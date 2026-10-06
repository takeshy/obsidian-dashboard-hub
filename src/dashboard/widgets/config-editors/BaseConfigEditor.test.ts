import { describe, expect, it, vi } from "vitest";
vi.mock("src/ui/AiGenerationModal", () => ({ AiGenerationModal: class {} }));
import { normalizeView } from "./BaseConfigEditor";

describe("Base view preservation", () => {
  it("keeps native Kanban settings when editing another field", () => {
    const view = { type: "kanban", name: "Tasks", groupBy: { property: "note.status", direction: "ASC" }, groupOrder: ["todo", null], columnWidth: 280 };
    expect(normalizeView(view, 0)).toEqual(view);
  });
  it("preserves plugin view types", () => {
    expect(normalizeView({ type: "map", name: "Map" }, 0).type).toBe("map");
  });
});
