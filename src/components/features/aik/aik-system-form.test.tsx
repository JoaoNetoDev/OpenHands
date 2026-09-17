import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { AikSystemForm } from "#/components/features/aik/aik-system-form";
import { useAikBoardStore } from "#/stores/aik-board-store";
import * as activeStore from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import type { LocalWorkspace } from "#/types/workspace";

const LOCAL_BACKEND: Backend = {
  id: "local-backend",
  name: "Local backend",
  host: "http://localhost:3000",
  apiKey: "",
  kind: "local",
};

const CLOUD_BACKEND: Backend = {
  id: "cloud-backend",
  name: "Cloud backend",
  host: "https://app.all-hands.dev",
  apiKey: "key",
  kind: "cloud",
};

const useGitRepositoriesMock = vi.fn();
const useUserProvidersMock = vi.fn();
const addWorkspacesMock = vi.fn();

vi.mock("#/hooks/query/use-git-repositories", () => ({
  useGitRepositories: (...args: unknown[]) => useGitRepositoriesMock(...args),
}));

vi.mock("#/hooks/use-user-providers", () => ({
  useUserProviders: (...args: unknown[]) => useUserProvidersMock(...args),
}));

vi.mock("#/hooks/mutation/use-local-workspaces-mutations", () => ({
  useAddWorkspaces: () => ({
    mutate: (items: LocalWorkspace[], opts?: { onSuccess?: () => void }) => {
      addWorkspacesMock(items);
      opts?.onSuccess?.();
    },
  }),
}));

// Same mocking pattern as
// __tests__/components/features/conversation-panel/local-new-conversation-menu.test.tsx:
// the real FolderBrowserModal drives its own filesystem browsing UI, which
// is out of scope here — a stub that exposes a single button to trigger
// `onAdd` with a fixed workspace is enough to exercise AikSystemForm's own
// logic (CA-03, duplicate-workspace warning, submit payload).
const BROWSED_WORKSPACE: LocalWorkspace = {
  id: "ws-1",
  name: "project",
  path: "/home/user/project",
};

vi.mock(
  "#/components/features/home/workspace-dropdown/folder-browser-modal",
  () => ({
    FolderBrowserModal: ({
      isOpen,
      onAdd,
    }: {
      isOpen: boolean;
      onAdd: (items: LocalWorkspace[]) => void;
    }) =>
      isOpen ? (
        <button
          type="button"
          data-testid="folder-browser-modal-pick"
          onClick={() => onAdd([BROWSED_WORKSPACE])}
        />
      ) : null,
  }),
);

const CLOUD_REPO = {
  id: "repo-1",
  full_name: "acme/api",
  git_provider: "github",
  is_public: false,
};

async function browseAndPickWorkspace(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByTestId("aik-system-form-browse-workspace"));
  await user.click(screen.getByTestId("folder-browser-modal-pick"));
}

describe("AikSystemForm", () => {
  beforeEach(() => {
    useAikBoardStore.setState({
      systems: [],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
    useGitRepositoriesMock.mockReturnValue({ data: undefined });
    useUserProvidersMock.mockReturnValue({ providers: ["github"] });
    addWorkspacesMock.mockClear();
  });

  // CA-03: local backend only offers the folder-browser workspace field,
  // never the repository field.
  it("shows only the workspace field for a local backend", () => {
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
    ]);
    renderWithProviders(<AikSystemForm onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(
      screen.getByTestId("aik-system-form-browse-workspace"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("aik-system-form-repository-select"),
    ).not.toBeInTheDocument();
  });

  // CA-03: cloud backend only lists useGitRepositories(), never both fields.
  it("lists only the repository field for a cloud backend", () => {
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      CLOUD_BACKEND,
    ]);
    useGitRepositoriesMock.mockReturnValue({
      data: { pages: [{ items: [CLOUD_REPO], next_page_id: null }] },
    });
    renderWithProviders(<AikSystemForm onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(
      screen.getByTestId("aik-system-form-repository-select"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("aik-system-form-browse-workspace"),
    ).not.toBeInTheDocument();
  });

  it("switches the second field when the backend selection changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
      CLOUD_BACKEND,
    ]);
    useGitRepositoriesMock.mockReturnValue({
      data: { pages: [{ items: [CLOUD_REPO], next_page_id: null }] },
    });
    renderWithProviders(<AikSystemForm onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(
      screen.getByTestId("aik-system-form-browse-workspace"),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByTestId("aik-system-form-backend-select"),
      CLOUD_BACKEND.id,
    );

    expect(
      screen.queryByTestId("aik-system-form-browse-workspace"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("aik-system-form-repository-select"),
    ).toBeInTheDocument();
  });

  it("submits a local system with the folder picked via the browser", async () => {
    const user = userEvent.setup();
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
    ]);
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <AikSystemForm onSubmit={onSubmit} onClose={onClose} />,
    );

    await user.type(
      screen.getByTestId("aik-system-form-name-input"),
      "My System",
    );
    await browseAndPickWorkspace(user);

    expect(addWorkspacesMock).toHaveBeenCalledWith([BROWSED_WORKSPACE]);
    expect(
      screen.getByTestId("aik-system-form-workspace-path"),
    ).toHaveTextContent(BROWSED_WORKSPACE.path);

    await user.click(screen.getByTestId("aik-system-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "My System",
      backendId: LOCAL_BACKEND.id,
      workspaceRef: {
        kind: "local",
        workspaceId: BROWSED_WORKSPACE.id,
        path: BROWSED_WORKSPACE.path,
      },
    });
    expect(onClose).toHaveBeenCalled();
  });

  // Submit stays disabled until a folder has actually been picked.
  it("keeps submit disabled for a local backend until a workspace is picked", () => {
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
    ]);
    renderWithProviders(<AikSystemForm onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId("aik-system-form-submit")).toBeDisabled();
  });

  // SPEC §4: warns (does not block) when the chosen local workspace is
  // already used by another system in the store.
  it("warns without blocking when the workspace is already used by another system", async () => {
    const user = userEvent.setup();
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
    ]);
    useAikBoardStore.setState({
      systems: [
        {
          id: "existing-system",
          name: "Existing",
          backendId: LOCAL_BACKEND.id,
          workspaceRef: {
            kind: "local",
            workspaceId: BROWSED_WORKSPACE.id,
            path: BROWSED_WORKSPACE.path,
          },
          columnId: "ativo",
          activeAgentTaskId: null,
          createdAt: "2026-09-15T00:00:00.000Z",
          updatedAt: "2026-09-15T00:00:00.000Z",
        },
      ],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <AikSystemForm onSubmit={onSubmit} onClose={vi.fn()} />,
    );

    await user.type(
      screen.getByTestId("aik-system-form-name-input"),
      "Second System",
    );
    await browseAndPickWorkspace(user);

    expect(
      screen.getByTestId("aik-system-form-duplicate-workspace-warning"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("aik-system-form-submit")).not.toBeDisabled();
  });
});
