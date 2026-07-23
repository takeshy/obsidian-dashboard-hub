import { TFile, type Vault } from "obsidian";
import { ensureVaultFolder } from "./dashboardFile";
import { DASHBOARD_FOLDER } from "./types";

const SEPARATOR_RE = /^\s*---\s*\r?\n(?=(?:<!--\s*timeline-post:|\d{4}-\d{2}-\d{2}T))/m;

export function sanitizeTimelineName(value: string): string {
  return value.trim().replace(/\.md$/i, "").replace(/[\\/:*?"<>|#[\]\n\r\t]+/g, "-")
    .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "Timeline";
}

function dayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timelineDir(name: string, baseDirectory = DASHBOARD_FOLDER): string {
  return `${baseDirectory}/Timeline/${sanitizeTimelineName(name)}`;
}

function blocks(content: string): string[] {
  return content.split(SEPARATOR_RE).map((block) => block.trim()).filter(Boolean);
}

function entryCreatedAt(block: string): Date | null {
  const marker = block.match(/<!--\s*timeline-post:\s*([^>]+?)\s*-->/)?.[1]?.trim();
  const firstLine = block.split(/\r?\n/, 1)[0]?.trim();
  const value = marker || firstLine;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Read activity by creation day, including Calendar events stored under a
 * future scheduled date. This is the canonical AI-facing Timeline query. */
export async function readTimelineEntriesForDay(vault: Vault, timelineName: string, day: string, baseDirectory = DASHBOARD_FOLDER): Promise<string[]> {
  const dir = timelineDir(timelineName, baseDirectory);
  const prefix = `${dir}/`;
  const files = vault.getMarkdownFiles().filter((file) =>
    file.path.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.path.slice(prefix.length)),
  );
  const entries: Array<{ createdAt: number; block: string }> = [];
  for (const file of files) {
    for (const block of blocks(await vault.read(file))) {
      const createdAt = entryCreatedAt(block);
      if (createdAt && dayKey(createdAt) === day) entries.push({ createdAt: createdAt.getTime(), block });
    }
  }
  return entries.sort((a, b) => a.createdAt - b.createdAt).map((entry) => entry.block);
}

async function writeBlocks(vault: Vault, file: TFile, next: string[]): Promise<void> {
  await vault.modify(file, next.length ? `${next.join("\n\n---\n\n")}\n` : "");
}

export async function appendTimelineEntry(vault: Vault, timelineName: string, body: string, date = new Date(), baseDirectory = DASHBOARD_FOLDER): Promise<void> {
  const dir = timelineDir(timelineName, baseDirectory);
  await ensureVaultFolder(vault, dir);
  const path = `${dir}/${dayKey(date)}.md`;
  const now = new Date();
  const block = `${now.toISOString()}\nid: timeline-${now.getTime().toString(36)}\n\n${body.trim()}`;
  const existing = vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const current = (await vault.read(existing)).trim();
    await vault.modify(existing, `${current}${current ? "\n\n---\n\n" : ""}${block}\n`);
  } else await vault.create(path, `${block}\n`);
}

export async function moveCalendarEvent(vault: Vault, timelineName: string, postId: string, nextDate: string, baseDirectory = DASHBOARD_FOLDER): Promise<boolean> {
  const dir = timelineDir(timelineName, baseDirectory);
  const prefix = `${dir}/`;
  const files = vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.path.slice(prefix.length)));
  let found = "";
  for (const file of files) {
    const current = await vault.read(file);
    const parsed = blocks(current);
    const index = parsed.findIndex((block) => new RegExp(`^id:\\s*${postId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "mi").test(block));
    if (index < 0) continue;
    found = parsed[index]
      .replace(/<!--\s*calendar-event:\s*\d{4}-\d{2}-\d{2}\s*-->/i, `<!-- calendar-event: ${nextDate} -->`)
      .replace(/(> \[!calendar\][^\n]*?·\s*)\d{4}-\d{2}-\d{2}/, `$1${nextDate}`);
    parsed.splice(index, 1);
    await writeBlocks(vault, file, parsed);
    break;
  }
  if (!found) return false;
  await ensureVaultFolder(vault, dir);
  const path = `${dir}/${nextDate}.md`;
  const target = vault.getAbstractFileByPath(path);
  if (target instanceof TFile) {
    const current = (await vault.read(target)).trim();
    await vault.modify(target, `${current}${current ? "\n\n---\n\n" : ""}${found}\n`);
  } else await vault.create(path, `${found}\n`);
  return true;
}
