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
const useAgentProfilesMock = vi.fn();
const getProfileMock = vi.fn();
const displayErrorToastMock = vi.fn();
const displaySuccessToastMock = vi.fn();

vi.mock("#/hooks/query/use-local-workspaces", () => ({
  useLocalWorkspaces: () => useLocalWorkspacesMock(),
}));

vi.mock("#/hooks/query/use-agent-profiles", () => ({
  useAgentProfiles: () => useAgentProfilesMock(),
}));

vi.mock("#/api/agent-profiles-service/agent-profiles-service.api", () => ({
  default: {
    getProfile: (...args: unknown[]) => getProfileMock(...args),
  },
}));

vi.mock("#/constants/acp-providers", () => ({
  getAcpProviderDisplayName: (key: string | null | undefined) =>
    key ? `Provider(${key})` : null,
}));

// The dialog itself (and its WorkspaceSelectionForm internals) is covered by
// its own tests; here it's stubbed to a single confirm button so CA-02 can
// exercise the System screen's wiring (open on "__create__", persist +
// auto-select on confirm) without pulling in unrelated provider/git plumbing.
vi.mock("#/components/features/home/open-workspace-dialog", () => ({
  OpenWorkspaceDialog: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (workspace: { id: string; name: string; path: string }) => void;
  }) => {
    if (!isOpen) return null;
    return (
      <button
        type="button"
        data-testid="open-workspace-dialog-confirm"
        onClick={() =>
          onConfirm({ id: "ws-new", name: "New Workspace", path: "/new" })
        }
      />
    );
  },
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: (...args: unknown[]) => displayErrorToastMock(...args),
  displaySuccessToast: (...args: unknown[]) => displaySuccessToastMock(...args),
}));

const WORKSPACES = [
  { id: "ws-1", name: "Workspace One", path: "/ws1" },
  { id: "ws-2", name: "Workspace Two", path: "/ws2" },
];

const AGENT_PROFILES = [
  { id: "profile-a-id", name: "profile-a", agent_kind: "openhands" as const },
  { id: "profile-b-id", name: "profile-b", agent_kind: "acp" as const },
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

function setAgentProfiles(
  overrides: Partial<{ data: unknown; isLoading: boolean }> = {},
) {
  useAgentProfilesMock.mockReturnValue({
    data: { profiles: AGENT_PROFILES, active_agent_profile_id: null },
    isLoading: false,
    ...overrides,
  });
}

describe("SystemSettingsScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    setLocalWorkspaces();
    setAgentProfiles();
    getProfileMock.mockResolvedValue({
      name: "profile-b",
      profile: {
        id: "profile-b-id",
        name: "profile-b",
        agent_kind: "acp",
        acp_server: "claude-code",
      },
    });
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

  it("CA-02b: creating a workspace from the dropdown persists and auto-selects it without route navigation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SystemSettingsScreen />);

    const workspaceInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_WORKSPACE_LABEL/,
    });
    await user.click(workspaceInput);
    await user.click(
      await screen.findByText("SYSTEM_SETTINGS$CREATE_WORKSPACE"),
    );

    const confirmButton = await screen.findByTestId(
      "open-workspace-dialog-confirm",
    );
    await user.click(confirmButton);

    // Dialog closes and the newly created workspace is selected in place —
    // no navigation away from /settings/system.
    expect(
      screen.queryByTestId("open-workspace-dialog-confirm"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("system-settings-screen")).toBeInTheDocument();

    await user.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(displaySuccessToastMock).toHaveBeenCalled();
    });

    const stored = JSON.parse(
      window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY) as string,
    ) as SystemSettings;
    expect(stored.defaultWorkspaceId).toBe("ws-new");
  });

  it("CA-03: the profile dropdown shows agent_kind per item and saving persists the profile id", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<SystemSettingsScreen />);

    const profileInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
    });
    await user.click(profileInput);
    expect(
      await screen.findByText(/profile-a — OpenHands/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/profile-b — SYSTEM_SETTINGS\$PROVIDER_ACP/),
    ).toBeInTheDocument();

    await user.click(screen.getByText(/profile-a — OpenHands/));
    await user.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(displaySuccessToastMock).toHaveBeenCalled();
    });

    const stored = JSON.parse(
      window.localStorage.getItem(SYSTEM_SETTINGS_STORAGE_KEY) as string,
    ) as SystemSettings;
    expect(stored.defaultLlmProfileName).toBe("profile-a-id");

    unmount();
  });

  it("CA-03b: selecting an ACP profile fetches its detail once and shows the specific provider", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SystemSettingsScreen />);

    const profileInput = screen.getByRole("combobox", {
      name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
    });
    await user.click(profileInput);
    await user.click(
      await screen.findByText(/profile-b — SYSTEM_SETTINGS\$PROVIDER_ACP/),
    );

    await waitFor(() => {
      expect(getProfileMock).toHaveBeenCalledWith("profile-b");
    });
    expect(getProfileMock).toHaveBeenCalledTimes(1);

    expect(
      await screen.findByTestId("default-agent-profile-provider"),
    ).toHaveTextContent("SYSTEM_SETTINGS$PROVIDER_DETAIL");
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

  it("CA-06b: shows a link to /settings/agents when there are no agent profiles", () => {
    setAgentProfiles({ data: { profiles: [], active_agent_profile_id: null } });
    renderWithProviders(<SystemSettingsScreen />);

    expect(
      screen.queryByRole("combobox", {
        name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_LABEL/,
      }),
    ).not.toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: /SYSTEM_SETTINGS\$DEFAULT_LLM_PROFILE_EMPTY_LINK/,
    });
    expect(link).toHaveAttribute("href", "/settings/agents");
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

  it("CA-10b: renders the skeleton while agent profiles are loading", () => {
    setAgentProfiles({ data: undefined, isLoading: true });
    renderWithProviders(<SystemSettingsScreen />);

    expect(screen.getByTestId("system-settings-skeleton")).toBeInTheDocument();
  });
});
