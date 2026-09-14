import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { useSystemSettings } from "#/hooks/use-system-settings";
import { useLocalWorkspaces } from "#/hooks/query/use-local-workspaces";
import { useLlmProfiles } from "#/hooks/query/use-llm-profiles";
import { SettingsDropdownInput } from "#/components/features/settings/settings-dropdown-input";
import { RichTextInput } from "#/components/features/settings/system-settings/rich-text-input";
import { SystemSettingsInputsSkeleton } from "#/components/features/settings/system-settings/system-settings-inputs-skeleton";
import { BrandButton } from "#/components/features/settings/brand-button";
import { NavigationLink } from "#/components/shared/navigation-link";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";

export function SystemSettingsScreen() {
  const { t } = useTranslation("openhands");
  const { settings, saveSystemSettings } = useSystemSettings();
  const { data: workspacesData, isLoading: workspacesLoading } =
    useLocalWorkspaces();
  const { data: llmProfiles, isLoading: profilesLoading } = useLlmProfiles();

  const effectiveDefaultWorkspaceId = workspacesData?.workspaces.some(
    (w) => w.id === settings.defaultWorkspaceId,
  )
    ? settings.defaultWorkspaceId
    : undefined;
  const effectiveDefaultLlmProfileName = llmProfiles?.profiles.some(
    (p) => p.name === settings.defaultLlmProfileName,
  )
    ? settings.defaultLlmProfileName
    : undefined;

  const [workspaceInput, setWorkspaceInput] = React.useState<
    string | undefined
  >(effectiveDefaultWorkspaceId);
  const [profileInput, setProfileInput] = React.useState<string | undefined>(
    effectiveDefaultLlmProfileName,
  );
  const [contextHtmlInput, setContextHtmlInput] = React.useState(
    settings.globalUserContextHtml ?? "",
  );
  const [initialized, setInitialized] = React.useState(false);

  // Seed form state from reconciled effective values once workspaces/profiles
  // have loaded (they start undefined while queries are pending).
  React.useEffect(() => {
    if (initialized || workspacesLoading || profilesLoading) return;
    setWorkspaceInput(effectiveDefaultWorkspaceId);
    setProfileInput(effectiveDefaultLlmProfileName);
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
  const profileItems = React.useMemo(
    () =>
      (llmProfiles?.profiles ?? []).map((p) => ({
        key: p.name,
        label: p.name,
      })),
    [llmProfiles?.profiles],
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
                items={workspaceItems}
                selectedKey={workspaceInput}
                isClearable
                onSelectionChange={(key) => setWorkspaceInput(key?.toString())}
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
              <SettingsDropdownInput
                testId="default-llm-profile-input"
                name="default-llm-profile-input"
                label={t(I18nKey.SYSTEM_SETTINGS$DEFAULT_LLM_PROFILE_LABEL)}
                items={profileItems}
                selectedKey={profileInput}
                isClearable
                onSelectionChange={(key) => setProfileInput(key?.toString())}
              />
            )}
            {!hasProfiles && (
              <div className="flex flex-col gap-2.5">
                <span className="text-sm">
                  {t(I18nKey.SYSTEM_SETTINGS$DEFAULT_LLM_PROFILE_LABEL)}
                </span>
                <NavigationLink
                  to="/settings/llm"
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
    </div>
  );
}

export default SystemSettingsScreen;
