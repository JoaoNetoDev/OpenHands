import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  ProfilesClient,
  AgentProfilesClient,
} from "@openhands/typescript-client/clients";
import { ApiKeyModalBase } from "#/components/features/settings/api-key-modal-base";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import ProfilesService from "#/api/profiles-service/profiles-service.api";
import AgentProfilesService, {
  type AgentProfileSaveInput,
} from "#/api/agent-profiles-service/agent-profiles-service.api";
import { LLM_PROFILES_QUERY_KEYS } from "#/hooks/query/use-llm-profiles";
import { AGENT_PROFILES_QUERY_KEYS } from "#/hooks/query/use-agent-profiles";
import { displaySuccessToast } from "#/utils/custom-toast-handlers";
import { I18nKey } from "#/i18n/declaration";

interface ImportFromCentralModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LogLine {
  text: string;
  kind: "ok" | "warn" | "error";
}

/**
 * Imports LLM profiles and (non-ACP) Agent profiles from a remote "central"
 * OpenHands backend into the currently active (local) backend, by talking to
 * the central's `/api/profiles` and `/api/agent-profiles` REST API directly
 * from the browser (same client classes the app already uses for the active
 * backend, just pointed at a different host/key).
 *
 * ACP profiles (Claude Code/Codex/Gemini CLI) are skipped: their credential
 * is a host-local CLI login or a global secret, not part of the profile
 * payload, so cloning the profile alone would leave it unauthenticated here.
 */
export function ImportFromCentralModal({
  isOpen,
  onClose,
}: ImportFromCentralModalProps) {
  const { t } = useTranslation("openhands");
  const queryClient = useQueryClient();
  const [host, setHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [includeAcp, setIncludeAcp] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  if (!isOpen) return null;

  const addLog = (text: string, kind: LogLine["kind"]) =>
    setLog((prev) => [...prev, { text, kind }]);

  const handleClose = () => {
    if (isImporting) return;
    setLog([]);
    onClose();
  };

  const handleImport = async () => {
    const trimmedHost = host.trim().replace(/\/$/, "");
    if (!trimmedHost || !apiKey.trim()) return;

    setIsImporting(true);
    setLog([]);

    const remoteProfiles = new ProfilesClient({
      host: trimmedHost,
      apiKey: apiKey.trim(),
    });
    const remoteAgentProfiles = new AgentProfilesClient({
      host: trimmedHost,
      apiKey: apiKey.trim(),
    });

    try {
      // 1. LLM profiles first — agent profiles below may reference them.
      let llmList: Awaited<ReturnType<typeof remoteProfiles.listProfiles>>;
      try {
        llmList = await remoteProfiles.listProfiles();
      } catch (error) {
        addLog(
          `Não foi possível conectar em ${trimmedHost} (${error instanceof Error ? error.message : "erro desconhecido"}). Confira o host, a API key, e se o CORS do central permite esta origem.`,
          "error",
        );
        return;
      }

      for (const p of llmList.profiles) {
        try {
          const detail = await remoteProfiles.getProfile(p.name, {
            exposeSecrets: "plaintext",
          });
          await ProfilesService.saveProfile(p.name, {
            llm: detail.config as never,
            include_secrets: true,
          });
          addLog(`LLM profile "${p.name}" importado.`, "ok");
        } catch (error) {
          addLog(
            `LLM profile "${p.name}" falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`,
            "error",
          );
        }
      }

      // 2. Agent profiles — skip ACP ones unless explicitly requested.
      const agentList = await remoteAgentProfiles.listAgentProfiles();
      for (const summary of agentList.profiles) {
        if (summary.agent_kind === "acp" && !includeAcp) {
          addLog(
            `Agent profile "${summary.name}" é ACP (ex.: Claude Code) — pulado (login/credencial não é clonável).`,
            "warn",
          );
          continue;
        }
        try {
          const detail = await remoteAgentProfiles.getAgentProfile(
            summary.name,
          );
          const { id, revision, schema_version, ...rest } = detail.profile;
          await AgentProfilesService.saveProfile(
            summary.name,
            rest as AgentProfileSaveInput,
          );
          addLog(`Agent profile "${summary.name}" importado.`, "ok");
        } catch (error) {
          addLog(
            `Agent profile "${summary.name}" falhou: ${error instanceof Error ? error.message : "erro desconhecido"}`,
            "error",
          );
        }
      }

      await queryClient.invalidateQueries({
        queryKey: LLM_PROFILES_QUERY_KEYS.all,
      });
      await queryClient.invalidateQueries({
        queryKey: AGENT_PROFILES_QUERY_KEYS.all,
      });
      displaySuccessToast("Importação do central concluída.");
    } finally {
      setIsImporting(false);
    }
  };

  const footer = (
    <>
      <BrandButton
        type="button"
        variant="tertiary"
        onClick={handleClose}
        isDisabled={isImporting}
      >
        {t(I18nKey.BUTTON$CLOSE)}
      </BrandButton>
      <BrandButton
        testId="import-from-central-confirm"
        type="button"
        variant="primary"
        onClick={handleImport}
        isDisabled={isImporting || !host.trim() || !apiKey.trim()}
        aria-busy={isImporting}
      >
        {isImporting ? (
          <>
            <LoadingSpinner size="small" />
            <span className="sr-only">
              {t(I18nKey.SETTINGS$IMPORTING_LABEL)}
            </span>
          </>
        ) : (
          t(I18nKey.SETTINGS$IMPORT_BUTTON)
        )}
      </BrandButton>
    </>
  );

  return (
    <ApiKeyModalBase
      isOpen
      title={t(I18nKey.SETTINGS$IMPORT_FROM_CENTRAL)}
      footer={footer}
      onClose={handleClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--oh-text-tertiary)]">
          {t(I18nKey.SETTINGS$IMPORT_FROM_CENTRAL_DESCRIPTION)}
        </p>
        <SettingsInput
          testId="import-from-central-host"
          label={t(I18nKey.SETTINGS$CENTRAL_HOST_LABEL)}
          name="central-host"
          type="text"
          value={host}
          onChange={setHost}
          placeholder={t(I18nKey.SETTINGS$CENTRAL_HOST_PLACEHOLDER)}
          isDisabled={isImporting}
        />
        <SettingsInput
          testId="import-from-central-key"
          label={t(I18nKey.SETTINGS$CENTRAL_API_KEY_LABEL)}
          name="central-key"
          type="password"
          value={apiKey}
          onChange={setApiKey}
          isDisabled={isImporting}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeAcp}
            disabled={isImporting}
            onChange={(e) => setIncludeAcp(e.target.checked)}
          />
          {t(I18nKey.SETTINGS$INCLUDE_ACP_PROFILES_LABEL)}
        </label>
        {log.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded border border-[var(--oh-border)] p-2 text-xs font-mono">
            {log.map((line) => (
              <div
                key={line.text}
                className={
                  line.kind === "ok"
                    ? "text-green-400"
                    : line.kind === "warn"
                      ? "text-yellow-400"
                      : "text-red-400"
                }
              >
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </ApiKeyModalBase>
  );
}
