import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { AikTask } from "#/types/aik";

export interface CreateAikTaskModalProps {
  phaseId: string;
  onClose: () => void;
}

/** Cadastro de tarefa (RF-12): título + tipo de executor. Quando
 * `executorType:"agent"`, exige um briefing — sem ele, Executar (CA-10)
 * nunca fica habilitado no card recém-criado, então não faz sentido deixar
 * criar uma tarefa de agente sem instrução alguma. */
export function CreateAikTaskModal({
  phaseId,
  onClose,
}: CreateAikTaskModalProps): JSX.Element {
  const { t } = useTranslation("openhands");
  const createTask = useAikBoardStore((state) => state.createTask);
  const [title, setTitle] = useState("");
  const [executorType, setExecutorType] =
    useState<AikTask["executorType"]>("human");
  const [agentBriefing, setAgentBriefing] = useState("");

  const trimmedTitle = title.trim();
  const isAgent = executorType === "agent";
  const canSubmit = !!trimmedTitle && (!isAgent || !!agentBriefing.trim());

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    createTask(phaseId, {
      title: trimmedTitle,
      executorType,
      agentBriefing: isAgent ? agentBriefing.trim() : undefined,
    });
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        data-testid="create-aik-task-modal"
        onSubmit={handleSubmit}
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <h2 className="text-sm font-semibold text-white">
          {t(I18nKey.AIK$TASK_CREATE_TITLE)}
        </h2>
        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.AIK$TASK_CREATE_NAME_LABEL)}
          <input
            data-testid="create-aik-task-modal-title-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.AIK$TASK_CREATE_EXECUTOR_LABEL)}
          <select
            data-testid="create-aik-task-modal-executor-select"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            style={{ colorScheme: "dark" }}
            value={executorType}
            onChange={(e) =>
              setExecutorType(e.target.value as AikTask["executorType"])
            }
          >
            <option value="human">
              {t(I18nKey.AIK$TASK_CREATE_EXECUTOR_HUMAN)}
            </option>
            <option value="agent">
              {t(I18nKey.AIK$TASK_CREATE_EXECUTOR_AGENT)}
            </option>
          </select>
        </label>

        {isAgent && (
          <label className="flex flex-col gap-1 text-sm text-white">
            {t(I18nKey.AIK$TASK_CREATE_BRIEFING_LABEL)}
            <textarea
              data-testid="create-aik-task-modal-briefing-input"
              className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
              value={agentBriefing}
              onChange={(e) => setAgentBriefing(e.target.value)}
              rows={3}
              required
            />
          </label>
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
            testId="create-aik-task-modal-submit"
            type="submit"
            variant="primary"
            isDisabled={!canSubmit}
          >
            {t(I18nKey.BUTTON$CREATE)}
          </BrandButton>
        </div>
      </form>
    </ModalBackdrop>
  );
}

export default CreateAikTaskModal;
