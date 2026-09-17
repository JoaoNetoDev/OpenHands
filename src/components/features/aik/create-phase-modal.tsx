import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { useAikBoardStore } from "#/stores/aik-board-store";

export interface CreatePhaseModalProps {
  systemId: string;
  onClose: () => void;
}

/** Cadastro de fase (RF-12): só título — a coluna nasce em `backlog` e é
 * sempre derivada pelo store a partir das tarefas filhas (RF-09), nunca
 * escolhida aqui. */
export function CreatePhaseModal({
  systemId,
  onClose,
}: CreatePhaseModalProps): JSX.Element {
  const { t } = useTranslation("openhands");
  const createPhase = useAikBoardStore((state) => state.createPhase);
  const [title, setTitle] = useState("");
  const trimmed = title.trim();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed) return;
    createPhase(systemId, trimmed);
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        data-testid="create-phase-modal"
        onSubmit={handleSubmit}
        className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
      >
        <h2 className="text-sm font-semibold text-white">
          {t(I18nKey.AIK$PHASE_CREATE_TITLE)}
        </h2>
        <label className="flex flex-col gap-1 text-sm text-white">
          {t(I18nKey.AIK$PHASE_CREATE_NAME_LABEL)}
          <input
            data-testid="create-phase-modal-title-input"
            className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            testId="create-phase-modal-submit"
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

export default CreatePhaseModal;
