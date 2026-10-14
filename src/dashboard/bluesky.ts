// Bluesky posting, ported from GemiHub Desktop's Bluesky feature and adapted
// for the Obsidian plugin (app-password sessions instead of desktop OAuth).
import { base64ToArrayBuffer } from "src/core/crypto";
import type { TimelinePost } from "./timelineThreads";

/** A frozen, explicit publication selection. No new replies enter an open preview. */
export interface BlueskyEntry { id: string; content: string; createdAt: string; replyTo: string; authorName: string; speaker: string; sourcePath: string }
export interface BlueskyImage { data: string; mime: string; alt: string }
export interface BlueskyPost { images?: BlueskyImage[]; id: string; text: string; createdAt: string; parent: string }
/** A Vault image reference extracted from a Timeline post. */
export interface BlueskyImageRef { target: string; wiki: boolean; alt: string }
export type BlueskyImageLoader = (ref: BlueskyImageRef, entry: BlueskyEntry) => Promise<BlueskyImage>;
/** Entries published as pictures of their rendered Markdown. `render` returns the pages, or null to fall back to text. */
export interface BlueskySnapshots { ids: Set<string>; render: (entry: BlueskyEntry) => Promise<BlueskyImage[] | null> }

// Bluesky's limit is 300 graphemes. The server validates with a different
// segmenter than the browser, so chunks keep a margin.
const MAX_GRAPHEMES = 290;
const MAX_BYTES = 3000;
const ATTACHABLE_IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const URL_RE = /https?:\/\/[^\s<>()]+/g;
interface SegmenterLike { segment(input: string): Iterable<{ segment: string }> }
const segmenter: SegmenterLike | null = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new (Intl as unknown as { Segmenter: new (locale: string | undefined, options: { granularity: string }) => SegmenterLike }).Segmenter(undefined, { granularity: "grapheme" })
  : null;
const encoder = new TextEncoder();
const utf8Length = (text: string) => encoder.encode(text).length;
const segments = (text: string) => segmenter ? Array.from(segmenter.segment(text), value => value.segment) : Array.from(text);
const graphemeCount = (text: string) => segments(text).length;
const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
const targetName = (target: string) => {
  const clean = target.split("|")[0].split("#")[0].trim();
  return clean.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
};

export function blueskyEntryFromPost(post: TimelinePost): BlueskyEntry {
  const authorName = post.speaker !== "user" ? (post.metadata["author-name"] || (post.speaker === "ai" ? "AI" : post.speaker)) : "";
  return { id: post.id, content: post.content, createdAt: post.createdAt, replyTo: post.replyTo, authorName, speaker: post.speaker, sourcePath: post.sourcePath };
}

/** Apply `transform` to the text between URLs so inline markup rules never rewrite a link. */
function outsideUrls(text: string, transform: (part: string) => string): string {
  let result = "", last = 0;
  for (const match of text.matchAll(URL_RE)) {
    result += transform(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return result + transform(text.slice(last));
}

/**
 * Turn Timeline Markdown into public plain text: Vault images become
 * attachments, links and embeds keep their readable text, and Timeline-only
 * markup (calendar markers, callouts, @ai, emphasis) is removed. Content hidden
 * in Obsidian's reading view (comments, footnotes) is never published.
 */
export function blueskyContent(content: string): { text: string; images: BlueskyImageRef[] } {
  const images: BlueskyImageRef[] = [];
  let text = content.replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/%%[\s\S]*?(?:%%|$)/g, "")
    .replace(/^\[\^[^\]\n]+\]:.*(?:\n[ \t]+.*)*$/gm, "");
  // One pass keeps attachments in their written order.
  text = text.replace(/!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g, (_match: string, wiki: string | undefined, alt: string = "", href: string = "") => {
    if (wiki) {
      const [path, label = ""] = wiki.split("|");
      const clean = path.split("#")[0].trim();
      if (!ATTACHABLE_IMAGE.test(clean)) return targetName(wiki);
      images.push({ target: clean, wiki: true, alt: label.trim() });
      return "";
    }
    if (/^https?:\/\//i.test(href)) return alt ? `${alt} ${href}` : href;
    const clean = decode(href.split(/[?#]/)[0]);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !ATTACHABLE_IMAGE.test(clean)) return alt || targetName(clean);
    images.push({ target: clean, wiki: false, alt });
    return "";
  });
  text = text
    .replace(/\[\[([^\]\n]+)\]\]/g, (_match, target: string) => target.split("|")[1]?.trim() || targetName(target))
    .replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g, (_match, label: string, href: string) =>
      /^https?:\/\//i.test(href) && label !== href ? `${label} ${href}` : label)
    .replace(/^>\s?\[![^\]]+\][+-]?\s*/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^```.*$/gm, "");
  text = outsideUrls(text, part => part
    .replace(/\[\^[^\]\n]+\]|\^\[[^\]\n]*\]/g, "")
    .replace(/(\*\*|__|~~|==)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/`([^`\n]+)`/g, "$1"));
  text = text
    .replace(/(^|\s)@ai\b[ \t]?/gi, "$1")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  return { text: text.trim(), images };
}

// Markup that plain text cannot carry: code, tables, callouts (other than
// Timeline calendar markers), math and diagrams.
const SNAPSHOT_MARKUP = [
  /^\s*(```|~~~)/m,
  /^\s*\|?\s*:?-{3,}:?\s*\|/m,
  /^>\s?\[!(?!calendar\])[^\]\n]+\]/im,
  /^\s*\$\$/m,
];

/** Whether an entry reads better as a picture of its rendered Markdown. */
export function blueskyPrefersImage(content: string): boolean {
  return SNAPSHOT_MARKUP.some(pattern => pattern.test(content));
}

/** The text of a picture post: only the links, which the picture cannot make clickable. */
export function blueskyImageCaption(content: string): string {
  const { text } = blueskyContent(content);
  let caption = "";
  for (const url of new Set(Array.from(text.matchAll(URL_RE), match => match[0]))) {
    const next = caption ? `${caption}\n${url}` : url;
    if (graphemeCount(next) > MAX_GRAPHEMES || utf8Length(next) > MAX_BYTES) break;
    caption = next;
  }
  return caption;
}

/** Split into Bluesky-sized chunks, preferring whitespace and never cutting a URL when avoidable. */
export function splitBlueskyText(text: string): string[] {
  const parts = segments(text);
  const starts: number[] = [];
  let length = 0;
  for (const part of parts) { starts.push(length); length += part.length; }
  const urls = [...text.matchAll(URL_RE)].map(match => [match.index, match.index + match[0].length]);
  const chunks: string[] = [];
  let offset = 0;
  while (offset < parts.length) {
    while (offset < parts.length && /^\s+$/.test(parts[offset])) offset++;
    if (offset >= parts.length) break;
    let end = offset, bytes = 0;
    while (end < parts.length && end - offset < MAX_GRAPHEMES) {
      const size = utf8Length(parts[end]);
      if (bytes + size > MAX_BYTES) break;
      bytes += size; end++;
    }
    if (end === offset) throw new Error("A character exceeds Bluesky's byte limit");
    if (end < parts.length) {
      let cut = end;
      for (let index = end - 1; index > offset + (end - offset) / 2; index--) {
        if (/^\s+$/.test(parts[index])) { cut = index + 1; break; }
      }
      const url = urls.find(([from, to]) => from < starts[cut] && starts[cut] < to);
      if (url) {
        const urlStart = starts.findIndex(start => start >= url[0]);
        if (urlStart > offset) cut = urlStart;
      }
      end = cut;
    }
    const chunk = parts.slice(offset, end).join("").trimEnd();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

export async function buildBlueskyPreview(
  entries: BlueskyEntry[],
  selected: Set<string>,
  image: BlueskyImageLoader,
  snapshots?: BlueskySnapshots,
): Promise<BlueskyPost[]> {
  const chosen = entries.filter(entry => selected.has(entry.id));
  if (!chosen.length) throw new Error("Select at least one post");
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("Resolve duplicate Timeline IDs before publishing");
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const selectedParent = (entry: BlueskyEntry) => {
    let parent = entry.replyTo;
    const visited = new Set([entry.id]);
    while (parent) {
      if (visited.has(parent)) throw new Error("Invalid reply chain");
      visited.add(parent);
      if (selected.has(parent)) return parent;
      parent = byId.get(parent)?.replyTo || "";
    }
    return "";
  };
  const pending = [...chosen];
  const posts: BlueskyPost[] = [];
  const last = new Map<string, string>();
  while (pending.length) {
    const index = pending.findIndex(entry => !selectedParent(entry) || last.has(selectedParent(entry)));
    if (index < 0) throw new Error("Invalid reply chain");
    const entry = pending.splice(index, 1)[0];
    const pages = snapshots?.ids.has(entry.id) ? await snapshots.render(entry) : null;
    if (pages?.length) {
      // Four pictures per post; further pages continue the thread.
      const caption = blueskyImageCaption(entry.content);
      const text = entry.speaker !== "user" && entry.authorName ? `${entry.authorName}:\n${caption}`.trim() : caption;
      let parent = last.get(selectedParent(entry)) ?? "";
      for (let part = 0; part * 4 < pages.length; part++) {
        const id = `${entry.sourcePath}#${entry.id}:${part}`;
        posts.push({ images: pages.slice(part * 4, part * 4 + 4), id, text: part === 0 ? splitBlueskyText(text)[0] ?? "" : "", createdAt: entry.createdAt, parent });
        parent = id;
      }
      last.set(entry.id, parent);
      continue;
    }
    const content = blueskyContent(entry.content);
    if (content.images.length > 4) throw new Error("Bluesky allows at most four images per post");
    const images: BlueskyImage[] = [];
    for (const ref of content.images) images.push(await image(ref, entry));
    const text = (entry.speaker !== "user" && entry.authorName ? `${entry.authorName}:\n${content.text}` : content.text).trim();
    if (!text && !images.length) throw new Error("Empty posts cannot be published");
    const chunks = splitBlueskyText(text);
    if (!chunks.length) chunks.push("");
    let parent = last.get(selectedParent(entry)) ?? "";
    chunks.forEach((chunk, part) => {
      const id = `${entry.sourcePath}#${entry.id}:${part}`;
      posts.push({ ...(part === 0 && images.length ? { images } : {}), id, text: chunk, createdAt: entry.createdAt, parent });
      parent = id;
    });
    last.set(entry.id, parent);
  }
  if (posts.length > 100) throw new Error("Select at most 100 Bluesky posts");
  return posts;
}

/** Convert Vault image bytes to the exact pixels shown in the preview. */
export async function prepareBlueskyImage(raw: ArrayBuffer, mime: string, alt: string): Promise<BlueskyImage> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) throw new Error("Use PNG, JPEG, WebP or GIF images for Bluesky");
  const bitmap = await createImageBitmap(new Blob([raw], { type: mime }));
  try {
    const canvas = createEl("canvas");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Cannot prepare the image");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let encoded = "";
    for (const quality of [0.9, 0.75, 0.55, 0.35]) { encoded = canvas.toDataURL("image/jpeg", quality).split(",")[1]; if (encoded.length <= 1_333_332) return { data: encoded, mime: "image/jpeg", alt: alt.slice(0, 2000) }; }
    throw new Error("This image is too large for Bluesky");
  } finally { bitmap.close(); }
}

function decodedImageBytes(data: string): Uint8Array | null {
  try { return new Uint8Array(base64ToArrayBuffer(data)); } catch { return null; }
}

export function validateBlueskyPosts(posts: BlueskyPost[]): Error | null {
  if (posts.length === 0 || posts.length > 100) return new Error("Select between 1 and 100 posts");
  const seen = new Set<string>();
  for (const post of posts) {
    const bytes = utf8Length(post.text);
    if (!post.id || post.id.length > 4096 || seen.has(post.id) || (post.text.trim() === "" && !post.images?.length) || bytes > 3000 || graphemeCount(post.text) > 300) {
      return new Error("Invalid Bluesky post");
    }
    if (Number.isNaN(Date.parse(post.createdAt))) return new Error("Invalid post time");
    if (post.parent && !seen.has(post.parent)) return new Error("Parent must precede its reply");
    if ((post.images?.length ?? 0) > 4) return new Error("At most four images are allowed");
    for (const image of post.images ?? []) {
      const raw = decodedImageBytes(image.data);
      if (!raw || raw.length === 0 || raw.length > 1_000_000 || image.alt.length > 8000 || !(image.mime === "image/jpeg" || image.mime === "image/png" || image.mime === "image/webp")) {
        return new Error("Invalid Bluesky image");
      }
    }
    seen.add(post.id);
  }
  return null;
}

const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

// Deterministic record keys let us reconcile a lost response before retrying.
// A different text or parent produces a separate, explicitly selected version.
// app.bsky.feed.post requires TID keys, so the key is a valid TID: the post's
// time in microseconds, with the sub-millisecond part and clock id from a hash.
export async function blueskyRecordKey(did: string, post: BlueskyPost): Promise<string> {
  const raw = JSON.stringify([did, post.id, post.text, post.createdAt, post.parent, post.images ?? []]);
  const digest = new DataView(await crypto.subtle.digest("SHA-256", encoder.encode(raw)));
  const micros = Date.parse(post.createdAt) * 1000 + digest.getUint32(0) % 1000;
  const clockId = digest.getUint16(4) & 0x3ff;
  // 11 characters of timestamp then 2 of clock id: the 63-bit TID without BigInt.
  const base32 = (value: number, length: number) => {
    let out = "";
    for (let index = 0; index < length; index++) {
      out = TID_ALPHABET[value % 32] + out;
      value = Math.floor(value / 32);
    }
    return out;
  };
  return base32(micros, 11) + base32(clockId, 2);
}

export interface BlueskyFacet { index: { byteStart: number; byteEnd: number }; features: { $type: string; uri: string }[] }

export function blueskyLinkFacets(text: string): BlueskyFacet[] {
  const facets: BlueskyFacet[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const uri = match[0].replace(/[.,!?;:、。！？\]}]+$/, "");
    try { if (!new URL(uri).host) continue; } catch { continue; }
    const byteStart = utf8Length(text.slice(0, match.index));
    facets.push({ index: { byteStart, byteEnd: byteStart + utf8Length(uri) }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  return facets;
}

export interface BlueskyApiResponse { status: number; json: unknown }
export interface BlueskyApi {
  get(path: string, params: Record<string, string>): Promise<BlueskyApiResponse>;
  post(path: string, body: unknown, contentType?: string): Promise<BlueskyApiResponse>;
}

interface BlueskyRecord { uri: string; cid: string; value: Record<string, unknown> }

export function blueskyJsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordRef(value: Record<string, unknown> | null): { uri: string; cid: string } | null {
  return value && typeof value.uri === "string" && value.uri && typeof value.cid === "string" && value.cid
    ? { uri: value.uri, cid: value.cid } : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function publishBlueskyPosts(api: BlueskyApi, did: string, posts: BlueskyPost[]): Promise<{ urls: string[] }> {
  const result = { urls: [] as string[] };
  const invalid = validateBlueskyPosts(posts);
  if (invalid) throw invalid;
  const refs = new Map<string, BlueskyRecord>();
  const roots = new Map<string, BlueskyRecord>();
  for (const post of posts) {
    const key = await blueskyRecordKey(did, post);
    const value: Record<string, unknown> = { $type: "app.bsky.feed.post", text: post.text, createdAt: post.createdAt };
    const facets = blueskyLinkFacets(post.text);
    if (facets.length > 0) value.facets = facets;
    let root: BlueskyRecord | null = null;
    if (post.parent) {
      const parent = refs.get(post.parent)!;
      root = roots.get(post.parent) ?? null;
      value.reply = { root: { uri: root!.uri, cid: root!.cid }, parent: { uri: parent.uri, cid: parent.cid } };
    }
    let record: BlueskyRecord;
    const existing = await api.get("com.atproto.repo.getRecord", { repo: did, collection: "app.bsky.feed.post", rkey: key });
    if (existing.status === 401) throw new Error("Reconnect Bluesky");
    const existingJson = blueskyJsonObject(existing.json);
    const existingRef = recordRef(existingJson);
    if (existing.status !== 200 || !existingRef) {
      const error = existingJson?.error;
      if (existing.status !== 400 || error !== "RecordNotFound") {
        throw new Error("Could not verify Bluesky publication. Retry to check before sending again");
      }
      if (post.images?.length) {
        const images: unknown[] = [];
        for (const image of post.images) {
          const raw = decodedImageBytes(image.data);
          if (!raw) throw new Error("Could not upload Bluesky image");
          const uploaded = await api.post("com.atproto.repo.uploadBlob", raw.buffer, image.mime);
          if (uploaded.status === 401) throw new Error("Reconnect Bluesky");
          const blob = blueskyJsonObject(blueskyJsonObject(uploaded.json)?.blob);
          if (uploaded.status < 200 || uploaded.status >= 300 || !blob) throw new Error("Could not upload Bluesky image");
          images.push({ alt: image.alt, image: blob });
        }
        value.embed = { $type: "app.bsky.embed.images", images };
      }
      value.createdAt = new Date().toISOString();
      const created = await api.post("com.atproto.repo.createRecord", { repo: did, collection: "app.bsky.feed.post", rkey: key, record: value });
      if (created.status === 401) throw new Error("Reconnect Bluesky");
      const createdRef = recordRef(blueskyJsonObject(created.json));
      if (created.status < 200 || created.status >= 300 || !createdRef) {
        throw new Error("Publication could not be confirmed. Retry the same selection to check before sending again");
      }
      record = { ...createdRef, value };
    } else {
      const found: BlueskyRecord = { ...existingRef, value: blueskyJsonObject(existingJson?.value) ?? {} };
      const compare: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(found.value)) if (k !== "embed" && k !== "createdAt") compare[k] = v;
      const expected: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) if (k !== "createdAt") expected[k] = v;
      if (canonicalJson(compare) !== canonicalJson(expected)) {
        throw new Error("The existing Bluesky record differs from this preview");
      }
      record = found;
    }
    refs.set(post.id, record);
    if (!post.parent) root = record;
    roots.set(post.id, root!);
    result.urls.push(`https://bsky.app/profile/${did}/post/${key}`);
  }
  return result;
}
