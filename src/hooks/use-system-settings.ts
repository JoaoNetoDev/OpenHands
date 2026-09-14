import * as React from "react";
import {
  readSystemSettings,
  writeSystemSettings,
  type SystemSettings,
} from "#/utils/system-settings-storage";

export function useSystemSettings(): {
  settings: SystemSettings;
  saveSystemSettings: (next: SystemSettings) => boolean;
} {
  const [settings, setSettings] = React.useState<SystemSettings>(() =>
    readSystemSettings(),
  );

  const saveSystemSettings = React.useCallback((next: SystemSettings) => {
    const ok = writeSystemSettings(next);
    if (ok) setSettings(next);
    return ok;
  }, []);

  return { settings, saveSystemSettings };
}
