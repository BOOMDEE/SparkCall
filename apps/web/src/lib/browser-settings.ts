export type BrowserSettings = {
  doNotDisturb: boolean;
  missedCallNotifications: boolean;
};

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  doNotDisturb: false,
  missedCallNotifications: false,
};

const SETTINGS_PREFIX = "sparkcall:browser-settings:v1:";
const SEEN_PREFIX = "sparkcall:missed-call-notifications:v1:";
const MAX_STORED_IDS = 100;

export function browserSettingsKey(userId: string) {
  return `${SETTINGS_PREFIX}${userId}`;
}

function seenCallIdsKey(userId: string) {
  return `${SEEN_PREFIX}${userId}`;
}

export function readBrowserSettings(userId: string): BrowserSettings {
  try {
    const raw = localStorage.getItem(browserSettingsKey(userId));
    if (!raw || raw.length > 512) return DEFAULT_BROWSER_SETTINGS;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_BROWSER_SETTINGS;
    const settings = value as Record<string, unknown>;
    return {
      doNotDisturb: typeof settings.doNotDisturb === "boolean" ? settings.doNotDisturb : false,
      missedCallNotifications: typeof settings.missedCallNotifications === "boolean" ? settings.missedCallNotifications : false,
    };
  } catch {
    return DEFAULT_BROWSER_SETTINGS;
  }
}

export function writeBrowserSettings(userId: string, settings: BrowserSettings) {
  try {
    localStorage.setItem(browserSettingsKey(userId), JSON.stringify({
      doNotDisturb: settings.doNotDisturb,
      missedCallNotifications: settings.missedCallNotifications,
    }));
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
}

export function readSeenMissedCallIds(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(seenCallIdsKey(userId));
    if (raw === null) return null;
    if (raw.length > 12_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128))].slice(-MAX_STORED_IDS);
  } catch {
    return null;
  }
}

export function writeSeenMissedCallIds(userId: string, ids: string[]) {
  try {
    localStorage.setItem(seenCallIdsKey(userId), JSON.stringify([...new Set(ids)].slice(-MAX_STORED_IDS)));
  } catch {
    // Notifications remain best-effort if browser storage is unavailable.
  }
}

export function clearSeenMissedCallIds(userId: string) {
  try {
    localStorage.removeItem(seenCallIdsKey(userId));
  } catch {
    // Ignore unavailable browser storage.
  }
}
