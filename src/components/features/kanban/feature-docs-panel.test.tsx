import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { FeatureDocsPanel } from "#/components/features/kanban/feature-docs-panel";

const WORKSPACE_PATH = "/home/user/workspace";
const SLUG = "my-feature";

const readFeatureDocMock = vi.fn();
const listFeatureSprintFilesMock = vi.fn();

vi.mock("#/api/kanban-pipeline.api", () => ({
  readFeatureDoc: (...args: unknown[]) => readFeatureDocMock(...args),
  listFeatureSprintFiles: (...args: unknown[]) =>
    listFeatureSprintFilesMock(...args),
}));

describe("FeatureDocsPanel", () => {
  beforeEach(() => {
    readFeatureDocMock.mockReset();
    listFeatureSprintFilesMock.mockReset();
    listFeatureSprintFilesMock.mockResolvedValue([]);
  });

  it("shows '(ainda não gerado)' for PRD, TECH and SPEC when none exist", async () => {
    readFeatureDocMock.mockResolvedValue({ exists: false });
    renderWithProviders(
      <FeatureDocsPanel workspacePath={WORKSPACE_PATH} slug={SLUG} />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("kanban-feature-doc-missing-PRD.md"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("kanban-feature-doc-missing-TECH.md"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("kanban-feature-doc-missing-SPEC.md"),
    ).toBeInTheDocument();
  });

  it("renders PRD content as markdown when it exists", async () => {
    readFeatureDocMock.mockImplementation(
      async (_workspacePath: string, relativePath: string) => {
        if (relativePath.endsWith("PRD.md")) {
          return { exists: true, content: "# Hello world" };
        }
        return { exists: false };
      },
    );
    renderWithProviders(
      <FeatureDocsPanel workspacePath={WORKSPACE_PATH} slug={SLUG} />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Hello world" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("kanban-feature-doc-missing-PRD.md"),
    ).not.toBeInTheDocument();
  });

  it("calls readFeatureDoc and listFeatureSprintFiles again when 'Atualizar' is clicked", async () => {
    readFeatureDocMock.mockResolvedValue({ exists: false });
    renderWithProviders(
      <FeatureDocsPanel workspacePath={WORKSPACE_PATH} slug={SLUG} />,
    );

    await waitFor(() => {
      expect(readFeatureDocMock).toHaveBeenCalled();
    });
    const callsAfterMount = readFeatureDocMock.mock.calls.length;

    screen.getByTestId("kanban-refresh-docs-button").click();

    await waitFor(() => {
      expect(readFeatureDocMock.mock.calls.length).toBeGreaterThan(
        callsAfterMount,
      );
    });
  });
});
