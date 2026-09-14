import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import type { KanbanBoard } from "#/types/kanban";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { ChecklistPanel } from "./checklist-panel";

interface BoardDetailPanelProps {
  board: KanbanBoard;
  onClose: () => void;
}

/**
 * Board-level detail panel (SPEC §2.5), opened from `board-list.tsx`. Holds
 * the board's own checklist, persisted through
 * `useKanbanBoardStore().updateBoardChecklist` — separate from
 * `renameBoard`/`deleteBoard` since it patches a single field instead of
 * replacing the whole board.
 */
export function BoardDetailPanel({ board, onClose }: BoardDetailPanelProps) {
  const { t } = useTranslation("openhands");
  const updateBoardChecklist = useKanbanBoardStore(
    (state) => state.updateBoardChecklist,
  );

  return (
    <ModalBackdrop
      onClose={onClose}
      aria-label={t(I18nKey.KANBAN_BOARD_LIST$DETAIL_TITLE, {
        name: board.name,
      })}
    >
      <div
        data-testid={`board-detail-panel-${board.id}`}
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-lg max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">
            {t(I18nKey.KANBAN_BOARD_LIST$DETAIL_TITLE, { name: board.name })}
          </h2>
          <BrandButton
            testId="board-detail-close"
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            {t(I18nKey.KANBAN_BOARD_LIST$DETAIL_CLOSE)}
          </BrandButton>
        </div>

        <ChecklistPanel
          items={board.checklist ?? []}
          onChange={(checklist) =>
            updateBoardChecklist(board.workspaceId, board.id, checklist)
          }
        />
      </div>
    </ModalBackdrop>
  );
}
