export type KanbanColumnId = "todo" | "in_progress" | "done";

export interface KanbanTask {
  id: string;
  parentId: string | null; // null = nível 1
  level: 1 | 2 | 3;
  title: string;
  description?: string;
  columnId: KanbanColumnId;
  order: number; // posição dentro da coluna, entre irmãos de mesmo parentId
  createdAt: string; // ISO
}
