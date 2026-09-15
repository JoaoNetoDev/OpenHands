// Shell do AIK (SPEC §2.1/§2.6): breadcrumb + outlet + painel de conversa,
// reescrito pelo SPRINT-07 a partir do stub do SPRINT-02.
import type { JSX } from "react";
import { useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { useAikBoardStore } from "#/stores/aik-board-store";
import { AikBreadcrumb } from "#/components/features/aik/aik-breadcrumb";
import { AikConversationPanel } from "#/components/features/aik/aik-conversation-panel";

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

  return (
    <div data-testid="aik-layout">
      <AikBreadcrumb systemId={systemId} phaseId={phaseId} />
      <Outlet />
      {systemId && <AikConversationPanel systemId={systemId} />}
    </div>
  );
}

export default AikLayout;
