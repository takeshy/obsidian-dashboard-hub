import { describe, expect, it } from "vitest";
import { buildAddedLayout, buildEqualizedLayout } from "./equalizeLayout";
import type { Widget } from "./types";

function makeWidgets(count: number): Widget[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i + 1}`,
    type: "file",
    layout: { lg: { x: 0, y: i, w: 6, h: 3 }, sm: { x: 0, y: i, w: 12, h: 3 } },
    config: {},
  }));
}

function lg(widgets: Widget[], id: string) {
  const pos = widgets.find((w) => w.id === id)?.layout.lg;
  if (!pos) throw new Error(`no lg layout for ${id}`);
  return pos;
}

describe("buildEqualizedLayout", () => {
  it("returns empty input as-is", () => {
    expect(buildEqualizedLayout([], "horizontal", 12, 12)).toEqual([]);
  });

  it("splits 3 widgets into 3 full-height columns", () => {
    const result = buildEqualizedLayout(makeWidgets(3), "horizontal", 12, 12);
    expect(lg(result, "w1")).toEqual({ x: 0, y: 0, w: 4, h: 12 });
    expect(lg(result, "w2")).toEqual({ x: 4, y: 0, w: 4, h: 12 });
    expect(lg(result, "w3")).toEqual({ x: 8, y: 0, w: 4, h: 12 });
  });

  it("stacks the 4th widget under the 1st in horizontal mode", () => {
    const result = buildEqualizedLayout(makeWidgets(4), "horizontal", 12, 12);
    expect(lg(result, "w1")).toEqual({ x: 0, y: 0, w: 4, h: 6 });
    expect(lg(result, "w4")).toEqual({ x: 0, y: 6, w: 4, h: 6 });
    expect(lg(result, "w2")).toEqual({ x: 4, y: 0, w: 4, h: 12 });
    expect(lg(result, "w3")).toEqual({ x: 8, y: 0, w: 4, h: 12 });
  });

  it("splits 3 widgets into 3 full-width rows in vertical mode", () => {
    const result = buildEqualizedLayout(makeWidgets(3), "vertical", 12, 12);
    expect(lg(result, "w1")).toEqual({ x: 0, y: 0, w: 12, h: 4 });
    expect(lg(result, "w2")).toEqual({ x: 0, y: 4, w: 12, h: 4 });
    expect(lg(result, "w3")).toEqual({ x: 0, y: 8, w: 12, h: 4 });
  });

  it("divides widths within rows in vertical mode", () => {
    const result = buildEqualizedLayout(makeWidgets(5), "vertical", 12, 12);
    expect(lg(result, "w1")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(lg(result, "w4")).toEqual({ x: 6, y: 0, w: 6, h: 4 });
    expect(lg(result, "w2")).toEqual({ x: 0, y: 4, w: 6, h: 4 });
    expect(lg(result, "w5")).toEqual({ x: 6, y: 4, w: 6, h: 4 });
    expect(lg(result, "w3")).toEqual({ x: 0, y: 8, w: 12, h: 4 });
  });

  it("never drops tile height below 2 rows", () => {
    const result = buildEqualizedLayout(makeWidgets(9), "horizontal", 12, 3);
    expect(lg(result, "w1").h).toBe(2);
    expect(lg(result, "w4")).toEqual({ x: 0, y: 2, w: 4, h: 2 });
  });

  it("drops sm layout so it can be re-derived", () => {
    const result = buildEqualizedLayout(makeWidgets(2), "horizontal", 12, 12);
    for (const widget of result) {
      expect(widget.layout.sm).toBeUndefined();
      expect(widget.layout.lg).toBeDefined();
    }
  });
});

describe("buildAddedLayout", () => {
  const next = (w = 4, h = 3): Widget => ({
    id: "new",
    type: "file",
    layout: { lg: { x: 0, y: 0, w, h } },
    config: {},
  });

  it("never changes existing widgets' positions or sizes", () => {
    const widgets = makeWidgets(3).map((w, i) => ({
      ...w,
      layout: { lg: { x: (i * 4) % 12, y: i, w: 3 + i, h: 2 + i } },
    }));
    for (const direction of ["horizontal", "vertical"] as const) {
      const result = buildAddedLayout(widgets, next(), direction, 12);
      for (const original of widgets) {
        expect(lg(result, original.id)).toEqual(original.layout.lg);
      }
    }
  });

  it("keeps the new widget's default size", () => {
    const result = buildAddedLayout(makeWidgets(1), next(5, 7), "horizontal", 12);
    expect(lg(result, "new").w).toBe(5);
    expect(lg(result, "new").h).toBe(7);
  });

  it("clamps the new widget width to the grid", () => {
    const result = buildAddedLayout([], next(20, 3), "horizontal", 12);
    expect(lg(result, "new")).toEqual({ x: 0, y: 0, w: 12, h: 3 });
  });

  it("fills the free space to the right when horizontal is active", () => {
    const widgets = [{ ...makeWidgets(1)[0], layout: { lg: { x: 0, y: 0, w: 6, h: 3 } } }];
    const result = buildAddedLayout(widgets, next(6, 3), "horizontal", 12);
    expect(lg(result, "w1")).toEqual({ x: 0, y: 0, w: 6, h: 3 });
    expect(lg(result, "new")).toEqual({ x: 6, y: 0, w: 6, h: 3 });
  });

  it("starts a new row when the current row is full in horizontal mode", () => {
    const widgets = [
      { ...makeWidgets(1)[0], layout: { lg: { x: 0, y: 0, w: 6, h: 3 } } },
      { ...makeWidgets(2)[1], layout: { lg: { x: 6, y: 0, w: 6, h: 5 } } },
    ];
    const result = buildAddedLayout(widgets, next(6, 3), "horizontal", 12);
    expect(lg(result, "new")).toEqual({ x: 0, y: 3, w: 6, h: 3 });
  });

  it("stacks below the first column when vertical is active", () => {
    const widgets = [
      { ...makeWidgets(1)[0], layout: { lg: { x: 0, y: 0, w: 6, h: 3 } } },
      { ...makeWidgets(2)[1], layout: { lg: { x: 6, y: 0, w: 6, h: 5 } } },
    ];
    const result = buildAddedLayout(widgets, next(6, 3), "vertical", 12);
    expect(lg(result, "w1")).toEqual({ x: 0, y: 0, w: 6, h: 3 });
    expect(lg(result, "w2")).toEqual({ x: 6, y: 0, w: 6, h: 5 });
    // Column 0 has 2 free rows below w1 (bottom edge is 5), not enough for h=3,
    // so the widget goes to the bottom.
    expect(lg(result, "new")).toEqual({ x: 0, y: 5, w: 6, h: 3 });
  });

  it("fills a gap inside an existing column in vertical mode", () => {
    const widgets = [
      { ...makeWidgets(1)[0], layout: { lg: { x: 0, y: 0, w: 6, h: 2 } } },
      { ...makeWidgets(2)[1], layout: { lg: { x: 6, y: 0, w: 6, h: 6 } } },
    ];
    const result = buildAddedLayout(widgets, next(6, 3), "vertical", 12);
    expect(lg(result, "new")).toEqual({ x: 0, y: 2, w: 6, h: 3 });
  });

  it("places the first widget at the origin", () => {
    expect(lg(buildAddedLayout([], next(), "vertical", 12), "new")).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  });
});
