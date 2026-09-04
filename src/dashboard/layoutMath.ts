import type { Breakpoint, DashboardData, LayoutPos } from "./types";
import { deriveSmLayout } from "./dashboardFile";

export interface PlacedItem {
  id: string;
  pos: LayoutPos;
}

/** Check if two layout rectangles overlap. */
export function overlaps(a: LayoutPos, b: LayoutPos): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Stable top-to-bottom, left-to-right order used by every layout pass. */
function byPosition(a: PlacedItem, b: PlacedItem): number {
  return a.pos.y - b.pos.y || a.pos.x - b.pos.x;
}

/**
 * Cascading collision resolution: `anchor` stays where it is; every other item
 * is processed top-to-bottom and pushed straight down until it clears all
 * already-placed items. Pushing one item can create a new overlap with another,
 * so each is re-checked in a loop — unlike a single pass, this resolves chains.
 */
export function resolveCollisions(anchor: PlacedItem, others: PlacedItem[]): PlacedItem[] {
  const placed: LayoutPos[] = [anchor.pos];
  const result: PlacedItem[] = [anchor];

  for (const other of [...others].sort(byPosition)) {
    let p = other.pos;
    // y strictly increases each iteration (an overlap means some placed
    // rect's bottom is below p.y), so this terminates; guard is belt-and-braces.
    for (let guard = 0; guard < 1000; guard++) {
      const hits = placed.filter((r) => overlaps(p, r));
      if (hits.length === 0) break;
      const maxBottom = Math.max(...hits.map((r) => r.y + r.h));
      if (maxBottom <= p.y) break;
      p = { ...p, y: maxBottom };
    }
    placed.push(p);
    result.push({ id: other.id, pos: p });
  }
  return result;
}

/**
 * Vertical compaction: pull every item up as far as it can go without
 * overlapping an item above it, so no empty rows are left between widgets.
 * Items are processed top-to-bottom, so each one rests on already-compacted
 * items. Widths and x positions never change.
 */
export function compactPositions(items: PlacedItem[]): PlacedItem[] {
  const placed: LayoutPos[] = [];
  const result: PlacedItem[] = [];

  for (const item of [...items].sort(byPosition)) {
    let p = item.pos;
    // Float up while the row above is free.
    while (p.y > 0 && !placed.some((r) => overlaps({ ...p, y: p.y - 1 }, r))) {
      p = { ...p, y: p.y - 1 };
    }
    // Then settle below anything still overlapping (defensive; input may overlap).
    for (let guard = 0; guard < 1000; guard++) {
      const hits = placed.filter((r) => overlaps(p, r));
      if (hits.length === 0) break;
      p = { ...p, y: Math.max(...hits.map((r) => r.y + r.h)) };
    }
    placed.push(p);
    result.push({ id: item.id, pos: p });
  }
  return result;
}

/**
 * Apply compaction to a dashboard's layout at `bp`, writing back only the
 * widgets whose position actually changed. For `sm`, positions are first
 * derived the same way the canvas renders them so the result matches screen.
 */
export function compactDashboard(data: DashboardData, bp: Breakpoint): DashboardData {
  const source = bp === "sm" ? deriveSmLayout(data) : data;
  const items: PlacedItem[] = source.widgets.map((w) => ({
    id: w.id,
    pos: w.layout[bp] ?? w.layout.lg ?? { x: 0, y: 0, w: data.grid.cols, h: 3 },
  }));
  const before = new Map(items.map((i) => [i.id, i.pos]));
  const moves = new Map<string, LayoutPos>();
  for (const item of compactPositions(items)) {
    const prev = before.get(item.id);
    if (prev && prev.y !== item.pos.y) moves.set(item.id, item.pos);
  }
  if (moves.size === 0) return data;
  return {
    ...data,
    widgets: data.widgets.map((w) =>
      moves.has(w.id) ? { ...w, layout: { ...w.layout, [bp]: moves.get(w.id)! } } : w,
    ),
  };
}

/**
 * Convert a pointer delta into grid steps. The dominant axis snaps to the
 * nearest cell as usual; the other axis is treated as incidental drift and
 * ignored until the pointer has travelled a full cell, so dragging a corner
 * straight down no longer changes the width by a column (and vice versa).
 */
export function snapGridDelta(
  dxPx: number,
  dyPx: number,
  cellW: number,
  cellH: number,
): { gx: number; gy: number } {
  const snap = (px: number, cell: number, primary: boolean): number => {
    if (cell <= 0) return 0;
    if (!primary && Math.abs(px) < cell) return 0;
    return Math.round(px / cell);
  };
  // Compare travel in cell units so a wide, short grid does not bias the choice.
  const xCells = cellW > 0 ? Math.abs(dxPx) / cellW : 0;
  const yCells = cellH > 0 ? Math.abs(dyPx) / cellH : 0;
  const xPrimary = xCells > yCells;
  return {
    gx: snap(dxPx, cellW, xPrimary),
    gy: snap(dyPx, cellH, !xPrimary),
  };
}
