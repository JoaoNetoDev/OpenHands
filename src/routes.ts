import {
  type RouteConfig,
  layout,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  layout("routes/root-layout.tsx", [
    index("routes/index-home.tsx"),
    route("conversations", "routes/home.tsx"),
    route(
      "conversations/:conversationId/panel",
      "routes/conversation-panel.tsx",
    ),
    route("conversations/:conversationId", "routes/conversation.tsx"),
    route("launch", "routes/launch.tsx"),
    route("board", "routes/board-list.tsx"),
    route("board/:boardId", "routes/kanban-board.tsx"),
    route("customize", "routes/extensions-hub.tsx"),
    route("skills", "routes/skills-settings.tsx"),
    route("plugins", "routes/skills-plugins.tsx"),
    route("apps", "routes/canvas-extensions.tsx"),
    route("extensions/:extensionName/*", "routes/canvas-extension-page.tsx"),
    route("mcp", "routes/mcp.tsx"),
    route("settings", "routes/settings.tsx", [
      index("routes/settings-index.tsx"),
      route("llm", "routes/llm-settings.tsx"),
      route("agent", "routes/agent-settings.tsx"),
      route("agents", "routes/agent-profiles-settings.tsx"),
      route("condenser", "routes/condenser-settings.tsx"),
      route("agent-context", "routes/agent-context-settings.tsx"),
      route("system", "routes/system-settings.tsx"),
      route("verification", "routes/verification-settings.tsx"),
      route("app", "routes/app-settings.tsx"),
      route("secrets", "routes/secrets-settings.tsx"),
    ]),
    route("oauth/device/verify", "routes/device-verify.tsx"),
    route("automations", "routes/automations-list.tsx"),
    route("automations/git-sync", "routes/automation-git-sync.tsx"),
    route("automations/templates", "routes/automation-templates.tsx"),
    route("automations/new/:automationId", "routes/automation-setup-route.tsx"),
    route("automations/:automationId", "routes/automation-detail.tsx"),
  ]),
  route(
    "shared/conversations/:conversationId",
    "routes/shared-conversation.tsx",
  ),
  // AIK (SPRINT-02, SPEC §2.1 fallback path — the `<Routes>` imperative
  // spike was rejected by the validator because `clientLoader` only runs
  // under file-routes/data-router, not inside `<Routes>` mounted by hand).
  // Same file-routes tree as the Agent Canvas above, so every AIK route
  // gets loader/typegen support for free, at the cost of a visible
  // `/__aik` prefix in the URL. `routes/index-home.tsx`'s `clientLoader`
  // redirects here when `window.location.hostname` is an AIK vhost.
  route("__aik", "routes/aik/aik-layout.tsx", [
    index("routes/aik/aik-systems-board.tsx"),
    route(":systemId", "routes/aik/aik-phases-board.tsx"),
    route(":systemId/fases/:phaseId", "routes/aik/aik-tasks-board.tsx"),
  ]),
] satisfies RouteConfig;
