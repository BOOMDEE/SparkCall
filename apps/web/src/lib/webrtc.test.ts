import { afterEach, describe, expect, it, vi } from "vitest";
import { CallController } from "./webrtc";

const controllers: CallController[] = [];
afterEach(() => { vi.useRealTimers(); });
function createController(options: ConstructorParameters<typeof CallController>[0] = {}) {
  const controller = new CallController(options);
  controllers.push(controller);
  return controller;
}

class FakeTrack {
  readonly kind = "audio";
  readonly id: string;
  enabled = true;
  stopped = false;

  constructor(id: string) { this.id = id; }
  stop(): void { this.stopped = true; }
}

class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(track: FakeTrack) { this.tracks = [track]; }
  getAudioTracks(): FakeTrack[] { return this.tracks; }
  getTracks(): FakeTrack[] { return this.tracks; }
}

class FakeSender {
  track: FakeTrack | null = null;
  replacedTrackEnabled: boolean | undefined;
  replaceTrack = vi.fn(async (track: FakeTrack) => { this.replacedTrackEnabled = track.enabled; this.track = track; });
  getParameters = vi.fn(() => ({ encodings: [{}] }));
  setParameters = vi.fn(async () => undefined);
}

class FakePeer {
  static configs: RTCConfiguration[] = [];
  static instances: FakePeer[] = [];
  constructor(config: RTCConfiguration) { FakePeer.configs.push(config); FakePeer.instances.push(this); }
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  readonly sender = new FakeSender();
  readonly addTrack = vi.fn((track: FakeTrack) => { this.sender.track = track; });
  readonly getSenders = vi.fn(() => [this.sender] as unknown as RTCRtpSender[]);
  readonly getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  readonly getStats = vi.fn(async () => new Map() as unknown as RTCStatsReport);
  readonly createOffer = vi.fn(async (options?: RTCOfferOptions) => ({ type: "offer" as const, sdp: options?.iceRestart ? "ice-restart-offer" : "offer" }));
  readonly setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.localDescription = description; });
  readonly close = vi.fn();
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readonly send = vi.fn();
  close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); });
  constructor(_url: string) { FakeWebSocket.instances.push(this); queueMicrotask(() => this.onopen?.()); }
}

function installWebRtcMocks(getUserMedia: typeof navigator.mediaDevices.getUserMedia) {
  FakeWebSocket.instances = [];
  FakePeer.configs = [];
  FakePeer.instances = [];
  vi.stubGlobal("MediaStream", class { getTracks(): FakeTrack[] { return []; } });
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: [] }) });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("window", {
    location: { href: "https://sparkcall.test/" },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: (type: string, listener: () => void) => { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener); },
    dispatch: (type: string) => { for (const listener of listeners.get(type) ?? []) listener(); },
  });
}

describe("CallController ICE transport policy", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });
  it("uses standard ICE with all candidates by default", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("default"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-default", "callee");
    expect(FakePeer.configs[0]?.iceTransportPolicy).toBe("all");
  });
  it("uses relay-only ICE when Force TURN is enabled", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("relay"))));
    const controller = createController({ iceServers: [], audio: { forceTurn: true } });
    await controller.startOutgoing("call-relay", "callee");
    expect(FakePeer.configs[0]?.iceTransportPolicy).toBe("relay");
  });
});
describe("CallController TURN credential failures", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });

  it("falls back to direct ICE when TURN credentials fail for a normal call", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("direct"))));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("TURN unavailable")));
    const controller = createController();

    await controller.startOutgoing("call-direct-fallback", "callee");

    expect(FakePeer.configs[0]).toMatchObject({ iceServers: [], iceTransportPolicy: "all" });
  });

  it("fails clearly instead of falling back when Force TURN credentials fail", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("relay"))));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("TURN unavailable")));
    const controller = createController({ audio: { forceTurn: true } });

    await expect(controller.startOutgoing("call-relay-failure", "callee")).rejects.toThrow(/Relay-only calling is unavailable.*TURN unavailable/);
    expect(FakePeer.configs).toHaveLength(0);
  });
});

describe("CallController connection mode", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });

  it("reports P2P only after selected ICE stats identify a non-relay candidate pair", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-mode-p2p", "callee");
    const peer = FakePeer.instances[0]!;
    peer.getStats.mockResolvedValue(new Map([
      ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" }],
      ["pair", { id: "pair", type: "candidate-pair", localCandidateId: "local", remoteCandidateId: "remote", state: "succeeded", nominated: true }],
      ["local", { id: "local", type: "local-candidate", candidateType: "host" }],
      ["remote", { id: "remote", type: "remote-candidate", candidateType: "srflx" }],
    ]) as unknown as RTCStatsReport);
    peer.connectionState = "connected";
    peer.iceConnectionState = "connected";
    peer.onconnectionstatechange?.();
    await vi.waitFor(() => expect(controller.snapshot.connectionMode).toBe("p2p"));
  });

  it("reports TURN when either selected candidate is relayed", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-mode-turn", "callee");
    const peer = FakePeer.instances[0]!;
    peer.getStats.mockResolvedValue(new Map([
      ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" }],
      ["pair", { id: "pair", type: "candidate-pair", localCandidateId: "local", remoteCandidateId: "remote", state: "succeeded", nominated: true }],
      ["local", { id: "local", type: "local-candidate", candidateType: "relay" }],
      ["remote", { id: "remote", type: "remote-candidate", candidateType: "srflx" }],
    ]) as unknown as RTCStatsReport);
    peer.connectionState = "connected";
    peer.iceConnectionState = "connected";
    peer.onconnectionstatechange?.();
    await vi.waitFor(() => expect(controller.snapshot.connectionMode).toBe("turn"));
  });

  it("skips TURN credential allocation in P2P-only mode", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = createController({ audio: { connectionMode: "p2p" } });
    await controller.startOutgoing("call-p2p-only", "callee");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakePeer.configs[0]).toMatchObject({ iceServers: [], iceTransportPolicy: "all" });
  });

  it("keeps Auto calls on a P2P attempt when the TURN limit blocks relay credentials", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ iceServers: [], relayUnavailable: true, reason: "monthly_turn_limit_reached" }), { status: 200 })));
    const controller = createController();
    await controller.startOutgoing("call-auto-limit", "callee");
    expect(FakePeer.configs[0]).toMatchObject({ iceServers: [], iceTransportPolicy: "all" });
    expect(controller.snapshot.relayUnavailable).toBe(true);
  });

  it("does not restart an active call when the user selects a different mode", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-mode-next", "callee");
    await controller.updateAudioOptions({ connectionMode: "turn" });
    expect(FakePeer.configs).toHaveLength(1);
    expect(controller.snapshot.connectionState).toBe("new");
  });
});

describe("CallController automatic ICE recovery", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });

  it("sends a restart offer after a sustained disconnect and reports recovery", async () => {
    vi.useFakeTimers();
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-ice-restart", "callee");
    const peer = FakePeer.instances[0]!;
    peer.connectionState = "connected";
    peer.iceConnectionState = "connected";
    peer.onconnectionstatechange?.();
    peer.iceConnectionState = "disconnected";
    peer.oniceconnectionstatechange?.();
    expect(controller.snapshot.recoveryStatus).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1_500);

    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
    expect(FakeWebSocket.instances[0]?.send).toHaveBeenCalledWith(JSON.stringify({ type: "offer", payload: { type: "offer", sdp: "ice-restart-offer" } }));
    expect(controller.snapshot.state).toBe("CONNECTING");
    peer.connectionState = "connected";
    peer.iceConnectionState = "connected";
    peer.oniceconnectionstatechange?.();
    peer.onconnectionstatechange?.();
    expect(controller.snapshot.state).toBe("CONNECTED");
    expect(controller.snapshot.recoveryStatus).toBe("recovered");
  });

  it("cancels the restart when ICE recovers during the disconnect grace period", async () => {
    vi.useFakeTimers();
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-ice-flap", "callee");
    const peer = FakePeer.instances[0]!;
    peer.connectionState = "connected";
    peer.iceConnectionState = "connected";
    peer.onconnectionstatechange?.();
    peer.iceConnectionState = "disconnected";
    peer.oniceconnectionstatechange?.();
    peer.iceConnectionState = "connected";
    peer.oniceconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.recoveryStatus).toBe("recovered");
  });

  it("waits while the device is offline and resumes recovery when it returns online", async () => {
    vi.useFakeTimers();
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-network-toggle", "callee");
    const peer = FakePeer.instances[0]!;
    peer.iceConnectionState = "disconnected";
    peer.oniceconnectionstatechange?.();
    (window as unknown as { dispatch: (type: string) => void }).dispatch("offline");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.snapshot.networkOnline).toBe(false);
    expect(peer.createOffer).toHaveBeenCalledTimes(1);

    (window as unknown as { dispatch: (type: string) => void }).dispatch("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.snapshot.networkOnline).toBe(true);
    expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
  });

  it("stops after two restart attempts instead of looping indefinitely", async () => {
    vi.useFakeTimers();
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-restart-limit", "callee");
    const peer = FakePeer.instances[0]!;
    peer.connectionState = "failed";
    peer.iceConnectionState = "failed";
    peer.onconnectionstatechange?.();
    peer.oniceconnectionstatechange?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(peer.createOffer).toHaveBeenCalledTimes(3);
    expect(controller.snapshot.state).toBe("FAILED");
    expect(controller.snapshot.recoveryStatus).toBe("failed");
  });

  it("clears a pending restart when the caller hangs up", async () => {
    vi.useFakeTimers();
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-restart-cancel", "callee");
    const peer = FakePeer.instances[0]!;
    peer.iceConnectionState = "disconnected";
    peer.oniceconnectionstatechange?.();
    controller.hangup();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(peer.createOffer).toHaveBeenCalledTimes(1);
    expect(peer.oniceconnectionstatechange).toBeNull();
    expect(controller.snapshot.recoveryStatus).toBe("idle");
  });
});

describe("CallController server-side cancellation", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });

  it("POSTs cancellation and stops a microphone stream that resolves after the user cancels", async () => {
    let resolveMedia!: (stream: FakeStream) => void;
    const getUserMedia = vi.fn(() => new Promise<FakeStream>((resolve) => { resolveMedia = resolve; }));
    installWebRtcMocks(getUserMedia as unknown as typeof navigator.mediaDevices.getUserMedia);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = createController({ iceServers: [] });
    const starting = controller.startOutgoing("call-early-cancel", "callee");

    controller.cancel();
    controller.cancel();
    expect(controller.snapshot.state).toBe("CANCELLED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/calls/call-early-cancel/cancel", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));

    const lateStream = new FakeStream(new FakeTrack("late-media"));
    resolveMedia(lateStream);
    await starting;
    expect(lateStream.getTracks()[0]?.stopped).toBe(true);
  });
});

describe("CallController remote audio playback", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });

  it("reports autoplay rejection and clears it after a user-gesture retry", async () => {
    installWebRtcMocks(vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("audio"))));
    const blocked = vi.fn();
    const recovered = vi.fn();
    const play = vi.fn().mockRejectedValueOnce(new Error("autoplay blocked")).mockResolvedValue(undefined);
    const controller = createController({ onAudioPlaybackBlocked: blocked, onAudioPlaybackRecovered: recovered });
    const audio = { play } as unknown as HTMLAudioElement;

    controller.attachRemoteAudio(audio);
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(1));
    await controller.resumeRemoteAudio();

    expect(play).toHaveBeenCalledTimes(2);
    expect(recovered).toHaveBeenCalledTimes(1);
  });
});

describe("CallController microphone mute intent", () => {
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.destroy();
    vi.unstubAllGlobals();
  });

  it("keeps a muted snapshot and disables the new track before a subsequent outgoing call adds it", async () => {
    const first = new FakeStream(new FakeTrack("first"));
    const second = new FakeStream(new FakeTrack("second"));
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    installWebRtcMocks(getUserMedia);

    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-1", "callee");
    controller.setMuted(true);
    controller.hangup();
    expect(first.getAudioTracks()[0]?.stopped).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.startOutgoing("call-2", "callee");

    expect(controller.snapshot.muted).toBe(true);
    expect(second.getAudioTracks()[0]?.enabled).toBe(false);
    expect((controller as unknown as { peer: FakePeer }).peer.addTrack).toHaveBeenCalledWith(second.getAudioTracks()[0], second);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(second.getAudioTracks()[0]?.stopped).toBe(false);
  });

  it("disables the replacement track before replacing a muted microphone", async () => {
    const first = new FakeStream(new FakeTrack("first"));
    const replacement = new FakeStream(new FakeTrack("replacement"));
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
    installWebRtcMocks(getUserMedia);

    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-1", "callee");
    controller.setMuted(true);
    await controller.setAudioInput("mic-2");

    expect(replacement.getAudioTracks()[0]?.enabled).toBe(false);
    const sender = (controller as unknown as { peer: FakePeer }).peer.sender;
    expect(sender.replaceTrack).toHaveBeenCalledWith(replacement.getAudioTracks()[0]);
    expect(sender.replacedTrackEnabled).toBe(false);
  });

  it("uses the latest mute state when getUserMedia resolves asynchronously", async () => {
    const first = new FakeStream(new FakeTrack("first"));
    const replacement = new FakeStream(new FakeTrack("replacement"));
    let resolveReplacement!: (stream: FakeStream) => void;
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise<FakeStream>((resolve) => { resolveReplacement = resolve; }));
    installWebRtcMocks(getUserMedia);

    const controller = createController({ iceServers: [] });
    await controller.startOutgoing("call-1", "callee");
    controller.setMuted(true);
    const changingMic = controller.setAudioInput("mic-2");
    controller.setMuted(false);
    resolveReplacement(replacement);
    await changingMic;

    expect(replacement.getAudioTracks()[0]?.enabled).toBe(true);
    expect(controller.snapshot.muted).toBe(false);
  });

  it("applies a saved output preference when remote audio is attached", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(new FakeStream(new FakeTrack("first")));
    installWebRtcMocks(getUserMedia);
    const setSinkId = vi.fn(async (_deviceId: string) => undefined);
    const audio = { play: vi.fn(async () => undefined), setSinkId } as unknown as HTMLAudioElement;
    const controller = createController({ audio: { audioOutputDeviceId: "speaker-2" } });

    controller.attachRemoteAudio(audio);

    await vi.waitFor(() => expect(setSinkId).toHaveBeenCalledWith("speaker-2"));
  });

  it.each(["call", "presence"])("stops capture and disallows reconnects when the %s socket reports an invalid session", async (source) => {
    const stream = new FakeStream(new FakeTrack("active"));
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    installWebRtcMocks(getUserMedia);
    const onError = vi.fn();
    const controller = createController({ iceServers: [], onError });
    await controller.connectPresence();
    await controller.startOutgoing("call-1", "callee");
    const socket = FakeWebSocket.instances[source === "presence" ? 0 : 1]!;
    socket.onmessage?.({ data: JSON.stringify({ type: "session-invalid" }) });

    expect(stream.getAudioTracks()[0]?.stopped).toBe(true);
    expect(controller.snapshot.state).toBe("FAILED");
    expect(controller.presenceConnected).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Sign in again") }));
    await expect(controller.startOutgoing("call-2", "callee")).rejects.toThrow("session ended");
    await expect(controller.connectPresence()).rejects.toThrow("session ended");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
