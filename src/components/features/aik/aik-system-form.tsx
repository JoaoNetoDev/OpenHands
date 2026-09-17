import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { getRegisteredBackends } from "#/api/backend-registry/active-store";
import { useGitRepositories } from "#/hooks/query/use-git-repositories";
import { useUserProviders } from "#/hooks/use-user-providers";
import { useAddWorkspaces } from "#/hooks/mutation/use-local-workspaces-mutations";
import { FolderBrowserModal } from "#/components/features/home/workspace-dropdown/folder-browser-modal";
import { useAikBoardStore } from "#/stores/aik-board-store";
import type { LocalWorkspace } from "#/types/workspace";
import type { AikWorkspaceRef } from "#/types/aik";

export interface AikSystemFormInput {
  name: string;
  backendId: string;
  workspaceRef: AikWorkspaceRef;
}

export interface AikSystemFormProps {
  onSubmit: (input: AikSystemFormInput) => void;
  onClose: () => void;
}

/**
 * Cadastro de sistema (SPEC §2.6 / TECH §2.2, CA-03): nome, backend
 * (`getRegisteredBackends()`) e, conforme `backend.kind`, exatamente UM dos
 * campos — nunca os dois ao mesmo tempo:
 * - `kind: "local"` -> `useLocalWorkspaces()`
 * - `kind: "cloud"` -> `useGitRepositories()` do backend/provider ativo
 *
 * Also warns (never blocks, SPEC §4 "dois sistemas apontando pro mesmo
 * workspace local") when the chosen local workspace is already used by
 * another system in the store — the .openhands/aik/system.json file would
 * be shared between them.
 */
export function AikSystemForm({ onSubmit, onClose }: AikSystemFormProps) {
  const { t } = useTranslation("openhands");
  const backends = useMemo(() => getRegisteredBackends(), []);
  const { providers } = useUserProviders();
  const systems = useAikBoardStore((state) => state.systems);

  const [name, setName] = useState("");
  const [backendId, setBackendId] = useState(backends[0]?.id ?? "");
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<LocalWorkspace | null>(null);
  const [repositoryFullName, setRepositoryFullName] = useState("");
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const { mutate: addWorkspaces } = useAddWorkspaces();

  const selectedBackend = backends.find((b) => b.id === backendId) ?? null;
  const isLocal = selectedBackend?.kind === "local";
  const isCloud = selectedBackend?.kind === "cloud";

  const { data: reposData } = useGitRepositories({
    provider: isCloud ? (providers[0] ?? null) : null,
    enabled: isCloud,
  });
  const repositories = useMemo(
    () => reposData?.pages.flatMap((page) => page.items) ?? [],
    [reposData],
  );

  const duplicateSystem = selectedWorkspace
    ? systems.find(
        (s) =>
          s.workspaceRef.kind === "local" &&
          s.workspaceRef.path === selectedWorkspace.path,
      )
    : undefined;

  const trimmedName = name.trim();
  const canSubmit =
    !!trimmedName &&
    !!selectedBackend &&
    ((isLocal && !!selectedWorkspace) || (isCloud && !!repositoryFullName));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !selectedBackend) return;

    let workspaceRef: AikWorkspaceRef;
    if (isLocal) {
      if (!selectedWorkspace) return;
      workspaceRef = {
        kind: "local",
        workspaceId: selectedWorkspace.id,
        path: selectedWorkspace.path,
      };
    } else {
      const repository = repositories.find(
        (r) => r.full_name === repositoryFullName,
      );
      if (!repository) return;
      workspaceRef = {
        kind: "cloud",
        repository: {
          provider: repository.git_provider,
          fullName: repository.full_name,
        },
      };
    }

    onSubmit({
      name: trimmedName,
      backendId: selectedBackend.id,
      workspaceRef,
    });
    onClose();
  };

  return (
    <>
      <ModalBackdrop onClose={onClose}>
        <form
          data-testid="aik-system-form"
          onSubmit={handleSubmit}
          className="bg-base-secondary p-4 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)] w-full max-w-sm"
        >
          <h2 className="text-sm font-semibold text-white">
            {t(I18nKey.AIK$SYSTEM_FORM_TITLE)}
          </h2>

          <label className="flex flex-col gap-1 text-sm text-white">
            {t(I18nKey.AIK$SYSTEM_FORM_NAME_LABEL)}
            <input
              data-testid="aik-system-form-name-input"
              className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-white">
            {t(I18nKey.AIK$SYSTEM_FORM_BACKEND_LABEL)}
            <select
              data-testid="aik-system-form-backend-select"
              className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
              style={{ colorScheme: "dark" }}
              value={backendId}
              onChange={(e) => {
                setBackendId(e.target.value);
                setSelectedWorkspace(null);
                setRepositoryFullName("");
              }}
            >
              {backends.map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.name}
                </option>
              ))}
            </select>
          </label>

          {isLocal && (
            <label className="flex flex-col gap-1 text-sm text-white">
              {t(I18nKey.AIK$SYSTEM_FORM_WORKSPACE_LABEL)}
              <div className="flex items-center gap-2">
                <span
                  data-testid="aik-system-form-workspace-path"
                  className="flex-1 truncate rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
                >
                  {selectedWorkspace
                    ? selectedWorkspace.path
                    : t(I18nKey.AIK$SYSTEM_FORM_WORKSPACE_PLACEHOLDER)}
                </span>
                <BrandButton
                  testId="aik-system-form-browse-workspace"
                  type="button"
                  variant="secondary"
                  onClick={() => setIsBrowserOpen(true)}
                >
                  {t(I18nKey.AIK$SYSTEM_FORM_BROWSE_WORKSPACE_BUTTON)}
                </BrandButton>
              </div>
            </label>
          )}

          {isCloud && (
            <label className="flex flex-col gap-1 text-sm text-white">
              {t(I18nKey.AIK$SYSTEM_FORM_REPOSITORY_LABEL)}
              <select
                data-testid="aik-system-form-repository-select"
                className="rounded-lg border border-[var(--oh-border)] bg-transparent px-3 py-2 text-sm text-white"
                style={{ colorScheme: "dark" }}
                value={repositoryFullName}
                onChange={(e) => setRepositoryFullName(e.target.value)}
              >
                <option value="">
                  {t(I18nKey.AIK$SYSTEM_FORM_REPOSITORY_PLACEHOLDER)}
                </option>
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.full_name}>
                    {repository.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {duplicateSystem && (
            <p
              data-testid="aik-system-form-duplicate-workspace-warning"
              className="text-xs text-warning"
            >
              {t(I18nKey.AIK$SYSTEM_FORM_DUPLICATE_WORKSPACE_WARNING, {
                name: duplicateSystem.name,
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
              testId="aik-system-form-submit"
              type="submit"
              variant="primary"
              isDisabled={!canSubmit}
            >
              {t(I18nKey.AIK$SYSTEM_FORM_SUBMIT_BUTTON)}
            </BrandButton>
          </div>
        </form>
      </ModalBackdrop>
      <FolderBrowserModal
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
        onAdd={(items) => {
          const lastAdded = items[items.length - 1];
          addWorkspaces(items, {
            onSuccess: () => {
              if (lastAdded) setSelectedWorkspace(lastAdded);
            },
          });
          setIsBrowserOpen(false);
        }}
      />
    </>
  );
}

export default AikSystemForm;
