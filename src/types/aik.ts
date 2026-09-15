import type { KanbanChecklistItem } from "#/types/kanban";

export type AikColumnId = "backlog" | "in_progress" | "in_review" | "done";
// Sistema usa um conjunto de colunas PRÓPRIO (Q1 do PRD):
export type AikSystemColumnId = "ativo" | "pausado" | "arquivado";

export interface AikWorkspaceRefLocal {
  kind: "local";
  workspaceId: string;
  path: string;
}
export interface AikWorkspaceRefCloud {
  kind: "cloud";
  repository: { provider: string; fullName: string };
}
export type AikWorkspaceRef = AikWorkspaceRefLocal | AikWorkspaceRefCloud;

export interface AikSystem {
  id: string;
  name: string;
  backendId: string; // Backend.id (backend-registry/types.ts)
  workspaceRef: AikWorkspaceRef;
  columnId: AikSystemColumnId; // sob controle humano, nunca derivada (RF‑09 não se aplica aqui)
  mainConversationId?: string;
  activeAgentTaskId: string | null; // limite N1
  createdAt: string;
  updatedAt: string;
}

export interface AikPhase {
  id: string;
  systemId: string;
  title: string;
  description?: string;
  columnId: AikColumnId; // DERIVADA (RF-09) — nunca gravada por drag
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AikTimelineEntry {
  id: string;
  at: string; // ISO
  kind:
    | "comment"
    | "status_change"
    | "run_started"
    | "run_stopped"
    | "review_feedback";
  text?: string;
  fromColumnId?: AikColumnId;
  toColumnId?: AikColumnId;
}

export interface AikTask {
  id: string;
  phaseId: string;
  systemId: string; // desnormalizado — evita subir a árvore pra achar o sistema (RNF-02/03)
  title: string;
  description?: string;
  executorType: "human" | "agent";
  agentBriefing?: string;
  agentSkill?: string; // RF-18: skill é campo do card, padrão vazio = execução livre
  priority: "p0" | "p1" | "p2" | "p3";
  columnId: AikColumnId;
  order: number;
  blockedByTaskId?: string;
  checklist?: KanbanChecklistItem[]; // reaproveitado de src/types/kanban.ts:22, sem alteração
  linkedConversationId?: string;
  lastRunFilesChanged?: string[]; // RF-17
  timeline: AikTimelineEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AikSystemFile {
  version: 1;
  systemId: string;
  phases: AikPhase[];
  tasks: AikTask[];
  updatedAt: string;
}

export type AikErrorType =
  | "backend_down"
  | "workspace_unreachable"
  | "cloud_unsupported"
  | "conflict"
  | "parse_error";
