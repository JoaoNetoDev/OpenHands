import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useOptionalConversationIdMock = vi.fn();
const useActiveBackendMock = vi.fn();
const useIsMutatingMock = vi.fn();
const switchMutate = vi.fn();

vi.mock("#/hooks/use-conversation-id", () => ({
  useOptionalConversationId: () => useOptionalConversationIdMock(),
}));

vi.mock("#/contexts/active-backend-context", async () => {
  const actual = await vi.importActual<
    typeof import("#/contexts/active-backend-context")
  >("#/contexts/active-backend-context");
  return {
    ...actual,
    useActiveBackend: () => useActiveBackendMock(),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useIsMutating: () => useIsMutatingMock(),
  };
});

// Drive the conversation-local-storage hook's mirror directly — the hook is
// covered in its own suite, and this file only cares that the returned state
// flows through to the picker.
const localStorageState: { reasoningEffort: "low" | "medium" | null } = {
  reasoningEffort: null,
};
vi.mock("#/utils/conversation-local-storage", async () => {
  const actual = await vi.importActual<
    typeof import("#/utils/conversation-local-storage")
  >("#/utils/conversation-local-storage");
  return {
    ...actual,
    useConversationLocalStorageState: () => ({
      state: { reasoningEffort: localStorageState.reasoningEffort },
      setReasoningEffort: vi.fn(),
    }),
  };
});

vi.mock("#/hooks/mutation/use-switch-reasoning-effort", () => ({
  SWITCH_REASONING_EFFORT_MUTATION_KEY: ["switch-reasoning-effort"],
  useSwitchReasoningEffort: () => ({ mutate: switchMutate }),
}));

import { useChatInputReasoningEffortState } from "#/hooks/use-chat-input-reasoning-effort-state";

const renderState = (profileName: string | null) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(() => useChatInputReasoningEffortState(profileName), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

describe("useChatInputReasoningEffortState", () => {
  beforeEach(() => {
    switchMutate.mockReset();
    useOptionalConversationIdMock.mockReset();
    useActiveBackendMock.mockReset();
    useIsMutatingMock.mockReset();
    useIsMutatingMock.mockReturnValue(0);
    useActiveBackendMock.mockReturnValue({ backend: { kind: "local" } });
    localStorageState.reasoningEffort = null;
  });

  it("shows the picker as soon as we're in a conversation on a local backend, even before the active profile is known", () => {
    // Regression for the "effort picker missing at conversation start" bug:
    // the picker used to be gated on a resolved profile name, so the menu
    // popped in only after the first turn stamped `active_profile` on the
    // conversation. The picker should render immediately and disable its
    // items until the profile lands (selectEffort remains a no-op without
    // a profile name).
    useOptionalConversationIdMock.mockReturnValue({ conversationId: "c1" });

    const { result } = renderState(null);

    expect(result.current.isAvailable).toBe(true);
    // selectEffort is a defensive no-op when profileName is null.
    result.current.selectEffort("low");
    expect(switchMutate).not.toHaveBeenCalled();
  });

  it("hides the picker on cloud backends", () => {
    useActiveBackendMock.mockReturnValue({ backend: { kind: "cloud" } });
    useOptionalConversationIdMock.mockReturnValue({ conversationId: "c1" });

    const { result } = renderState(null);

    expect(result.current.isAvailable).toBe(false);
  });

  it("hides the picker when no conversation is open", () => {
    useOptionalConversationIdMock.mockReturnValue({ conversationId: null });

    const { result } = renderState(null);

    expect(result.current.isAvailable).toBe(false);
  });

  it("exposes the saved per-conversation effort once the picker is available", () => {
    localStorageState.reasoningEffort = "medium";
    useOptionalConversationIdMock.mockReturnValue({ conversationId: "c1" });

    const { result } = renderState("Smart");

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.currentEffort).toBe("medium");
  });

  it("invokes the switch mutation with the conversation, profile, and effort when all three are known", () => {
    useOptionalConversationIdMock.mockReturnValue({ conversationId: "c1" });

    const { result } = renderState("Smart");

    result.current.selectEffort("high");

    expect(switchMutate).toHaveBeenCalledWith({
      conversationId: "c1",
      profileName: "Smart",
      reasoningEffort: "high",
    });
  });

  it("skips the mutation when the selected effort matches the saved one", () => {
    localStorageState.reasoningEffort = "low";
    useOptionalConversationIdMock.mockReturnValue({ conversationId: "c1" });

    const { result } = renderState("Smart");

    result.current.selectEffort("low");

    expect(switchMutate).not.toHaveBeenCalled();
  });

  it("reflects an in-flight switch via useIsMutating", () => {
    useIsMutatingMock.mockReturnValue(1);
    useOptionalConversationIdMock.mockReturnValue({ conversationId: "c1" });

    const { result } = renderState("Smart");

    expect(result.current.isSwitching).toBe(true);
  });
});
