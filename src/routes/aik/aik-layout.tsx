// Shell do AIK (SPEC §2.1/§2.6): breadcrumb + outlet + painel de conversa,
// reescrito pelo SPRINT-07 a partir do stub do SPRINT-02.
import type { JSX } from "react";
import { useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { AikBreadcrumb } from "#/components/features/aik/aik-breadcrumb";
import { AikConversationPanel } from "#/components/features/aik/aik-conversation-panel";
import { ReactRouterNavigationProvider } from "#/routes/react-router-navigation-provider";

export function AikLayout(): JSX.Element {
  const { systemId, phaseId } = useParams<{
    systemId?: string;
    phaseId?: string;
  }>();
  const startPolling = useAikBoardStore((state) => state.startPolling);

  // RF-27/SPEC §2.1/§2.3: polling do arquivo de quadro do sistema, iniciado
  // no mount e reiniciado sempre que `systemId` muda; parado no unmount.
  useEffect(() => {
    if (!systemId) return undefined;
    const stop = startPolling(systemId);
    return stop;
  }, [systemId, startPolling]);

  // Bug found while writing SPRINT-11's E2E specs (out of that sprint's
  // stated scope, but confirmed against the real dev:mock server: every
  // AIK "open system"/"open phase" click and every `AikBreadcrumb` link
  // was a silent no-op). `root-layout.tsx:113` wraps the Agent Canvas
  // tree in `ReactRouterNavigationProvider`, which is what makes
  // `useNavigation()`/`NavigationLink` (used throughout `src/routes/aik`
  // and `src/components/features/aik`) actually call react-router's
  // `navigate()` instead of the inert default from
  // `context/navigation-context.tsx:13-20` (`navigate: noop`). `AikLayout`
  // never got the same wrapper, so every AIK screen silently inherited
  // the no-op — clicking a system/phase card updated nothing and threw no
  // error, so it was easy to miss without an E2E test driving a real
  // browser click.
  return (
    <ReactRouterNavigationProvider>
      <div data-testid="aik-layout">
        <AikBreadcrumb systemId={systemId} phaseId={phaseId} />
        <Outlet />
        {systemId && <AikConversationPanel systemId={systemId} />}
      </div>
    </ReactRouterNavigationProvider>
  );
}

export default AikLayout;
