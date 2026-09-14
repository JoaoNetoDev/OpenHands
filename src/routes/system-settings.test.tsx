import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test-utils";
import { SystemSettingsScreen } from "./system-settings";
import { OSS_NAV_ITEMS } from "#/constants/settings-nav";
import {
  SYSTEM_SETTINGS_STORAGE_KEY,
  type SystemSettings,
} from "#/utils/system-settings-storage";

const useLocalWorkspacesMock = vi.fn();
const useLlmProfilesMock = vi.fn();
const displayErrorToastMock = vi.fn();
const displaySuccessToastMock = vi.fn();

vi.mock("#/hooks/query/use-local-workspaces", () => ({
  useLocalWorkspaces: () => useLocalWorkspacesMock(),
}));

vi.mock("#/hooks/query/use-llm-profiles", () => ({
  useLlmProfiles: () => useLlmProfilesMock(),
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: (...args: unknown[]) => displayErrorToastMock(...args),
  displaySuccessToast: (...args: unknown[]) => displaySuccessToastMock(...args),
}));

const WORKSPACES = [
  { id: "ws-1", name: "Workspace One", path: "/ws1" },
  { id: "ws-2", name: "Workspace Two", path: "/ws2" },
];

const PROFILES = [
  { name: "profile-a", model: "gpt-4o" },
  { name: "profile-b", model: "claude" },
];

function setLocalWorkspaces(
  overrides: Partial<{ data: unknown; isLoading: boolean }> = {},
) {
  useLocalWorkspacesMock.mockReturnValue({
    data: { workspaces: WORKSPACES, workspaceParents: [] },
    isLoading: false,
    ...overrides,
  });
}

function setLlmProfiles(
  overrides: Partial<{ data: unknown; isLoading: boolean }> = {},
) {
  useLlmProfilesMock.mockReturnValue({
    data: { profiles: PROFILES },
    isLoading: false,
    ...overrides,
  });
}

describe("SystemSettingsScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    setLocalWorkspaces();
    setLlmProfiles();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("CA-01: registers a System nav item pointing at /settings/system", () => {
    const systemItem = OSS_NAV_ITEMS.find(
      (item) => item.to === "/settings/system",
    );
    expect(systemItem).toBeDefined();
    expect(systemItem?.text).toBe("SETTINGS$NAV_SYSTEM");
  });

  it("CA-02: selecting a workspace and saving persists defaultWorkspaceId, reselected after reload", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<SystemSettingsScreen />);

    const workspaceInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
    });
    await user.click(workspaceInput);
    await user.click(await screen.findByText("Workspace Two"));

    await user.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(displaySuccessToastMock).toHaveBeenCalled();
    });

    const stored = JSON.parse(
      window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY) as string,
    ) as SystemSettings;
    expect(stored.defaultWorkspaceId).toBe("ws-2");

    unmount();

    renderWithProviders(<SystemSettingsScreen />);
    const reselected = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
    });
    expect(reselected).toHaveDisplayValue("Workspace Two");
  });

  it("CA-03: selecting an LLM profile and saving persists defaultLlmProfileName, reselected after reload", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<SystemSettingsScreen />);

    const profileInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
    });
    await user.click(profileInput);
    await user.click(await screen.findByText("profile-b"));

    await user.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(displaySuccessToastMock).toHaveBeenCalled();
    });

    const stored = JSON.parse(
      window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY) as string,
    ) as SystemSettings;
    expect(stored.defaultLlmProfileName).toBe("profile-b");

    unmount();

    renderWithProviders(<SystemSettingsScreen />);
    const reselected = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
    });
    expect(reselected).toHaveDisplayValue("profile-b");
  });

  it("CA-06: shows a link instead of an empty list when there are no workspaces", () => {
    setLocalWorkspaces({ data: { workspaces: [], workspaceParents: [] } });
    renderWithProviders(<SystemSettingsScreen />);

    expect(
      screen.queryByRole("combobox", {
        name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
      }),
    ).not.toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_EMPTY_LINK/,
    });
    expect(link).toHaveAttribute("href", "/");
  });

  it("CA-06b: shows a link to /settings/llm when there are no LLM profiles", () => {
    setLlmProfiles({ data: { profiles: [] } });
    renderWithProviders(<SystemSettingsScreen />);

    expect(
      screen.queryByRole("combobox", {
        name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
      }),
    ).not.toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_EMPTY_LINK/,
    });
    expect(link).toHaveAttribute("href", "/settings/llm");
  });

  it("CA-07: a workspace saved as default but later removed reconciles to unselected", () => {
    window.localStorage.setItem(
      SYSTEM_SETTINGS_STORAGE_KEY,
      JSON.stringify({ defaultWorkspaceId: "deleted-ws" }),
    );
    const consoleErrorSpy = vi.spyOn(console, "error");

    renderWithProviders(<SystemSettingsScreen />);

    const workspaceInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
    });
    expect(workspaceInput).toHaveDisplayValue("");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("CA-08: shows an error toast and preserves form values when localStorage.setItem throws", async () => {
    const user = userEvent.setup();
    const setItemSpy = vi
      .spyOn(window.localStorage.__proto__, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    renderWithProviders(<SystemSettingsScreen />);

    const workspaceInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
    });
    await user.click(workspaceInput);
    await user.click(await screen.findByText("Workspace One"));

    await user.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(displayErrorToastMock).toHaveBeenCalled();
    });
    expect(displaySuccessToastMock).not.toHaveBeenCalled();
    expect(workspaceInput).toHaveDisplayValue("Workspace One");

    setItemSpy.mockRestore();
  });

  it("CA-09: the three fields expose an accessible name via label/aria-label", () => {
    renderWithProviders(<SystemSettingsScreen />);

    expect(
      screen.getByRole("combobox", {
        name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: /SYSTEM_SETTINGS\$GLOBAL_CONTEXT_LABEL/,
      }),
    ).toBeInTheDocument();
  });

  it("CA-10: renders the skeleton instead of the form while workspaces/profiles are loading", () => {
    setLocalWorkspaces({ data: undefined, isLoading: true });
    renderWithProviders(<SystemSettingsScreen />);

    expect(screen.getByTestId("system-settings-skeleton")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", {
        name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
      }),
    ).not.toBeInTheDocument();
  });

  it("CA-10b: renders the skeleton while LLM profiles are loading", () => {
    setLlmProfiles({ data: undefined, isLoading: true });
    renderWithProviders(<SystemSettingsScreen />);

    expect(screen.getByTestId("system-settings-skeleton")).toBeInTheDocument();
  });
});
