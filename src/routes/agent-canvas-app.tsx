// Moved from `src/routes.ts:8-49` without content change (SPRINT-02, SPEC
// §2.1). Renders the same route tree the Agent Canvas has always used, but
// via `<Routes>` imperative (react-router@7.18.2) instead of the
// `RouteConfig`/file-routes convention, so it can be mounted conditionally
// by `host-gate.tsx` alongside `<AikRoutes/>` (TECH §2.1).
//
// Known limitation carried over by this move (documented, not fixed here):
// several of these route modules export a `clientLoader` (e.g.
// `settings.tsx`, `index-home.tsx`) that only runs under the file-routes
// data-router convention. Mounting them via `<Routes>` does not invoke
// those loaders. This sprint's scope is limited to proving the hostname
// routing pattern (SPEC §2.1 spike) — loader parity is out of scope here.
import type { JSX } from "react";
import { Routes, Route } from "react-router";
import MainApp from "./root-layout";
import HomeScreen from "./home";
import { ConversationView } from "./conversation";
import LaunchRoute from "./launch";
import BoardListRoute from "./board-list";
import KanbanBoardRoute from "./kanban-board";
import ExtensionsHub from "./extensions-hub";
import SkillsSettingsScreen from "./skills-settings";
import SkillsPluginsScreen from "./skills-plugins";
import CanvasExtensionsScreen from "./canvas-extensions";
import CanvasExtensionPage from "./canvas-extension-page";
import MCPPage from "./mcp";
import SettingsScreen from "./settings";
import SettingsIndex from "./settings-index";
import LlmSettingsRoute from "./llm-settings";
import AgentSettingsRoute from "./agent-settings";
import AgentProfilesSettingsRoute from "./agent-profiles-settings";
import CondenserSettingsScreen from "./condenser-settings";
import AgentContextSettingsScreen from "./agent-context-settings";
import SystemSettingsScreen from "./system-settings";
import VerificationSettingsScreen from "./verification-settings";
import AppSettingsScreen from "./app-settings";
import SecretsSettingsScreen from "./secrets-settings";
import DeviceVerify from "./device-verify";
import AutomationsList from "./automations-list";
import AutomationGitSync from "./automation-git-sync";
import AutomationTemplates from "./automation-templates";
import AutomationSetupRoute from "./automation-setup-route";
import AutomationDetail from "./automation-detail";
import SharedConversation from "./shared-conversation";

export function AgentCanvasApp(): JSX.Element {
  return (
    <Routes>
      <Route element={<MainApp />}>
        <Route index element={<HomeScreen />} />
        <Route path="conversations" element={<HomeScreen />} />
        <Route
          path="conversations/:conversationId/panel"
          element={<ConversationView />}
        />
        <Route
          path="conversations/:conversationId"
          element={<ConversationView />}
        />
        <Route path="launch" element={<LaunchRoute />} />
        <Route path="board" element={<BoardListRoute />} />
        <Route path="board/:boardId" element={<KanbanBoardRoute />} />
        <Route path="customize" element={<ExtensionsHub />} />
        <Route path="skills" element={<SkillsSettingsScreen />} />
        <Route path="plugins" element={<SkillsPluginsScreen />} />
        <Route path="apps" element={<CanvasExtensionsScreen />} />
        <Route
          path="extensions/:extensionName/*"
          element={<CanvasExtensionPage />}
        />
        <Route path="mcp" element={<MCPPage />} />
        <Route path="settings" element={<SettingsScreen />}>
          <Route index element={<SettingsIndex />} />
          <Route path="llm" element={<LlmSettingsRoute />} />
          <Route path="agent" element={<AgentSettingsRoute />} />
          <Route path="agents" element={<AgentProfilesSettingsRoute />} />
          <Route path="condenser" element={<CondenserSettingsScreen />} />
          <Route
            path="agent-context"
            element={<AgentContextSettingsScreen />}
          />
          <Route path="system" element={<SystemSettingsScreen />} />
          <Route path="verification" element={<VerificationSettingsScreen />} />
          <Route path="app" element={<AppSettingsScreen />} />
          <Route path="secrets" element={<SecretsSettingsScreen />} />
        </Route>
        <Route path="oauth/device/verify" element={<DeviceVerify />} />
        <Route path="automations" element={<AutomationsList />} />
        <Route path="automations/git-sync" element={<AutomationGitSync />} />
        <Route path="automations/templates" element={<AutomationTemplates />} />
        <Route
          path="automations/new/:automationId"
          element={<AutomationSetupRoute />}
        />
        <Route
          path="automations/:automationId"
          element={<AutomationDetail />}
        />
      </Route>
      <Route
        path="shared/conversations/:conversationId"
        element={<SharedConversation />}
      />
    </Routes>
  );
}

export default AgentCanvasApp;
