import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { AikSystemForm } from "#/components/features/aik/aik-system-form";
import { useAikBoardStore } from "#/stores/aik-board-store";
import * as activeStore from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";

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

const useLocalWorkspacesMock = vi.fn();
const useGitRepositoriesMock = vi.fn();
const useUserProvidersMock = vi.fn();

vi.mock("#/hooks/query/use-local-workspaces", () => ({
  useLocalWorkspaces: (...args: unknown[]) => useLocalWorkspacesMock(...args),
}));

vi.mock("#/hooks/query/use-git-repositories", () => ({
  useGitRepositories: (...args: unknown[]) => useGitRepositoriesMock(...args),
}));

vi.mock("#/hooks/use-user-providers", () => ({
  useUserProviders: (...args: unknown[]) => useUserProvidersMock(...args),
}));

const LOCAL_WORKSPACE = { id: "ws-1", path: "/home/user/project" };
const CLOUD_REPO = {
  id: "repo-1",
  full_name: "acme/api",
  git_provider: "github",
  is_public: false,
};

describe("AikSystemForm", () => {
  beforeEach(() => {
    useAikBoardStore.setState({
      systems: [],
      phasesBySystemId: {},
      tasksBySystemId: {},
      errorBySystemId: {},
    });
    useLocalWorkspacesMock.mockReturnValue({
      data: { workspaces: [LOCAL_WORKSPACE], workspaceParents: [] },
    });
    useGitRepositoriesMock.mockReturnValue({ data: undefined });
    useUserProvidersMock.mockReturnValue({ providers: ["github"] });
  });

  // CA-03: local backend only lists useLocalWorkspaces(), never both fields.
  it("lists only the workspace field for a local backend", () => {
    vi.spyOn(activeStore, "getRegisteredBackends").mockReturnValue([
      LOCAL_BACKEND,
    ]);
    renderWithProviders(<AikSystemForm onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(
      screen.getByTestId("aik-system-form-workspace-select"),
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
      screen.queryByTestId("aik-system-form-workspace-select"),
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
      screen.getByTestId("aik-system-form-workspace-select"),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByTestId("aik-system-form-backend-select"),
      CLOUD_BACKEND.id,
    );

    expect(
      screen.queryByTestId("aik-system-form-workspace-select"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("aik-system-form-repository-select"),
    ).toBeInTheDocument();
  });

  it("submits a local system with the chosen workspace", async () => {
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
    await user.selectOptions(
      screen.getByTestId("aik-system-form-workspace-select"),
      LOCAL_WORKSPACE.id,
    );
    await user.click(screen.getByTestId("aik-system-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "My System",
      backendId: LOCAL_BACKEND.id,
      workspaceRef: {
        kind: "local",
        workspaceId: LOCAL_WORKSPACE.id,
        path: LOCAL_WORKSPACE.path,
      },
    });
    expect(onClose).toHaveBeenCalled();
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
            workspaceId: LOCAL_WORKSPACE.id,
            path: LOCAL_WORKSPACE.path,
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
    await user.selectOptions(
      screen.getByTestId("aik-system-form-workspace-select"),
      LOCAL_WORKSPACE.id,
    );

    expect(
      screen.getByTestId("aik-system-form-duplicate-workspace-warning"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("aik-system-form-submit")).not.toBeDisabled();
  });
});
