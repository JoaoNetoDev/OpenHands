import { useState } from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanChecklistItem } from "#/types/kanban";

interface ChecklistPanelProps {
  items: KanbanChecklistItem[];
  onChange: (items: KanbanChecklistItem[]) => void;
}

/**
 * Reusable checklist widget (SPEC §2.5) — used both inside the task drawer
 * (`kanban-task-drawer.tsx`) and the board detail panel
 * (`board-detail-panel.tsx`). Fully controlled: the caller owns the items
 * array and persists it via `onChange`.
 */
export function ChecklistPanel({ items, onChange }: ChecklistPanelProps) {
  const { t } = useTranslation("openhands");
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, { id: uuidv4(), text: trimmed, done: false }]);
    setDraft("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  };

  const handleToggle = (itemId: string) => {
    onChange(
      items.map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item,
      ),
    );
  };

  const handleRemove = (itemId: string) => {
    onChange(items.filter((item) => item.id !== itemId));
  };

  return (
    <div data-testid="checklist-panel" className="flex flex-col gap-2">
      <span className="text-sm text-white">
        {t(I18nKey.KANBAN$CHECKLIST_LABEL)}
      </span>
      <input
        data-testid="checklist-add-input"
        className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
        placeholder={t(I18nKey.KANBAN$CHECKLIST_ADD_PLACEHOLDER)}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {items.length === 0 ? (
        <p data-testid="checklist-empty" className="text-xs text-muted">
          {t(I18nKey.KANBAN$CHECKLIST_EMPTY)}
        </p>
      ) : (
        <ul data-testid="checklist-items" className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid={`checklist-item-${item.id}`}
              className="flex items-center gap-2"
            >
              <input
                type="checkbox"
                data-testid={`checklist-item-checkbox-${item.id}`}
                checked={item.done}
                onChange={() => handleToggle(item.id)}
              />
              <span
                className={
                  item.done
                    ? "flex-1 text-sm text-muted line-through"
                    : "flex-1 text-sm text-white"
                }
              >
                {item.text}
              </span>
              <button
                type="button"
                data-testid={`checklist-item-remove-${item.id}`}
                aria-label={t(I18nKey.KANBAN$CHECKLIST_REMOVE_ITEM)}
                className="text-xs text-muted hover:text-white"
                onClick={() => handleRemove(item.id)}
              >
                {t(I18nKey.KANBAN$CHECKLIST_REMOVE_ITEM)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
