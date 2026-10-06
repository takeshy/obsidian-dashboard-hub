import { describe, expect, it } from "vitest";
import { kanbanToBase } from "./kanbanToBase";
import { parse, stringify } from "yaml";

describe("native Kanban migration", () => {
  it("preserves editable grouping, column order, title and field aliases without changing the board", () => {
    const board = {
      title: "Work", folder: "Projects/", tag: "#task", statusProperty: "workflow status",
      titleProperty: "title", columns: [{ value: "todo", label: "To do" }, { value: "done", label: "Done" }],
      displayFields: ["due", { field: "owner", label: "Assignee" }, "file.content", "file.name"],
    };
    const before = structuredClone(board);
    const base = kanbanToBase(board, ["blocked", "todo", "blocked"]);
    expect(base.filters.and).toEqual(['file.ext == "md"', 'file.path.lower().startsWith("projects/")', 'file.tags.map(value.replace(/^#/, "").lower()).contains("task")']);
    expect(base.views[0]).toEqual({
      type: "kanban", name: "Work", groupBy: { property: "note.workflow status", direction: "ASC" },
      groupOrder: ["todo", "done", "blocked", null], order: ["note.title", "note.due", "note.owner", "file.name"],
    });
    expect(base.properties).toEqual({ "note.owner": { displayName: "Assignee" } });
    expect(board).toEqual(before);
  });

  it("hides unmatched values when requested and removes duplicate columns", () => {
    expect(kanbanToBase({ showUnspecified: false, columns: [
      { value: "todo", label: "A" }, { value: "todo", label: "B" },
    ] }, ["blocked"]).views[0].groupOrder).toEqual(["todo"]);
  });

  it("uses the default status and filename and includes missing-status notes", () => {
    const view = kanbanToBase({}).views[0];
    expect(view.groupBy.property).toBe("note.status");
    expect(view.order).toEqual(["file.name"]);
    expect(view.groupOrder).toEqual([null]);
  });

  it("escapes filter values so quotes cannot inject expressions", () => {
    const base = kanbanToBase({ folder: 'A"B', tag: 'x" || true' });
    expect(base.filters.and[1]).toBe('file.path.lower().startsWith("a\\"b/")');
    expect(base.filters.and[2]).toBe('file.tags.map(value.replace(/^#/, "").lower()).contains("x\\" || true")');
  });

  it("round trips YAML with missing groups, Unicode and literal status values", () => {
    const base = kanbanToBase({ title: "作業", columns: [
      { value: " in progress ", label: "作業中" }, { value: "", label: "未設定" },
    ] });
    expect(parse(stringify(base))).toEqual(base);
    expect(base.views[0].groupOrder).toEqual([" in progress ", null]);
  });
});
