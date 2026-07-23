export interface SplitDiffRow { before?: string; after?: string; changed: boolean }

/** Line-oriented LCS diff paired for a side-by-side renderer. */
export function buildSplitDiffRows(beforeText: string, afterText: string): SplitDiffRow[] {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  if (before.length * after.length > 160_000) {
    const count = Math.max(before.length, after.length);
    return Array.from({ length: count }, (_, index) => ({ before: before[index], after: after[index], changed: before[index] !== after[index] }));
  }
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] = before[left] === after[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  const rows: SplitDiffRow[] = [];
  let left = 0; let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      rows.push({ before: before[left], after: after[right], changed: false }); left += 1; right += 1; continue;
    }
    const removed: string[] = []; const added: string[] = [];
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && before[left] === after[right]) break;
      if (right >= after.length || (left < before.length && table[left + 1][right] >= table[left][right + 1])) removed.push(before[left++]);
      else added.push(after[right++]);
    }
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) rows.push({ before: removed[index], after: added[index], changed: true });
  }
  return rows;
}
