export type CallState =
  | "IDLE" | "CALLING" | "RINGING" | "CONNECTING" | "CONNECTED" | "ENDED"
  | "REJECTED" | "BUSY" | "TIMEOUT" | "FAILED" | "CANCELLED";
export type AudioBitratePreset = "low" | "standard" | "high" | "custom";
export interface TurnResponse { iceServers: RTCIceServer[]; expiresAt?: string; }
export interface CallSnapshot {
  id: string | null;
  state: CallState;
  role: "caller" | "callee" | null;
  durationMs: number;
  muted: boolean;
  connectionState: RTCPeerConnectionState | "new";
}
export interface IncomingCallInvite {
  callId: string;
  callerNumber: string;
  callerName: string;
  createdAt: number;
  expiresAt: number;
}
export interface AudioOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  audioInputDeviceId?: string;
  audioOutputDeviceId?: string;
  bitrateMode?: AudioBitratePreset;
  bitrateKbps?: number;
}
export interface CallControllerOptions {
  signalingUrl?: (callId: string) => string;
  presenceUrl?: string;
  turnCredentialsUrl?: string;
  iceServers?: RTCIceServer[];
  audio?: AudioOptions;
  onChange?: (snapshot: CallSnapshot) => void;
  onIncomingCall?: (invite: IncomingCallInvite) => void;
  onIncomingCallEnded?: (callId: string) => void;
  onPresenceChange?: (online: boolean) => void;
  onError?: (error: Error) => void;
}

interface Envelope { type: string; [key: string]: unknown; }
const TERMINAL: CallState[] = ["ENDED", "REJECTED", "BUSY", "TIMEOUT", "FAILED", "CANCELLED"];
const BITRATES: Record<Exclude<AudioBitratePreset, "custom">, number> = { low: 16, standard: 32, high: 64 };
const MAX_RECONNECTS = 3;

function asState(value: unknown): CallState | null {
  const states: CallState[] = ["IDLE", "CALLING", "RINGING", "CONNECTING", "CONNECTED", ...TERMINAL];
  return typeof value === "string" && states.includes(value as CallState) ? value as CallState : null;
}
function normalizeError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
function webSocketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** Browser WebRTC controller; all signaling requests are authenticated by the Worker session cookie. */
export class CallController {
  private readonly options: CallControllerOptions;
  private socket?: WebSocket;
  private presenceSocket?: WebSocket;
  private peer?: RTCPeerConnection;
  private localStream?: MediaStream;
  private remoteStream = new MediaStream();
  private remoteAudio?: HTMLAudioElement;
  private id: string | null = null;
  private role: "caller" | "callee" | null = null;
  private state: CallState = "IDLE";
  private muted = false;
  private connectedAt = 0;
  private generation = 0;
  private reconnectAttempts = 0;
  private reconnectTimer?: number;
  private presenceRetryTimer?: number;
  private presenceHeartbeat?: number;
  private durationTimer?: number;
  private presenceStopped = false;
  private sessionInvalid = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private audio: AudioOptions;

  constructor(options: CallControllerOptions = {}) {
    this.options = options;
    this.audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, bitrateMode: "standard", bitrateKbps: 32, ...options.audio };
  }

  get snapshot(): CallSnapshot { return this.currentSnapshot(); }
  get presenceConnected(): boolean { return this.presenceSocket?.readyState === WebSocket.OPEN; }

  async connectPresence(): Promise<void> {
    if (this.sessionInvalid) throw new Error("Your session ended. Sign in again.");
    this.presenceStopped = false;
    if (this.presenceConnected) return;
    await this.openPresenceSocket();
  }

  async updateAudioOptions(options: AudioOptions): Promise<void> {
    const previous = this.audio;
    this.audio = { ...this.audio, ...options };
    if (options.audioOutputDeviceId !== undefined && options.audioOutputDeviceId !== previous.audioOutputDeviceId && this.remoteAudio) {
      await this.applyAudioOutputPreference();
    }
    if (this.peer) {
      const captureChanged = (options.audioInputDeviceId !== undefined && options.audioInputDeviceId !== previous.audioInputDeviceId)
        || (options.echoCancellation !== undefined && options.echoCancellation !== previous.echoCancellation)
        || (options.noiseSuppression !== undefined && options.noiseSuppression !== previous.noiseSuppression)
        || (options.autoGainControl !== undefined && options.autoGainControl !== previous.autoGainControl);
      if (captureChanged) await this.setAudioInput(this.audio.audioInputDeviceId ?? "");
      await this.applyBitrate();
    }
  }

  async startOutgoing(callId: string, calleeId: string): Promise<void> {
    if (this.sessionInvalid) throw new Error("Your session ended. Sign in again.");
    if (!callId || !calleeId) throw new Error("The call request did not return a call ID and recipient.");
    this.prepareForNewCall();
    if (this.state !== "IDLE") throw new Error("A call is already active.");
    const generation = ++this.generation;
    this.id = callId;
    this.role = "caller";
    this.reconnectAttempts = 0;
    this.setState("CALLING");
    try {
      await this.openMediaAndPeer(generation);
      if (generation !== this.generation) return;
      await this.openCallSocket(generation);
      if (generation !== this.generation) return;
      const offer = await this.peer!.createOffer();
      await this.peer!.setLocalDescription(offer);
      const localOffer = this.peer!.localDescription;
      this.send({ type: "offer", payload: localOffer ? { type: localOffer.type, sdp: localOffer.sdp } : offer });
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw normalizeError(error);
    }
  }

  async acceptIncoming(callId: string): Promise<void> {
    if (this.sessionInvalid) throw new Error("Your session ended. Sign in again.");
    this.prepareForNewCall();
    if (this.state !== "IDLE") throw new Error("You are already in a call.");
    const generation = ++this.generation;
    this.id = callId;
    this.role = "callee";
    this.reconnectAttempts = 0;
    this.setState("RINGING");
    try {
      await this.openMediaAndPeer(generation);
      if (generation !== this.generation) return;
      await this.openCallSocket(generation);
      if (generation !== this.generation) return;
      this.send({ type: "accept" });
    } catch (error) {
      if (generation === this.generation) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          try { await this.openCallSocket(generation); } catch { /* caller will receive the room timeout */ }
        }
        this.send({ type: "busy" });
        this.fail(error);
      }
      throw normalizeError(error);
    }
  }

  async rejectIncoming(callId: string): Promise<void> {
    if (this.sessionInvalid) throw new Error("Your session ended. Sign in again.");
    this.prepareForNewCall();
    if (this.state !== "IDLE") throw new Error("You are already in a call.");
    const generation = ++this.generation;
    this.id = callId;
    this.role = "callee";
    this.setState("RINGING");
    try {
      await this.openCallSocket(generation);
      this.send({ type: "reject" });
    } catch (error) {
      this.options.onError?.(normalizeError(error));
      this.setState("FAILED");
      this.cleanup();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
    this.emit();
  }
  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }

  async setAudioInput(deviceId: string): Promise<void> {
    if (!this.peer) throw new Error("Start or accept a call before changing its microphone.");
    const peer = this.peer;
    const generation = this.generation;
    const constraints: MediaTrackConstraints = { echoCancellation: this.audio.echoCancellation, noiseSuppression: this.audio.noiseSuppression, autoGainControl: this.audio.autoGainControl };
    if (deviceId) constraints.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    const track = stream.getAudioTracks()[0];
    if (generation !== this.generation || this.peer !== peer || TERMINAL.includes(this.state)) {
      stream.getTracks().forEach((item) => item.stop());
      return;
    }
    const sender = peer.getSenders().find((item) => item.track?.kind === "audio");
    if (!track || !sender) { stream.getTracks().forEach((item) => item.stop()); throw new Error("The selected microphone is not available."); }
    track.enabled = !this.muted;
    await sender.replaceTrack(track);
    if (generation !== this.generation || this.peer !== peer || TERMINAL.includes(this.state)) {
      track.stop();
      return;
    }
    for (const old of this.localStream?.getTracks() ?? []) old.stop();
    this.localStream = stream;
    this.emit();
  }

  async setAudioOutput(deviceId: string): Promise<void> {
    if (!this.remoteAudio) throw new Error("The remote audio output is not available yet.");
    const element = this.remoteAudio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (!element.setSinkId) throw new Error("This browser does not support speaker selection.");
    await element.setSinkId(deviceId);
  }

  async setBitrate(mode: AudioBitratePreset, customKbps?: number): Promise<void> {
    this.audio = { ...this.audio, bitrateMode: mode, bitrateKbps: customKbps ?? this.audio.bitrateKbps };
    await this.applyBitrate();
  }

  attachRemoteAudio(element: HTMLAudioElement): void {
    this.remoteAudio = element;
    element.autoplay = true;
    element.srcObject = this.remoteStream;
    void element.play().catch(() => undefined);
    void this.applyAudioOutputPreference().catch(() => undefined);
  }

  hangup(): void { this.finishLocally("ENDED", "hangup"); }
  cancel(): void { this.finishLocally("CANCELLED", "cancel"); }

  destroy(): void {
    this.presenceStopped = true;
    this.generation++;
    if (this.presenceRetryTimer) window.clearTimeout(this.presenceRetryTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.presenceHeartbeat) window.clearInterval(this.presenceHeartbeat);
    this.presenceSocket?.close(1000, "Session closed");
    this.presenceSocket = undefined;
    this.cleanup();
    this.setState("IDLE");
  }

  private async openPresenceSocket(): Promise<void> {
    if (this.presenceStopped) return;
    const socket = new WebSocket(webSocketUrl(this.options.presenceUrl ?? "/api/presence"));
    this.presenceSocket = socket;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => { socket.close(); if (!settled) { settled = true; reject(new Error("Presence connection timed out.")); } }, 10_000);
      socket.onopen = () => {
        window.clearTimeout(timer);
        settled = true;
        this.options.onPresenceChange?.(true);
        if (this.presenceHeartbeat) window.clearInterval(this.presenceHeartbeat);
        this.presenceHeartbeat = window.setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" })); }, 25_000);
        resolve();
      };
      socket.onerror = () => { window.clearTimeout(timer); if (!settled) { settled = true; reject(new Error("Presence connection failed.")); } };
      socket.onclose = () => {
        window.clearTimeout(timer);
        this.options.onPresenceChange?.(false);
        if (this.presenceHeartbeat) window.clearInterval(this.presenceHeartbeat);
        if (this.presenceSocket === socket) this.presenceSocket = undefined;
        if (!settled) { settled = true; reject(new Error("Presence connection closed.")); }
        this.schedulePresenceReconnect();
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as Envelope;
          if (message.type === "session-invalid") {
            this.invalidateSession();
          } else if (message.type === "incoming-call") {
            const invite = message as unknown as IncomingCallInvite & Envelope;
            if (invite.expiresAt > Date.now() && typeof invite.callId === "string") this.options.onIncomingCall?.(invite);
          } else if (message.type === "incoming-call-ended" && typeof message.callId === "string") {
            this.options.onIncomingCallEnded?.(message.callId);
          }
        } catch { /* ignore malformed presence event */ }
      };
    });
  }

  private schedulePresenceReconnect(): void {
    if (this.presenceStopped || this.presenceRetryTimer) return;
    this.presenceRetryTimer = window.setTimeout(() => {
      this.presenceRetryTimer = undefined;
      void this.openPresenceSocket().catch(() => this.schedulePresenceReconnect());
    }, 2_000);
  }

  private async openMediaAndPeer(generation: number): Promise<void> {
    const constraints: MediaTrackConstraints = {
      echoCancellation: this.audio.echoCancellation,
      noiseSuppression: this.audio.noiseSuppression,
      autoGainControl: this.audio.autoGainControl,
    };
    if (this.audio.audioInputDeviceId) constraints.deviceId = { exact: this.audio.audioInputDeviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
    for (const track of stream.getAudioTracks()) track.enabled = !this.muted;
    this.localStream = stream;
    const servers = this.options.iceServers ?? await this.fetchTurnServers();
    if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
    this.peer = new RTCPeerConnection({ iceServers: servers });
    for (const track of stream.getTracks()) {
      track.enabled = !this.muted;
      this.peer.addTrack(track, stream);
    }
    this.preferOpusCodec();
    this.peer.onicecandidate = (event) => { if (event.candidate) this.send({ type: "ice-candidate", payload: event.candidate.toJSON() }); };
    this.peer.ontrack = (event) => {
      const tracks = event.streams[0]?.getTracks() ?? [event.track];
      for (const track of tracks) if (!this.remoteStream.getTracks().some((existing) => existing.id === track.id)) this.remoteStream.addTrack(track);
      if (this.remoteAudio) { this.remoteAudio.srcObject = this.remoteStream; void this.remoteAudio.play().catch(() => undefined); }
    };
    this.peer.onconnectionstatechange = () => {
      const state = this.peer?.connectionState;
      if (state === "connected") {
        this.reconnectAttempts = 0;
        this.setState("CONNECTED");
        this.send({ type: "connected" });
      } else if (state === "failed") {
        this.fail(new Error("The audio connection failed. Check your network and TURN setup."));
      } else if (state === "connecting") {
        this.setState("CONNECTING");
      }
      this.emit();
    };
    this.peer.oniceconnectionstatechange = () => {
      if (this.peer?.iceConnectionState === "disconnected" && this.state === "CONNECTED") this.setState("CONNECTING");
    };
    await this.applyBitrate();
  }

  private async fetchTurnServers(): Promise<RTCIceServer[]> {
    const response = await fetch(this.options.turnCredentialsUrl ?? "/api/turn/credentials", { credentials: "include", headers: { accept: "application/json" } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(payload.error?.message ?? `TURN credentials are unavailable (${response.status}).`);
    }
    const data = await response.json() as TurnResponse;
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error("The TURN service returned no ICE servers.");
    return data.iceServers;
  }

  private async openCallSocket(generation: number): Promise<void> {
    if (!this.id || generation !== this.generation) return;
    const path = this.options.signalingUrl?.(this.id) ?? `/api/calls/${encodeURIComponent(this.id)}/signaling`;
    const socket = new WebSocket(webSocketUrl(path));
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => { socket.close(); if (!settled) { settled = true; reject(new Error("Signaling connection timed out.")); } }, 10_000);
      socket.onopen = () => { window.clearTimeout(timer); settled = true; this.reconnectAttempts = 0; resolve(); };
      socket.onerror = () => { window.clearTimeout(timer); if (!settled) { settled = true; reject(new Error("Signaling connection failed.")); } };
      socket.onclose = () => {
        window.clearTimeout(timer);
        if (this.socket === socket) this.socket = undefined;
        if (!settled) { settled = true; reject(new Error("Signaling connection closed.")); }
        if (generation === this.generation && !TERMINAL.includes(this.state)) this.scheduleCallReconnect(generation);
      };
    });
    socket.onmessage = (event) => { void this.receive(event.data); };
  }

  private scheduleCallReconnect(generation: number): void {
    if (this.reconnectTimer || generation !== this.generation || TERMINAL.includes(this.state)) return;
    if (this.reconnectAttempts >= MAX_RECONNECTS) { this.fail(new Error("Signaling connection was lost. The call has ended.")); return; }
    const delay = 750 * (2 ** this.reconnectAttempts++);
    this.setState("CONNECTING");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openCallSocket(generation).catch((error) => {
        this.options.onError?.(normalizeError(error));
        this.scheduleCallReconnect(generation);
      });
    }, delay);
  }

  private async receive(raw: unknown): Promise<void> {
    if (typeof raw !== "string") return;
    let message: Envelope;
    try { message = JSON.parse(raw) as Envelope; } catch { return; }
    if (message.type === "session-invalid") { this.invalidateSession(); return; }
    if (message.type === "call-state") {
      const state = asState(message.status);
      if (!state) return;
      this.setState(state);
      if (state === "CONNECTED" && !this.connectedAt) this.connectedAt = Date.now();
      if (TERMINAL.includes(state)) this.cleanup();
      return;
    }
    const payload = message.payload;
    try {
      if (message.type === "offer" && this.role === "callee") {
        if (!this.peer) throw new Error("The audio connection is not ready.");
        await this.peer.setRemoteDescription(payload as RTCSessionDescriptionInit);
        for (const candidate of this.pendingCandidates) await this.peer.addIceCandidate(candidate);
        this.pendingCandidates = [];
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        const localAnswer = this.peer.localDescription;
        this.send({ type: "answer", payload: localAnswer ? { type: localAnswer.type, sdp: localAnswer.sdp } : answer });
        this.setState("CONNECTING");
      } else if (message.type === "answer" && this.role === "caller") {
        await this.peer?.setRemoteDescription(payload as RTCSessionDescriptionInit);
        for (const candidate of this.pendingCandidates) await this.peer?.addIceCandidate(candidate);
        this.pendingCandidates = [];
        this.setState("CONNECTING");
      } else if (message.type === "ice-candidate") {
        const candidate = payload as RTCIceCandidateInit;
        if (this.peer?.remoteDescription) await this.peer.addIceCandidate(candidate);
        else this.pendingCandidates.push(candidate);
      }
    } catch (error) { this.fail(error); }
  }

  private send(message: Envelope): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private async applyAudioOutputPreference(): Promise<void> {
    if (!this.remoteAudio || !this.audio.audioOutputDeviceId) return;
    const output = this.remoteAudio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (output.setSinkId) await output.setSinkId(this.audio.audioOutputDeviceId);
  }
  private async applyBitrate(): Promise<void> {
    if (!this.peer) return;
    const mode = this.audio.bitrateMode ?? "standard";
    const kbps = mode === "custom" ? this.audio.bitrateKbps ?? 32 : BITRATES[mode];
    const sender = this.peer.getSenders().find((item) => item.track?.kind === "audio");
    if (!sender) return;
    try {
      const parameters = sender.getParameters();
      parameters.encodings ??= [{}];
      parameters.encodings[0]!.maxBitrate = Math.max(6, Math.min(128, kbps)) * 1_000;
      await sender.setParameters(parameters);
    } catch { /* Some browsers do not support changing sender bitrate. */ }
  }

  private preferOpusCodec(): void {
    const transceiver = this.peer?.getTransceivers().find((item) => item.sender.track?.kind === "audio");
    const codecs = RTCRtpSender.getCapabilities("audio")?.codecs;
    if (!transceiver?.setCodecPreferences || !codecs?.length) return;
    const opus = codecs.filter((codec) => codec.mimeType.toLowerCase() === "audio/opus");
    if (opus.length) transceiver.setCodecPreferences([...opus, ...codecs.filter((codec) => codec.mimeType.toLowerCase() !== "audio/opus")]);
  }

  private finishLocally(state: "ENDED" | "CANCELLED", signal: "hangup" | "cancel"): void {
    if (this.state === "IDLE" || TERMINAL.includes(this.state)) return;
    this.generation++;
    this.send({ type: signal });
    this.setState(state);
    // WebSocket.close flushes already queued messages; an arbitrary delayed
    // cleanup can stop the microphone of a new call started in that interval.
    this.cleanup();
  }

  private prepareForNewCall(): void {
    if (!TERMINAL.includes(this.state)) return;
    this.cleanup();
    this.id = null;
    this.role = null;
    this.connectedAt = 0;
    this.pendingCandidates = [];
    this.setState("IDLE");
  }

  private setState(state: CallState): void {
    this.state = state;
    if (state === "CONNECTED" && !this.connectedAt) this.connectedAt = Date.now();
    if (state === "CONNECTED" && !this.durationTimer) this.durationTimer = window.setInterval(() => this.emit(), 1_000);
    if (TERMINAL.includes(state) && this.durationTimer) { window.clearInterval(this.durationTimer); this.durationTimer = undefined; }
    this.emit();
  }
  private emit(): void { this.options.onChange?.(this.currentSnapshot()); }
  private currentSnapshot(): CallSnapshot {
    return { id: this.id, state: this.state, role: this.role, durationMs: this.connectedAt ? Date.now() - this.connectedAt : 0, muted: this.muted, connectionState: this.peer?.connectionState ?? "new" };
  }
  private invalidateSession(): void {
    if (this.sessionInvalid) return;
    this.sessionInvalid = true;
    this.presenceStopped = true;
    this.generation++;
    if (this.presenceRetryTimer) window.clearTimeout(this.presenceRetryTimer);
    this.presenceRetryTimer = undefined;
    if (this.presenceHeartbeat) window.clearInterval(this.presenceHeartbeat);
    this.presenceHeartbeat = undefined;
    this.presenceSocket?.close(1000, "Session ended");
    this.presenceSocket = undefined;
    this.cleanup();
    this.setState("FAILED");
    this.options.onPresenceChange?.(false);
    this.options.onError?.(new Error("Your session ended. Sign in again."));
  }
  private fail(error: unknown): void {
    const normalized = normalizeError(error);
    this.generation++;
    this.options.onError?.(normalized);
    this.setState("FAILED");
    this.cleanup();
  }
  private cleanup(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    try { socket?.close(1000, "Call ended"); } catch { /* closed */ }
    this.peer?.close();
    this.peer = undefined;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = undefined;
    this.remoteStream.getTracks().forEach((track) => track.stop());
    this.remoteStream = new MediaStream();
    if (this.remoteAudio) this.remoteAudio.srcObject = this.remoteStream;
    if (this.durationTimer) window.clearInterval(this.durationTimer);
    this.durationTimer = undefined;
    this.connectedAt = 0;
    this.pendingCandidates = [];
  }
}

export default CallController;
