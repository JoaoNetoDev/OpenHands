import { type RouteConfig, route } from "@react-router/dev/routes";

// The full Agent Canvas tree that used to live here has moved, unchanged,
// to `src/routes/agent-canvas-app.tsx`. A single splat route now defers to
// `host-gate.tsx`, which decides at runtime (by `window.location.hostname`)
// between the Agent Canvas app and the AIK app — no URL prefix, no proxy
// path rewrite (TECH §2.1, SPEC §2.1, SPRINT-02).
export default [route("*", "routes/host-gate.tsx")] satisfies RouteConfig;
