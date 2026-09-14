export type KanbanColumnId = "todo" | "in_progress" | "done";

export interface KanbanTaskAttachment {
  id: string;
  fileName: string; // já sanitizado com getSafeUploadFileName
  sizeBytes: number;
  contentBase64: string; // conteúdo bruto do arquivo, guardado até a sinterização
}

export interface KanbanTask {
  id: string;
  parentId: string | null; // null = nível 1
  level: 1 | 2 | 3;
  title: string;
  description?: string;
  columnId: KanbanColumnId;
  order: number; // posição dentro da coluna, entre irmãos de mesmo parentId
  createdAt: string; // ISO
  userContextHtml?: string;
  agentContextHtml?: string;
  attachments?: KanbanTaskAttachment[];
  lastSinteredAt?: string; // ISO — presença = indicador visual de sinterização
}
