import { describe, expect, it } from "vitest";
import {
  blueskyContent,
  blueskyImageCaption,
  blueskyPrefersImage,
  blueskyEntryFromPost,
  blueskyLinkFacets,
  blueskyRecordKey,
  buildBlueskyPreview,
  publishBlueskyPosts,
  splitBlueskyText,
  validateBlueskyPosts,
  type BlueskyApi,
  type BlueskyApiResponse,
  type BlueskyEntry,
} from "./bluesky";

const entry = (id: string, content = id, replyTo = "", speaker = "user", authorName = ""): BlueskyEntry =>
  ({ id, content, replyTo, createdAt: "2026-10-14T00:00:00.000Z", speaker, authorName, sourcePath: "Dashboards/Timeline/Timeline/2026-10-14.md" });
const image = async () => ({ data: "eA==", mime: "image/jpeg", alt: "image" });

describe("buildBlueskyPreview", () => {
  it("excludes unselected entries, orders parents first, and supports reply-only selection", async () => {
    const entries = [entry("reply", "reply", "root"), entry("root"), entry("excluded", "private", "root")];
    const preview = await buildBlueskyPreview(entries, new Set(["root", "reply"]), image);
    expect(preview).toHaveLength(2);
    expect(preview[1].parent).toBe(preview[0].id);
    expect(preview.every(post => post.text !== "private")).toBe(true);
    const replyOnly = await buildBlueskyPreview(entries, new Set(["reply"]), image);
    expect(replyOnly[0].parent).toBe("");
  });

  it("splits Japanese and multi-code-point emoji into chained posts without breaking graphemes", async () => {
    const text = "あ".repeat(289) + "👨‍👩‍👧‍👦" + "続き";
    const preview = await buildBlueskyPreview([entry("long", text)], new Set(["long"]), image);
    expect(preview).toHaveLength(2);
    expect(preview[0].text).toBe("あ".repeat(289) + "👨‍👩‍👧‍👦");
    expect(preview[1].parent).toBe(preview[0].id);
    expect(preview.map(post => post.text).join("")).toBe(text);
  });

  it("prepares images once and shows them only on the first split post", async () => {
    const loads: string[] = [];
    const preview = await buildBlueskyPreview([entry("image", `![[picture.png]]\n${"a".repeat(400)}`)], new Set(["image"]), async ref => {
      loads.push(ref.target);
      return image();
    });
    expect(preview[0].images).toHaveLength(1);
    expect(preview[1].images).toBeUndefined();
    expect(preview[0].text).not.toContain("picture.png");
    expect(loads).toEqual(["picture.png"]);
  });

  it("rejects cyclic replies and more than four images", async () => {
    await expect(buildBlueskyPreview([entry("a", "a", "b"), entry("b", "b", "a")], new Set(["a", "b"]), image)).rejects.toThrow();
    await expect(buildBlueskyPreview([entry("a", "![[a.png]]".repeat(5))], new Set(["a"]), image)).rejects.toThrow();
  });

  it("attaches omitted intermediate replies to their nearest selected ancestor", async () => {
    const entries = [entry("root"), entry("middle", "private", "root"), entry("leaf", "public", "middle")];
    const preview = await buildBlueskyPreview(entries, new Set(["root", "leaf"]), image);
    expect(preview[1].parent).toBe(preview[0].id);
    expect(preview.every(post => post.text !== "private")).toBe(true);
  });

  it("prefixes non-user speakers with their author name", async () => {
    const preview = await buildBlueskyPreview([entry("ai", "Answer", "", "ai", "AI")], new Set(["ai"]), image);
    expect(preview[0].text).toBe("AI:\nAnswer");
  });

  it("maps Timeline posts to Bluesky entries with AI as the default author", () => {
    const base = {
      id: "p", createdAt: "2026-10-14T00:00:00.000Z", pinned: false, rootId: "p", replyTo: "",
      deleted: false, content: "hi", index: 0, sourcePath: "a.md", sourceFile: null as never,
    };
    expect(blueskyEntryFromPost({ ...base, speaker: "ai", metadata: { "author-name": "Bot" } }).authorName).toBe("Bot");
    expect(blueskyEntryFromPost({ ...base, speaker: "ai", metadata: {} }).authorName).toBe("AI");
    expect(blueskyEntryFromPost({ ...base, speaker: "user", metadata: {} }).authorName).toBe("");
  });
});

describe("blueskyContent", () => {
  it("removes Timeline markup and keeps only Vault images as attachments", () => {
    const source = [
      "<!-- calendar-event: 2026-10-14 -->",
      "> [!calendar] Calendar event · 2026-10-14",
      "> **Dinner** with [[People/Alice|Alice]] @ai",
      "![[Meeting.md]] ![remote](https://example.com/a.png) ![](<my%20pic.png> \"title\") ![[/assets/x.png|alt text]]",
      "[docs](https://example.com/docs) and `code`",
    ].join("\n");
    const { text, images } = blueskyContent(source);
    expect(text).toBe("Calendar event · 2026-10-14\nDinner with Alice\nMeeting remote https://example.com/a.png\ndocs https://example.com/docs and code");
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ target: "my pic.png", wiki: false, alt: "" });
    expect(images[1]).toMatchObject({ target: "/assets/x.png", wiki: true, alt: "alt text" });
  });

  it("drops content hidden in reading view and keeps URLs intact", () => {
    const source = [
      "Shipped ==v2==[^1] %%client: Acme, price $40k%% today^[inline note]",
      "%%",
      "private block",
      "%%",
      "see https://example.com/a__b__c and **bold**",
      "[^1]: footnote text",
      "    continued",
      "after",
    ].join("\n");
    expect(blueskyContent(source).text).toBe("Shipped v2 today\n\nsee https://example.com/a__b__c and bold\n\nafter");
  });
});

describe("splitBlueskyText", () => {
  it("prefers whitespace boundaries and keeps URLs whole", () => {
    const url = "https://example.com/" + "p".repeat(40);
    const text = "a".repeat(270) + " " + url + " end";
    const chunks = splitBlueskyText(text);
    const graphemes = (value: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("a".repeat(270));
    expect(chunks[1].startsWith(url)).toBe(true);
    expect(chunks.every(chunk => graphemes(chunk) <= 290)).toBe(true);
  });
});

describe("validateBlueskyPosts", () => {
  const valid = { id: "p", text: "hello", createdAt: "2026-10-14T00:00:00.000Z", parent: "" };
  it("accepts valid posts including 300 emoji graphemes", () => {
    expect(validateBlueskyPosts([{ ...valid }])).toBeNull();
    expect(validateBlueskyPosts([{ ...valid, id: "emoji", text: "👨‍👩‍👧‍👦".repeat(100) }])).toBeNull();
  });
  it("rejects over-long, undated, orphaned, and empty posts", () => {
    expect(validateBlueskyPosts([{ ...valid, text: "あ".repeat(301) }])).toBeInstanceOf(Error);
    expect(validateBlueskyPosts([{ ...valid, createdAt: "invalid" }])).toBeInstanceOf(Error);
    expect(validateBlueskyPosts([{ ...valid, parent: "missing" }])).toBeInstanceOf(Error);
    expect(validateBlueskyPosts([{ ...valid, text: "   " }])).toBeInstanceOf(Error);
    expect(validateBlueskyPosts([])).toBeInstanceOf(Error);
  });
  it("rejects oversized or badly encoded images", () => {
    const big = "A".repeat(1_000_001);
    expect(validateBlueskyPosts([{ ...valid, images: [{ data: big, mime: "image/jpeg", alt: "" }] }])).toBeInstanceOf(Error);
    expect(validateBlueskyPosts([{ ...valid, images: [{ data: "!!!", mime: "image/jpeg", alt: "" }] }])).toBeInstanceOf(Error);
    expect(validateBlueskyPosts([{ ...valid, images: Array.from({ length: 5 }, () => ({ data: "eA==", mime: "image/jpeg", alt: "" })) }])).toBeInstanceOf(Error);
  });
});

describe("blueskyRecordKey", () => {
  it("is deterministic and changes with the text", async () => {
    const post = { id: "p", text: "hello", createdAt: "2026-10-14T00:00:00.000Z", parent: "" };
    const key = await blueskyRecordKey("did:plc:test", post);
    expect(key).toMatch(/^[2-7a-j][2-7a-z]{12}$/);
    expect(await blueskyRecordKey("did:plc:test", post)).toBe(key);
    expect(await blueskyRecordKey("did:plc:test", { ...post, text: "changed" })).not.toBe(key);
  });

  it("is a TID whose timestamp is the post time", async () => {
    const post = { id: "p", text: "hello", createdAt: "2026-10-14T00:00:00.000Z", parent: "" };
    const key = await blueskyRecordKey("did:plc:test", post);
    const micros = [...key.slice(0, 11)].reduce((value, char) => value * 32 + "234567abcdefghijklmnopqrstuvwxyz".indexOf(char), 0);
    expect(Math.floor(micros / 1000)).toBe(Date.parse(post.createdAt));
  });
});

describe("blueskyLinkFacets", () => {
  it("uses UTF-8 byte offsets and trims trailing punctuation", () => {
    const text = "日本語 https://example.com。";
    const facets = blueskyLinkFacets(text);
    expect(facets).toHaveLength(1);
    const prefix = new TextEncoder().encode("日本語 ");
    const full = new TextEncoder().encode("日本語 https://example.com");
    expect(facets[0].index.byteStart).toBe(prefix.length);
    expect(facets[0].index.byteEnd).toBe(full.length);
    expect(facets[0].features[0].uri).toBe("https://example.com");
  });
});

describe("publishBlueskyPosts", () => {
  const posts = [
    { id: "root", text: "hello", createdAt: "2026-10-14T00:00:00.000Z", parent: "" },
    { id: "reply", text: "reply", createdAt: "2026-10-14T00:00:01.000Z", parent: "root" },
  ];

  function fakeApi(handler: (method: "get" | "post", path: string, body: unknown) => BlueskyApiResponse | Promise<BlueskyApiResponse>): BlueskyApi {
    return {
      async get(path, params) { void params; return handler("get", path, params); },
      async post(path, body, contentType) { void contentType; return handler("post", path, body); },
    };
  }

  it("reconciles a lost createRecord response without duplicating the thread", async () => {
    const rows = new Map<string, { uri: string; cid: string; value: Record<string, unknown> }>();
    let writes = 0;
    let lose = true;
    const api = fakeApi((_method, path, body) => {
      if (path === "com.atproto.repo.getRecord") {
        const rkey = String((body as Record<string, string>).rkey);
        const row = rows.get(rkey);
        if (!row) return { status: 400, json: { error: "RecordNotFound" } };
        return { status: 200, json: row };
      }
      if (path === "com.atproto.repo.createRecord") {
        const request = body as { rkey: string; record: Record<string, unknown> };
        writes += 1;
        const row = { uri: `at://did:plc:test/app.bsky.feed.post/${request.rkey}`, cid: request.rkey, value: request.record };
        rows.set(request.rkey, row);
        if (lose) { lose = false; return { status: 500, json: null }; }
        return { status: 200, json: row };
      }
      throw new Error(`unexpected endpoint: ${path}`);
    });
    await expect(publishBlueskyPosts(api, "did:plc:test", posts)).rejects.toThrow();
    const result = await publishBlueskyPosts(api, "did:plc:test", posts);
    expect(writes).toBe(2);
    expect(rows.size).toBe(2);
    expect(result.urls).toHaveLength(2);
    const replyKey = await blueskyRecordKey("did:plc:test", posts[1]);
    const rootKey = await blueskyRecordKey("did:plc:test", posts[0]);
    const reply = rows.get(replyKey)!.value.reply as { root: { uri: string }; parent: { uri: string } };
    expect(reply.root.uri).toBe(rows.get(rootKey)!.uri);
    expect(reply.parent.uri).toBe(rows.get(rootKey)!.uri);
    await expect(publishBlueskyPosts(api, "did:plc:test", posts)).resolves.toMatchObject({ urls: result.urls });
    expect(writes).toBe(2);
  });

  it("never creates when verification cannot be read", async () => {
    let posts503 = 0;
    const api = fakeApi(method => {
      if (method === "post") posts503 += 1;
      return { status: 503, json: null };
    });
    await expect(publishBlueskyPosts(api, "did:plc:test", [{ id: "p", text: "hello", createdAt: "2026-10-14T00:00:00.000Z", parent: "" }])).rejects.toThrow();
    expect(posts503).toBe(0);
  });

  it("rejects an existing record that differs from the preview", async () => {
    const key = await blueskyRecordKey("did:plc:test", posts[0]);
    const api = fakeApi((_method, path) => {
      if (path === "com.atproto.repo.getRecord") {
        return { status: 200, json: { uri: `at://did:plc:test/app.bsky.feed.post/${key}`, cid: key, value: { $type: "app.bsky.feed.post", text: "different", createdAt: "2026-01-01T00:00:00.000Z" } } };
      }
      throw new Error(`unexpected endpoint: ${path}`);
    });
    await expect(publishBlueskyPosts(api, "did:plc:test", [posts[0]])).rejects.toThrow("differs from this preview");
  });

  it("asks to reconnect on expired authorization", async () => {
    const api = fakeApi(() => ({ status: 401, json: { error: "ExpiredToken" } }));
    await expect(publishBlueskyPosts(api, "did:plc:test", [posts[0]])).rejects.toThrow("Reconnect Bluesky");
  });

  it("uploads images as blobs and embeds them on the record", async () => {
    const uploads: string[] = [];
    const key = await blueskyRecordKey("did:plc:test", { ...posts[0], images: [{ data: "eA==", mime: "image/jpeg", alt: "pic" }] });
    let created: Record<string, unknown> | null = null;
    const api = fakeApi((_method, path, body) => {
      if (path === "com.atproto.repo.getRecord") return { status: 400, json: { error: "RecordNotFound" } };
      if (path === "com.atproto.repo.uploadBlob") { uploads.push(String((body as ArrayBuffer).byteLength)); return { status: 200, json: { blob: { $type: "blob", mimeType: "image/jpeg", size: 1 } } }; }
      if (path === "com.atproto.repo.createRecord") { created = (body as { record: Record<string, unknown> }).record; return { status: 200, json: { uri: `at://did:plc:test/app.bsky.feed.post/${key}`, cid: key } }; }
      throw new Error(`unexpected endpoint: ${path}`);
    });
    const result = await publishBlueskyPosts(api, "did:plc:test", [{ ...posts[0], images: [{ data: "eA==", mime: "image/jpeg", alt: "pic" }] }]);
    expect(uploads).toEqual(["1"]);
    expect(result.urls[0]).toBe(`https://bsky.app/profile/did:plc:test/post/${key}`);
    const embed = (created as unknown as { embed: { images: { alt: string }[] } }).embed;
    expect(embed.images[0].alt).toBe("pic");
  });
});

describe("picture posts", () => {
  it("suggests pictures for markup plain text cannot carry", () => {
    expect(blueskyPrefersImage("```js\nlet a = 1;\n```")).toBe(true);
    expect(blueskyPrefersImage("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(blueskyPrefersImage("> [!note] Remember\n> this")).toBe(true);
    expect(blueskyPrefersImage("> [!calendar] Calendar event · 2026-10-14")).toBe(false);
    expect(blueskyPrefersImage("Just **words** and https://example.com")).toBe(false);
  });

  it("captions with only the links the picture cannot make clickable", () => {
    expect(blueskyImageCaption(`${"word ".repeat(60)}\n\n[docs](https://example.com/docs) https://example.com/docs https://example.org`))
      .toBe("https://example.com/docs\nhttps://example.org");
    expect(blueskyImageCaption("| a |\n| --- |")).toBe("");
  });

  it("publishes rendered pages four per post and falls back to text when rendering fails", async () => {
    const page = { data: "eA==", mime: "image/jpeg", alt: "page" };
    const entries = [entry("table", "| a |\n| --- |"), entry("reply", "plain reply", "table"), entry("broken", "```\nx\n```", "reply")];
    const preview = await buildBlueskyPreview(entries, new Set(["table", "reply", "broken"]), image, {
      ids: new Set(["table", "broken"]),
      render: async item => item.id === "table" ? Array(6).fill(page) : null,
    });
    expect(preview.map(post => post.images?.length ?? 0)).toEqual([4, 2, 0, 0]);
    expect(preview[1].parent).toBe(preview[0].id);
    expect(preview[1].text).toBe("");
    expect(preview[2]).toMatchObject({ text: "plain reply", parent: preview[1].id });
    expect(preview[3].text).toBe("x");
    expect(validateBlueskyPosts(preview)).toBeNull();
  });
});
