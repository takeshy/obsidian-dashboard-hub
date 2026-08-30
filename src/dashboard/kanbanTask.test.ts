import { describe, expect, it } from "vitest";
import {
  isCompletionColumn,
  parseKanbanTaskBody,
  replaceKanbanTaskBody,
  serializeKanbanTaskBody,
} from "./kanbanTask";

describe("kanban task details", () => {
  it("round trips description, checklist and attachments", () => {
    const task = {
      description: "Context",
      checklist: [{ text: "Review", completed: true }, { text: "Send", completed: false }],
      attachments: [{ path: "Tasks/Attachments/spec.pdf", label: "spec.pdf" }],
    };
    expect(parseKanbanTaskBody(serializeKanbanTaskBody(task))).toEqual(task);
  });

  it("preserves legacy note content as the description", () => {
    expect(parseKanbanTaskBody("Existing note\n")).toEqual({ description: "Existing note", checklist: [], attachments: [] });
  });
  it("replaces the body without changing frontmatter", () => {
    const content = "---\nstatus: doing\npriority: high\n---\n\nOld body\n";
    expect(replaceKanbanTaskBody(content, {
      description: "New body",
      checklist: [{ text: "Verify", completed: true }],
      attachments: [],
    })).toContain("---\nstatus: doing\npriority: high\n---\nNew body");
  });
});

describe("completion columns", () => {
  it("recognizes completion columns without treating every final column as done", () => {
    expect(isCompletionColumn("DONE", "Done", 1, 3)).toBe(true);
    expect(isCompletionColumn("archive", "Archive", 2, 3)).toBe(false);
  });
});
