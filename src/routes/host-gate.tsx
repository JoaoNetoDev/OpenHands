// Only entry registered in `src/routes.ts` (rota `*`). Decides, once per
// mount, which app tree to render based on `window.location.hostname` — no
// URL prefix, no proxy path rewrite (TECH §2.1, SPEC §2.1).
import React from "react";
import type { JSX } from "react";
import { AgentCanvasApp } from "./agent-canvas-app";
import { AikRoutes } from "./aik/aik-routes";

const AIK_HOSTNAMES = ["aik.zadotec.com.br"]; // TECH §2.1 — lido 1x no mount

export default function HostGate(): JSX.Element {
  const isAik = React.useMemo(
    () => AIK_HOSTNAMES.includes(window.location.hostname),
    [],
  );
  return isAik ? <AikRoutes /> : <AgentCanvasApp />;
}
