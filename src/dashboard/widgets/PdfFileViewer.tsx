import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { loadPdfJs, TFile } from "obsidian";
import type { WidgetContext } from "../types";

export interface PdfQuoteAnchor {
  anchor: string;
  quotePrefix?: string;
  quoteSuffix?: string;
}

export interface PdfSelectionRoot {
  root: Node;
  win: Window;
}

export interface PdfFileViewerHandle {
  renderAllPages: () => void;
  getScrollContainer: () => HTMLElement | null;
  getSelectionRoots: () => PdfSelectionRoot[];
}

interface PdfPageSlot {
  page: any | null;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  scale: number;
  rendering: boolean;
  textTask?: { cancel?: () => void };
}

function selectionFrom(root: Node, win: Window): { text: string; anchor?: PdfQuoteAnchor } {
  const selection = win.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (!text || !selection?.rangeCount) return { text: "" };
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return { text: "" };

  const element = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  const pageEl = element?.closest<HTMLElement>("[data-pdf-page]");
  const page = Number(pageEl?.dataset.pdfPage) || 0;
  const contextRoot = pageEl ?? root;
  const doc = range.startContainer.ownerDocument;
  if (!doc) return { text: "" };
  const beforeRange = doc.createRange();
  beforeRange.setStart(contextRoot, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = doc.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(contextRoot, contextRoot.childNodes.length);
  const prefix = beforeRange.toString().replace(/\s+/g, " ").trim().slice(-30);
  const suffix = afterRange.toString().replace(/\s+/g, " ").trim().slice(0, 30);
  return {
    text,
    anchor: {
      anchor: page ? `page=${page}` : "text",
      ...(prefix ? { quotePrefix: prefix } : {}),
      ...(suffix ? { quoteSuffix: suffix } : {}),
    },
  };
}

const PdfFileViewer = forwardRef<PdfFileViewerHandle, {
  ctx: WidgetContext;
  file: TFile;
  onSelectionContextMenu: (text: string, x: number, y: number, anchor?: PdfQuoteAnchor) => void;
  onRenderTick?: () => void;
}>(function PdfFileViewer({ ctx, file, onSelectionContextMenu, onRenderTick }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(new Map<number, PdfPageSlot>());
  const generationRef = useRef(0);
  const renderPageRef = useRef<(page: number) => Promise<void>>(async () => undefined);
  const [error, setError] = useState("");

  const getScale = useCallback((page: any) => {
    const host = hostRef.current;
    const width = page.getViewport({ scale: 1 }).width || 1;
    return Math.max(0.2, ((host?.clientWidth ?? width) - 24) / width);
  }, []);

  const renderTextLayer = useCallback(async (pdfjs: any, slot: PdfPageSlot, viewport: any) => {
    slot.textTask?.cancel?.();
    slot.textLayer.replaceChildren();
    slot.textLayer.style.setProperty("--scale-factor", String(viewport.scale));
    slot.textLayer.style.setProperty("--total-scale-factor", String(viewport.scale));

    if (pdfjs.TextLayer) {
      const task = new pdfjs.TextLayer({
        textContentSource: slot.page.streamTextContent({ includeMarkedContent: true }),
        container: slot.textLayer,
        viewport,
      });
      slot.textTask = task;
      await task.render();
      return;
    }

    const task = pdfjs.renderTextLayer({
      textContentSource: await slot.page.getTextContent({ includeMarkedContent: true }),
      container: slot.textLayer,
      viewport,
    });
    slot.textTask = task;
    await (task.promise ?? task);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const generation = ++generationRef.current;
    let observer: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let loadingTask: { destroy?: () => Promise<void> } | null = null;
    let resizeTimer = 0;
    setError("");
    host.replaceChildren();
    pagesRef.current.clear();

    void (async () => {
      try {
        const [pdfjs, buffer] = await Promise.all([
          loadPdfJs(),
          ctx.app.vault.readBinary(file),
        ]);
        if (generation !== generationRef.current) return;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        const pdf = await (loadingTask as any).promise;
        if (generation !== generationRef.current) return;

        const firstPage = await pdf.getPage(1);
        if (generation !== generationRef.current) return;
        const scale = getScale(firstPage);
        const viewport = firstPage.getViewport({ scale });
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const wrapper = document.createElement("div");
          wrapper.className = "llm-hub-db-pdf-page";
          wrapper.dataset.pdfPage = String(pageNumber);
          wrapper.style.width = `${Math.floor(viewport.width)}px`;
          wrapper.style.height = `${Math.floor(viewport.height)}px`;
          const canvas = document.createElement("canvas");
          const textLayer = document.createElement("div");
          textLayer.className = "llm-hub-db-pdf-text-layer";
          wrapper.append(canvas, textLayer);
          host.appendChild(wrapper);
          pagesRef.current.set(pageNumber, {
            page: pageNumber === 1 ? firstPage : null,
            wrapper,
            canvas,
            textLayer,
            scale: 0,
            rendering: false,
          });
        }

        const renderPage = async (pageNumber: number) => {
          const slot = pagesRef.current.get(pageNumber);
          if (!slot || slot.rendering || generation !== generationRef.current) return;
          slot.rendering = true;
          try {
            const page = slot.page ?? await pdf.getPage(pageNumber);
            if (generation !== generationRef.current) return;
            slot.page = page;
            const scale = getScale(page);
            if (Math.abs(slot.scale - scale) < 0.001 && slot.textLayer.childElementCount) return;
            const viewport = page.getViewport({ scale });
            const dpr = Math.min(3, window.devicePixelRatio || 1);
            slot.wrapper.style.width = `${Math.floor(viewport.width)}px`;
            slot.wrapper.style.height = `${Math.floor(viewport.height)}px`;
            slot.canvas.width = Math.floor(viewport.width * dpr);
            slot.canvas.height = Math.floor(viewport.height * dpr);
            slot.canvas.style.width = `${Math.floor(viewport.width)}px`;
            slot.canvas.style.height = `${Math.floor(viewport.height)}px`;
            const context = slot.canvas.getContext("2d");
            if (!context) return;
            await page.render({
              canvas: slot.canvas,
              canvasContext: context,
              viewport,
              transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
            }).promise;
            if (generation !== generationRef.current) return;
            await renderTextLayer(pdfjs, slot, viewport);
            slot.scale = scale;
            onRenderTick?.();
          } catch (renderError) {
            if (generation === generationRef.current) console.warn("Could not render PDF page.", renderError);
          } finally {
            slot.rendering = false;
          }
        };
        renderPageRef.current = renderPage;

        observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const page = Number((entry.target as HTMLElement).dataset.pdfPage);
            if (page) void renderPage(page);
          }
        }, { root: host, rootMargin: "150% 0px" });
        pagesRef.current.forEach((slot) => observer?.observe(slot.wrapper));

        // Do not wait for IntersectionObserver's next frame: make the first
        // pages selectable as soon as the document structure is ready.
        await Promise.all([1, 2].filter((page) => page <= pdf.numPages).map(renderPage));

        resizeObserver = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            pagesRef.current.forEach((slot, page) => {
              const rect = slot.wrapper.getBoundingClientRect();
              const hostRect = host.getBoundingClientRect();
              if (rect.bottom >= hostRect.top - host.clientHeight && rect.top <= hostRect.bottom + host.clientHeight) {
                slot.scale = 0;
                void renderPage(page);
              }
            });
          }, 120);
        });
        resizeObserver.observe(host);
      } catch (loadError) {
        console.error("Could not load PDF.", loadError);
        if (generation === generationRef.current) setError("Could not display PDF");
      }
    })();

    return () => {
      generationRef.current += 1;
      window.clearTimeout(resizeTimer);
      observer?.disconnect();
      resizeObserver?.disconnect();
      pagesRef.current.forEach((slot) => slot.textTask?.cancel?.());
      pagesRef.current.clear();
      void loadingTask?.destroy?.();
      host.replaceChildren();
    };
  }, [ctx.app, file, getScale, onRenderTick, renderTextLayer]);

  useImperativeHandle(ref, () => ({
    renderAllPages: () => {
      pagesRef.current.forEach((_slot, page) => void renderPageRef.current(page));
    },
    getScrollContainer: () => hostRef.current,
    getSelectionRoots: () => hostRef.current
      ? [{ root: hostRef.current, win: hostRef.current.ownerDocument.defaultView ?? window }]
      : [],
  }), []);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host) return;
    const selected = selectionFrom(host, host.ownerDocument.defaultView ?? window);
    if (!selected.text) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectionContextMenu(selected.text, event.clientX, event.clientY, selected.anchor);
  };

  return (
    <div className="llm-hub-db-pdf-shell">
      <div ref={hostRef} className="llm-hub-db-pdf-pages" onContextMenu={handleContextMenu} />
      {error && <div className="llm-hub-db-pdf-error">{error}</div>}
    </div>
  );
});

PdfFileViewer.displayName = "PdfFileViewer";

export default PdfFileViewer;
