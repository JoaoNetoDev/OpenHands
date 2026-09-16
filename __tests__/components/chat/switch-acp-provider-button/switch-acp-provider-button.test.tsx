// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SwitchAcpProviderButton } from "#/components/features/chat/switch-acp-provider-button";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";

const { mockCanShow, mockSwitch, mockProfiles, mockConversation } = vi.hoisted(
  () => ({
    mockCanShow: vi.fn(),
    mockSwitch: vi.fn(),
    mockProfiles: vi.fn<() => { profiles: AgentProfileSummary[]; active_agent_profile_id: string | null }>(),
    mockConversation: vi.fn(),
  }),
);

vi.mock("#/utils/acp-error-codes", async () => ({
  canShowAcpProviderSwitch: (...args: unknown[]) => mockCanShow(...args),
}));

vi.mock("#/hooks/mutation/use-switch-acp-provider", async () => ({
  useSwitchAcpProviderCallback: () => mockSwitch,
}));

vi.mock("#/hooks/query/use-agent-profiles", async () => ({
  useAgentProfiles: () => ({ data: mockProfiles() }),
}));

vi.mock("#/hooks/query/use-active-conversation", async () => ({
  useActiveConversation: () => ({ data: mockConversation() }),
}));

vi.mock("#/hooks/use-conversation-id", async () => ({
  useOptionalConversationId: () => ({ conversationId: "conv-1" }),
}));

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { changeLanguage: () => Promise.resolve() },
    }),
  };
});

const profileActive: AgentProfileSummary = {
  id: "p-active",
  name: "Claude Code",
  agent_kind: "acp",
  revision: 1,
  llm_profile_ref: null,
  mcp_server_refs: null,
};
const profileOther: AgentProfileSummary = {
  id: "p-other",
  name: "Codex CLI",
  agent_kind: "acp",
  revision: 1,
  llm_profile_ref: null,
  mcp_server_refs: null,
};
const profileOpenHands: AgentProfileSummary = {
  id: "p-oh",
  name: "OpenHands",
  agent_kind: "openhands",
  revision: 1,
  llm_profile_ref: "default",
  mcp_server_refs: null,
};

describe("SwitchAcpProviderButton", () => {
  beforeEach(() => {
    mockCanShow.mockReset();
    mockSwitch.mockReset();
    mockProfiles.mockReset();
    mockConversation.mockReset();
  });

  it("renders nothing when not in an ACP conversation", () => {
    mockCanShow.mockReturnValue(false);
    mockProfiles.mockReturnValue({ profiles: [profileActive, profileOther], active_agent_profile_id: "p-active" });
    mockConversation.mockReturnValue({ id: "conv-1", acp_server: null });
    const { container } = render(<SwitchAcpProviderButton />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no other ACP profile is configured", () => {
    mockCanShow.mockReturnValue(true);
    mockProfiles.mockReturnValue({ profiles: [profileActive], active_agent_profile_id: "p-active" });
    mockConversation.mockReturnValue({ id: "conv-1", acp_server: "claude-code" });
    const { container } = render(<SwitchAcpProviderButton />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the active profile name when other ACP profiles exist", () => {
    mockCanShow.mockReturnValue(true);
    mockProfiles.mockReturnValue({
      profiles: [profileActive, profileOther],
      active_agent_profile_id: "p-active",
    });
    mockConversation.mockReturnValue({ id: "conv-1", acp_server: "claude-code" });
    render(<SwitchAcpProviderButton />);
    expect(screen.getByTestId("switch-acp-provider-trigger")).toHaveTextContent("Claude Code");
  });

  it("filters out non-ACP profiles and the active one from the menu", async () => {
    mockCanShow.mockReturnValue(true);
    mockProfiles.mockReturnValue({
      profiles: [profileActive, profileOther, profileOpenHands],
      active_agent_profile_id: "p-active",
    });
    mockConversation.mockReturnValue({ id: "conv-1", acp_server: "claude-code" });
    render(<SwitchAcpProviderButton />);
    fireEvent.click(screen.getByTestId("switch-acp-provider-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("switch-acp-provider-menu")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("switch-acp-provider-option-p-active")).toBeNull();
    expect(screen.queryByTestId("switch-acp-provider-option-p-oh")).toBeNull();
    expect(
      screen.getByTestId("switch-acp-provider-option-p-other"),
    ).toBeInTheDocument();
  });

  it("invokes the switch callback when a profile is picked", async () => {
    mockCanShow.mockReturnValue(true);
    mockProfiles.mockReturnValue({
      profiles: [profileActive, profileOther],
      active_agent_profile_id: "p-active",
    });
    mockConversation.mockReturnValue({ id: "conv-1", acp_server: "claude-code" });
    render(<SwitchAcpProviderButton />);
    fireEvent.click(screen.getByTestId("switch-acp-provider-trigger"));
    fireEvent.click(screen.getByTestId("switch-acp-provider-option-p-other"));
    expect(mockSwitch).toHaveBeenCalledWith(profileOther);
  });
});
