import { describe, expect, it } from "vitest";
import { TFile, TFolder, type Vault } from "obsidian";
import { appendTimelineEntry, moveCalendarEvent, readTimelineEntriesForDay, sanitizeTimelineName } from "./timelineEvents";

function file(path: string): TFile {
  const result = new TFile();
  result.path = path;
  result.name = path.split("/").pop() ?? path;
  result.basename = result.name.replace(/\.md$/, "");
  result.extension = "md";
  return result;
}

function folder(path: string): TFolder {
  const result = new TFolder();
  result.path = path;
  result.name = path.split("/").pop() ?? path;
  return result;
}

function makeVault(initial: Record<string, string> = {}) {
  const contents = new Map(Object.entries(initial));
  const folders = new Set<string>();
  for (const path of contents.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) folders.add(parts.slice(0, index).join("/"));
  }
  const vault = {
    adapter: {
      stat: async (path: string) => folders.has(path) ? { type: "folder" } : contents.has(path) ? { type: "file" } : null,
    },
    getAbstractFileByPath: (path: string) => folders.has(path) ? folder(path) : contents.has(path) ? file(path) : null,
    getMarkdownFiles: () => [...contents.keys()].filter((path) => path.endsWith(".md")).map(file),
    createFolder: async (path: string) => { folders.add(path); },
    create: async (path: string, content: string) => { contents.set(path, content); return file(path); },
    read: async (target: TFile) => contents.get(target.path) ?? "",
    modify: async (target: TFile, content: string) => { contents.set(target.path, content); },
  } as unknown as Vault;
  return { vault, contents };
}

describe("Timeline activity events", () => {
  it("sanitizes Timeline names and appends entries to the selected day", async () => {
    const { vault, contents } = makeVault();
    const day = new Date(2026, 6, 23, 9, 0, 0);

    await appendTimelineEntry(vault, "My / Timeline", "Memo created", day);
    await appendTimelineEntry(vault, "My / Timeline", "Kanban moved", day);

    const content = contents.get("Dashboards/Timeline/My-Timeline/2026-07-23.md") ?? "";
    expect(sanitizeTimelineName("My / Timeline.md")).toBe("My-Timeline");
    expect(content).toContain("Memo created");
    expect(content).toContain("Kanban moved");
    expect(content).toContain("\n\n---\n\n");
  });

  it("stores entries below the configured base directory", async () => {
    const { vault, contents } = makeVault();
    const day = new Date(2026, 6, 23, 9, 0, 0);

    await appendTimelineEntry(vault, "Timeline", "Custom root", day, "Workspace");

    expect(contents.get("Workspace/Timeline/Timeline/2026-07-23.md")).toContain("Custom root");
  });

  it("moves a calendar event to its new scheduled day", async () => {
    const oldPath = "Dashboards/Timeline/Timeline/2026-07-23.md";
    const { vault, contents } = makeVault({
      [oldPath]: "2026-07-23T01:00:00.000Z\nid: calendar-event-1\n\n<!-- calendar-event: 2026-07-23 -->\n> [!calendar] Event · 2026-07-23\n> Review\n",
    });

    await expect(moveCalendarEvent(vault, "Timeline", "calendar-event-1", "2026-07-25")).resolves.toBe(true);

    expect(contents.get(oldPath)).toBe("");
    const moved = contents.get("Dashboards/Timeline/Timeline/2026-07-25.md") ?? "";
    expect(moved).toContain("<!-- calendar-event: 2026-07-25 -->");
    expect(moved).toContain("Event · 2026-07-25");
  });

  it("finds activity by creation date even when an event is stored on a future date", async () => {
    const { vault } = makeVault({
      "Dashboards/Timeline/Timeline/2026-07-23.md": "2026-07-23T01:00:00.000Z\nid: memo-1\n\nMemo created\n",
      "Dashboards/Timeline/Timeline/2026-07-30.md": "2026-07-23T02:00:00.000Z\nid: event-1\n\n<!-- calendar-event: 2026-07-30 -->\n> Planned review\n",
      "Dashboards/Timeline/Timeline/2026-07-24.md": "2026-07-24T01:00:00.000Z\nid: other\n\nNot today\n",
    });

    const entries = await readTimelineEntriesForDay(vault, "Timeline", "2026-07-23");
    expect(entries).toHaveLength(2);
    expect(entries.join("\n")).toContain("Memo created");
    expect(entries.join("\n")).toContain("Planned review");
    expect(entries.join("\n")).not.toContain("Not today");
  });
});
