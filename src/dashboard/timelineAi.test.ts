import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type Vault } from "obsidian";
import type { DashboardAiIntegration, DashboardAiModel } from "src/plugin";
import { generateTimelineAnswer, hasAiMention, replyToTimelinePost } from "./timelineAi";
import { appendPost, splitPosts } from "./timelineThreads";

const path = "Workspace/Timeline/Timeline/2026-10-11.md";
const file = new TFile(); file.path = path;
const text = "2026-10-11T01:00:00.000Z\nid: question\n\n@ai Explain this";
const [question] = splitPosts(text, path, file);
const model: DashboardAiModel = { id: "model", name: "Model", capabilities: { text: true, vaultRead: false, tools: false } };
function provider(overrides: Partial<DashboardAiIntegration> = {}) {
  const integration: DashboardAiIntegration = {
    protocolVersion: 1, id: "hub", name: "Hub", listModels: async () => [model], getDefaultModel: async () => model.id,
    rewriteText: vi.fn(async () => "Answer"), ...overrides,
  };
  return { integration, plugin: { listModels: vi.fn(async () => ({ integration, models: [model], defaultModelId: model.id })) } };
}
function makeVault() {
  const contents = new Map([[path, text]]);
  const files = new Map([[path, file]]);
  const vault = {
    adapter: { stat: async () => ({ type: "folder" }) },
    getMarkdownFiles: () => [...files.values()],
    getAbstractFileByPath: (path: string) => files.get(path) || Object.assign(new TFolder(), { path }),
    create: async (path: string, content: string) => { const file = Object.assign(new TFile(), { path }); files.set(path, file); contents.set(path, content); return file; },
    read: async (file: TFile) => contents.get(file.path) || "",
    process: async (file: TFile, fn: (text: string) => string) => { contents.set(file.path, fn(contents.get(file.path) || "")); },
  } as unknown as Vault;
  return { vault, contents, files };
}

describe("Timeline @ai replies", () => {
  it("recognizes standalone mentions without matching email addresses or other handles", () => {
    for (const text of ["@ai question", "hello @AI", "（@ai）質問", "@ai、質問"]) expect(hasAiMention(text)).toBe(true);
    for (const text of ["user@ai.example", "@aide", "@@ai", "@ai-bot", "普通の投稿"]) expect(hasAiMention(text)).toBe(false);
  });

  it("passes conversation roles and the question to the optional answer API", async () => {
    const answerTimeline = vi.fn(async () => " Answer ");
    const { plugin, integration } = provider({ answerTimeline });
    expect(await generateTimelineAnswer(plugin, [question, { ...question, speaker: "ai", content: "Earlier answer" }], question)).toBe("Answer");
    expect(plugin.listModels).toHaveBeenCalledWith("timeline-reply");
    expect(answerTimeline).toHaveBeenCalledWith({ modelId: "model", question: question.content, messages: [{ role: "user", content: question.content }, { role: "assistant", content: "Earlier answer" }] });
    expect(integration.rewriteText).not.toHaveBeenCalled();
  });

  it("uses existing v1 Hub text generation with an answer instruction and valid model", async () => {
    const { plugin, integration } = provider();
    plugin.listModels.mockResolvedValueOnce({ integration, models: [model], defaultModelId: "removed-model" });
    expect(await generateTimelineAnswer(plugin, [question], question)).toBe("Answer");
    expect(integration.rewriteText).toHaveBeenCalledWith(expect.objectContaining({ modelId: "model", context: "timeline", instruction: expect.stringContaining("assistant's next reply"), content: expect.stringContaining("Explain this") }));
  });

  it("saves the AI reply on a later day with root and direct-parent metadata, preserving concurrent posts", async () => {
    const { vault, contents, files } = makeVault();
    const { plugin } = provider({ rewriteText: async () => {
      const today = "Workspace/Timeline/Timeline/2026-10-12.md";
      await vault.create(today, "2026-10-12T00:00:00.000Z\nid: other\n\nConcurrent post");
      return "AI answer";
    } });
    const reply = await replyToTimelinePost(vault, plugin, "Timeline", "Workspace", question, new Date(2026, 9, 12, 10));
    expect(contents.get(path)).toBe(text);
    const posts = splitPosts(contents.get(reply.sourcePath)!, reply.sourcePath, files.get(reply.sourcePath)!);
    expect(posts).toHaveLength(2);
    expect(posts[0].content).toBe("Concurrent post");
    expect(posts[1]).toMatchObject({ content: "AI answer", speaker: "ai", rootId: "question", replyTo: "question" });
  });

  it("uses all thread days but excludes unrelated posts and attachments from AI context", async () => {
    const { vault, contents, files } = makeVault();
    const replyPath = "Workspace/Timeline/Timeline/2026-10-12.md";
    const input = "2026-10-12T01:00:00.000Z\nid: followup\nroot-id: question\nreply-to: question\n\n@ai Follow up";
    await vault.create(replyPath, appendPost(input, text.replace("id: question", "id: other").replace("Explain this", "Unrelated")));
    await vault.create("Workspace/Timeline/Other/2026-10-11.md", text);
    const [followup] = splitPosts(input, replyPath, files.get(replyPath)!);
    const { plugin, integration } = provider({ answerTimeline: vi.fn(async () => "Follow-up answer") });
    await replyToTimelinePost(vault, plugin, "Timeline", "Workspace", followup, new Date(2026, 9, 13));
    expect(integration.answerTimeline).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: "user", content: question.content }, { role: "user", content: "@ai Follow up" }] }));
    expect(contents.get(path)).toBe(text);
  });

  it("leaves the question saved after AI failure and allows retry", async () => {
    const { vault, contents } = makeVault();
    const { plugin, integration } = provider({ rewriteText: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("Recovered") });
    await expect(replyToTimelinePost(vault, plugin, "Timeline", "Workspace", question)).rejects.toThrow("offline");
    expect(contents.get(path)).toBe(text);
    expect(contents.size).toBe(1);
    await expect(replyToTimelinePost(vault, plugin, "Timeline", "Workspace", question)).resolves.toMatchObject({ content: "Recovered" });
    expect(integration.rewriteText).toHaveBeenCalledTimes(2);
  });

  it("rejects empty responses, missing models and deleted questions", async () => {
    const { plugin, integration } = provider({ rewriteText: async () => " " });
    await expect(generateTimelineAnswer(plugin, [question], question)).rejects.toThrow("empty answer");
    plugin.listModels.mockResolvedValueOnce({ integration, models: [], defaultModelId: "" });
    await expect(generateTimelineAnswer(plugin, [question], question)).rejects.toThrow("No text model");
    const { vault, contents } = makeVault(); contents.set(path, "");
    await expect(replyToTimelinePost(vault, plugin, "Timeline", "Workspace", question)).rejects.toThrow("deleted");
  });
});
