import { I18nKey } from "#/i18n/declaration";
import i18n from "#/i18n";
import type { KanbanColumnId, KanbanTask } from "#/types/kanban";

export interface KanbanColumnPreset {
  id: KanbanColumnId;
  label: string;
}

/**
 * Decides which set of `KanbanColumnId` a level-1 card uses (SPEC §2.7,
 * TECH §2.3/§5). Cards with a `featureSlug` use the six `featdevelop_*`
 * columns that mirror the `/featdevelop` skill phases; every other card
 * (including all level-2/3 cards, which never carry a `featureSlug`)
 * keeps the original three-column generic preset from `kanban-3-niveis`
 * (RNF-03 — explicit regression guard, see
 * `kanban-column-presets.test.ts`).
 */
export function getColumnsForTask(task: KanbanTask): KanbanColumnPreset[] {
  const { t } = i18n;
  if (task.featureSlug) {
    return [
      { id: "featdevelop_todo", label: t(I18nKey.KANBAN$COLUMN_TODO) },
      { id: "featdevelop_prd", label: "PRD" },
      { id: "featdevelop_tech", label: "TECH" },
      { id: "featdevelop_spec", label: "SPEC" },
      { id: "featdevelop_sprints", label: "SPRINTS" },
      { id: "featdevelop_done", label: t(I18nKey.KANBAN$COLUMN_DONE) },
    ];
  }
  return [
    { id: "todo", label: t(I18nKey.KANBAN$COLUMN_TODO) },
    { id: "in_progress", label: t(I18nKey.KANBAN$COLUMN_IN_PROGRESS) },
    { id: "done", label: t(I18nKey.KANBAN$COLUMN_DONE) },
  ];
}
