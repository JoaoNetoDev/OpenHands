// Stub mínimo — reescrito pelo SPRINT-07 (shell do AIK: breadcrumb + slot de
// painel de conversa, TECH §2.6).
import type { JSX } from "react";
import { Outlet } from "react-router";

export function AikLayout(): JSX.Element {
  return (
    <div data-testid="aik-layout">
      <Outlet />
    </div>
  );
}

export default AikLayout;
