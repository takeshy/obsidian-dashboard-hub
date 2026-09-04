import { describe, expect, it } from "vitest";
import {
  compactDashboard,
  compactPositions,
  resolveCollisions,
  snapGridDelta,
} from "./layoutMath";
import type { DashboardData, Widget } from "./types";

const item = (id: string, x: number, y: number, w: number, h: number) => ({
  id,
  pos: { x, y, w, h },
});

const posOf = (items: ReturnType<typeof item>[], id: string) =>
  items.find((i) => i.id === id)!.pos;

describe("resolveCollisions", () => {
  it("pushes overlapped widgets below the anchor, cascading", () => {
    const anchor = item("a", 0, 0, 12, 4);
    const result = resolveCollisions(anchor, [item("b", 0, 2, 12, 3), item("c", 0, 5, 12, 2)]);
    expect(posOf(result, "a")).toEqual({ x: 0, y: 0, w: 12, h: 4 });
    expect(posOf(result, "b")).toEqual({ x: 0, y: 4, w: 12, h: 3 });
    expect(posOf(result, "c")).toEqual({ x: 0, y: 7, w: 12, h: 2 });
  });

  it("leaves non-overlapping widgets untouched", () => {
    const result = resolveCollisions(item("a", 0, 0, 6, 3), [item("b", 6, 0, 6, 3)]);
    expect(posOf(result, "b")).toEqual({ x: 6, y: 0, w: 6, h: 3 });
  });
});

describe("compactPositions", () => {
  it("removes an empty band between vertically stacked widgets", () => {
    const result = compactPositions([item("a", 0, 0, 12, 2), item("b", 0, 5, 12, 3)]);
    expect(posOf(result, "b")).toEqual({ x: 0, y: 2, w: 12, h: 3 });
  });

  it("floats widgets up only past columns they actually share", () => {
    // a occupies the left half; b is on the right and should rise to the top.
    const result = compactPositions([item("a", 0, 0, 6, 4), item("b", 6, 6, 6, 2)]);
    expect(posOf(result, "b")).toEqual({ x: 6, y: 0, w: 6, h: 2 });
  });

  it("stacks a wide widget under the tallest widget it overlaps", () => {
    const result = compactPositions([
      item("a", 0, 0, 6, 4),
      item("b", 6, 0, 6, 2),
      item("c", 0, 9, 12, 2),
    ]);
    expect(posOf(result, "c")).toEqual({ x: 0, y: 4, w: 12, h: 2 });
  });

  it("never changes x or width", () => {
    const result = compactPositions([item("a", 3, 7, 4, 1)]);
    expect(posOf(result, "a")).toEqual({ x: 3, y: 0, w: 4, h: 1 });
  });

  it("settles overlapping input instead of stacking it", () => {
    const result = compactPositions([item("a", 0, 0, 12, 3), item("b", 0, 1, 12, 3)]);
    expect(posOf(result, "b")).toEqual({ x: 0, y: 3, w: 12, h: 3 });
  });
});

describe("compactDashboard", () => {
  const widget = (id: string, y: number, h: number, sm?: { y: number; h: number }): Widget => ({
    id,
    type: "file",
    layout: {
      lg: { x: 0, y, w: 12, h },
      ...(sm ? { sm: { x: 0, y: sm.y, w: 12, h: sm.h } } : {}),
    },
    config: {},
  });
  const data = (widgets: Widget[]): DashboardData => ({
    version: 1,
    grid: { cols: 12, rowHeight: 80, gap: 8 },
    widgets,
  });

  it("returns the same object when nothing moves", () => {
    const d = data([widget("a", 0, 3), widget("b", 3, 3)]);
    expect(compactDashboard(d, "lg")).toBe(d);
  });

  it("rewrites only the widgets that moved on lg", () => {
    const d = data([widget("a", 0, 3), widget("b", 6, 3)]);
    const out = compactDashboard(d, "lg");
    expect(out.widgets[0]).toBe(d.widgets[0]);
    expect(out.widgets[1].layout.lg).toEqual({ x: 0, y: 3, w: 12, h: 3 });
  });

  it("compacts explicit sm positions and leaves lg alone", () => {
    const d = data([widget("a", 0, 3, { y: 0, h: 3 }), widget("b", 3, 3, { y: 8, h: 3 })]);
    const out = compactDashboard(d, "sm");
    expect(out.widgets[1].layout.sm).toEqual({ x: 0, y: 3, w: 12, h: 3 });
    expect(out.widgets[1].layout.lg).toEqual(d.widgets[1].layout.lg);
  });
});

describe("snapGridDelta", () => {
  const cellW = 60;
  const cellH = 80;

  it("snaps the dominant axis to the nearest cell", () => {
    expect(snapGridDelta(0, 130, cellW, cellH)).toEqual({ gx: 0, gy: 2 });
    expect(snapGridDelta(-95, 0, cellW, cellH)).toEqual({ gx: -2, gy: 0 });
  });

  it("ignores drift on the other axis below one full cell", () => {
    // 40px sideways would round to a column on its own; here it is drift.
    expect(snapGridDelta(40, 170, cellW, cellH)).toEqual({ gx: 0, gy: 2 });
    expect(snapGridDelta(150, 55, cellW, cellH)).toEqual({ gx: 3, gy: 0 });
  });

  it("keeps deliberate diagonal moves", () => {
    expect(snapGridDelta(70, 170, cellW, cellH)).toEqual({ gx: 1, gy: 2 });
  });

  it("returns zero steps when cells are unmeasured", () => {
    expect(snapGridDelta(100, 100, 0, 0)).toEqual({ gx: 0, gy: 0 });
  });
});
