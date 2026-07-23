import { describe, expect, it, vi } from "vitest";
import * as yaml from "yaml";
import { TFolder, type Vault } from "obsidian";
import { dashboardPath, ensureVaultFolder, migrateDashboardKanbanWidgetsToFiles, migrateDashboardWidgets, parseDashboard } from "./dashboardFile";
import { normalizeBaseDirectory } from "./types";

vi.mock("obsidian", async () => {
  const yaml = await import("yaml");
  class MockTFolder {
    path = "";
    name = "";
  }
  return {
    TFolder: MockTFolder,
    parseYaml: (source: string) => yaml.parse(source),
    stringifyYaml: (value: unknown) => yaml.stringify(value),
  };
});

function folder(path: string): TFolder {
  const f = new TFolder();
  f.path = path;
  f.name = path.split("/").pop() ?? path;
  return f;
}

function makeVault(options?: {
  folders?: string[];
  files?: string[];
  raceOnCreate?: string[];
}) {
  const folders = new Set(options?.folders ?? []);
  const files = new Set(options?.files ?? []);
  const fileContents = new Map<string, string>();
  const raceOnCreate = new Set(options?.raceOnCreate ?? []);
  const created: string[] = [];
  const createdFiles: Array<{ path: string; content: string }> = [];

  const vault = {
    getAbstractFileByPath: (path: string) => {
      if (folders.has(path)) return folder(path);
      if (files.has(path)) return { path };
      return null;
    },
    getFolderByPath: (path: string) => folders.has(path) ? folder(path) : null,
    create: async (path: string, content: string) => {
      if (folders.has(path) || files.has(path)) throw new Error(`already exists: ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !folders.has(parent)) throw new Error(`missing parent: ${parent}`);
      files.add(path);
      fileContents.set(path, content);
      createdFiles.push({ path, content });
    },
    createFolder: async (path: string) => {
      if (folders.has(path) || files.has(path)) throw new Error(`already exists: ${path}`);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (parent && !folders.has(parent)) throw new Error(`missing parent: ${parent}`);
      folders.add(path);
      if (raceOnCreate.has(path)) throw new Error(`created concurrently: ${path}`);
      created.push(path);
    },
  } as unknown as Vault;

  return { vault, folders, files, fileContents, created, createdFiles };
}

describe("ensureVaultFolder", () => {
  it("creates nested folders one segment at a time", async () => {
    const { vault, folders, created } = makeVault();

    await ensureVaultFolder(vault, "Dashboards/Data");

    expect([...folders]).toEqual(["Dashboards", "Dashboards/Data"]);
    expect(created).toEqual(["Dashboards", "Dashboards/Data"]);
  });

  it("keeps folders that already exist in the Vault", async () => {
    const { vault, created } = makeVault({
      folders: ["Dashboards", "Dashboards/Data"],
    });

    await expect(ensureVaultFolder(vault, "Dashboards/Data")).resolves.toBeUndefined();
    expect(created).toEqual([]);
  });

  it("accepts a folder created concurrently after the initial lookup", async () => {
    const { vault, created } = makeVault({
      folders: ["Dashboards"],
      raceOnCreate: ["Dashboards/Data"],
    });

    await expect(ensureVaultFolder(vault, "Dashboards/Data")).resolves.toBeUndefined();
    expect(created).toEqual([]);
  });
});

describe("configurable base directory", () => {
  it("defaults empty values to Dashboards and normalizes nested paths", () => {
    expect(normalizeBaseDirectory(undefined)).toBe("Dashboards");
    expect(normalizeBaseDirectory(" /Workspace//Dashboards/ ")).toBe("Workspace/Dashboards");
    expect(normalizeBaseDirectory("../Workspace/./Dashboards")).toBe("Workspace/Dashboards");
    expect(dashboardPath("Home", "Workspace")).toBe("Workspace/Home.dashboard");
  });

  it("stores migrated Kanban definitions below the configured directory", async () => {
    const { vault, createdFiles } = makeVault();
    await migrateDashboardKanbanWidgetsToFiles(vault, {
      version: 1,
      grid: { cols: 12, rowHeight: 80, gap: 8 },
      widgets: [{ id: "tasks", type: "kanban", layout: {}, config: { title: "Tasks" } }],
    }, "Workspace");

    expect(createdFiles[0]?.path).toBe("Workspace/Kanbans/Tasks.kanban");
  });
});

describe("dashboard widget migrations", () => {
  it("migrates legacy markdown widgets to file widgets", () => {
    const widgets = migrateDashboardWidgets([{
      id: "readme",
      type: "markdown",
      layout: { lg: { x: 0, y: 0, w: 6, h: 4 } },
      config: { path: "Home.md" },
    }]);

    expect(widgets[0].type).toBe("file");
    expect(widgets[0].config).toEqual({ path: "Home.md" });
  });

  it("parses legacy markdown widgets as file widgets", () => {
    const parsed = parseDashboard(`
version: 1
grid:
  cols: 12
  rowHeight: 72
  gap: 8
widgets:
  - id: note
    type: markdown
    layout:
      lg:
        x: 0
        y: 0
        w: 6
        h: 3
    config:
      path: Notes/example.md
`);

    expect(parsed?.widgets[0]?.type).toBe("file");
    expect(parsed?.widgets[0]?.config).toEqual({ path: "Notes/example.md" });
  });

  it("moves inline kanban widget settings to Dashboards/Kanbans", async () => {
    const { vault, createdFiles } = makeVault();
    const migrated = await migrateDashboardKanbanWidgetsToFiles(vault, {
      version: 1,
      grid: { cols: 12, rowHeight: 80, gap: 8 },
      widgets: [{
        id: "tasks",
        type: "kanban",
        layout: { lg: { x: 0, y: 0, w: 12, h: 6 } },
        config: {
          title: "Tasks",
          statusProperty: "status",
          cardOrder: ["Tasks/A.md"],
          columns: [{ value: "todo", label: "Todo" }],
        },
      }],
    });

    expect(createdFiles).toEqual([{
      path: "Dashboards/Kanbans/Tasks.kanban",
      content: expect.any(String),
    }]);
    expect(yaml.parse(createdFiles[0].content)).toEqual({
      title: "Tasks",
      statusProperty: "status",
      columns: [{ value: "todo", label: "Todo" }],
    });
    expect(migrated?.widgets[0].config).toEqual({
      kanban: "Dashboards/Kanbans/Tasks.kanban",
      cardOrder: ["Tasks/A.md"],
    });
  });
});
