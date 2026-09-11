import React from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, KeyRound } from "lucide-react";

import { type Backend } from "#/api/backend-registry/types";
import {
  downloadBackendsFile,
  parseBackendsFile,
} from "#/api/backend-registry/export-import";
import {
  loadBackendsFromVault,
  saveBackendsToVault,
  VaultRequestError,
} from "#/api/backend-registry/vault-service";
import { BrandButton } from "#/components/features/settings/brand-button";
import { I18nKey } from "#/i18n/declaration";

interface BackendSyncSectionProps {
  backends: Backend[];
  /** Adds one backend (by value, not by imported id) and returns the stored record. */
  onImportBackend: (
    backend: Omit<Backend, "id" | "connectionRevision">,
  ) => void;
}

type StatusMessage = { kind: "success" | "error"; text: string };

/**
 * Backends only ever live in this browser's localStorage (see
 * backend-registry/storage.ts) — there's no account to sync them through.
 * This gives the user two ways to carry that list to another device:
 * a plain file, or a password-encrypted vault stored server-side (the
 * server never sees the password or the plaintext list, see vault-crypto.ts).
 */
export function BackendSyncSection({
  backends,
  onImportBackend,
}: BackendSyncSectionProps) {
  const { t } = useTranslation("openhands");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState<"vault-save" | "vault-load" | null>(
    null,
  );
  const [status, setStatus] = React.useState<StatusMessage | null>(null);

  const importBackends = (imported: Backend[]) => {
    const existingHosts = new Set(backends.map((b) => b.host));
    let added = 0;
    for (const backend of imported) {
      if (existingHosts.has(backend.host)) continue;
      onImportBackend({
        name: backend.name,
        host: backend.host,
        apiKey: backend.apiKey,
        kind: backend.kind,
        authMode: backend.authMode,
      });
      existingHosts.add(backend.host);
      added += 1;
    }
    return added;
  };

  const handleExport = () => {
    downloadBackendsFile(backends);
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const { target } = event;
    const file = target.files?.[0];
    target.value = "";
    if (!file) return;

    try {
      const imported = await parseBackendsFile(file);
      const added = importBackends(imported);
      setStatus({
        kind: "success",
        text: t(I18nKey.BACKEND$IMPORT_FILE_SUCCESS, { count: added }),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        text: t(I18nKey.BACKEND$IMPORT_FILE_ERROR, {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  };

  const handleVaultSave = async () => {
    if (!password) {
      setStatus({
        kind: "error",
        text: t(I18nKey.BACKEND$VAULT_PASSWORD_REQUIRED),
      });
      return;
    }
    setBusy("vault-save");
    setStatus(null);
    try {
      await saveBackendsToVault(password, backends);
      setStatus({
        kind: "success",
        text: t(I18nKey.BACKEND$VAULT_SAVE_SUCCESS),
      });
    } catch {
      setStatus({ kind: "error", text: t(I18nKey.BACKEND$VAULT_ERROR) });
    } finally {
      setBusy(null);
    }
  };

  const handleVaultLoad = async () => {
    if (!password) {
      setStatus({
        kind: "error",
        text: t(I18nKey.BACKEND$VAULT_PASSWORD_REQUIRED),
      });
      return;
    }
    setBusy("vault-load");
    setStatus(null);
    try {
      const loaded = await loadBackendsFromVault(password);
      const added = importBackends(loaded);
      setStatus({
        kind: "success",
        text: t(I18nKey.BACKEND$VAULT_LOAD_SUCCESS, { count: added }),
      });
    } catch (error) {
      const notFound =
        error instanceof VaultRequestError && error.status === 404;
      setStatus({
        kind: "error",
        text: t(
          notFound
            ? I18nKey.BACKEND$VAULT_NOT_FOUND
            : I18nKey.BACKEND$VAULT_ERROR,
        ),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--oh-border)] px-5 py-4">
      <h3 className="text-sm font-medium text-[var(--oh-text-primary)]">
        {t(I18nKey.BACKEND$SYNC_TITLE)}
      </h3>

      <div className="flex flex-wrap gap-2">
        <BrandButton
          type="button"
          variant="secondary"
          onClick={handleExport}
          testId="backend-sync-export-file"
          startContent={<Download width={14} height={14} />}
        >
          {t(I18nKey.BACKEND$EXPORT_FILE)}
        </BrandButton>
        <BrandButton
          type="button"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          testId="backend-sync-import-file"
          startContent={<Upload width={14} height={14} />}
        >
          {t(I18nKey.BACKEND$IMPORT_FILE)}
        </BrandButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          data-testid="backend-sync-file-input"
          onChange={handleFileSelected}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="backend-vault-password" className="sr-only">
          {t(I18nKey.BACKEND$VAULT_PASSWORD_LABEL)}
        </label>
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-[var(--oh-border)] bg-surface-raised px-2">
          <KeyRound
            width={14}
            height={14}
            className="text-[var(--oh-text-secondary)]"
          />
          <input
            id="backend-vault-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t(I18nKey.BACKEND$VAULT_PASSWORD_PLACEHOLDER)}
            data-testid="backend-vault-password-input"
            className="w-full bg-transparent py-1.5 text-sm text-[var(--oh-text-primary)] outline-none"
          />
        </div>
        <BrandButton
          type="button"
          variant="secondary"
          onClick={handleVaultSave}
          isDisabled={busy !== null}
          testId="backend-sync-vault-save"
        >
          {t(I18nKey.BACKEND$VAULT_SAVE)}
        </BrandButton>
        <BrandButton
          type="button"
          variant="secondary"
          onClick={handleVaultLoad}
          isDisabled={busy !== null}
          testId="backend-sync-vault-load"
        >
          {t(I18nKey.BACKEND$VAULT_LOAD)}
        </BrandButton>
      </div>

      {status ? (
        <p
          data-testid="backend-sync-status"
          className={
            status.kind === "error"
              ? "text-sm text-[var(--oh-danger)]"
              : "text-sm text-[var(--oh-success)]"
          }
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
