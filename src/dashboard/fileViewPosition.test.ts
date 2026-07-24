import { describe, expect, it } from "vitest";
import { parseFileViewPosition, restoredScrollTop } from "./fileViewPosition";

describe("file view position", () => {
  it("restores by ratio and rejects a different file", () => {
    const raw = JSON.stringify({
      key: "Books/manual.pdf:pdf",
      top: 420,
      ratio: 0.25,
      pdfPage: { page: 12, offset: 0.4 },
      contentAnchor: { path: [1, 3], textOffset: 12 },
    });
    const position = parseFileViewPosition(raw, "Books/manual.pdf:pdf");
    expect(position?.pdfPage).toEqual({ page: 12, offset: 0.4 });
    expect(position?.contentAnchor).toEqual({ path: [1, 3], textOffset: 12 });
    expect(restoredScrollTop(position!, 2000)).toBe(500);
    expect(parseFileViewPosition(raw, "Books/other.pdf:pdf")).toBeNull();
  });
});
