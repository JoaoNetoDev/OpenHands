// `<Routes>` imperativo do AIK (react-router@7.18.2), montado por
// `host-gate.tsx` quando o hostname bate com um vhost do AIK (TECH §2.1,
// SPEC §2.1). Importa desde já os caminhos finais dos componentes reais —
// este arquivo não é tocado de novo por nenhum sprint posterior (ver nota
// em SPRINT-02.md sobre por que os stubs nascem aqui, correção ao achado
// F-SPRINT-1 do validador adversarial).
import type { JSX } from "react";
import { Routes, Route } from "react-router";
import { AikLayout } from "./aik-layout";
import { AikSystemsBoard } from "./aik-systems-board";
import { AikPhasesBoard } from "./aik-phases-board";
import { AikTasksBoard } from "./aik-tasks-board";

export function AikRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<AikLayout />}>
        <Route index element={<AikSystemsBoard />} />
        <Route path=":systemId" element={<AikPhasesBoard />} />
        <Route path=":systemId/fases/:phaseId" element={<AikTasksBoard />} />
      </Route>
    </Routes>
  );
}

export default AikRoutes;
