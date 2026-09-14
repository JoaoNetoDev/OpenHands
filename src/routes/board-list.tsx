import { useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useNavigation } from "#/context/navigation-context";
import { useSystemSettings } from "#/hooks/use-system-settings";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanBoard, KanbanTask } from "#/types/kanban";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { BoardDetailPanel } from "#/components/features/kanban/board-detail-panel";

// Stable references so the Zustand selectors below don't return a fresh
// array on every call when a workspace/board has none yet — a fresh `[]`
// literal each render defeats `useSyncExternalStore`'s reference equality
// check and causes an infinite render loop ("getSnapshot should be cached").
const EMPTY_BOARDS: KanbanBoard[] = [];
const EMPTY_TASKS: KanbanTask[] = [];

interface BoardFormModalProps {
  title: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

/** Shared form for both "create board" and "rename board" (same fields,
 * only the title/initial value and the submit action differ). */
function BoardFormModal({
  title,
  initialName = "",
  onClose,
  onSubmit,
}: BoardFormModalProps) {
  const { t } = useTranslation("openhands");
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        data-testid="board-form-modal"
        onSubmit={handleSubmit}
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.KANBAN_BOARD_LIST$NAME_LABEL)}
          <input
            data-testid="board-form-name-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <div className="w-full flex justify-end gap-2">
          <BrandButton
            testId="cancel-button"
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t(I18nKey.BUTTON$CANCEL)}
          </BrandButton>
          <BrandButton
            testId="board-form-submit"
            type="submit"
            variant="primary"
            isDisabled={!trimmed}
          >
            {t(I18nKey.BUTTON$CREATE)}
          </BrandButton>
        </div>
      </form>
    </ModalBackdrop>
  );
}

interface DeleteBoardConfirmDialogProps {
  board: KanbanBoard;
  onClose: () => void;
}

/**
 * Confirms board deletion, showing how many tasks (across all levels) will
 * be removed with it — same UX pattern as
 * `delete-task-confirm-dialog.tsx` (SPEC §5 / §4 casos de borda).
 */
function DeleteBoardConfirmDialog({
  board,
  onClose,
}: DeleteBoardConfirmDialogProps) {
  const { t } = useTranslation("openhands");
  const tasks = useKanbanBoardStore(
    (state) => state.tasksByBoardId[board.id] ?? EMPTY_TASKS,
  );
  const deleteBoard = useKanbanBoardStore((state) => state.deleteBoard);
  const taskCount = tasks.length;

  const handleConfirm = () => {
    deleteBoard(board.workspaceId, board.id);
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-testid="delete-board-confirm-dialog"
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <p className="text-sm text-white">
          {t(I18nKey.KANBAN_BOARD_LIST$DELETE_CONFIRM_MESSAGE)}
        </p>
        {taskCount > 0 && (
          <p
            data-testid="delete-board-task-count"
            data-count={taskCount}
            className="text-sm text-muted"
          >
            {t(I18nKey.KANBAN_BOARD_LIST$DELETE_CONFIRM_TASK_COUNT, {
              count: taskCount,
            })}
          </p>
        )}
        <div className="w-full flex justify-end gap-2">
          <BrandButton
            testId="cancel-button"
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t(I18nKey.BUTTON$CANCEL)}
          </BrandButton>
          <BrandButton
            testId="confirm-delete-board-button"
            type="button"
            variant="danger"
            onClick={handleConfirm}
          >
            {t(I18nKey.BUTTON$DELETE)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/**
 * `/board` route: lists the boards of the active workspace, with
 * create/rename/delete (SPEC §2.4 / TECH §2.4, CA-04). The active workspace
 * is resolved from `useSystemSettings().settings.defaultWorkspaceId`, same
 * as the previous single-board `/board` route — when it is absent, this
 * screen shows the "no active workspace" state instead of the board list.
 */
export default function BoardListRoute() {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const { settings } = useSystemSettings();
  const workspaceId = settings.defaultWorkspaceId;

  const boards = useKanbanBoardStore((state) =>
    workspaceId
      ? (state.boardsByWorkspaceId[workspaceId] ?? EMPTY_BOARDS)
      : EMPTY_BOARDS,
  );
  const tasksByBoardId = useKanbanBoardStore((state) => state.tasksByBoardId);
  const createBoard = useKanbanBoardStore((state) => state.createBoard);
  const renameBoard = useKanbanBoardStore((state) => state.renameBoard);

  const [createOpen, setCreateOpen] = useState(false);
  const [boardToRename, setBoardToRename] = useState<KanbanBoard | null>(null);
  const [boardToDelete, setBoardToDelete] = useState<KanbanBoard | null>(null);
  const [boardDetailId, setBoardDetailId] = useState<string | null>(null);
  const boardToShowDetail = boards.find((b) => b.id === boardDetailId) ?? null;

  if (!workspaceId) {
    return (
      <div
        data-testid="kanban-board-no-workspace"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <h1 className="text-lg font-semibold text-white">
          {t(I18nKey.KANBAN$NO_WORKSPACE_TITLE)}
        </h1>
        <p className="text-sm text-muted max-w-md">
          {t(I18nKey.KANBAN$NO_WORKSPACE_DESCRIPTION)}
        </p>
      </div>
    );
  }

  const hasBoards = boards.length > 0;

  return (
    <div
      data-testid="board-list-screen"
      className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-white">
          {t(I18nKey.KANBAN_BOARD_LIST$TITLE)}
        </h1>
        <BrandButton
          testId="board-list-create-button"
          type="button"
          variant="primary"
          onClick={() => setCreateOpen(true)}
        >
          {t(I18nKey.KANBAN_BOARD_LIST$CREATE_BUTTON)}
        </BrandButton>
      </div>

      {hasBoards ? (
        <ul data-testid="board-list" className="flex flex-col gap-2">
          {boards.map((board) => (
            <li
              key={board.id}
              data-testid={`board-list-item-${board.id}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-[var(--oh-border)] bg-base-secondary p-3"
            >
              <button
                type="button"
                data-testid={`board-list-open-${board.id}`}
                onClick={() => navigate(`/board/${board.id}`)}
                className="flex flex-col gap-1 text-left"
              >
                <span className="text-sm font-semibold text-white">
                  {board.name}
                </span>
                <span
                  data-testid={`board-list-task-count-${board.id}`}
                  className="text-xs text-muted"
                >
                  {t(I18nKey.KANBAN_BOARD_LIST$TASK_COUNT, {
                    count: (tasksByBoardId[board.id] ?? EMPTY_TASKS).length,
                  })}
                </span>
              </button>
              <div className="flex gap-2">
                <BrandButton
                  testId={`board-list-detail-${board.id}`}
                  type="button"
                  variant="secondary"
                  onClick={() => setBoardDetailId(board.id)}
                >
                  {t(I18nKey.KANBAN_BOARD_LIST$DETAIL_BUTTON)}
                </BrandButton>
                <BrandButton
                  testId={`board-list-rename-${board.id}`}
                  type="button"
                  variant="secondary"
                  onClick={() => setBoardToRename(board)}
                >
                  {t(I18nKey.KANBAN_BOARD_LIST$RENAME_BUTTON)}
                </BrandButton>
                <BrandButton
                  testId={`board-list-delete-${board.id}`}
                  type="button"
                  variant="danger"
                  onClick={() => setBoardToDelete(board)}
                >
                  {t(I18nKey.KANBAN_BOARD_LIST$DELETE_BUTTON)}
                </BrandButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div
          data-testid="board-list-empty-state"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <p className="text-sm text-muted">
            {t(I18nKey.KANBAN_BOARD_LIST$EMPTY_TITLE)}
          </p>
          <BrandButton
            testId="board-list-empty-state-cta"
            type="button"
            variant="primary"
            onClick={() => setCreateOpen(true)}
          >
            {t(I18nKey.KANBAN_BOARD_LIST$CREATE_BUTTON)}
          </BrandButton>
        </div>
      )}

      {createOpen && (
        <BoardFormModal
          title={t(I18nKey.KANBAN_BOARD_LIST$CREATE_MODAL_TITLE)}
          onClose={() => setCreateOpen(false)}
          onSubmit={(name) => createBoard(workspaceId, name)}
        />
      )}
      {boardToRename && (
        <BoardFormModal
          title={t(I18nKey.KANBAN_BOARD_LIST$RENAME_MODAL_TITLE)}
          initialName={boardToRename.name}
          onClose={() => setBoardToRename(null)}
          onSubmit={(name) => renameBoard(workspaceId, boardToRename.id, name)}
        />
      )}
      {boardToDelete && (
        <DeleteBoardConfirmDialog
          board={boardToDelete}
          onClose={() => setBoardToDelete(null)}
        />
      )}
      {boardToShowDetail && (
        <BoardDetailPanel
          board={boardToShowDetail}
          onClose={() => setBoardDetailId(null)}
        />
      )}
    </div>
  );
}
