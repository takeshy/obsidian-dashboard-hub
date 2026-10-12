import type { TFile } from "obsidian";

export interface TimelinePost {
  id: string;
  createdAt: string;
  pinned: boolean;
  metadata: Record<string, string>;
  rootId: string;
  replyTo: string;
  speaker: string;
  deleted: boolean;
  content: string;
  index: number;
  sourcePath: string;
  sourceFile: TFile;
}

interface ParsedPostBlock {
  raw: string;
  post: TimelinePost | null;
}

const POST_MARKER_RE = /<!--\s*timeline-post:\s*([^>]+?)\s*-->/;
const POST_SEPARATOR_RE = /^\s*---\s*\r?\n(?=(?:<!--\s*timeline-post:|\d{4}-\d{2}-\d{2}T))/m;
const ISO_DATE_LINE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function parsePostBlock(raw: string, index: number, sourcePath: string, sourceFile: TFile): TimelinePost | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const marker = trimmed.match(POST_MARKER_RE);
  const withoutMarker = trimmed.replace(POST_MARKER_RE, "").trim();
  const lines = withoutMarker.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const dateFromLine = ISO_DATE_LINE_RE.test(firstLine) ? firstLine : "";
  const createdAt = marker?.[1]?.trim() || dateFromLine || new Date(0).toISOString();
  const bodyStart = dateFromLine ? 1 : 0;
  const metadata: Record<string, string> = {};
  let contentStart = bodyStart;
  while (contentStart < lines.length) {
    const match = lines[contentStart].match(/^([a-z][a-z0-9-]*):\s*(.*?)\s*$/i);
    if (!match || (contentStart === bodyStart && !/^(id|pinned|root-id|reply-to|speaker|deleted)$/i.test(match[1]))) break;
    metadata[match[1].toLowerCase()] = match[2];
    contentStart++;
  }
  const id = metadata.id || `${createdAt}-${index}`;
  const body = lines.slice(contentStart).join("\n").trim();
  if (!body && metadata.deleted !== "true") return null;
  return {
    id,
    metadata,
    rootId: metadata["root-id"] || id,
    replyTo: metadata["reply-to"] || "",
    speaker: metadata.speaker || "user",
    deleted: metadata.deleted === "true",
    createdAt,
    pinned: metadata.pinned?.toLowerCase() === "true",
    content: body,
    index,
    sourcePath,
    sourceFile,
  };
}

function parsePostBlocks(content: string, sourcePath: string, sourceFile: TFile): ParsedPostBlock[] {
  const ids = new Set<string>();
  return content
    .split(POST_SEPARATOR_RE)
    .map((raw, index) => {
      const post = parsePostBlock(raw, index, sourcePath, sourceFile);
      // Older activity writers could emit the same ID within one millisecond.
      // Keep each post addressable and persist its repaired ID on the next edit.
      if (post) {
        const originalId = post.id;
        while (ids.has(post.id)) post.id += `-duplicate-${index}`;
        if (post.rootId === originalId && !post.replyTo) post.rootId = post.id;
        ids.add(post.id);
      }
      return { raw: raw.trim(), post };
    })
    .filter((block) => block.raw);
}

export function splitPosts(content: string, sourcePath: string, sourceFile: TFile): TimelinePost[] {
  return parsePostBlocks(content, sourcePath, sourceFile)
    .map((block) => block.post)
    .filter((post): post is TimelinePost => post !== null);
}

export function appendPost(content: string, postBlock: string): string {
  const current = content.trim();
  if (!current) return `${postBlock}\n`;
  return `${current}\n\n---\n\n${postBlock}\n`;
}

function serializeBlocks(blocks: ParsedPostBlock[]): string {
  return blocks.map((block) => block.raw.trim()).filter(Boolean).join("\n\n---\n\n") + "\n";
}

export function replacePostContent(content: string, file: TFile, postId: string, nextBody: string): string | null {
  let changed = false;
  const blocks = parsePostBlocks(content, file.path, file).map((block) => {
    if (block.post?.id !== postId) return block;
    changed = true;
    return {
      raw: postBlock({ ...block.post, content: nextBody.trim() }),
      post: block.post,
    };
  });
  return changed ? serializeBlocks(blocks) : null;
}

export function setPostPinnedContent(content: string, file: TFile, postId: string, pinned: boolean): string | null {
  let changed = false;
  const blocks = parsePostBlocks(content, file.path, file).map((block) => {
    if (block.post?.id !== postId) return block;
    changed = true;
    return {
      raw: postBlock({ ...block.post, pinned }),
      post: { ...block.post, pinned },
    };
  });
  return changed ? serializeBlocks(blocks) : null;
}

export function deletePostContent(content: string, file: TFile, postId: string): string | null {
  const blocks = parsePostBlocks(content, file.path, file);
  if (!blocks.some(block => block.post?.id === postId)) return null;
  return serializeBlocks(blocks.map(block => block.post?.id === postId
    ? { ...block, raw: postBlock({ ...block.post, deleted: true, content: "" }) } : block));
}


export function postBlock(post: TimelinePost): string {
  const metadata = { ...post.metadata, id: post.id, "root-id": post.rootId, "reply-to": post.replyTo, speaker: post.speaker, pinned: String(post.pinned), deleted: String(post.deleted) };
  return `${post.createdAt}\n${Object.entries(metadata).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join("\n")}\n\n${post.content}`;
}

export function timelineThreads(entries: TimelinePost[]): { root: TimelinePost; replies: TimelinePost[] }[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const groups = new Map<string, TimelinePost[]>();
  for (const entry of entries) {
    if (entry.deleted) continue;
    // Resolve legacy reply chains without looping on corrupt parent metadata.
    let rootId = entry.rootId;
    if (entry.replyTo && rootId === entry.id) {
      rootId = entry.replyTo;
      const visited = new Set([entry.id]);
      let parent = byId.get(entry.replyTo);
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id); rootId = parent.rootId;
        if (!parent.replyTo || parent.rootId !== parent.id) break;
        parent = byId.get(parent.replyTo);
      }
    }
    const group = groups.get(rootId) ?? [];
    group.push(entry); groups.set(rootId, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const root = byId.get(id) ?? {
      ...group[0], id, rootId: id, replyTo: "", deleted: true, content: "",
      metadata: { deleted: "true" },
    };
    return { root, replies: group.filter(entry => entry.id !== root.id).map(entry => ({ ...entry, rootId: id })).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)) };
  });
}

/** Filter and paginate whole threads, keeping the root and all replies together. */
export function selectTimelineThreads(posts: TimelinePost[], limit: number, matches: (post: TimelinePost) => boolean): { posts: TimelinePost[]; hasMore: boolean } {
  const threads = timelineThreads(posts).filter(thread => [thread.root, ...thread.replies].some(post => !post.deleted && matches(post)));
  const activity = (thread: typeof threads[number]) => Math.max(...[thread.root, ...thread.replies].map(post => Date.parse(post.createdAt)));
  threads.sort((a, b) => activity(b) - activity(a) || b.root.id.localeCompare(a.root.id));
  return { posts: threads.slice(0, limit).reverse().flatMap(thread => [thread.root, ...thread.replies]), hasMore: threads.length > limit };
}
