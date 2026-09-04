import type { LayoutPos, Widget } from "./types";
import { overlaps } from "./layoutMath";

export type EqualizeDirection = "horizontal" | "vertical";

const MIN_TILE_ROWS = 2;

export function buildEqualizedLayout(
  widgets: Widget[],
  direction: EqualizeDirection,
  cols: number,
  targetRows: number,
): Widget[] {
  const count = widgets.length;
  if (count === 0) return widgets;

  const primarySlots = Math.min(3, count);
  const groups = Array.from({ length: primarySlots }, () => [] as Widget[]);
  widgets.forEach((widget, index) => {
    groups[index % primarySlots].push(widget);
  });
  const maxGroupSize = Math.max(...groups.map((group) => group.length));

  const layouts = new Map<string, LayoutPos>();
  groups.forEach((group, primaryIndex) => {
    if (direction === "vertical") {
      const rowH = Math.max(MIN_TILE_ROWS, Math.floor(targetRows / primarySlots));
      const slotWidth = Math.max(1, Math.floor(cols / group.length));
      group.forEach((widget, groupIndex) => {
        const x = groupIndex * slotWidth;
        const w = groupIndex === group.length - 1 ? cols - x : slotWidth;
        layouts.set(widget.id, { x, y: primaryIndex * rowH, w, h: rowH });
      });
      return;
    }

    const tileH = Math.max(MIN_TILE_ROWS, Math.floor(targetRows / maxGroupSize));
    const slotWidth = Math.max(1, Math.floor(cols / primarySlots));
    const x = primaryIndex * slotWidth;
    const w = primaryIndex === primarySlots - 1 ? cols - x : slotWidth;
    group.forEach((widget, groupIndex) => {
      layouts.set(widget.id, {
        x,
        y: groupIndex * tileH,
        w,
        h: group.length === 1 ? maxGroupSize * tileH : tileH,
      });
    });
  });

  return widgets.map((widget) => {
    const pos = layouts.get(widget.id);
    return pos ? { ...widget, layout: { lg: pos } } : widget;
  });
}

/**
 * Add a widget using the packing direction selected in the toolbar without
 * touching any existing widget. The new tile keeps its default size (clamped
 * to the grid width) and is dropped into the first free slot:
 * - horizontal: fill rows left-to-right, top-to-bottom;
 * - vertical: fill existing columns top-to-bottom before starting a new row.
 * Existing positions and sizes are preserved exactly; only the new widget's
 * `lg` position is chosen here.
 */
export function buildAddedLayout(
  widgets: Widget[],
  nextWidget: Widget,
  direction: EqualizeDirection,
  cols: number,
): Widget[] {
  const size = nextWidget.layout.lg ?? { x: 0, y: 0, w: 4, h: 3 };
  const w = Math.max(1, Math.min(size.w, cols));
  const h = Math.max(1, size.h);
  const occupied = widgets
    .map((widget) => widget.layout.lg)
    .filter((pos): pos is LayoutPos => pos !== undefined);
  const maxY = occupied.reduce((max, pos) => Math.max(max, pos.y + pos.h), 0);
  const fits = (x: number, y: number): boolean =>
    !occupied.some((pos) => overlaps({ x, y, w, h }, pos));

  let placed: LayoutPos | undefined;
  if (direction === "vertical") {
    // Column-major scan bounded by the current bottom edge so we fill gaps in
    // existing columns first; anything that does not fit goes below.
    outer: for (let x = 0; x + w <= cols; x++) {
      for (let y = 0; y + h <= maxY; y++) {
        if (fits(x, y)) {
          placed = { x, y, w, h };
          break outer;
        }
      }
    }
  } else {
    // Row-major scan: y is unbounded, so a slot is always found eventually.
    outer: for (let y = 0; y <= maxY; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (fits(x, y)) {
          placed = { x, y, w, h };
          break outer;
        }
      }
    }
  }

  const pos = placed ?? { x: 0, y: maxY, w, h };
  return [...widgets, { ...nextWidget, layout: { lg: pos } }];
}
