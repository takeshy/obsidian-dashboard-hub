import { expect, it } from "vitest";
import { buildSplitDiffRows } from "./splitDiff";

it("pairs replacements and preserves unchanged lines", () => {
  expect(buildSplitDiffRows("a\nb\nc", "a\nB\nc")).toEqual([
    { before: "a", after: "a", changed: false },
    { before: "b", after: "B", changed: true },
    { before: "c", after: "c", changed: false },
  ]);
});
