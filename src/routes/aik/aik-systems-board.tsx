import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useNavigation } from "#/context/navigation-context";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikSystem, AikSystemColumnId } from "#/types/aik";
import { BrandButton } from "#/components/features/settings/brand-button";
import { AikSystemForm } from "#/components/features/aik/aik-system-form";
import { DeleteSystemConfirmDialog } from "#/components/features/aik/delete-system-confirm-dialog";

const SYSTEM_COLUMNS: {
  id: AikSystemColumnId;
  labelKey: I18nKey;
}[] = [
  { id: "ativo", labelKey: I18nKey.AIK$SYSTEMS_BOARD_COLUMN_ATIVO },
  { id: "pausado", labelKey: I18nKey.AIK$SYSTEMS_BOARD_COLUMN_PAUSADO },
  { id: "arquivado", labelKey: I18nKey.AIK$SYSTEMS_BOARD_COLUMN_ARQUIVADO },
];

const ERROR_LABEL_KEYS: Record<string, I18nKey> = {
  backend_down: I18nKey.AIK$SYSTEMS_BOARD_ERROR_BACKEND_DOWN,
  workspace_unreachable: I18nKey.AIK$SYSTEMS_BOARD_ERROR_WORKSPACE_UNREACHABLE,
  parse_error: I18nKey.AIK$SYSTEMS_BOARD_ERROR_PARSE_ERROR,
  conflict: I18nKey.AIK$SYSTEMS_BOARD_ERROR_CONFLICT,
  cloud_unsupported: I18nKey.AIK$SYSTEMS_BOARD_ERROR_CLOUD_UNSUPPORTED,
};

interface AikSystemCardProps {
  system: AikSystem;
  taskCount: number;
  errorType?: string;
  onOpen: (systemId: string) => void;
  onDelete: (system: AikSystem) => void;
}

/**
 * Card for a single system (CA-04): shows the count of tasks in
 * `in_progress`/`in_review` across the system's phases and, when
 * `syncFromFile` recorded an error for this system (CA-39), an isolated
 * error badge — the card itself never throws or blocks the rest of the
 * board from rendering.
 */
function AikSystemCard({
  system,
  taskCount,
  errorType,
  onOpen,
  onDelete,
}: AikSystemCardProps) {
  const { t } = useTranslation("openhands");

  return (
    <li
      key={system.id}
      data-testid={`aik-system-card-${system.id}`}
      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--oh-border)] bg-base-secondary p-3"
    >
      <button
        type="button"
        data-testid={`aik-system-card-open-${system.id}`}
        onClick={() => onOpen(system.id)}
        className="flex flex-col gap-1 text-left"
      >
        <span className="text-sm font-semibold text-white">{system.name}</span>
        <span
          data-testid={`aik-system-card-task-count-${system.id}`}
          data-count={taskCount}
          className="text-xs text-muted"
        >
          {t(I18nKey.AIK$SYSTEMS_BOARD_TASK_COUNT, { count: taskCount })}
        </span>
        {errorType && (
          <span
            data-testid={`aik-system-card-error-${system.id}`}
            className="text-xs text-danger"
          >
            {t(I18nKey.AIK$SYSTEMS_BOARD_ERROR_BADGE)}:{" "}
            {t(
              ERROR_LABEL_KEYS[errorType] ??
                I18nKey.AIK$SYSTEMS_BOARD_ERROR_BADGE,
            )}
          </span>
        )}
      </button>
      <BrandButton
        testId={`aik-system-card-delete-${system.id}`}
        type="button"
        variant="danger"
        onClick={() => onDelete(system)}
      >
        {t(I18nKey.AIK$SYSTEMS_BOARD_DELETE_BUTTON)}
      </BrandButton>
    </li>
  );
}

/**
 * `AikSystemsBoard` — root screen of the AIK (RF-01, CA-01): a 3-column
 * kanban (`ativo | pausado | arquivado`, TECH §3, sob controle humano,
 * nunca derivada) of `AikSystem`s. Reads `useAikBoardStore` directly (no
 * props, SPEC §2.6). A per-system error (CA-39) never prevents the other
 * systems, or the rest of the board, from rendering.
 */
export function AikSystemsBoard(): JSX.Element {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();

  const systems = useAikBoardStore((state) => state.systems);
  const tasksBySystemId = useAikBoardStore((state) => state.tasksBySystemId);
  const errorBySystemId = useAikBoardStore((state) => state.errorBySystemId);
  const createSystem = useAikBoardStore((state) => state.createSystem);

  const [createOpen, setCreateOpen] = useState(false);
  const [systemToDelete, setSystemToDelete] = useState<AikSystem | null>(null);

  const handleOpen = (systemId: string) => {
    navigate(`/__aik/${systemId}`);
  };

  return (
    <div
      data-testid="aik-systems-board"
      className="flex flex-1 flex-col gap-4 p-4 overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-white">
          {t(I18nKey.AIK$SYSTEMS_BOARD_TITLE)}
        </h1>
        <BrandButton
          testId="aik-systems-board-create-button"
          type="button"
          variant="primary"
          onClick={() => setCreateOpen(true)}
        >
          {t(I18nKey.AIK$SYSTEMS_BOARD_CREATE_BUTTON)}
        </BrandButton>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SYSTEM_COLUMNS.map((column) => {
          const columnSystems = systems.filter((s) => s.columnId === column.id);
          return (
            <div
              key={column.id}
              data-testid={`aik-systems-board-column-${column.id}`}
              className="flex flex-col gap-2 rounded-xl border border-[var(--oh-border)] p-3"
            >
              <h2 className="text-sm font-semibold text-white">
                {t(column.labelKey)}
              </h2>
              {columnSystems.length > 0 ? (
                <ul
                  data-testid={`aik-systems-board-column-list-${column.id}`}
                  className="flex flex-col gap-2"
                >
                  {columnSystems.map((system) => {
                    const tasks = tasksBySystemId[system.id] ?? [];
                    const taskCount = tasks.filter(
                      (task) =>
                        task.columnId === "in_progress" ||
                        task.columnId === "in_review",
                    ).length;
                    return (
                      <AikSystemCard
                        key={system.id}
                        system={system}
                        taskCount={taskCount}
                        errorType={errorBySystemId[system.id]?.errorType}
                        onOpen={handleOpen}
                        onDelete={setSystemToDelete}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p
                  data-testid={`aik-systems-board-column-empty-${column.id}`}
                  className="text-xs text-muted"
                >
                  {t(I18nKey.AIK$SYSTEMS_BOARD_EMPTY_COLUMN)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {createOpen && (
        <AikSystemForm
          onSubmit={(input) => createSystem(input)}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {systemToDelete && (
        <DeleteSystemConfirmDialog
          system={systemToDelete}
          onClose={() => setSystemToDelete(null)}
        />
      )}
    </div>
  );
}

export default AikSystemsBoard;
