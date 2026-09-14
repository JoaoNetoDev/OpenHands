import { describe, expect, it, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { CardAttachments } from "#/components/features/kanban/card-attachments";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanTask } from "#/types/kanban";

const WORKSPACE_ID = "workspace-1";

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    boardId: "board-1",
    parentId: null,
    level: 1,
    title: "Task with attachments",
    columnId: "todo",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFile(name: string, sizeBytes: number): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name);
}

describe("CardAttachments", () => {
  beforeEach(() => {
    useKanbanBoardStore.setState({
      tasksByBoardId: {
        [WORKSPACE_ID]: [makeTask()],
      },
      lastPersistFailed: false,
    });
  });

  it("rejects a 300 KB file (CA-02)", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <CardAttachments workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId(
      "card-attachments-input",
    ) as HTMLInputElement;
    const tooLarge = makeFile("too-large.txt", 300 * 1024);
    await user.upload(input, tooLarge);

    await waitFor(() => {
      const tasks = useKanbanBoardStore.getState().tasksByBoardId[WORKSPACE_ID];
      expect(tasks[0].attachments ?? []).toHaveLength(0);
    });
    expect(
      screen.queryByTestId("card-attachment-name-too-large.txt"),
    ).not.toBeInTheDocument();
  });

  it("accepts a 100 KB file (CA-02)", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <CardAttachments workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId(
      "card-attachments-input",
    ) as HTMLInputElement;
    const okFile = makeFile("small.txt", 100 * 1024);
    await user.upload(input, okFile);

    await waitFor(() => {
      const tasks = useKanbanBoardStore.getState().tasksByBoardId[WORKSPACE_ID];
      expect(tasks[0].attachments ?? []).toHaveLength(1);
      expect(tasks[0].attachments?.[0].fileName).toBe("small.txt");
      expect(tasks[0].attachments?.[0].sizeBytes).toBe(100 * 1024);
    });
  });

  it("rejects a file whose name contains control characters", async () => {
    const user = userEvent.setup();
    const task = makeTask();
    renderWithProviders(
      <CardAttachments workspaceId={WORKSPACE_ID} task={task} />,
    );

    const input = screen.getByTestId(
      "card-attachments-input",
    ) as HTMLInputElement;
    const badName = makeFile("bad\x01name.txt", 10);
    await user.upload(input, badName);

    await waitFor(() => {
      const tasks = useKanbanBoardStore.getState().tasksByBoardId[WORKSPACE_ID];
      expect(tasks[0].attachments ?? []).toHaveLength(0);
    });
  });
});
