import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";

interface KanbanCardProps {
  workspaceId: string;
  task: KanbanTask;
  onClick?: (task: KanbanTask) => void;
}

/**
 * Sortable card rendered inside a `KanbanColumn`. Shows the task title and,
 * when it has children, an "X of Y" completed-subtasks indicator (RF-08),
 * where "completed" means the child's `columnId === "done"`.
 */
export function KanbanCard({ workspaceId, task, onClick }: KanbanCardProps) {
  const { t } = useTranslation("openhands");
  const getChildren = useKanbanBoardStore((state) => state.getChildren);
  const children = getChildren(workspaceId, task.id);
  const completedChildren = children.filter((c) => c.columnId === "done");

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => onClick?.(task);

  // `@dnd-kit`'s `KeyboardSensor` (attached via `listeners.onKeyDown` below)
  // treats both Enter and Space as its "pick up / drop the drag" keys by
  // default (`defaultKeyboardCodes.start`/`end` include both). Since this
  // card is simultaneously a clickable element (opens the task drawer) and
  // a `useSortable` drag source, the same keystroke can't mean both things.
  // Resolution (same split used by native controls: a `<button>` activates
  // on Enter's keydown but on Space's keyup, precisely to allow this kind
  // of disambiguation): Enter is reserved exclusively for "open the
  // drawer" and is never forwarded to `@dnd-kit` — it's `preventDefault`ed
  // and handled here instead, so it can never also start a keyboard drag.
  // Every other key (notably Space, plus arrows/Escape/Tab while a drag is
  // in progress) is forwarded unchanged to `listeners.onKeyDown`, so
  // keyboard-driven reordering (RNF-02) keeps working exactly as before.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return; // ignore bubbling from any future nested interactive child
    if (event.key === "Enter") {
      event.preventDefault();
      handleClick();
      return;
    }
    listeners?.onKeyDown?.(event);
  };

  return (
    // A plain `div` rather than HeroUI's `Card` — `Card`'s clickable
    // behavior is built on react-aria's `usePress`, which ignores the
    // interaction once `@dnd-kit`'s sortable `listeners` (spread below,
    // needed for drag) are attached to the same node, so `onPress`/`onClick`
    // never fires. A native `onClick` on a plain element is unaffected.
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`kanban-card-${task.id}`}
      className="flex flex-col rounded-xl shadow-md p-3 cursor-pointer bg-base-secondary border border-[var(--oh-border)]"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <p className="text-sm font-medium text-white">{task.title}</p>
      {children.length > 0 && (
        <p
          data-testid={`kanban-card-progress-${task.id}`}
          data-completed={completedChildren.length}
          data-total={children.length}
          className="mt-1 text-xs text-muted"
        >
          {t(I18nKey.KANBAN$SUBTASK_PROGRESS, {
            completed: completedChildren.length,
            total: children.length,
          })}
        </p>
      )}
    </div>
  );
}
