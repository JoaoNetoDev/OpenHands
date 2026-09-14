export type KanbanColumnId =
  | "todo"
  | "in_progress"
  | "done"
  | "featdevelop_todo"
  | "featdevelop_prd"
  | "featdevelop_tech"
  | "featdevelop_spec"
  | "featdevelop_sprints"
  | "featdevelop_done";

export interface KanbanTaskAttachment {
  id: string;
  fileName: string; // já sanitizado com getSafeUploadFileName
  sizeBytes: number;
  contentBase64: string; // conteúdo bruto do arquivo, guardado até a sinterização
}

/** Item de checklist reutilizável em qualquer nível — quadro ou tarefa
 * (SPEC §2.5). */
export interface KanbanChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/**
 * A board groups tasks within a workspace (SPEC §2.4). Multiple boards can
 * exist per `workspaceId`; tasks are partitioned by `boardId`, not
 * `workspaceId`, directly.
 */
export interface KanbanBoard {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string; // ISO
  checklist?: KanbanChecklistItem[];
}

export interface KanbanTask {
  id: string;
  boardId: string; // substitui a antiga partição por workspaceId
  parentId: string | null; // null = nível 1
  level: 1 | 2 | 3;
  title: string;
  description?: string;
  columnId: KanbanColumnId;
  order: number; // posição dentro da coluna, entre irmãos de mesmo parentId
  createdAt: string; // ISO
  updatedAt: string; // ISO
  userContextHtml?: string;
  agentContextHtml?: string;
  attachments?: KanbanTaskAttachment[];
  lastSinteredAt?: string; // ISO — presença = indicador visual de sinterização
  featureSlug?: string; // presença = card usa o preset "featdevelop"
  linkedConversationId?: string;
  checklist?: KanbanChecklistItem[];
}
