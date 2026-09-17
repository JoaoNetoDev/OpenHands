import React from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { I18nKey } from "#/i18n/declaration";
import { useSystemSettings } from "#/hooks/use-system-settings";
import { useLocalWorkspaces } from "#/hooks/query/use-local-workspaces";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { AGENT_PROFILES_QUERY_KEYS } from "#/hooks/query/query-keys";
import AgentProfilesService from "#/api/agent-profiles-service/agent-profiles-service.api";
import { getAcpProviderDisplayName } from "#/constants/acp-providers";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { SettingsDropdownInput } from "#/components/features/settings/settings-dropdown-input";
import { RichTextInput } from "#/components/features/settings/system-settings/rich-text-input";
import { SystemSettingsInputsSkeleton } from "#/components/features/settings/system-settings/system-settings-inputs-skeleton";
import { BrandButton } from "#/components/features/settings/brand-button";
import { NavigationLink } from "#/components/shared/navigation-link";
import { OpenWorkspaceDialog } from "#/components/features/home/open-workspace-dialog";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";

const CREATE_WORKSPACE_KEY = "__create__";

export function SystemSettingsScreen() {
  const { t } = useTranslation("openhands");
  const { backend, orgId } = useActiveBackend();
  const { settings, saveSystemSettings } = useSystemSettings();
  const { data: workspacesData, isLoading: workspacesLoading } =
    useLocalWorkspaces();
  const { data: agentProfiles, isLoading: profilesLoading } =
    useAgentProfiles();

  const effectiveDefaultWorkspaceId = workspacesData?.workspaces.some(
    (w) => w.id === settings.defaultWorkspaceId,
  )
    ? settings.defaultWorkspaceId
    : undefined;
  // `SystemSettings.defaultLlmProfileName` now stores an AgentProfile id
  // (opaque string in localStorage; a pre-existing LLM profile name simply
  // won't match any AgentProfileSummary.id and reconciles to unselected).
  const effectiveDefaultAgentProfileId = agentProfiles?.profiles.some(
    (p) => p.id === settings.defaultLlmProfileName,
  )
    ? settings.defaultLlmProfileName
    : undefined;

  const [workspaceInput, setWorkspaceInput] = React.useState<
    string | undefined
  >(effectiveDefaultWorkspaceId);
  const [profileInput, setProfileInput] = React.useState<string | undefined>(
    effectiveDefaultAgentProfileId,
  );
  const [contextHtmlInput, setContextHtmlInput] = React.useState(
    settings.globalUserContextHtml ?? "",
  );
  const [initialized, setInitialized] = React.useState(false);
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] =
    React.useState(false);

  // Seed form state from reconciled effective values once workspaces/profiles
  // have loaded (they start undefined while queries are pending).
  React.useEffect(() => {
    if (initialized || workspacesLoading || profilesLoading) return;
    setWorkspaceInput(effectiveDefaultWorkspaceId);
    setProfileInput(effectiveDefaultAgentProfileId);
    setContextHtmlInput(settings.globalUserContextHtml ?? "");
    setInitialized(true);
  }, [workspacesLoading, profilesLoading, initialized]);

  const workspaceItems = React.useMemo(
    () =>
      (workspacesData?.workspaces ?? []).map((w) => ({
        key: w.id,
        label: w.name,
      })),
    [workspacesData?.workspaces],
  );
  const workspaceDropdownItems = React.useMemo(
    () => [
      {
        key: CREATE_WORKSPACE_KEY,
        label: t(I18nKey.SYSTEM_SETTINGS$CREATE_WORKSPACE),
      },
      ...workspaceItems,
    ],
    [workspaceItems, t],
  );
  const profileItems = React.useMemo(
    () =>
      (agentProfiles?.profiles ?? [])
        .filter((p) => p.id != null)
        .map((p) => ({
          key: p.id as string,
          label: `${p.name} — ${
            p.agent_kind === "acp"
              ? t(I18nKey.SYSTEM_SETTINGS$PROVIDER_ACP)
              : "OpenHands"
          }`,
        })),
    [agentProfiles?.profiles, t],
  );

  const selectedProfile = agentProfiles?.profiles.find(
    (p) => p.id === profileInput,
  );
  // Provider detail is only ever fetched for the currently-selected profile
  // (never for every item in the dropdown) — same on-demand pattern as
  // useSwitchAcpModel's home-page ACP resolution.
  const { data: selectedProfileDetail } = useQuery({
    queryKey: AGENT_PROFILES_QUERY_KEYS.detail(
      backend.id,
      orgId,
      selectedProfile?.name ?? "",
    ),
    queryFn: () => AgentProfilesService.getProfile(selectedProfile!.name),
    enabled: selectedProfile?.agent_kind === "acp",
    meta: { disableToast: true },
  });
  const selectedProfileAcp =
    selectedProfileDetail?.profile.agent_kind === "acp"
      ? selectedProfileDetail.profile
      : null;
  const providerLabel = getAcpProviderDisplayName(
    selectedProfileAcp?.acp_server,
  );

  const hasWorkspaces = workspaceItems.length > 0;
  const hasProfiles = profileItems.length > 0;

  const handleSave = () => {
    const ok = saveSystemSettings({
      defaultWorkspaceId: workspaceInput,
      defaultLlmProfileName: profileInput,
      globalUserContextHtml: contextHtmlInput,
    });
    if (ok) {
      displaySuccessToast(t(I18nKey.SETTINGS$SAVED));
    } else {
      displayErrorToast(t(I18nKey.SYSTEM_SETTINGS$SAVE_ERROR));
    }
  };

  const shouldBeLoading = workspacesLoading || profilesLoading;

  return (
    <div data-testid="system-settings-screen" className="flex flex-col gap-6">
      {shouldBeLoading && <SystemSettingsInputsSkeleton />}
      {!shouldBeLoading && (
        <div className="flex flex-col gap-6">
          <div>
            {hasWorkspaces && (
              <SettingsDropdownInput
                testId="default-workspace-input"
                name="default-workspace-input"
                label={t(I18nKey.SYSTEM_SETTINGS$DEFAULT_WORKSPACE_LABEL)}
                items={workspaceDropdownItems}
                selectedKey={workspaceInput}
                isClearable
                onSelectionChange={(key) => {
                  if (key === CREATE_WORKSPACE_KEY) {
                    setIsCreateWorkspaceOpen(true);
                    return;
                  }
                  setWorkspaceInput(key?.toString());
                }}
              />
            )}
            {!hasWorkspaces && (
              <div className="flex flex-col gap-2.5">
                <span className="text-sm">
                  {t(I18nKey.SYSTEM_SETTINGS$DEFAULT_WORKSPACE_LABEL)}
                </span>
                <NavigationLink
                  to="/"
                  className="text-sm text-primary hover:underline"
                >
                  {t(I18nKey.SYSTEM_SETTINGS$DEFAULT_WORKSPACE_EMPTY_LINK)}
                </NavigationLink>
              </div>
            )}
          </div>

          <div>
            {hasProfiles && (
              <>
                <SettingsDropdownInput
                  testId="default-llm-profile-input"
                  name="default-llm-profile-input"
                  label={t(I18nKey.SYSTEM_SETTINGS$DEFAULT_LLM_PROFILE_LABEL)}
                  items={profileItems}
                  selectedKey={profileInput}
                  isClearable
                  onSelectionChange={(key) => setProfileInput(key?.toString())}
                />
                {providerLabel && (
                  <p
                    data-testid="default-agent-profile-provider"
                    className="mt-1.5 text-xs text-tertiary-light"
                  >
                    {t(I18nKey.SYSTEM_SETTINGS$PROVIDER_DETAIL, {
                      provider: providerLabel,
                    })}
                  </p>
                )}
              </>
            )}
            {!hasProfiles && (
              <div className="flex flex-col gap-2.5">
                <span className="text-sm">
                  {t(I18nKey.SYSTEM_SETTINGS$DEFAULT_LLM_PROFILE_LABEL)}
                </span>
                <NavigationLink
                  to="/settings/agents"
                  className="text-sm text-primary hover:underline"
                >
                  {t(I18nKey.SYSTEM_SETTINGS$DEFAULT_LLM_PROFILE_EMPTY_LINK)}
                </NavigationLink>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--oh-border)] pt-6 mt-2">
            <RichTextInput
              testId="global-user-context-input"
              label={t(I18nKey.SYSTEM_SETTINGS$GLOBAL_CONTEXT_LABEL)}
              defaultValueHtml={contextHtmlInput}
              onChange={setContextHtmlInput}
            />
          </div>

          <div className="border-t border-[var(--oh-border)] pt-6 mt-2 flex flex-col gap-4">
            <p className="text-sm leading-5 text-tertiary-light">
              {t(I18nKey.SYSTEM_SETTINGS$LOCAL_SCOPE_HELP)}
            </p>
            <div className="flex justify-start">
              <BrandButton
                testId="submit-button"
                variant="primary"
                type="button"
                onClick={handleSave}
              >
                {t(I18nKey.SETTINGS$SAVE_CHANGES)}
              </BrandButton>
            </div>
          </div>
        </div>
      )}
      <OpenWorkspaceDialog
        isOpen={isCreateWorkspaceOpen}
        onClose={() => setIsCreateWorkspaceOpen(false)}
        onConfirm={(workspace) => {
          setWorkspaceInput(workspace.id);
          setIsCreateWorkspaceOpen(false);
        }}
      />
    </div>
  );
}

export default SystemSettingsScreen;
