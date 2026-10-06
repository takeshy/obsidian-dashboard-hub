import type { KanbanBoardDefinition } from "./kanbanFile";

/** Build a native board over the same notes; never rewrite task frontmatter. */
export function kanbanToBase(board: KanbanBoardDefinition, otherStatuses: string[] = []) {
  const status = (board.statusProperty ?? "status").trim() || "status";
  const title = (board.titleProperty ?? "").trim();
  const property = (field: string) => field.startsWith("file.") ? field : `note.${field}`;
  const filters = ['file.ext == "md"'];
  const folder = (board.folder ?? "").trim().replace(/[/\\]+$/, "");
  const tag = (board.tag ?? "").trim().replace(/^#/, "");
  if (folder) filters.push(`file.path.lower().startsWith(${JSON.stringify(`${folder.toLowerCase()}/`)})`);
  if (tag) filters.push(`file.tags.map(value.replace(/^#/, "").lower()).contains(${JSON.stringify(tag.toLowerCase())})`);
  const order = [title && title !== "file.content" ? property(title) : "file.name"];
  const properties: Record<string, { displayName: string }> = {};
  for (const item of board.displayFields ?? []) {
    const field = typeof item === "string" ? item : item.field;
    // Bases has no file.content property; the note itself remains untouched.
    if (!field || field === "file.content") continue;
    const id = property(field);
    if (!order.includes(id)) order.push(id);
    if (typeof item !== "string" && item.label?.trim()) properties[id] = { displayName: item.label.trim() };
  }
  const groups: Array<string | null> = [...new Set((board.columns ?? []).map((column) => column.value || null))];
  if (board.showUnspecified !== false) {
    for (const value of otherStatuses) if (value && !groups.includes(value)) groups.push(value);
    if (!groups.includes(null)) groups.push(null);
  }
  return {
    filters: { and: filters },
    ...(Object.keys(properties).length ? { properties } : {}),
    views: [{
      type: "kanban",
      name: board.title?.trim() || "Kanban",
      groupBy: { property: `note.${status}`, direction: "ASC" },
      groupOrder: groups,
      order,
    }],
  };
}
