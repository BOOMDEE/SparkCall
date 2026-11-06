export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const raw = payload && typeof payload === "object" ? (payload as { error?: unknown; message?: unknown }).error : undefined;
    const message = raw && typeof raw === "object" ? (raw as { message?: unknown }).message : raw;
    throw new Error(typeof message === "string" ? message : typeof (payload as { message?: unknown } | undefined)?.message === "string" ? String((payload as { message: string }).message) : `Request failed (${response.status})`);
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const envelope = payload as Record<string, unknown>;
    for (const key of ["user", "contacts", "history", "blocked", "record", "records", "preferences"]) {
      if (Object.hasOwn(envelope, key)) {
        if (key === "preferences" && Object.hasOwn(envelope, "version")) return payload as T;
        return envelope[key] as T;
      }
    }
  }
  return payload as T;
}

export type Me = {
  id: string;
  username: string | null;
  displayName: string;
  number: string | null;
  temporary: boolean;
  expiresAt: string | null;
};
export type Contact = {
  id: string;
  number: string;
  name: string;
  notes: string;
  favorite: boolean | number;
  created_at?: string;
  updated_at?: string;
};
export type HistoryItem = {
  id: string;
  caller?: string | null;
  recipient?: string | null;
  direction: "incoming" | "outgoing";
  status: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds?: number | null;
};
export type Usage = {
  available: boolean;
  month: string;
  usedBytes: number | null;
  quotaBytes: number | null;
  remainingBytes: number | null;
  percentageUsed: number | null;
  limitEnforced: boolean;
  lastUpdated: string | null;
  source: string;
  authoritative: boolean;
  note: string;
};
export type UserPreferences = {
  forceTurn: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  bitrateMode: "low" | "standard" | "high" | "custom";
  bitrateKbps: number;
  allowIncoming: boolean;
  showOnlineStatus: boolean;
  theme: "light" | "dark" | "system";
};
export type PreferenceSnapshot = { preferences: UserPreferences; version: number };
export type PublicRecord = {
  publicIdentifier: string;
  id?: string;
  slug?: string;
  title: string;
  description: string;
  notes: string;
  tags: string[];
  participants: Array<{ displayName: string }>;
  metadata: Record<string, string | number | boolean>;
  isPublic?: boolean;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
};
export type PrivateRecord = PublicRecord & {
  id: string;
  slug: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};
export type IncomingCallInvite = {
  callId: string;
  callerNumber: string;
  callerName: string;
  createdAt: number;
  expiresAt: number;
};
