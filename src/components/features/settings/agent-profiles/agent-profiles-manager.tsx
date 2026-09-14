import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandButton } from "#/components/features/settings/brand-button";
import { AgentProfilesBody } from "./agent-profiles-body";
import { DeleteAgentProfileModal } from "./delete-agent-profile-modal";
import { ImportFromCentralModal } from "./import-from-central-modal";
import { type AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { useActivateAgentProfile } from "#/hooks/mutation/use-activate-agent-profile";
import { useCanManageOrgProfiles } from "#/hooks/use-can-manage-org-profiles";
import { displaySuccessToast } from "#/utils/custom-toast-handlers";
import { I18nKey } from "#/i18n/declaration";

interface AgentProfilesManagerProps {
  onAddProfile?: () => void;
  onEditProfile?: (profile: AgentProfileSummary) => void;
}

export function AgentProfilesManager({
  onAddProfile,
  onEditProfile,
}: AgentProfilesManagerProps) {
  const { t } = useTranslation("openhands");
  const { data, isLoading, error } = useAgentProfiles();
  const activateProfile = useActivateAgentProfile();
  // Cloud members are view-only; only owners/admins (and all local users) may
  // add, edit, delete, or activate agent profiles (org-scoped, same permission
  // as LLM profiles). Mirrors LlmProfilesManager.
  const canManage = useCanManageOrgProfiles();
  const [profileToDelete, setProfileToDelete] =
    useState<AgentProfileSummary | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const profiles = data?.profiles ?? [];
  const activeId = data?.active_agent_profile_id ?? null;

  const handleActivate = async (profile: AgentProfileSummary) => {
    if (!profile.id) return;
    try {
      await activateProfile.mutateAsync(profile.id);
      displaySuccessToast(
        t(I18nKey.SETTINGS$PROFILE_ACTIVATED, { name: profile.name }),
      );
    } catch (error) {
      // The global mutation error toast reports the failure; just log here.
      console.error("Failed to activate agent profile:", error);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium text-white">
            {t(I18nKey.SETTINGS$AVAILABLE_PROFILES)}
          </h2>
          {canManage ? (
            <div className="ml-auto flex gap-2">
              <BrandButton
                testId="import-from-central"
                type="button"
                variant="tertiary"
                onClick={() => setIsImportOpen(true)}
              >
                {t(I18nKey.SETTINGS$IMPORT_FROM_CENTRAL)}
              </BrandButton>
              {onAddProfile ? (
                <BrandButton
                  testId="add-agent-profile"
                  type="button"
                  variant="secondary"
                  onClick={onAddProfile}
                >
                  {t(I18nKey.SETTINGS$ADD_AGENT_PROFILE)}
                </BrandButton>
              ) : null}
            </div>
          ) : null}
        </div>

        <AgentProfilesBody
          isLoading={isLoading}
          loadError={error ?? null}
          profiles={profiles}
          activeId={activeId}
          canManage={canManage}
          onActivate={handleActivate}
          onEdit={(profile) => onEditProfile?.(profile)}
          onDelete={setProfileToDelete}
          isActivating={activateProfile.isPending}
        />
      </div>

      <DeleteAgentProfileModal
        profile={profileToDelete}
        onClose={() => setProfileToDelete(null)}
      />
      <ImportFromCentralModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
      />
    </>
  );
}
