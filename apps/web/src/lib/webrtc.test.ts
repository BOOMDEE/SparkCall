import { afterEach, describe, expect, it, vi } from "vitest";
import { CallController } from "./webrtc";

const controllers: CallController[] = [];
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
  constructor(config: RTCConfiguration) { FakePeer.configs.push(config); }
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  readonly sender = new FakeSender();
  readonly addTrack = vi.fn((track: FakeTrack) => { this.sender.track = track; });
  readonly getSenders = vi.fn(() => [this.sender] as unknown as RTCRtpSender[]);
  readonly getTransceivers = vi.fn(() => [] as RTCRtpTransceiver[]);
  readonly createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "offer" }));
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
  vi.stubGlobal("MediaStream", class { getTracks(): FakeTrack[] { return []; } });
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: [] }) });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("window", {
    location: { href: "https://sparkcall.test/" },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
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
