import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useSwitchAcpProvider,
  useSwitchAcpProviderCallback,
} from "#/hooks/mutation/use-switch-acp-provider";

const navigateMock = vi.fn();
const createConversationMock = vi.fn();
const listProfilesMock = vi.fn();

vi.mock("#/context/navigation-context", () => ({
  useNavigation: () => ({ navigate: navigateMock }),
}));

vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => ({ data: null }),
}));

vi.mock("#/hooks/mutation/use-create-conversation", () => ({
  useCreateConversation: () => ({
    mutateAsync: createConversationMock,
    isPending: false,
  }),
}));

vi.mock("#/api/conversation-metadata-store", () => ({
  getStoredConversationMetadata: vi.fn(() => ({
    selected_repository: "OpenHands/OpenHands",
    selected_branch: "main",
    git_provider: "github",
    selected_workspace: "/tmp/work",
    workspace_mode: "local_repo",
    plugins: [
      { source: "github", ref: "owner/repo", repo_path: null, name: "skill" },
    ],
  })),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
    }
  >
    {children}
  </QueryClientProvider>
);

describe("useSwitchAcpProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProfilesMock.mockReset();
    createConversationMock.mockResolvedValue({
      conversation_id: "new-conv",
      session_api_key: null,
      url: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects profiles that are not ACP", async () => {
    const { result } = renderHook(() => useSwitchAcpProvider(), { wrapper });

    result.current.mutate({
      sourceConversationId: "src",
      targetProfile: {
        id: "p1",
        name: "OpenHands profile",
        agent_kind: "openhands",
        revision: 1,
        llm_profile_ref: null,
        mcp_server_refs: null,
      },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/not ACP/i);
    expect(createConversationMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("rejects profiles without a stable id", async () => {
    const { result } = renderHook(() => useSwitchAcpProvider(), { wrapper });

    result.current.mutate({
      sourceConversationId: "src",
      targetProfile: {
        id: null,
        name: "ACP no id",
        agent_kind: "acp",
        revision: 1,
        llm_profile_ref: null,
        mcp_server_refs: null,
      },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/stable id/i);
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it("creates a conversation with the chosen ACP profile and carries over repo/workspace/plugins", async () => {
    const { result } = renderHook(() => useSwitchAcpProvider(), { wrapper });

    result.current.mutate({
      sourceConversationId: "src",
      targetProfile: {
        id: "codex-id",
        name: "Codex",
        agent_kind: "acp",
        revision: 1,
        llm_profile_ref: null,
        mcp_server_refs: null,
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(createConversationMock).toHaveBeenCalledTimes(1);
    const variables = createConversationMock.mock.calls[0][0];
    expect(variables.agentProfileId).toBe("codex-id");
    expect(variables.parentConversationId).toBe("src");
    expect(variables.entryPoint).toBe("error_banner_switch_acp_provider");
    expect(variables.repository).toEqual({
      name: "OpenHands/OpenHands",
      gitProvider: "github",
      branch: "main",
    });
    expect(variables.workingDir).toBe("/tmp/work");
    expect(variables.workspaceMode).toBe("local_repo");
    expect(variables.plugins).toHaveLength(1);
    expect(variables.plugins[0].name).toBe("skill");

    expect(navigateMock).toHaveBeenCalledWith("/conversations/new-conv");
  });
});

describe("useSwitchAcpProviderCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createConversationMock.mockResolvedValue({
      conversation_id: "new-conv",
      session_api_key: null,
      url: null,
    });
  });

  it("invokes the mutation with the bound source conversation id", async () => {
    const { result } = renderHook(
      () => useSwitchAcpProviderCallback("src-id"),
      { wrapper },
    );

    result.current({
      id: "codex-id",
      name: "Codex",
      agent_kind: "acp",
      revision: 1,
      llm_profile_ref: null,
      mcp_server_refs: null,
    });

    await waitFor(() => expect(createConversationMock).toHaveBeenCalled());
    expect(createConversationMock.mock.calls[0][0].parentConversationId).toBe(
      "src-id",
    );
  });
});
