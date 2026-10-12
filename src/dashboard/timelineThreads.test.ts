import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { appendPost, deletePostContent, postBlock, replacePostContent, selectTimelineThreads, setPostPinnedContent, splitPosts, timelineThreads } from "./timelineThreads";

const file = new TFile();
file.path = "Dashboards/Timeline/Timeline/2026-10-11.md";
const root = "2026-10-11T01:00:00.000Z\nid: root\n\nOriginal";
const reply = "2026-10-12T01:00:00.000Z\nid: reply\nroot-id: root\nreply-to: root\nspeaker: ai\nauthor-name: Bot\nremote-id: keep\n\nAnswer";
const parse = (text: string) => splitPosts(text, file.path, file);

describe("Timeline thread format", () => {
  it("keeps legacy posts, markers, body separators and metadata-like body lines", () => {
    const [post] = parse("<!-- timeline-post: 2026-10-11T01:00:00.000Z -->\n\nhttps: example\n\n---\n\nBody");
    expect(post.content).toBe("https: example\n\n---\n\nBody");
    expect(parse(postBlock(post))[0]).toMatchObject({ id: post.id, content: post.content });
    expect(parse(root)[0]).toMatchObject({ id: "root", rootId: "root", replyTo: "", speaker: "user" });
  });

  it("keeps older activity posts with duplicate IDs visible and editable", () => {
    const text = appendPost(root, root.replace("Original", "Second"));
    const posts = parse(text);
    expect(timelineThreads(posts)).toHaveLength(2);
    const edited = parse(replacePostContent(text, file, posts[1].id, "Edited second")!);
    expect(edited.map(post => post.content)).toEqual(["Original", "Edited second"]);
    expect(new Set(edited.map(post => post.id)).size).toBe(2);
  });

  it("preserves thread, author, and unknown metadata when editing or pinning", () => {
    const edited = replacePostContent(reply, file, "reply", "Edited")!;
    const pinned = setPostPinnedContent(edited, file, "reply", true)!;
    expect(parse(pinned)[0]).toMatchObject({
      content: "Edited", pinned: true, rootId: "root", replyTo: "root", speaker: "ai",
      metadata: { "author-name": "Bot", "remote-id": "keep" },
    });
  });

  it("orders replies across day files under their root, including replies to replies", () => {
    const nested = reply.replace("id: reply", "id: nested").replace("reply-to: root", "reply-to: reply").replace("01:00:00", "02:00:00");
    const [thread] = timelineThreads([...parse(nested), ...parse(reply), ...parse(root)]);
    expect(thread.root.id).toBe("root");
    expect(thread.replies.map(post => post.id)).toEqual(["reply", "nested"]);
  });

  it("resolves older reply chains with no explicit root-id", () => {
    const nested = reply.replace("id: reply", "id: nested").replace("root-id: root\n", "").replace("reply-to: root", "reply-to: reply");
    const [thread] = timelineThreads([...parse(nested), ...parse(reply), ...parse(root)]);
    expect(thread.root.id).toBe("root");
    expect(thread.replies).toHaveLength(2);
  });

  it("keeps replies visible after deleting the root and retains stable legacy IDs", () => {
    const text = appendPost(root, reply);
    const deleted = deletePostContent(text, file, "root")!;
    const [thread] = timelineThreads(parse(deleted));
    expect(thread.root).toMatchObject({ id: "root", deleted: true, content: "" });
    expect(thread.replies.map(post => post.id)).toEqual(["reply"]);
    const legacy = "2026-10-11T01:00:00.000Z\n\nFirst";
    const legacySecond = "2026-10-11T02:00:00.000Z\n\nSecond";
    const both = appendPost(legacy, legacySecond);
    const [first, second] = parse(both);
    expect(parse(deletePostContent(both, file, first.id)!)[1].id).toBe(second.id);
  });

  it("provides placeholders for missing roots, even without root-id metadata", () => {
    for (const text of [reply, reply.replace("root-id: root\n", "")]) {
      const [thread] = timelineThreads(parse(text));
      expect(thread.root).toMatchObject({ id: "root", deleted: true });
      expect(thread.replies.map(post => post.id)).toEqual(["reply"]);
    }
  });

  it("paginates whole threads by their most recent reply and filters within a thread", () => {
    const other = root.replace("id: root", "id: other").replace("Original", "Other").replace("01:00:00", "03:00:00");
    const posts = [...parse(root), ...parse(reply), ...parse(other)];
    expect(selectTimelineThreads(posts, 1, () => true)).toMatchObject({ hasMore: true, posts: [{ id: "root" }, { id: "reply" }] });
    expect(selectTimelineThreads(posts, 1, post => post.content.includes("Answer"))).toMatchObject({ hasMore: false, posts: [{ id: "root" }, { id: "reply" }] });
  });

  it("keeps unaffected blocks byte-for-byte when editing and excludes deleted replies", () => {
    const text = appendPost(root, reply);
    expect(replacePostContent(text, file, "reply", "New")!.startsWith(root)).toBe(true);
    expect(timelineThreads(parse(deletePostContent(text, file, "reply")!))[0].replies).toEqual([]);
    expect(replacePostContent(text, file, "missing", "New")).toBeNull();
  });
});
