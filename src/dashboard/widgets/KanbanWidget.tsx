// Kanban widget — renders notes as cards grouped into columns by a frontmatter
// status property. Drag cards between columns to update the status (writes via
// processFrontMatter). Click a card to open the note. Works in view mode.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CalendarDays, CheckSquare, Paperclip, Plus, Sparkles, X } from "lucide-react";
import { Notice, TFile, type App } from "obsidian";
import { t } from "src/i18n";
import type { WidgetContext } from "../types";
import { ensureVaultFolder } from "../dashboardFile";
import { KanbanCardModal } from "./KanbanCardModal";
import { KanbanTaskModal, type KanbanTaskInput } from "./KanbanTaskModal";
import {
  canPreviewKanbanAttachment,
  downloadKanbanAttachment,
  KanbanAttachmentModal,
} from "./KanbanAttachmentModal";
import { parseKanbanFile, type KanbanBoardDefinition } from "../kanbanFile";
import {
  isCompletionColumn,
  parseKanbanTaskBody,
  serializeKanbanTaskBody,
  type KanbanAttachment,
} from "../kanbanTask";
import { KANBAN_AI_SOURCE, parseKanbanAiTasks } from "../kanbanAi";
import { appendTimelineEntry } from "../timelineEvents";
import { AiGenerationModal } from "src/ui/AiGenerationModal";
import ObsidianMarkdown from "./ObsidianMarkdown";

interface KanbanColumn {
  value: string;
  label: string;
}

interface KanbanDisplayField {
  field: string;
  label?: string;
  maxLength?: number;
}

interface KanbanConfig {
  kanban?: string;
  title?: string;
  tag?: string;
  folder?: string;
  statusProperty?: string;
  titleProperty?: string;
  dueProperty?: string;
  startedProperty?: string;
  completedProperty?: string;
  columns?: KanbanColumn[];
  showUnspecified?: boolean;
  /** Frontmatter property names shown on each card below the title. */
  displayFields?: Array<string | KanbanDisplayField>;
  /** Stable card path order used for vertical ordering inside columns. */
  cardOrder?: string[];
}

interface Card {
  file: TFile;
  title: string;
  status: string;
  path: string;
  fields: { field: string; label: string; value: string }[];
  tags: string[];
  due: string;
  started: string;
  completed: string;
  checklistDone: number;
  checklistTotal: number;
  attachmentCount: number;
  attachments: KanbanAttachment[];
}

type FrontmatterRecord = Record<string, unknown>;
type DropPosition = "before" | "after";
type DropTarget = { column: string; path: string; position: DropPosition } | null;

function asFrontmatterRecord(value: unknown): FrontmatterRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as FrontmatterRecord : {};
}

/** Format a single scalar frontmatter value; objects and nullish return "". */
function formatScalar(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return "";
}

/** Format a frontmatter value for display on a card. Returns "" to skip. */
function formatFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((v) => formatScalar(v)).filter((s) => s.length > 0).join(", ");
  }
  return formatScalar(value);
}

function contentWithoutFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
}

function replaceBodyPreservingFrontmatter(content: string, body: string): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  return `${frontmatter}${body}`;
}

function cardFieldValue(
  file: TFile,
  frontmatter: FrontmatterRecord,
  field: string,
  fileContent?: string,
): unknown {
  if (field === "file.path") return file.path;
  if (field === "file.name") return file.name;
  if (field === "file.content") return fileContent;
  if (field === "file.mtime") return new Date(file.stat.mtime).toLocaleString();
  if (field === "file.ctime") return new Date(file.stat.ctime).toLocaleString();
  return frontmatter[field];
}

function normalizeDisplayFields(value: KanbanConfig["displayFields"]): KanbanDisplayField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const fields: KanbanDisplayField[] = [];
  for (const item of value) {
    const field = (typeof item === "string" ? item : item?.field)?.trim() ?? "";
    if (!field || seen.has(field)) continue;
    const label = typeof item === "string" ? "" : item.label?.trim() ?? "";
    const maxLength = typeof item === "string" ? undefined : item.maxLength;
    fields.push({
      field,
      label,
      maxLength: typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0
        ? Math.floor(maxLength) : undefined,
    });
    seen.add(field);
  }
  return fields;
}

function truncate(value: string, maxLength?: number): string {
  if (!maxLength || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function localIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DRAG_THRESHOLD = 4;
const UNSPECIFIED = "__unspecified__";

function normTag(tag: string): string {
  return tag.replace(/^#/, "").trim().toLowerCase();
}

// Strip characters that are illegal in vault file names so a typed card title
// can be used as the note's file name.
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
}

function getFileTags(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const tags: string[] = [];
  const frontmatter = asFrontmatterRecord(cache.frontmatter);
  const fmTags = frontmatter.tags;
  if (fmTags) {
    if (Array.isArray(fmTags)) {
      tags.push(...fmTags.map((t) => (typeof t === "string" && t.startsWith("#") ? t : `#${t}`)));
    } else if (typeof fmTags === "string") {
      tags.push(fmTags.startsWith("#") ? fmTags : `#${fmTags}`);
    }
  }
  if (cache.tags) {
    tags.push(...cache.tags.map((tc) => tc.tag));
  }
  return [...new Set(tags)];
}

export default function KanbanWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const cfg = (config ?? {}) as KanbanConfig;
  const kanbanPath = (cfg.kanban ?? "").trim();
  const [fileDefinition, setFileDefinition] = useState<KanbanBoardDefinition | null>(null);
  const [fileError, setFileError] = useState(false);
  useEffect(() => {
    if (!ctx || !kanbanPath) { setFileDefinition(null); setFileError(false); return; }
    let cancelled = false;
    const load = async () => {
      const file = ctx.app.vault.getAbstractFileByPath(kanbanPath);
      if (!(file instanceof TFile)) {
        if (!cancelled) { setFileDefinition(null); setFileError(true); }
        return;
      }
      try {
        const parsed = parseKanbanFile(await ctx.app.vault.cachedRead(file));
        if (!cancelled) { setFileDefinition(parsed); setFileError(parsed === null); }
      } catch {
        if (!cancelled) { setFileDefinition(null); setFileError(true); }
      }
    };
    void load();
    const refs = [
      ctx.app.vault.on("modify", (file) => { if (file.path === kanbanPath) void load(); }),
      ctx.app.vault.on("delete", (file) => { if (file.path === kanbanPath) void load(); }),
      ctx.app.vault.on("rename", (file, oldPath) => { if (oldPath === kanbanPath || file.path === kanbanPath) void load(); }),
    ];
    return () => {
      cancelled = true;
      refs.forEach((ref) => ctx.app.vault.offref(ref));
    };
  }, [ctx, kanbanPath]);
  const def = (kanbanPath ? fileDefinition ?? {} : cfg) as KanbanConfig;
  const boardTitle = (def.title ?? "").trim();
  const kanbanName = boardTitle || kanbanPath.split("/").pop()?.replace(/\.kanban$/i, "") || "Kanban";
  const tagFilter = normTag(def.tag ?? "");
  const folderFilter = (def.folder ?? "").trim();
  const statusProp = (def.statusProperty ?? "status").trim() || "status";
  const titleProp = (def.titleProperty ?? "").trim();
  const dueProp = (def.dueProperty ?? "due").trim() || "due";
  const startedProp = (def.startedProperty ?? "started").trim() || "started";
  const completedProp = (def.completedProperty ?? "completed").trim() || "completed";
  const displayFields = normalizeDisplayFields(def.displayFields);
  const columns = Array.isArray(def.columns) ? def.columns.filter((c) => c && typeof c.value === "string") : [];
  const showUnspecified = def.showUnspecified !== false;

  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((v) => v + 1), []);
  useEffect(() => {
    if (!ctx) return;
    const workspace = ctx.app.workspace as unknown as {
      on: (name: string, callback: () => void) => { id: string };
      offref: (ref: { id: string }) => void;
    };
    const ref = workspace.on("dashboard-hub:integrations-changed", rerender);
    return () => workspace.offref(ref);
  }, [ctx, rerender]);

  // Filter descriptor so vault listeners use the latest filter values.
  const filterKey = `${folderFilter}|${tagFilter}`;
  useEffect(() => {
    if (!ctx) return;
    const app = ctx.app;
    let last = 0;
    let timer: number | null = null;
    // Throttle with a trailing edge so the final event in a burst still fires a
    // re-render. Creating a card emits "create" (no frontmatter yet) immediately
    // followed by "changed" (status written); dropping the trailing "changed"
    // would leave the new card stuck in the Unspecified column.
    const schedule = () => {
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed >= 200) {
        last = now;
        rerender();
      } else if (timer == null) {
        timer = window.setTimeout(() => {
          timer = null;
          last = Date.now();
          rerender();
        }, 200 - elapsed);
      }
    };
    const refs = [
      app.metadataCache.on("changed", () => {
        // A metadata change can remove the tag/status that made a card visible.
        // Re-render even when the updated cache no longer matches the filter so
        // stale cards disappear immediately.
        schedule();
      }),
      app.metadataCache.on("deleted", schedule),
      app.vault.on("create", schedule),
      app.vault.on("delete", schedule),
      app.vault.on("rename", schedule),
    ];
    return () => {
      if (timer != null) window.clearTimeout(timer);
      refs.forEach((r) => {
        app.metadataCache.offref(r);
        app.vault.offref(r);
      });
    };
    }, [ctx, rerender, filterKey]);

  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!ctx) {
      setFileContents({});
      return;
    }
    let cancelled = false;
    const matchesBoard = (file: TFile) => {
      if (file.extension.toLocaleLowerCase() !== "md") return false;
      if (folderFilter) {
        const folder = folderFilter.replace(/[/\\]+$/, "").toLocaleLowerCase();
        if (!file.path.toLocaleLowerCase().startsWith(`${folder}/`)) return false;
      }
      return !tagFilter || getFileTags(ctx.app, file).some((tag) => normTag(tag) === tagFilter);
    };
    const load = async (file: TFile) => {
      const content = contentWithoutFrontmatter(await ctx.app.vault.cachedRead(file));
      if (!cancelled) setFileContents((previous) => ({ ...previous, [file.path]: content }));
    };
    const files = ctx.app.vault.getMarkdownFiles().filter(matchesBoard);
    setFileContents({});
    void Promise.all(files.map(load));
    const refs = [
      ctx.app.vault.on("modify", (file) => {
        if (file instanceof TFile && matchesBoard(file)) void load(file);
      }),
      ctx.app.vault.on("rename", (file, oldPath) => {
        setFileContents((previous) => {
          const next = { ...previous };
          delete next[oldPath];
          return next;
        });
        if (file instanceof TFile && matchesBoard(file)) void load(file);
      }),
      ctx.app.vault.on("delete", (file) => {
        setFileContents((previous) => {
          const next = { ...previous };
          delete next[file.path];
          return next;
        });
      }),
    ];
    return () => {
      cancelled = true;
      refs.forEach((ref) => ctx.app.vault.offref(ref));
    };
  }, [ctx, folderFilter, tagFilter]);

  const cards: Card[] = ctx
    ? (() => {
        const app = ctx.app;
        let files = app.vault.getMarkdownFiles();
        if (folderFilter) {
          const normalizedFolder = folderFilter.replace(/[/\\]+$/, "").toLowerCase();
          const prefix = `${normalizedFolder}/`;
          files = files.filter((f) => f.path.toLowerCase().startsWith(prefix));
        }
        if (tagFilter) {
          files = files.filter((f) => getFileTags(app, f).some((tg) => normTag(tg) === tagFilter));
        }
        return files.map((file) => {
          const cache = app.metadataCache.getFileCache(file);
          const fm = asFrontmatterRecord(cache?.frontmatter);
          const rawStatus = fm?.[statusProp];
          const status = formatScalar(rawStatus);
          let title = file.basename;
          if (titleProp) {
            title = formatScalar(cardFieldValue(file, fm, titleProp, fileContents[file.path])) || title;
          }
          const tags = getFileTags(app, file).map(normTag).filter(Boolean);
          const taskBody = parseKanbanTaskBody(fileContents[file.path] ?? "");
          const fields = displayFields
            .map(({ field, label, maxLength }) => {
              const raw = cardFieldValue(file, fm, field, fileContents[file.path]);
              return { field, label: label ?? "", value: truncate(formatFieldValue(raw), maxLength) };
            })
            .filter((f) => f.value.length > 0);
          return {
            file, title, status, path: file.path, fields, tags,
            due: formatScalar(fm[dueProp]),
            started: formatScalar(fm[startedProp]),
            completed: formatScalar(fm[completedProp]),
            checklistDone: taskBody.checklist.filter((item) => item.completed).length,
            checklistTotal: taskBody.checklist.length,
            attachmentCount: taskBody.attachments.length,
            attachments: taskBody.attachments,
          };
        });
      })()
    : [];

  // De-duplicate columns by value so a misconfigured board with two columns
  // sharing the same status value never renders the cards twice nor lets the
  // ref callback clobber the wrong column element.
  const uniqueColumns = useMemo(() => {
    const seen = new Set<string>();
    const out: KanbanColumn[] = [];
    for (const col of columns) {
      if (seen.has(col.value)) continue;
      seen.add(col.value);
      out.push(col);
    }
    return out;
  }, [columns]);
  const columnValues = useMemo(() => new Set(uniqueColumns.map((c) => c.value)), [uniqueColumns]);
  const [cardOrder, setCardOrder] = useState<string[]>(
    Array.isArray(cfg.cardOrder) ? cfg.cardOrder.filter((id): id is string => typeof id === "string") : [],
  );
  useEffect(() => {
    setCardOrder(Array.isArray(cfg.cardOrder) ? cfg.cardOrder.filter((id): id is string => typeof id === "string") : []);
  }, [cfg.cardOrder]);
  const tagOptions = useMemo(() => Array.from(new Set(cards.flatMap((card) => card.tags))).sort(), [cards]);
  const [selectedTag, setSelectedTag] = useState("");
  useEffect(() => {
    if (selectedTag && !tagOptions.includes(selectedTag)) setSelectedTag("");
  }, [selectedTag, tagOptions]);
  const visibleCards = selectedTag ? cards.filter((card) => card.tags.includes(selectedTag)) : cards;
  const orderedCards = useMemo(() => {
    const orderMap = new Map(cardOrder.map((path, index) => [path, index]));
    return [...visibleCards].sort((a, b) => {
      const ai = orderMap.get(a.path);
      const bi = orderMap.get(b.path);
      if (ai == null && bi == null) return a.path.localeCompare(b.path);
      if (ai == null) return 1;
      if (bi == null) return -1;
      return ai - bi;
    });
  }, [visibleCards, cardOrder]);
  const grouped = new Map<string, Card[]>();
  for (const col of uniqueColumns) {
    grouped.set(col.value, []);
  }
  const unspecified: Card[] = [];
  for (const card of orderedCards) {
    if (columnValues.has(card.status)) {
      grouped.get(card.status)!.push(card);
    } else {
      unspecified.push(card);
    }
  }

  const [drag, setDrag] = useState<{ card: Card; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  // Path of the card that just landed in a new column — used to flash it so the
  // user can see where the card moved to after dropping.
  const [landed, setLanded] = useState<string | null>(null);
  const landedTimer = useRef<number | null>(null);
  const columnElsRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    return () => {
      if (landedTimer.current != null) window.clearTimeout(landedTimer.current);
    };
  }, []);

  const flashLanded = useCallback((path: string) => {
    if (landedTimer.current != null) window.clearTimeout(landedTimer.current);
    setLanded(path);
    landedTimer.current = window.setTimeout(() => {
      setLanded(null);
      landedTimer.current = null;
    }, 700);
  }, []);

  const hitTestColumn = (clientX: number, clientY: number): string | null => {
    for (const [value, el] of columnElsRef.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return value;
      }
    }
    return null;
  };

  const hitTestDrop = (clientX: number, clientY: number): { column: string | null; target: DropTarget } => {
    const column = hitTestColumn(clientX, clientY);
    const cardEl = activeDocument
      .elementsFromPoint(clientX, clientY)
      .find((el): el is HTMLElement => el.instanceOf(HTMLElement) && Boolean(el.dataset.kanbanCardPath));
    const path = cardEl?.dataset.kanbanCardPath;
    const cardColumn = cardEl?.dataset.kanbanColumn;
    if (!column || !path || !cardColumn || cardColumn !== column) return { column, target: null };
    const rect = cardEl.getBoundingClientRect();
    const position: DropPosition = clientY < rect.top + rect.height / 2 ? "before" : "after";
    return { column, target: { column, path, position } };
  };

  const persistCardOrder = useCallback(
    (nextOrder: string[]) => {
      setCardOrder(nextOrder);
      ctx?.onConfigChange?.({ ...cfg, cardOrder: nextOrder });
    },
    [ctx, cfg],
  );

  const columnForCard = useCallback(
    (card: Card): string => columnValues.has(card.status) ? card.status : UNSPECIFIED,
    [columnValues],
  );

  const reorderCard = useCallback(
    (path: string, target: DropTarget, fallbackColumn: string): string[] => {
      const visiblePaths = new Set(orderedCards.map((card) => card.path));
      const base = [
        ...cardOrder.filter((id) => visiblePaths.has(id)),
        ...orderedCards.map((card) => card.path).filter((id) => !cardOrder.includes(id)),
      ].filter((id) => id !== path);

      if (target?.path && target.path !== path) {
        const index = base.indexOf(target.path);
        if (index >= 0) {
          base.splice(target.position === "before" ? index : index + 1, 0, path);
          return base;
        }
      }

      const columnCards = fallbackColumn === UNSPECIFIED ? unspecified : grouped.get(fallbackColumn) ?? [];
      const lastInColumn = [...columnCards].reverse().find((card) => card.path !== path);
      if (!lastInColumn) return [path, ...base];
      const index = base.indexOf(lastInColumn.path);
      base.splice(index >= 0 ? index + 1 : base.length, 0, path);
      return base;
    },
    [cardOrder, orderedCards, grouped, unspecified],
  );

  const onCardPointerDown = useCallback(
    (e: React.PointerEvent, card: Card) => {
      if (!ctx) return;
      // In edit mode the GridCell handles drag/resize interactions on the
      // cell; let those through and don't start a competing card drag.
      if (ctx.editMode) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      let isDragging = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!isDragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          isDragging = true;
        }
        setDrag({
          card,
          x: ev.clientX,
          y: ev.clientY,
          offsetX: ev.clientX - rect.left,
          offsetY: ev.clientY - rect.top,
        });
        const hit = hitTestDrop(ev.clientX, ev.clientY);
        setDropCol(hit.column);
        setDropTarget(hit.target?.path === card.path ? null : hit.target);
      };

      const onUp = (ev: PointerEvent) => {
        activeWindow.removeEventListener("pointermove", onMove);
        activeWindow.removeEventListener("pointerup", onUp);
        if (isDragging) {
          const hit = hitTestDrop(ev.clientX, ev.clientY);
          const found = hit.column;
          const target = hit.target?.path === card.path ? null : hit.target;
          const currentCol = columnForCard(card);
          if (found != null) {
            persistCardOrder(reorderCard(card.path, target, found));
          }
          if (found != null && found !== currentCol) {
            const oldLabel = uniqueColumns.find((column) => column.value === card.status)?.label || card.status || t("dashboard.kanbanUnspecified");
            const nextStatus = found === UNSPECIFIED ? "" : found;
            const nextLabel = uniqueColumns.find((column) => column.value === nextStatus)?.label || nextStatus || t("dashboard.kanbanUnspecified");
            void ctx.app.fileManager
              .processFrontMatter(card.file, (fm) => {
                const frontmatter = fm as FrontmatterRecord;
                if (found === UNSPECIFIED) {
                  delete frontmatter[statusProp];
                } else {
                  frontmatter[statusProp] = found;
                }
                const completionIndex = uniqueColumns.findIndex((column) => column.value === found);
                const isCompleted = completionIndex >= 0 && isCompletionColumn(
                  found,
                  uniqueColumns[completionIndex].label,
                  completionIndex,
                  uniqueColumns.length,
                );
                if (isCompleted) {
                  if (!frontmatter[startedProp]) frontmatter[startedProp] = localIsoDate();
                  frontmatter[completedProp] = localIsoDate();
                } else {
                  delete frontmatter[completedProp];
                  if (found !== uniqueColumns[0]?.value && !frontmatter[startedProp]) {
                    frontmatter[startedProp] = localIsoDate();
                  }
                }
              })
              .then(async () => {
                flashLanded(card.path);
                await appendTimelineEntry(
                  ctx.app.vault,
                  ctx.plugin.settings.activityTimelineName,
                  `> [!info] Kanban · ${kanbanName}\n> [[${card.path}|${card.title}]]\n> \`${oldLabel}\` → \`${nextLabel}\``,
                  new Date(),
                  ctx.plugin.settings.baseDirectory,
                );
              });
          }
          setDrag(null);
          setDropCol(null);
          setDropTarget(null);
        } else {
          // Treat as a click — preview the note in a modal. The modal's open
          // icon navigates to the note in a new leaf (keeps the dashboard).
          new KanbanCardModal(
            ctx.app,
            card.file,
            card.title,
            {
              status: card.status,
              statusLabel: uniqueColumns.find((column) => column.value === card.status)?.label || card.status || t("dashboard.kanbanUnspecified"),
              due: card.due,
              started: card.started,
              completed: card.completed,
              tags: card.tags,
              checklistDone: card.checklistDone,
              checklistTotal: card.checklistTotal,
              attachmentCount: card.attachmentCount,
              fields: card.fields,
            },
            () => {
              ctx.closeHost?.();
              const leaf = ctx.app.workspace.getLeaf(true);
              void leaf.openFile(card.file).then(() => {
                ctx.app.workspace.setActiveLeaf(leaf, { focus: true });
              });
            },
            () => { void openEditCard(card); },
          ).open();
        }
      };

      activeWindow.addEventListener("pointermove", onMove);
      activeWindow.addEventListener("pointerup", onUp);
    },
    [ctx, statusProp, startedProp, completedProp, columnForCard, flashLanded, hitTestDrop, persistCardOrder, reorderCard, uniqueColumns, kanbanName, openEditCard],
  );

  const storeAttachments = useCallback(async (notePath: string, files: File[]) => {
    if (!ctx || files.length === 0) return [];
    const slash = notePath.lastIndexOf("/");
    const noteFolder = slash >= 0 ? notePath.slice(0, slash) : "";
    const noteName = notePath.slice(slash + 1).replace(/\.md$/i, "");
    const attachmentFolder = [noteFolder, "Attachments", sanitizeFileName(noteName)].filter(Boolean).join("/");
    await ensureVaultFolder(ctx.app.vault, attachmentFolder);
    const stored = [];
    for (const source of files) {
      const rawName = source.name.replace(/[\\/:*?"<>|#[\]]/g, "-").trim() || "attachment";
      const dot = rawName.lastIndexOf(".");
      const stem = dot > 0 ? rawName.slice(0, dot) : rawName;
      const extension = dot > 0 ? rawName.slice(dot) : "";
      let target = `${attachmentFolder}/${rawName}`;
      for (let index = 2; ctx.app.vault.getAbstractFileByPath(target); index += 1) {
        target = `${attachmentFolder}/${stem} ${index}${extension}`;
      }
      await ctx.app.vault.createBinary(target, await source.arrayBuffer());
      stored.push({ path: target, label: source.name });
    }
    return stored;
  }, [ctx]);

  const createCard = useCallback(
    async (input: KanbanTaskInput) => {
      if (!ctx) return;
      const app = ctx.app;
      const folder = folderFilter.replace(/[/\\]+$/, "");
      try {
        await ensureVaultFolder(app.vault, folder);
        const dir = folder ? `${folder}/` : "";
        const base = sanitizeFileName(input.title) || t("dashboard.kanbanNewCardName");
        let name = base;
        let n = 1;
        while (app.vault.getAbstractFileByPath(`${dir}${name}.md`)) {
          name = `${base} ${++n}`;
        }
        const file = await app.vault.create(`${dir}${name}.md`, "");
        const attachments = await storeAttachments(file.path, input.files);
        await app.vault.modify(file, serializeKanbanTaskBody({
          description: input.description,
          checklist: input.checklist,
          attachments: [...input.attachments, ...attachments],
        }));
        await app.fileManager.processFrontMatter(file, (fm) => {
          const frontmatter = fm as FrontmatterRecord;
          if (tagFilter) {
            const tags = frontmatter.tags;
            const cur: unknown[] = Array.isArray(tags) ? tags.slice() : tags != null ? [tags] : [];
            if (!cur.some((tg) => normTag(String(tg)) === tagFilter)) cur.push(tagFilter);
            frontmatter.tags = cur;
          }
          if (input.status) frontmatter[statusProp] = input.status;
          if (titleProp && !titleProp.startsWith("file.") && input.title) frontmatter[titleProp] = input.title;
          if (input.due) frontmatter[dueProp] = input.due;
          const completionIndex = uniqueColumns.findIndex((column) => column.value === input.status);
          if (completionIndex >= 0 && isCompletionColumn(input.status, uniqueColumns[completionIndex].label, completionIndex, uniqueColumns.length)) {
            frontmatter[startedProp] = localIsoDate();
            frontmatter[completedProp] = localIsoDate();
          }
        });
        // Stay on the dashboard — the new card appears in its column via the
        // metadata listener; the user can click it to open when ready.
      } catch (e) {
        new Notice(t("dashboard.kanbanNewCardError"));
        console.error("Kanban: failed to create card", e);
      }
    },
    [ctx, folderFilter, tagFilter, statusProp, titleProp, dueProp, startedProp, completedProp, storeAttachments, uniqueColumns],
  );

  const openNewCard = useCallback(() => {
    if (!ctx) return;
    new KanbanTaskModal(ctx.app, { mode: "new", columns: uniqueColumns, onSubmit: createCard }).open();
  }, [ctx, uniqueColumns, createCard]);

  async function openEditCard(card: Card) {
    if (!ctx) return;
    const content = await ctx.app.vault.cachedRead(card.file);
    const task = parseKanbanTaskBody(contentWithoutFrontmatter(content));
    new KanbanTaskModal(ctx.app, {
      mode: "edit",
      columns: uniqueColumns,
      initial: {
        title: card.title,
        status: card.status,
        due: card.due,
        description: task.description,
        checklist: task.checklist,
        attachments: task.attachments,
      },
      onSubmit: async (input) => {
        const attachments = await storeAttachments(card.file.path, input.files);
        await ctx.app.fileManager.processFrontMatter(card.file, (fm) => {
          const frontmatter = fm as FrontmatterRecord;
          if (input.status) frontmatter[statusProp] = input.status;
          if (input.due) frontmatter[dueProp] = input.due;
          else delete frontmatter[dueProp];
          if (titleProp && !titleProp.startsWith("file.")) frontmatter[titleProp] = input.title;
          const completionIndex = uniqueColumns.findIndex((column) => column.value === input.status);
          if (completionIndex >= 0 && isCompletionColumn(input.status, uniqueColumns[completionIndex].label, completionIndex, uniqueColumns.length)) {
            if (!frontmatter[startedProp]) frontmatter[startedProp] = localIsoDate();
            if (!frontmatter[completedProp]) frontmatter[completedProp] = localIsoDate();
          } else {
            delete frontmatter[completedProp];
          }
        });
        const currentContent = await ctx.app.vault.read(card.file);
        await ctx.app.vault.modify(card.file, replaceBodyPreservingFrontmatter(currentContent, serializeKanbanTaskBody({
          description: input.description,
          checklist: input.checklist,
          attachments: [...input.attachments, ...attachments],
        })));
        if ((!titleProp || titleProp.startsWith("file.")) && input.title !== card.file.basename) {
          const parent = card.file.parent?.path ?? "";
          const dir = parent ? `${parent}/` : "";
          const base = sanitizeFileName(input.title) || card.file.basename;
          let target = `${dir}${base}.md`;
          for (let index = 2; ctx.app.vault.getAbstractFileByPath(target) && target !== card.file.path; index += 1) {
            target = `${dir}${base} ${index}.md`;
          }
          if (target !== card.file.path) {
            const oldPath = card.file.path;
            await ctx.app.fileManager.renameFile(card.file, target);
            if (cardOrder.includes(oldPath)) {
              persistCardOrder(cardOrder.map((path) => path === oldPath ? target : path));
            }
          }
        }
      },
    }).open();
  }

  const openAiCreate = useCallback(() => {
    if (!ctx || !ctx.plugin.hasCapability("text-rewrite")) return;
    const today = localIsoDate();
    new AiGenerationModal(ctx.app, {
      plugin: ctx.plugin,
      capability: "text-rewrite",
      title: t("dashboard.kanbanAiCreate"),
      description: t("dashboard.kanbanAiDescription"),
      original: "[]",
      generate: ({ modelId, instruction, previousResult, abortSignal }) => ctx.plugin.rewriteText({
        modelId,
        content: KANBAN_AI_SOURCE.replace("{{today}}", today),
        instruction: `Task request:\n${instruction}\n\nReturn only the requested JSON array.`,
        previousResult,
        context: "memo",
        abortSignal,
      }),
      validate: (result) => { parseKanbanAiTasks(result); },
      onApply: async (result) => {
        for (const task of parseKanbanAiTasks(result)) {
          await createCard({
            ...task,
            status: uniqueColumns[0]?.value ?? "",
            attachments: [],
            files: [],
          });
        }
      },
    }).open();
  }, [ctx, createCard, uniqueColumns]);

  const openAttachment = useCallback((attachment: KanbanAttachment) => {
    if (!ctx) return;
    const file = ctx.app.vault.getAbstractFileByPath(attachment.path);
    if (!(file instanceof TFile)) {
      new Notice(t("dashboard.kanbanAttachmentMissing"));
      return;
    }
    if (canPreviewKanbanAttachment(file)) new KanbanAttachmentModal(ctx.app, file).open();
    else void downloadKanbanAttachment(ctx.app, file);
  }, [ctx]);

  if (!ctx) return null;

  if (!statusProp) {
    return <div className="dashboard-hub-db-widget-empty">{t("dashboard.kanbanNoStatusProperty")}</div>;
  }
  if (fileError) return <div className="dashboard-hub-db-widget-empty">{t("dashboard.kanbanFileError")}</div>;

  const renderColumn = (value: string, label: string, cardsInCol: Card[]) => (
    <div
      key={value}
      ref={(el) => {
        if (el) columnElsRef.current.set(value, el);
        else columnElsRef.current.delete(value);
      }}
      className={`dashboard-hub-db-kanban-column${dropCol === value ? " is-drop-target" : ""}`}
    >
      <div className="dashboard-hub-db-kanban-column-header">
        <span>{label}</span>
        <span className="dashboard-hub-db-kanban-column-count">{cardsInCol.length}</span>
      </div>
      <div className="dashboard-hub-db-kanban-cards">
        {cardsInCol.map((card) => (
          <div
            key={card.path}
            className={`dashboard-hub-db-kanban-card${drag?.card.path === card.path ? " is-dragging" : ""}${landed === card.path ? " is-landed" : ""}${dropTarget?.path === card.path && dropTarget.position === "before" ? " is-drop-before" : ""}${dropTarget?.path === card.path && dropTarget.position === "after" ? " is-drop-after" : ""}`}
            data-kanban-card-path={card.path}
            data-kanban-column={value}
            onPointerDown={(e) => onCardPointerDown(e, card)}
            title={t("dashboard.kanbanDragToMove")}
          >
            <ObsidianMarkdown
              app={ctx.app}
              markdown={card.title}
              sourcePath={card.path}
              className="dashboard-hub-db-kanban-card-title dashboard-hub-db-kanban-card-markdown"
            />
            {(card.due || card.completed || card.checklistTotal > 0 || card.attachmentCount > 0) && (
              <div className="dashboard-hub-db-kanban-task-meta">
                {card.due && (
                  <span className={!card.completed && card.due < localIsoDate() ? "is-overdue" : ""}>
                    <CalendarDays size={12} />{card.due}
                  </span>
                )}
                {card.checklistTotal > 0 && <span><CheckSquare size={12} />{card.checklistDone}/{card.checklistTotal}</span>}
                {card.attachmentCount > 0 && <span><Paperclip size={12} />{card.attachmentCount}</span>}
                {card.completed && <span className="is-completed"><CheckSquare size={12} />{card.completed}</span>}
              </div>
            )}
            {card.fields.map((f) => (
              <div className="dashboard-hub-db-kanban-card-field" key={f.field}>
                {f.label && <span className="dashboard-hub-db-kanban-card-field-name">{f.label}</span>}
                <ObsidianMarkdown
                  app={ctx.app}
                  markdown={f.value}
                  sourcePath={card.path}
                  className="dashboard-hub-db-kanban-card-field-value dashboard-hub-db-kanban-card-markdown"
                />
              </div>
            ))}
            {card.attachments.length > 0 && (
              <div className="dashboard-hub-db-kanban-card-attachments">
                {card.attachments.map((attachment, index) => {
                  const attachmentFile = ctx.app.vault.getAbstractFileByPath(attachment.path);
                  const previewable = attachmentFile instanceof TFile && canPreviewKanbanAttachment(attachmentFile);
                  return (
                    <button
                      type="button"
                      key={`${attachment.path}-${index}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        openAttachment(attachment);
                      }}
                      title={previewable ? t("dashboard.kanbanAttachmentPreview") : t("dashboard.kanbanAttachmentDownload")}
                    >
                      <Paperclip size={12} />
                      <span>{attachment.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {cardsInCol.length === 0 && (
          <div className="dashboard-hub-db-kanban-column-empty" />
        )}
      </div>
    </div>
  );

  const allColumns = showUnspecified && (unspecified.length > 0 || uniqueColumns.length === 0)
    ? [...uniqueColumns.map((c) => ({ value: c.value, label: c.label, cards: grouped.get(c.value) ?? [] })), { value: UNSPECIFIED, label: t("dashboard.kanbanUnspecified"), cards: unspecified }]
    : uniqueColumns.map((c) => ({ value: c.value, label: c.label, cards: grouped.get(c.value) ?? [] }));

  return (
    <div className="dashboard-hub-db-kanban-wrap">
      <div className="dashboard-hub-db-kanban-header">
        {boardTitle && <span className="dashboard-hub-db-kanban-board-title">{boardTitle}</span>}
        {tagOptions.length > 0 && (
          <div className="dashboard-hub-db-kanban-tag-filter">
            <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} title={t("dashboard.kanbanTagFilter")}>
              <option value="">{t("dashboard.kanbanAllTags")}</option>
              {tagOptions.map((tag) => <option value={tag} key={tag}>#{tag}</option>)}
            </select>
            {selectedTag && <button type="button" className="dashboard-hub-db-iconbtn" onClick={() => setSelectedTag("")} title={t("dashboard.kanbanClearTagFilter")}><X size={13} /></button>}
          </div>
        )}
        {ctx.plugin.hasCapability("text-rewrite") && (
          <button
            type="button"
            className="dashboard-hub-db-kanban-ai"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); openAiCreate(); }}
            title={t("dashboard.kanbanAiCreate")}
          >
            <Sparkles size={13} />
            <span>{t("dashboard.kanbanAiCreate")}</span>
          </button>
        )}
        <button
          type="button"
          className="dashboard-hub-db-kanban-new"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openNewCard();
          }}
          title={t("dashboard.kanbanNewCard")}
        >
          <Plus size={13} />
          <span>{t("dashboard.kanbanNewCard")}</span>
        </button>
      </div>
      {allColumns.length === 0 ? (
        <div className="dashboard-hub-db-kanban-empty">{t("dashboard.kanbanEmpty")}</div>
      ) : (
        <div className="dashboard-hub-db-kanban">
          {allColumns.map((col) => renderColumn(col.value, col.label, col.cards))}
        </div>
      )}
      {drag && (
        <div
          className="dashboard-hub-db-kanban-ghost"
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY }}
        >
          <ObsidianMarkdown
            app={ctx.app}
            markdown={drag.card.title}
            sourcePath={drag.card.path}
            className="dashboard-hub-db-kanban-card-title dashboard-hub-db-kanban-card-markdown"
          />
        </div>
      )}
    </div>
  );
}
