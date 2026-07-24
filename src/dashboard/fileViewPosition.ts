export interface FileViewPosition {
  key: string;
  top: number;
  ratio: number;
  pdfPage?: { page: number; offset: number };
  contentAnchor?: { path: number[]; textOffset: number };
}

export function parseFileViewPosition(raw: string | null, key: string): FileViewPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FileViewPosition>;
    if (
      value.key !== key ||
      typeof value.top !== "number" || !Number.isFinite(value.top) ||
      typeof value.ratio !== "number" || !Number.isFinite(value.ratio)
    ) return null;
    const pdfPage = value.pdfPage;
    const contentAnchor = value.contentAnchor;
    return {
      key,
      top: Math.max(0, value.top),
      ratio: Math.max(0, Math.min(1, value.ratio)),
      ...(pdfPage && Number.isInteger(pdfPage.page) && pdfPage.page > 0 &&
        Number.isFinite(pdfPage.offset)
        ? { pdfPage: { page: pdfPage.page, offset: Math.max(0, Math.min(1, pdfPage.offset)) } }
        : {}),
      ...(contentAnchor && Array.isArray(contentAnchor.path) &&
        contentAnchor.path.every((index) => Number.isInteger(index) && index >= 0) &&
        typeof contentAnchor.textOffset === "number" && Number.isInteger(contentAnchor.textOffset) &&
        contentAnchor.textOffset >= 0
        ? { contentAnchor: {
          path: contentAnchor.path,
          textOffset: contentAnchor.textOffset,
        } }
        : {}),
    };
  } catch {
    return null;
  }
}

export function restoredScrollTop(position: Pick<FileViewPosition, "top" | "ratio">, maxScrollTop: number): number {
  return maxScrollTop > 0 ? Math.round(position.ratio * maxScrollTop) : position.top;
}
