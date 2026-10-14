// Pictures of rendered Markdown for Bluesky, after kakeratta's html-image:
// render offscreen, serialize into an SVG foreignObject with the page's CSS
// inlined, draw it on a canvas and cut it into JPEG pages.
import { Component, MarkdownRenderer, requestUrl, type App } from "obsidian";
import type { BlueskyImage } from "./bluesky";

const WIDTH = 720;
const PAGE_HEIGHT = 1440;
const MAX_PAGES = 12;
const SCALE = 2;
const MAX_BASE64 = 1_333_332; // 1 MB, Bluesky's blob limit
const MAX_INLINE_IMAGE = 1440;
const SETTLE_MS = 400;
const SETTLE_LIMIT_MS = 5000;

/** Resolve once the rendered DOM stops changing (Mermaid and embeds render asynchronously). */
function settle(el: HTMLElement): Promise<void> {
  return new Promise(resolve => {
    let timer = window.setTimeout(done, SETTLE_MS);
    const limit = window.setTimeout(done, SETTLE_LIMIT_MS);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, SETTLE_MS);
    });
    observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    function done() {
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(limit);
      resolve();
    }
  });
}

/** Image bytes as a downscaled data URL; SVG images cannot load anything themselves. */
async function imageDataUrl(src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  try {
    const source = /^https?:/i.test(src)
      ? new Blob([(await requestUrl({ url: src })).arrayBuffer])
      : await loadImage(src);
    const bitmap = await createImageBitmap(source);
    try {
      const scale = Math.min(1, MAX_INLINE_IMAGE / bitmap.width);
      const canvas = createEl("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    } finally { bitmap.close(); }
  } catch { return null; }
}

/** Make the clone self-contained: inline images and canvases, drop what cannot be drawn. */
async function inlineResources(live: HTMLElement, clone: HTMLElement): Promise<void> {
  const liveCanvases = Array.from(live.querySelectorAll("canvas"));
  Array.from(clone.querySelectorAll("canvas")).forEach((canvas, index) => {
    const img = createEl("img");
    try { img.src = liveCanvases[index].toDataURL("image/png"); } catch { canvas.remove(); return; }
    img.width = liveCanvases[index].clientWidth;
    canvas.replaceWith(img);
  });
  clone.querySelectorAll("script, iframe, video, audio, object, embed, link").forEach(node => node.remove());
  await Promise.all(Array.from(clone.querySelectorAll("img")).map(async img => {
    const data = img.getAttribute("src") ? await imageDataUrl(img.src) : null;
    if (data) {
      img.setAttribute("src", data);
      img.removeAttribute("srcset");
    } else {
      img.replaceWith(document.createTextNode(img.alt));
    }
  }));
}

/** The app's CSS rules, as far as they can be read. */
function pageCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText);
    } catch { /* another origin's sheet */ }
  }
  return out.join("\n").replace(/]]>/g, "]] >");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not draw the post as an image"));
    image.src = src;
  });
}

function pageJpeg(canvas: HTMLCanvasElement): string {
  for (const quality of [0.9, 0.75, 0.55, 0.35]) {
    const data = canvas.toDataURL("image/jpeg", quality).split(",")[1];
    if (data.length <= MAX_BASE64) return data;
  }
  throw new Error("This image is too large for Bluesky");
}

/** Render Timeline Markdown as it appears in Obsidian (light theme) and cut it into Bluesky-sized JPEG pages. */
export async function renderBlueskySnapshot(app: App, markdown: string, sourcePath: string): Promise<BlueskyImage[]> {
  const host = document.body.createDiv();
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;pointer-events:none;`;
  const content = host.createDiv({ cls: "dashboard-hub-bluesky-snapshot markdown-rendered markdown-preview-view" });
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, markdown, content, sourcePath, component);
    await settle(content);
    const height = Math.ceil(content.scrollHeight);
    if (height > PAGE_HEIGHT * MAX_PAGES) throw new Error("This post is too long to publish as images");
    const clone = content.cloneNode(true) as HTMLElement;
    await inlineResources(content, clone);
    const bodyClass = document.body.className.replace(/\btheme-dark\b/, "theme-light");
    const xml = new XMLSerializer().serializeToString(clone);
    const page = `<html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[${pageCss()}]]></style></head>`
      + `<body class="${bodyClass.replace(/"/g, "")}" style="margin:0;width:${WIDTH}px;background:var(--background-primary);color:var(--text-normal);">${xml}</body></html>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><foreignObject width="100%" height="100%">${page}</foreignObject></svg>`;
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const pages = Math.max(1, Math.ceil(height / PAGE_HEIGHT));
    const alt = content.innerText.replace(/\s+/g, " ").trim().slice(0, 1000);
    const images: BlueskyImage[] = [];
    for (let index = 0; index < pages; index++) {
      const top = index * PAGE_HEIGHT;
      const pageHeight = Math.max(1, Math.min(PAGE_HEIGHT, height - top));
      const canvas = createEl("canvas");
      canvas.width = WIDTH * SCALE;
      canvas.height = pageHeight * SCALE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not draw the post as an image");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, top, WIDTH, pageHeight, 0, 0, canvas.width, canvas.height);
      images.push({ data: pageJpeg(canvas), mime: "image/jpeg", alt: pages > 1 ? `(${index + 1}/${pages}) ${alt}` : alt });
    }
    return images;
  } finally {
    component.unload();
    host.remove();
  }
}
