import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import type { KanbanTask } from "#/types/kanban";
import { useKanbanBoardStore } from "#/stores/kanban-board-store";
import { isValidFeatureSlug } from "#/utils/kanban-slug";
import { SettingsInput } from "#/components/features/settings/settings-input";

interface FeatureSlugInputProps {
  workspaceId: string;
  task: KanbanTask;
}

/**
 * Editable `task.featureSlug` field (SPEC §2.4). Only rendered by the
 * caller for level-1 cards — sub-tasks (level 2/3) never get to "become" a
 * `/featdevelop` feature (SPEC §4).
 *
 * Validates with `isValidFeatureSlug` on blur, before ever calling
 * `updateTask` — an invalid value is never persisted, it only shows an
 * inline error (RF-01).
 *
 * Saving a new valid slug while the card is still sitting in the generic
 * `"todo"` column also resets `columnId` to `"featdevelop_todo"` in the
 * same `updateTask` call, so the board immediately switches this card to
 * the featdevelop preset (TECH §2.1). If the card was already moved
 * manually to another column, that move is respected — only the "still in
 * todo" default column is overridden (SPEC §2.4).
 */
export function FeatureSlugInput({ workspaceId, task }: FeatureSlugInputProps) {
  const { t } = useTranslation("openhands");
  const updateTask = useKanbanBoardStore((state) => state.updateTask);
  const [value, setValue] = React.useState(task.featureSlug ?? "");

  const isValid = value === "" || isValidFeatureSlug(value);

  const handleBlur = () => {
    if (!isValid) return;
    const patch: Partial<Pick<KanbanTask, "featureSlug" | "columnId">> = {
      featureSlug: value || undefined,
    };
    if (value && task.columnId === "todo") {
      patch.columnId = "featdevelop_todo";
    }
    updateTask(workspaceId, task.id, patch);
  };

  return (
    <SettingsInput
      testId="kanban-feature-slug-input"
      name="kanban-feature-slug-input"
      type="text"
      label={t(I18nKey.KANBAN$FEATURE_SLUG_LABEL)}
      value={value}
      onChange={setValue}
      onBlur={handleBlur}
      error={!isValid ? t(I18nKey.KANBAN$FEATURE_SLUG_INVALID) : undefined}
    />
  );
}
