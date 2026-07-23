import type { LayoutPos, Widget } from "./types";

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
 * Add a widget using the packing direction selected in the toolbar. This
 * mirrors Gemihub's behavior: horizontal fills rows, vertical fills columns,
 * and the current set is fitted into the viewport as the new tile is added.
 */
export function buildAddedLayout(
  widgets: Widget[],
  nextWidget: Widget,
  direction: EqualizeDirection,
  cols: number,
  targetRows = 6,
): Widget[] {
  const all = [...widgets, nextWidget];
  // Gemihub's compact layout is a 3 × 3 surface. For larger dashboards use
  // the general equalizer so no widget is left overlapping an old position.
  if (all.length > 9) return buildEqualizedLayout(all, direction, cols, targetRows);

  const layouts = new Map<string, LayoutPos>();
  if (direction === "vertical") {
    const columns = [...new Set(widgets.map((widget) => widget.layout.lg?.x ?? 0))]
      .sort((a, b) => a - b)
      .map((x) => widgets
        .filter((widget) => (widget.layout.lg?.x ?? 0) === x)
        .sort((a, b) => (a.layout.lg?.y ?? 0) - (b.layout.lg?.y ?? 0)));
    if (columns.length === 0) columns.push([]);
    let target = columns
      .map((column, index) => ({ index, size: column.length }))
      .filter(({ size }) => size < 3)
      .sort((a, b) => a.size - b.size || a.index - b.index)[0]?.index;
    if (target === undefined && columns.length < 3) {
      columns.push([]);
      target = columns.length - 1;
    }
    columns[target ?? 0].push(nextWidget);

    const columnCount = Math.min(3, columns.length);
    const slotWidth = Math.max(1, Math.floor(cols / columnCount));
    columns.slice(0, columnCount).forEach((column, columnIndex) => {
      const itemCount = Math.max(1, Math.min(3, column.length));
      const slotHeight = Math.max(1, Math.floor(targetRows / itemCount));
      const x = columnIndex * slotWidth;
      const w = columnIndex === columnCount - 1 ? cols - x : slotWidth;
      column.slice(0, 3).forEach((widget, rowIndex) => {
        const y = rowIndex * slotHeight;
        const h = rowIndex === itemCount - 1 ? targetRows - y : slotHeight;
        layouts.set(widget.id, { x, y, w, h });
      });
    });
  } else {
    const rows = [...new Set(widgets.map((widget) => widget.layout.lg?.y ?? 0))]
      .sort((a, b) => a - b)
      .map((y) => widgets
        .filter((widget) => (widget.layout.lg?.y ?? 0) === y)
        .sort((a, b) => (a.layout.lg?.x ?? 0) - (b.layout.lg?.x ?? 0)));
    if (rows.length === 0) rows.push([]);
    let target = rows
      .map((row, index) => ({ index, size: row.length }))
      .filter(({ size }) => size < 3)
      .sort((a, b) => a.size - b.size || a.index - b.index)[0]?.index;
    if (target === undefined && rows.length < 3) {
      rows.push([]);
      target = rows.length - 1;
    }
    rows[target ?? 0].push(nextWidget);

    const rowCount = Math.min(3, rows.length);
    const rowHeight = Math.max(1, Math.floor(targetRows / rowCount));
    rows.slice(0, rowCount).forEach((row, rowIndex) => {
      const itemCount = Math.max(1, Math.min(3, row.length));
      const slotWidth = Math.max(1, Math.floor(cols / itemCount));
      const y = rowIndex * rowHeight;
      const h = rowIndex === rowCount - 1 ? targetRows - y : rowHeight;
      row.slice(0, 3).forEach((widget, columnIndex) => {
        const x = columnIndex * slotWidth;
        const w = columnIndex === itemCount - 1 ? cols - x : slotWidth;
        layouts.set(widget.id, { x, y, w, h });
      });
    });
  }

  return all.map((widget) => {
    const pos = layouts.get(widget.id);
    return pos ? { ...widget, layout: { lg: pos } } : widget;
  });
}
