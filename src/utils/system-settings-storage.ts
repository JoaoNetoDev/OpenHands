export interface SystemSettings {
  defaultWorkspaceId?: string;
  defaultLlmProfileName?: string;
  globalUserContextHtml?: string;
}

export const SYSTEM_SETTINGS_STORAGE_KEY = "openhands-system-settings";

export function readSystemSettings(): SystemSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSystemSettings(next: SystemSettings): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      SYSTEM_SETTINGS_STORAGE_KEY,
      JSON.stringify(next),
    );
    return true;
  } catch {
    return false;
  }
}
