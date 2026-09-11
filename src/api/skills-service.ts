import { SkillsClient } from "@openhands/typescript-client/clients";
import {
  SKILLS_CATALOG,
  type SkillCatalogEntry,
} from "@openhands/extensions/skills";
import { SkillInfo } from "#/types/settings";
import { getAgentServerWorkingDir } from "./agent-server-config";
import { getActiveBackend } from "./backend-registry/active-store";
import {
  fetchCloudConversationSkills,
  fetchCloudSkills,
} from "./cloud/skills-service.api";
import { getAgentServerClientOptions } from "./agent-server-client-options";

function catalogEntryToSkillInfo(entry: SkillCatalogEntry): SkillInfo {
  return {
    name: entry.name,
    type: "knowledge",
    source: "public",
    description: entry.description,
    triggers: entry.triggers,
    category: entry.category,
    content: entry.content,
    license: entry.license ?? null,
    compatibility: entry.compatibility ?? null,
  };
}

/**
 * Public skills loaded from the `@openhands/extensions` npm package.
 *
 * This is an **immutable build-time snapshot**: the catalog is baked into the
 * bundle at `npm run build` / `vite build` time and does not change at
 * runtime. Updating the catalog requires bumping the `@openhands/extensions`
 * dependency and rebuilding.
 */
const PUBLIC_SKILLS: SkillInfo[] = SKILLS_CATALOG.map(catalogEntryToSkillInfo);

class SkillsService {
  static async getSkills(projectDir?: string): Promise<SkillInfo[]> {
    if (getActiveBackend().backend.kind === "cloud") {
      return fetchCloudSkills();
    }

    // Most "public" skills come from the bundled @openhands/extensions npm
    // package, so we don't need an agent-server round-trip for those. But
    // `load_public` is also what gates the agent-server's own registered
    // marketplace skills (see openhands.agent_server.skills_service
    // .load_all_skills: marketplace auto-load skills only load when
    // load_public is true) — so it must stay true, or any marketplace
    // registered in settings.json (e.g. custom internal skill catalogs)
    // silently never loads. Duplicates against PUBLIC_SKILLS are removed
    // below by name.
    let localSkills: SkillInfo[] = [];
    try {
      const response = await new SkillsClient(
        getAgentServerClientOptions(),
      ).getSkills({
        load_public: true,
        load_user: true,
        load_project: true,
        load_org: false,
        project_dir: projectDir ?? getAgentServerWorkingDir(),
      });
      localSkills = (response.skills ?? []) as SkillInfo[];
    } catch {
      // Agent-server may not support the skills endpoint or may be
      // unreachable; fall back to the bundled public catalog alone.
    }

    const localSkillNames = new Set(localSkills.map((s) => s.name));
    const dedupedPublicSkills = PUBLIC_SKILLS.filter(
      (s) => !localSkillNames.has(s.name),
    );

    return [...localSkills, ...dedupedPublicSkills];
  }

  /**
   * Skills loaded into a running cloud conversation (see
   * `fetchCloudConversationSkills`). Cloud-only: local conversations keep
   * using `getSkills(projectDir)`, whose agent-server call already scopes to
   * the conversation's workspace.
   */
  static getConversationSkills(conversationId: string): Promise<SkillInfo[]> {
    return fetchCloudConversationSkills(conversationId);
  }
}

export default SkillsService;
