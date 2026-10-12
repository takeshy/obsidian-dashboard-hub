import type { DashboardHubPlugin, TimelineAnswerRequest } from "src/plugin";
import { TFile, type Vault } from "obsidian";
import { appendPost, postBlock, splitPosts, timelineThreads, type TimelinePost } from "./timelineThreads";
import { ensureVaultFolder } from "./dashboardFile";
import { sanitizeTimelineName } from "./timelineEvents";

/** A standalone mention; email addresses and longer handles do not invoke AI. */
export function hasAiMention(text: string): boolean {
  return /(^|[^\p{L}\p{N}_@])@ai(?=$|[^\p{L}\p{N}_-])/iu.test(text);
}

export async function generateTimelineAnswer(
  plugin: Pick<DashboardHubPlugin, "listModels">,
  posts: TimelinePost[],
  question: TimelinePost,
): Promise<string> {
  const { integration, models, defaultModelId } = await plugin.listModels("timeline-reply");
  const modelId = models.find(model => model.id === defaultModelId)?.id || models[0]?.id;
  if (!modelId) throw new Error("No text model is available for Timeline replies.");
  const messages = posts.filter(post => !post.deleted).map(post => ({
    role: post.speaker === "ai" ? "assistant" as const : "user" as const,
    content: post.content,
  }));
  const request: TimelineAnswerRequest = { modelId, messages, question: question.content };
  let answer: string;
  if (integration.answerTimeline) {
    answer = await integration.answerTimeline(request);
  } else if (integration.rewriteText) {
    // Protocol v1 Hubs expose text generation through rewriteText. Transform
    // the conversation into the assistant's answer, without modifying posts.
    answer = await integration.rewriteText({
      modelId, context: "timeline", content: JSON.stringify(messages),
      instruction: `Transform this Timeline conversation into the AI assistant's next reply answering the following user post: ${question.content}\nUse the thread as context. @ai addresses you. Return only the answer in the user's language as Markdown. Do not repeat or rewrite the user's question.`,
    });
  } else throw new Error("Connect an AI Hub with Timeline reply or text generation support.");
  if (!answer.trim()) throw new Error("AI returned an empty answer.");
  return answer.trim();
}

/** Read the complete thread and save the answer as a reply in today's file. */
export async function replyToTimelinePost(
  vault: Vault,
  plugin: Pick<DashboardHubPlugin, "listModels">,
  name: string,
  baseDirectory: string,
  question: TimelinePost,
  now = new Date(),
): Promise<TimelinePost> {
  const dir = `${baseDirectory}/Timeline/${sanitizeTimelineName(name)}`;
  const prefix = `${dir}/`;
  const all: TimelinePost[] = [];
  for (const file of vault.getMarkdownFiles().filter(file => file.path.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.path.slice(prefix.length)))) {
    all.push(...splitPosts(await vault.read(file), file.path, file));
  }
  const thread = timelineThreads(all).find(thread => [thread.root, ...thread.replies].some(post => post.id === question.id && !post.deleted));
  if (!thread) throw new Error("The Timeline question was deleted or could not be found.");
  const answer = await generateTimelineAnswer(plugin, [thread.root, ...thread.replies], question);
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await ensureVaultFolder(vault, dir);
  const path = `${dir}/${day}.md`;
  let existing = vault.getAbstractFileByPath(path);
  if (!(existing instanceof TFile)) {
    try { existing = await vault.create(path, ""); }
    catch (err) { existing = vault.getAbstractFileByPath(path); if (!(existing instanceof TFile)) throw err; }
  }
  const file = existing as TFile;
  const reply: TimelinePost = {
    ...question, metadata: {}, id: `ai-${crypto.randomUUID()}`, createdAt: now.toISOString(),
    sourcePath: path, sourceFile: file, content: answer, pinned: false, deleted: false,
    rootId: thread.root.id, replyTo: question.id, speaker: "ai",
  };
  await vault.process(file, current => appendPost(current, postBlock(reply)));
  return reply;
}
