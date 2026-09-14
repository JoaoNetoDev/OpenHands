import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_SETTINGS_STORAGE_KEY,
  readSystemSettings,
  writeSystemSettings,
  type SystemSettings,
} from "./system-settings-storage";

describe("system-settings-storage", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns an empty object when nothing is stored", () => {
    expect(readSystemSettings()).toEqual({});
  });

  it("round-trips a written value through read", () => {
    const settings: SystemSettings = {
      defaultWorkspaceId: "workspace-1",
      defaultLlmProfileName: "profile-1",
      globalUserContextHtml: "<p>hello</p>",
    };

    const ok = writeSystemSettings(settings);

    expect(ok).toBe(true);
    expect(readSystemSettings()).toEqual(settings);
  });

  it("persists under the documented storage key", () => {
    const settings: SystemSettings = { defaultWorkspaceId: "workspace-1" };
    writeSystemSettings(settings);

    const raw = window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY);
    expect(raw).toBe(JSON.stringify(settings));
  });

  it("returns an empty object when localStorage.getItem throws", () => {
    vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(
      () => {
        throw new Error("boom");
      },
    );

    expect(readSystemSettings()).toEqual({});
  });

  it("returns false and does not throw when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(
      () => {
        throw new Error("quota exceeded");
      },
    );

    expect(() =>
      writeSystemSettings({ defaultWorkspaceId: "x" }),
    ).not.toThrow();
    expect(writeSystemSettings({ defaultWorkspaceId: "x" })).toBe(false);
  });

  it("returns an empty object when the stored value is corrupted JSON", () => {
    window.localStorage.setItem(SYSTEM_SETTINGS_STORAGE_KEY, "{not-json");

    expect(readSystemSettings()).toEqual({});
  });

  it("returns an empty object when the stored value is not an object", () => {
    window.localStorage.setItem(
      SYSTEM_SETTINGS_STORAGE_KEY,
      JSON.stringify("a string"),
    );

    expect(readSystemSettings()).toEqual({});
  });

  it("returns an empty object when the stored value is null", () => {
    window.localStorage.setItem(
      SYSTEM_SETTINGS_STORAGE_KEY,
      JSON.stringify(null),
    );

    expect(readSystemSettings()).toEqual({});
  });
});
