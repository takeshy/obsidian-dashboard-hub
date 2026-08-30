import { describe, expect, it } from "vitest";
import { parseKanbanAiTasks } from "./kanbanAi";

describe("kanban AI response", () => {
  it("accepts fenced JSON and normalizes tasks", () => {
    expect(parseKanbanAiTasks('```json\n[{"title":" Send report ","description":"","due":"2026-09-01","checklist":[{"text":"Review"}]}]\n```'))
      .toEqual([{ title: "Send report", description: "", due: "2026-09-01", checklist: [{ text: "Review", completed: false }] }]);
  });
  it("rejects an empty proposal", () => expect(() => parseKanbanAiTasks("[]")).toThrow());
  it("drops impossible dates", () => {
    expect(parseKanbanAiTasks('[{"title":"Task","due":"2026-99-01"}]')[0].due).toBe("");
  });
});
