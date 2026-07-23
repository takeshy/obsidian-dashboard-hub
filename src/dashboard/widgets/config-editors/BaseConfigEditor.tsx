import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, GripVertical, Pencil, Plus, Sparkles, X } from "lucide-react";
import { Notice, TFile, parseYaml, stringifyYaml } from "obsidian";
import { t } from "src/i18n";
import type { ConfigEditorProps } from "../../types";
import { dashboardSubfolder } from "../../types";
import { ensureVaultFolder } from "../../dashboardFile";
import { FilePicker } from "./FilePicker";
import { AiGenerationModal } from "src/ui/AiGenerationModal";
import {
  isRelativeDateValue,
  parseRelativeDateExpression,
  relativeDateExpression,
  type RelativeDateUnit,
  type RelativeDateValue,
} from "../../baseRelativeDate";

interface BaseConfig {
  base?: string;
  /** Removed in Dashboard Hub; retained only so legacy values can be stripped. */
  view?: unknown;
}

type EditableBaseView = Record<string, unknown> & {
  type: string;
  name: string;
  order?: string[];
  sort?: Array<{ property: string; direction: "ASC" | "DESC" }>;
  limit?: number;
  filters?: unknown;
};

type EditableBaseConfig = Record<string, unknown> & {
  views: EditableBaseView[];
  formulas?: Record<string, string>;
  properties?: Record<string, PropertyConfig>;
};

type PropertyConfig = Record<string, unknown> & {
  displayName?: string;
};

type PropertyType = "string" | "number" | "date" | "boolean";

interface FieldInfo {
  name: string;
  type: PropertyType;
}

type FilterNode = string | { and?: FilterNode[]; or?: FilterNode[]; not?: FilterNode[] };

type FilterOp =
  | "eq"
  | "neq"
  | "dateEq"
  | "dateNeq"
  | "contains"
  | "notContains"
  | "empty"
  | "notEmpty"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "isTrue"
  | "isFalse"
  | "before"
  | "after";

interface FilterCondition {
  property: string;
  op: FilterOp;
  value?: unknown;
}

function defaultBaseYaml(viewName: string): string {
  return stringifyYaml({
    views: [{
      type: "table",
      name: viewName,
      order: ["file.name", "file.mtime"],
      sort: [{ property: "file.mtime", direction: "DESC" }],
      limit: 50,
    }],
  }).trimEnd() + "\n";
}

const FILE_FIELDS: FieldInfo[] = [
  { name: "file.name", type: "string" },
  { name: "file.path", type: "string" },
  { name: "file.folder", type: "string" },
  { name: "file.ext", type: "string" },
  { name: "file.ctime", type: "date" },
  { name: "file.mtime", type: "date" },
  { name: "file.tags", type: "string" },
  { name: "file.links", type: "string" },
];

function sanitizeBaseName(name: string): string {
  return (name || "New Base")
    .replace(/\.base$/i, "")
    .replace(/[\\/:*?"<>|#[\]\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "New Base";
}

function normalizeView(view: Record<string, unknown>, fallbackIndex: number): EditableBaseView {
  const type = view.type === "cards" || view.type === "list" || view.type === "table" ? view.type : "table";
  const name = typeof view.name === "string" && view.name.trim() ? view.name : `View ${fallbackIndex + 1}`;
  const order = Array.isArray(view.order)
    ? view.order.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : undefined;
  const sort = Array.isArray(view.sort)
    ? view.sort
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
        .map((s) => ({
          property: typeof s.property === "string" ? s.property : "",
          direction: s.direction === "ASC" ? "ASC" as const : "DESC" as const,
        }))
        .filter((s) => s.property.length > 0)
    : undefined;
  const limit = typeof view.limit === "number" && Number.isFinite(view.limit) && view.limit > 0 ? view.limit : undefined;
  return cleanView({ ...view, type, name, order, sort, limit });
}

function cleanView(view: EditableBaseView): EditableBaseView {
  const next: EditableBaseView = { ...view };
  if (!next.order || next.order.length === 0) delete next.order;
  if (!next.sort || next.sort.length === 0) delete next.sort;
  if (!next.limit || next.limit < 1) delete next.limit;
  if (next.filters == null || next.filters === "") delete next.filters;
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

function parseEditableBase(content: string): EditableBaseConfig {
  const loaded = parseYaml(content) as unknown;
  const obj = loaded && typeof loaded === "object" && !Array.isArray(loaded)
    ? loaded as Record<string, unknown>
    : {};
  const parsedViews = Array.isArray(obj.views)
    ? obj.views
        .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
        .map(normalizeView)
    : [];
  const seenNames: EditableBaseView[] = [];
  const views = parsedViews.map((view) => {
    const name = uniqueViewName(view.name, seenNames);
    const next = { ...view, name };
    seenNames.push(next);
    return next;
  });
  return { ...obj, views: views.length > 0 ? views : [{ type: "table", name: "Table" }] };
}

function dumpEditableBase(config: EditableBaseConfig): string {
  return stringifyYaml(config).trimEnd() + "\n";
}

function defaultFieldLabel(field: string): string {
  const dot = field.indexOf(".");
  return dot >= 0 ? field.slice(dot + 1) : field;
}

function uniqueViewName(baseName: string, views: EditableBaseView[], currentIndex?: number): string {
  const fallback = baseName.trim() || "View";
  const used = new Set(
    views
      .map((view, index) => currentIndex === index ? "" : view.name)
      .filter(Boolean),
  );
  if (!used.has(fallback)) return fallback;
  let i = 2;
  let next = `${fallback} ${i}`;
  while (used.has(next)) next = `${fallback} ${++i}`;
  return next;
}

function uniquePath(existingPaths: string[], desiredName: string, folder: string): string {
  const base = sanitizeBaseName(desiredName);
  const used = new Set(existingPaths);
  let path = `${folder}/${base}.base`;
  let i = 2;
  while (used.has(path)) {
    path = `${folder}/${base} ${i}.base`;
    i += 1;
  }
  return path;
}

function inferPropertyType(value: unknown): PropertyType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(value)) return "date";
  return "string";
}

function fileFieldsFromVault(app: ConfigEditorProps["app"]): FieldInfo[] {
  const seen = new Map<string, PropertyType>(FILE_FIELDS.map((field) => [field.name, field.type]));
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm && typeof fm === "object") {
      for (const key of Object.keys(fm)) {
        if (key === "position") continue;
        const fieldName = `note.${key}`;
        if (!seen.has(fieldName)) seen.set(fieldName, inferPropertyType(fm[key]));
      }
    }
  }
  return Array.from(seen, ([name, type]) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name));
}

function folderPathsFromVault(app: ConfigEditorProps["app"]): string[] {
  const folders = new Set<string>();
  for (const file of app.vault.getFiles()) {
    const parts = file.path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    }
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

export function BaseConfigEditor({ config, onChange, app, plugin }: ConfigEditorProps) {
  const cfg = (config ?? {}) as BaseConfig;
  const basesFolder = dashboardSubfolder(plugin.settings.baseDirectory, "Bases");
  const updateWidgetConfig = (patch: Partial<BaseConfig>) => {
    const { view: _legacyView, ...current } = cfg;
    onChange({ ...current, ...patch });
  };
  const [baseFiles, setBaseFiles] = useState<string[]>([]);
  const [baseContent, setBaseContent] = useState("");
  const [baseConfig, setBaseConfig] = useState<EditableBaseConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<{ content: string; file: TFile } | null>(null);
  const suppressExternalContentRef = useRef<string | null>(null);

  const refreshBaseFiles = () => {
    setBaseFiles(
      app.vault
        .getFiles()
        .filter((f) => f.extension === "base")
        .map((f) => f.path)
        .sort((a, b) => a.localeCompare(b)),
    );
  };

  useEffect(() => {
    refreshBaseFiles();
  }, [app]);

  const loadSelectedBase = (cancelledRef?: { current: boolean }, options?: { external?: boolean }) => {
    const file = cfg.base ? app.vault.getAbstractFileByPath(cfg.base) : null;
    if (!(file instanceof TFile)) {
      setBaseContent("");
      setBaseConfig(null);
      setLoadError(cfg.base ? t("dashboard.fileNotFound") : null);
      return;
    }
    void app.vault.read(file).then((content) => {
      if (cancelledRef?.current) return;
      if (options?.external && suppressExternalContentRef.current === content) {
        suppressExternalContentRef.current = null;
        return;
      }
      try {
        const parsed = parseEditableBase(content);
        setBaseContent(content);
        setBaseConfig(parsed);
        setLoadError(null);
      } catch (err) {
        setBaseContent(content);
        setBaseConfig(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  useEffect(() => {
    const cancelled = { current: false };
    loadSelectedBase(cancelled);
    return () => {
      cancelled.current = true;
    };
  }, [app, cfg.base]);

  useEffect(() => {
    if (!cfg.base) return;
    const ref = app.vault.on("modify", (file) => {
      if (file.path === cfg.base) loadSelectedBase(undefined, { external: true });
    });
    return () => app.vault.offref(ref);
  }, [app, cfg.base]);

  const writeLatestSave = async (file: TFile, content: string) => {
    savingRef.current = true;
    setSaving(true);
    suppressExternalContentRef.current = content;
    try {
      await app.vault.modify(file, content);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) {
        await writeLatestSave(pending.file, pending.content);
      } else {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  const fieldInfos = useMemo(() => {
    const fields = fileFieldsFromVault(app);
    for (const formula of Object.keys(baseConfig?.formulas ?? {})) {
      fields.push({ name: `formula.${formula}`, type: "string" });
    }
    const seen = new Map<string, FieldInfo>();
    for (const field of fields) {
      if (!seen.has(field.name)) seen.set(field.name, field);
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [app, baseConfig]);

  const folderOptions = useMemo(() => folderPathsFromVault(app), [app, baseFiles]);

  const activeViewIndex = 0;
  const activeView = baseConfig?.views[activeViewIndex] ?? null;

  const saveBaseConfig = async (next: EditableBaseConfig) => {
    if (!cfg.base) return;
    const file = app.vault.getAbstractFileByPath(cfg.base);
    if (!(file instanceof TFile)) return;
    const nextContent = dumpEditableBase(next);
    setBaseConfig(next);
    setBaseContent(nextContent);
    if (savingRef.current) {
      pendingSaveRef.current = { file, content: nextContent };
      return;
    }
    await writeLatestSave(file, nextContent);
  };

  const updateActiveView = (patch: Partial<EditableBaseView>) => {
    if (!baseConfig || !activeView) return;
    const nextViews = [...baseConfig.views];
    const index = activeViewIndex >= 0 ? activeViewIndex : 0;
    const patched = { ...activeView, ...patch };
    if (typeof patch.name === "string") {
      patched.name = uniqueViewName(patch.name, nextViews, index);
    }
    nextViews[index] = cleanView(patched);
    void saveBaseConfig({ ...baseConfig, views: nextViews });
  };

  const updateProperties = (next: Record<string, PropertyConfig>) => {
    if (!baseConfig) return;
    const nextConfig: EditableBaseConfig = { ...baseConfig };
    if (Object.keys(next).length > 0) nextConfig.properties = next;
    else delete nextConfig.properties;
    void saveBaseConfig(nextConfig);
  };

  const createNewBase = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await ensureVaultFolder(app.vault, basesFolder);
      const path = uniquePath(baseFiles, newName, basesFolder);
      const viewName = path.split("/").pop()?.replace(/\.base$/i, "") || "Base";
      await app.vault.create(path, defaultBaseYaml(viewName));
      refreshBaseFiles();
      updateWidgetConfig({ base: path });
      setNewName("");
      new Notice(t("dashboard.baseCreated"));
    } catch (err) {
      new Notice(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const openAi = (mode: "create" | "modify") => {
    new AiGenerationModal(app, {
      plugin,
      capability: "base-generation",
      title: mode === "create" ? t("dashboard.aiBaseCreate") : t("dashboard.aiBaseEdit"),
      description: mode === "create"
        ? "Describe the notes, fields, filters, and view you want."
        : "Describe how this Base should be changed.",
      original: mode === "modify" ? baseContent : "",
      generate: (request) => plugin.generateBase({
        modelId: request.modelId,
        instruction: request.instruction,
        currentYaml: mode === "modify" ? baseContent : undefined,
        basePath: mode === "modify" ? cfg.base : undefined,
        allowVaultRead: request.allowVaultRead,
        previousResult: request.previousResult,
        abortSignal: request.abortSignal,
      }),
      validate: (generated) => { parseEditableBase(generated.trim().replace(/^```(?:yaml)?\s*/i, "").replace(/\s*```$/, "")); },
      onApply: async (generated) => {
        const yaml = generated.trim().replace(/^```(?:yaml)?\s*/i, "").replace(/\s*```$/, "");
        const parsed = parseEditableBase(yaml);
        if (mode === "modify") {
          await saveBaseConfig(parsed);
          return;
        }
        await ensureVaultFolder(app.vault, basesFolder);
        const path = uniquePath(baseFiles, newName || "AI Base", basesFolder);
        await app.vault.create(path, dumpEditableBase(parsed));
        refreshBaseFiles();
        updateWidgetConfig({ base: path });
      },
    }).open();
  };

  if (!cfg.base) {
    return (
      <div className="llm-hub-db-fields">
        <div className="llm-hub-db-field">
          <label>{t("dashboard.baseCreateNew")}</label>
          <div className="llm-hub-db-base-create-row">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createNewBase();
                }
              }}
              placeholder="New Base"
            />
            <button type="button" className="llm-hub-db-ai-btn" onClick={() => void createNewBase()} disabled={creating}>
              <Plus size={13} />
              {t("dashboard.baseCreate")}
            </button>
          </div>
        </div>

        <div className="llm-hub-db-field">
          <label>{t("dashboard.baseImportExisting")}</label>
          <FilePicker
            value=""
            onChange={(path) => updateWidgetConfig({ base: path })}
            paths={baseFiles}
            placeholder={t("dashboard.baseSelectFile")}
            searchPlaceholder={t("dashboard.searchPlaceholder")}
          />
        </div>

        {plugin.hasCapability("base-generation") && <div className="llm-hub-db-ai-actions">
          <button type="button" className="llm-hub-db-ai-btn" onClick={() => openAi("create")}>
            <Sparkles size={13} />
            {t("dashboard.aiBaseCreate")}
          </button>
        </div>}

      </div>
    );
  }

  return (
    <div className="llm-hub-db-fields">
      <div className="llm-hub-db-base-editor-head">
        <div className="llm-hub-db-base-file-label">
          <FileText size={14} />
          <span>{cfg.base}</span>
        </div>
        <span className="llm-hub-db-base-save-state">{saving ? t("dashboard.saving") : t("dashboard.saved")}</span>
      </div>

      <div className="llm-hub-db-ai-actions">
        {plugin.hasCapability("base-generation") && <button type="button" className="llm-hub-db-ai-btn" onClick={() => openAi("modify")}>
          <Sparkles size={13} />
          {t("dashboard.aiBaseEdit")}
        </button>}
        <button type="button" className="llm-hub-db-ai-btn" onClick={() => updateWidgetConfig({ base: "" })}>
          <Pencil size={13} />
          {t("dashboard.baseChangeFile")}
        </button>
      </div>

      {loadError && <p className="llm-hub-db-error">{loadError}</p>}

      {baseConfig && activeView ? (
        <ManualBaseEditor
          baseConfig={baseConfig}
          activeView={activeView}
          baseContent={baseContent}
          fieldInfos={fieldInfos}
          folderOptions={folderOptions}
          onUpdateView={updateActiveView}
          onUpdateProperties={updateProperties}
          onRawChange={(content) => {
            setBaseContent(content);
            try {
              const parsed = parseEditableBase(content);
              void saveBaseConfig(parsed);
              setLoadError(null);
            } catch (err) {
              setLoadError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      ) : (
        !loadError && <div className="llm-hub-db-empty-hint">{t("dashboard.baseNoViews")}</div>
      )}
    </div>
  );
}

function ManualBaseEditor({
  baseConfig,
  activeView,
  baseContent,
  fieldInfos,
  folderOptions,
  onUpdateView,
  onUpdateProperties,
  onRawChange,
}: {
  baseConfig: EditableBaseConfig;
  activeView: EditableBaseView;
  baseContent: string;
  fieldInfos: FieldInfo[];
  folderOptions: string[];
  onUpdateView: (patch: Partial<EditableBaseView>, nextViewName?: string) => void;
  onUpdateProperties: (next: Record<string, PropertyConfig>) => void;
  onRawChange: (content: string) => void;
}) {
  const order = activeView.order ?? [];
  const fieldNames = fieldInfos.map((field) => field.name);
  const fieldTypeMap = new Map(fieldInfos.map((field) => [field.name, field.type]));
  const sort = activeView.sort?.[0];
  const viewType = activeView.type === "cards" || activeView.type === "list" ? activeView.type : "table";
  const properties = baseConfig.properties ?? {};

  const setPropertyAlias = (id: string, alias: string) => {
    const next: Record<string, PropertyConfig> = { ...properties };
    const trimmed = alias.trim();
    if (trimmed) {
      next[id] = { ...next[id], displayName: trimmed };
    } else if (next[id]) {
      const { displayName: _drop, ...rest } = next[id];
      if (Object.keys(rest).length > 0) next[id] = rest;
      else delete next[id];
    }
    onUpdateProperties(next);
  };

  return (
    <>
      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseViewName")}</label>
        <input
          type="text"
          value={activeView.name}
          onChange={(e) => onUpdateView({ name: e.target.value || "View" }, e.target.value || "View")}
        />
      </div>

      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseViewType")}</label>
        <select value={viewType} onChange={(e) => onUpdateView({ type: e.target.value })}>
          <option value="table">Table</option>
          <option value="cards">Cards</option>
          <option value="list">List</option>
        </select>
      </div>

      <div className="llm-hub-db-field">
        <label>{viewType === "table" ? t("dashboard.baseColumns") : t("dashboard.baseProperties")}</label>
        <BaseFieldsEditor
          order={order}
          fieldNames={fieldNames}
          allowAlias={viewType === "table"}
          aliasFor={(id) => properties[id]?.displayName ?? ""}
          onOrderChange={(next) => onUpdateView({ order: next.length > 0 ? next : undefined })}
          onAliasChange={setPropertyAlias}
        />
      </div>

      {viewType === "cards" && (
        <BaseCardOptions view={activeView} fieldNames={fieldNames} onUpdateView={onUpdateView} />
      )}

      {viewType === "list" && (
        <label className="llm-hub-db-kanban-checkbox">
          <input
            type="checkbox"
            checked={activeView.indentProperties === true}
            onChange={(e) => onUpdateView({ indentProperties: e.target.checked ? true : undefined })}
          />
          {t("dashboard.baseListIndent")}
        </label>
      )}

      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseSort")}</label>
        <div className="llm-hub-db-base-sort-row">
          <select
            value={sort?.property ?? ""}
            onChange={(e) => onUpdateView({ sort: e.target.value ? [{ property: e.target.value, direction: sort?.direction ?? "ASC" }] : undefined })}
          >
            <option value="">{t("dashboard.baseNoSort")}</option>
            {fieldNames.map((field) => <option key={field} value={field}>{field}</option>)}
          </select>
          <select
            value={sort?.direction ?? "ASC"}
            disabled={!sort?.property}
            onChange={(e) => onUpdateView({ sort: sort?.property ? [{ property: sort.property, direction: e.target.value === "DESC" ? "DESC" : "ASC" }] : undefined })}
          >
            <option value="ASC">{t("dashboard.baseSortAsc")}</option>
            <option value="DESC">{t("dashboard.baseSortDesc")}</option>
          </select>
        </div>
      </div>

      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseLimit")}</label>
        <input
          type="number"
          min={1}
          value={activeView.limit ?? ""}
          onChange={(e) => {
            const value = Number(e.target.value);
            onUpdateView({ limit: Number.isFinite(value) && value > 0 ? value : undefined });
          }}
          placeholder="50"
        />
      </div>

      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseFilters")}</label>
        <BaseFilterEditor
          filters={activeView.filters}
          fieldNames={fieldNames}
          fieldTypeMap={fieldTypeMap}
          folderOptions={folderOptions}
          onChange={(next) => onUpdateView({ filters: next })}
        />
      </div>

      <details className="llm-hub-db-base-raw">
        <summary>{t("dashboard.baseRawYaml")}</summary>
        <textarea value={baseContent} onChange={(e) => onRawChange(e.target.value)} rows={8} />
      </details>
    </>
  );
}

function BaseFieldsEditor({
  order,
  fieldNames,
  allowAlias,
  aliasFor,
  onOrderChange,
  onAliasChange,
}: {
  order: string[];
  fieldNames: string[];
  allowAlias: boolean;
  aliasFor: (id: string) => string;
  onOrderChange: (next: string[]) => void;
  onAliasChange: (id: string, alias: string) => void;
}) {
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const availableFields = fieldNames.filter((field) => !order.includes(field));

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onOrderChange(next);
  };

  return (
    <>
      {order.length === 0 && <p className="llm-hub-db-hint">{t("dashboard.baseFieldsAuto")}</p>}
      <div className="llm-hub-db-base-fields-list">
        {order.map((field, index) => (
          <div
            className={`llm-hub-db-base-field-row${dragOverIndex === index ? " is-drag-over" : ""}`}
            draggable
            key={field}
            onDragStart={() => {
              dragIndexRef.current = index;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(index);
            }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={() => {
              if (dragIndexRef.current !== null) move(dragIndexRef.current, index);
              dragIndexRef.current = null;
              setDragOverIndex(null);
            }}
          >
            <GripVertical size={12} className="llm-hub-db-base-grip" />
            <span title={field}>{field}</span>
            {allowAlias && (
              <input
                type="text"
                value={aliasFor(field)}
                placeholder={defaultFieldLabel(field)}
                onChange={(e) => onAliasChange(field, e.target.value)}
              />
            )}
            <button type="button" className="llm-hub-db-iconbtn is-danger" onClick={() => onOrderChange(order.filter((_, i) => i !== index))} title={t("dashboard.remove")}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onOrderChange([...order, e.target.value]);
        }}
        disabled={availableFields.length === 0}
      >
        <option value="">{t("dashboard.baseAddField")}</option>
        {availableFields.map((field) => (
          <option key={field} value={field}>{defaultFieldLabel(field)} ({field})</option>
        ))}
      </select>
    </>
  );
}

function BaseCardOptions({
  view,
  fieldNames,
  onUpdateView,
}: {
  view: EditableBaseView;
  fieldNames: string[];
  onUpdateView: (patch: Partial<EditableBaseView>) => void;
}) {
  const imageProp = typeof view.image === "string" ? view.image : "";
  const imageFit = typeof view.imageFit === "string" ? view.imageFit : "cover";
  const imageAspectRatio = typeof view.imageAspectRatio === "string" ? view.imageAspectRatio : "16 / 9";
  const cardSize = typeof view.cardSize === "string" ? view.cardSize : "medium";

  return (
    <div className="llm-hub-db-base-card-options">
      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseCardImage")}</label>
        <select value={imageProp} onChange={(e) => onUpdateView({ image: e.target.value || undefined })}>
          <option value="">{t("dashboard.baseImageNone")}</option>
          {fieldNames.map((field) => <option key={field} value={field}>{field}</option>)}
        </select>
      </div>
      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseCardImageFit")}</label>
        <select value={imageFit} onChange={(e) => onUpdateView({ imageFit: e.target.value })}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </div>
      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseCardImageRatio")}</label>
        <select value={imageAspectRatio} onChange={(e) => onUpdateView({ imageAspectRatio: e.target.value })}>
          <option value="16 / 9">16:9</option>
          <option value="4 / 3">4:3</option>
          <option value="1 / 1">1:1</option>
          <option value="3 / 2">3:2</option>
        </select>
      </div>
      <div className="llm-hub-db-field">
        <label>{t("dashboard.baseCardSize")}</label>
        <select value={cardSize} onChange={(e) => onUpdateView({ cardSize: e.target.value })}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </div>
    </div>
  );
}

type Combinator = "and" | "or";
type BaseTerm =
  | { kind: "cmp"; cond: FilterCondition }
  | { kind: "inFolder"; value: string }
  | { kind: "hasTag"; value: string }
  | { kind: "raw"; node: FilterNode };

const VALUELESS_OPS = new Set<FilterOp>(["empty", "notEmpty", "isTrue", "isFalse"]);
const INFOLDER_KEY = "@inFolder";
const HASTAG_KEY = "@hasTag";
const OPERATORS_BY_TYPE: Record<PropertyType, FilterOp[]> = {
  string: ["contains", "eq", "neq", "notContains", "empty", "notEmpty"],
  number: ["eq", "neq", "gt", "lt", "gte", "lte", "empty", "notEmpty"],
  date: ["dateEq", "dateNeq", "before", "after", "empty", "notEmpty"],
  boolean: ["isTrue", "isFalse", "eq", "neq", "empty", "notEmpty"],
};

function BaseFilterEditor({
  filters,
  fieldNames,
  fieldTypeMap,
  folderOptions,
  onChange,
}: {
  filters: unknown;
  fieldNames: string[];
  fieldTypeMap: Map<string, PropertyType>;
  folderOptions: string[];
  onChange: (next: FilterNode | undefined) => void;
}) {
  const parsed = useMemo(() => parseBaseFilter(filters), [filters]);
  const { combinator, terms, representable } = parsed;

  const commit = (nextCombinator: Combinator, nextTerms: BaseTerm[]) =>
    onChange(serializeBaseFilter(nextCombinator, nextTerms));
  const setTerm = (index: number, term: BaseTerm) =>
    commit(combinator, terms.map((item, i) => (i === index ? term : item)));
  const removeTerm = (index: number) =>
    commit(combinator, terms.filter((_, i) => i !== index));
  const addTerm = () => {
    const property = fieldNames[0] ?? "";
    const type = fieldTypeMap.get(property) ?? "string";
    commit(combinator, [...terms, { kind: "cmp", cond: { property, op: OPERATORS_BY_TYPE[type][0] } }]);
  };

  const onFieldChange = (index: number, value: string) => {
    if (value === INFOLDER_KEY) return setTerm(index, { kind: "inFolder", value: "" });
    if (value === HASTAG_KEY) return setTerm(index, { kind: "hasTag", value: "" });
    const type = fieldTypeMap.get(value) ?? "string";
    setTerm(index, { kind: "cmp", cond: { property: value, op: OPERATORS_BY_TYPE[type][0] } });
  };

  const fieldSelect = (index: number, term: BaseTerm, selectedValue: string) => (
    <select value={selectedValue} onChange={(e) => onFieldChange(index, e.target.value)}>
      {term.kind === "cmp" && !fieldNames.includes(term.cond.property) && (
        <option value={term.cond.property}>{term.cond.property}</option>
      )}
      <optgroup label={t("dashboard.baseProperties")}>
        {fieldNames.map((name) => <option key={name} value={name}>{name}</option>)}
      </optgroup>
      <optgroup label="file">
        <option value={INFOLDER_KEY}>{t("dashboard.baseFilterInFolder")}</option>
        <option value={HASTAG_KEY}>{t("dashboard.baseFilterHasTag")}</option>
      </optgroup>
    </select>
  );

  if (!representable) {
    return (
      <p className="llm-hub-db-hint llm-hub-db-base-filter-advanced">
        {t("dashboard.baseAdvancedFilters")}
      </p>
    );
  }

  return (
    <div className="llm-hub-db-base-filter">
      <div className="llm-hub-db-base-filter-head">
        {terms.length === 0 && <p className="llm-hub-db-hint">{t("dashboard.noFilters")}</p>}
        {terms.length >= 2 && (
          <select value={combinator} onChange={(e) => commit(e.target.value as Combinator, terms)}>
            <option value="and">{t("dashboard.baseFilterAnd")}</option>
            <option value="or">{t("dashboard.baseFilterOr")}</option>
          </select>
        )}
      </div>
      <div className="llm-hub-db-base-filter-terms">
        {terms.map((term, index) => {
          if (term.kind === "raw") {
            return (
              <div className="llm-hub-db-base-filter-row is-raw" key={index}>
                <span title={rawNodeToText(term.node)}>{rawNodeToText(term.node)}</span>
                <button type="button" className="llm-hub-db-iconbtn is-danger" onClick={() => removeTerm(index)} title={t("dashboard.remove")}>
                  <X size={12} />
                </button>
              </div>
            );
          }
          if (term.kind === "inFolder") {
            const missing = term.value && !folderOptions.includes(term.value);
            return (
              <div className="llm-hub-db-base-filter-row is-short" key={index}>
                {fieldSelect(index, term, INFOLDER_KEY)}
                <select value={term.value} onChange={(e) => setTerm(index, { ...term, value: e.target.value })}>
                  <option value="">{t("dashboard.baseFilterSelectFolder")}</option>
                  {missing && <option value={term.value}>{term.value}</option>}
                  {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                </select>
                <button type="button" className="llm-hub-db-iconbtn is-danger" onClick={() => removeTerm(index)} title={t("dashboard.remove")}>
                  <X size={12} />
                </button>
              </div>
            );
          }
          if (term.kind === "hasTag") {
            return (
              <div className="llm-hub-db-base-filter-row is-short" key={index}>
                {fieldSelect(index, term, HASTAG_KEY)}
                <input value={term.value} placeholder="#tag" onChange={(e) => setTerm(index, { ...term, value: e.target.value })} />
                <button type="button" className="llm-hub-db-iconbtn is-danger" onClick={() => removeTerm(index)} title={t("dashboard.remove")}>
                  <X size={12} />
                </button>
              </div>
            );
          }
          const cond = term.cond;
          const type = fieldTypeMap.get(cond.property) ?? "string";
          const needsValue = !VALUELESS_OPS.has(cond.op);
          return (
            <div className={`llm-hub-db-base-filter-row${type === "date" && needsValue ? " is-date" : ""}`} key={index}>
              <div className="llm-hub-db-base-filter-property">{fieldSelect(index, term, cond.property)}</div>
              <select className="llm-hub-db-base-filter-operator" value={cond.op} onChange={(e) => setTerm(index, { kind: "cmp", cond: { ...cond, op: e.target.value as FilterOp } })}>
                {(OPERATORS_BY_TYPE[type] ?? OPERATORS_BY_TYPE.string).map((op) => (
                  <option key={op} value={op}>{operatorLabel(op)}</option>
                ))}
              </select>
              {needsValue && type === "date" ? (
                <div className="llm-hub-db-base-filter-value">
                  <RelativeDateInput
                    value={cond.value}
                    onChange={(value) => setTerm(index, { kind: "cmp", cond: { ...cond, value } })}
                  />
                </div>
              ) : needsValue ? (
                <div className="llm-hub-db-base-filter-value">
                  <input
                    type={type === "number" ? "number" : "text"}
                    value={inputValueString(cond.value)}
                    onChange={(e) => {
                      const value: unknown = type === "number" ? Number(e.target.value) : e.target.value;
                      setTerm(index, { kind: "cmp", cond: { ...cond, value } });
                    }}
                  />
                </div>
              ) : null}
              <button type="button" className="llm-hub-db-iconbtn is-danger" onClick={() => removeTerm(index)} title={t("dashboard.remove")}>
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="llm-hub-db-base-add-filter" onClick={addTerm}>
        <Plus size={12} />
        {t("dashboard.addFilter")}
      </button>
    </div>
  );
}

function RelativeDateInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: string | RelativeDateValue) => void;
}) {
  const relative = isRelativeDateValue(value) ? value : null;
  const mode = relative ? relative.amount === 0 ? "today" : "relative" : "absolute";
  const setMode = (next: string) => {
    if (next === "today") onChange({ kind: "relative-date", amount: 0, unit: "day", direction: "future" });
    else if (next === "relative") onChange({ kind: "relative-date", amount: relative?.amount || 1, unit: relative?.unit ?? "day", direction: relative?.direction ?? "future" });
    else onChange("");
  };
  return <div className={`llm-hub-db-base-date-value is-${mode}`}>
    <select value={mode} onChange={(event) => setMode(event.target.value)}>
      <option value="absolute">{t("dashboard.baseDateAbsolute")}</option>
      <option value="today">{t("dashboard.baseDateToday")}</option>
      <option value="relative">{t("dashboard.baseDateRelative")}</option>
    </select>
    {mode === "absolute" && <input type="date" value={inputValueString(value)} onChange={(event) => onChange(event.target.value)} />}
    {mode === "relative" && relative && <>
      <select
        value={relative.direction}
        aria-label={t("dashboard.baseDateDirection")}
        onChange={(event) => onChange({ ...relative, direction: event.target.value as "past" | "future" })}
      >
        <option value="past">−</option>
        <option value="future">＋</option>
      </select>
      <input
        type="number"
        min={1}
        step={1}
        value={relative.amount}
        aria-label={t("dashboard.baseDateAmount")}
        onChange={(event) => onChange({ ...relative, amount: Math.max(1, Math.floor(Number(event.target.value) || 1)) })}
      />
      <select
        value={relative.unit}
        aria-label={t("dashboard.baseDateUnit")}
        onChange={(event) => onChange({ ...relative, unit: event.target.value as RelativeDateUnit })}
      >
        <option value="day">{t("dashboard.baseDateDays")}</option>
        <option value="month">{t("dashboard.baseDateMonths")}</option>
        <option value="year">{t("dashboard.baseDateYears")}</option>
      </select>
    </>}
  </div>;
}

function parseBaseFilter(filters: unknown): { combinator: Combinator; terms: BaseTerm[]; representable: boolean } {
  if (filters == null || filters === "") return { combinator: "and", terms: [], representable: true };
  if (typeof filters === "string") return { combinator: "and", terms: [parseTermNode(filters)], representable: true };
  if (filters && typeof filters === "object" && !Array.isArray(filters)) {
    const obj = filters as { and?: unknown[]; or?: unknown[] };
    if (Array.isArray(obj.and)) return { combinator: "and", terms: obj.and.map(parseTermNode), representable: true };
    if (Array.isArray(obj.or)) return { combinator: "or", terms: obj.or.map(parseTermNode), representable: true };
  }
  return { combinator: "and", terms: [{ kind: "raw", node: filters as FilterNode }], representable: false };
}

function parseTermNode(node: unknown): BaseTerm {
  if (typeof node !== "string") return { kind: "raw", node: node as FilterNode };
  const raw = node.trim();
  const inFolder = raw.match(/^file\.inFolder\((["'])(.*?)\1\)$/);
  if (inFolder) return { kind: "inFolder", value: inFolder[2] };
  const hasTag = raw.match(/^file\.hasTag\((["'])(.*?)\1\)$/);
  if (hasTag) return { kind: "hasTag", value: hasTag[2] };
  const cond = parseConditionExpr(raw);
  return cond ? { kind: "cmp", cond } : { kind: "raw", node };
}

function termToNode(term: BaseTerm): FilterNode {
  switch (term.kind) {
    case "cmp":
      return conditionToExpr(term.cond);
    case "inFolder":
      return `file.inFolder(${literal(term.value)})`;
    case "hasTag":
      return `file.hasTag(${literal(term.value)})`;
    case "raw":
      return term.node;
  }
}

function serializeBaseFilter(combinator: Combinator, terms: BaseTerm[]): FilterNode | undefined {
  const nodes = terms.map(termToNode);
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return { [combinator]: nodes } as FilterNode;
}

function rawNodeToText(node: FilterNode): string {
  return typeof node === "string" ? node : JSON.stringify(node);
}

const PROP_EXPR = String.raw`([A-Za-z_][\w.]*)`;

function parseConditionExpr(raw: string): FilterCondition | null {
  let match: RegExpMatchArray | null;
  if ((match = raw.match(new RegExp(`^!\\s*${PROP_EXPR}\\.isEmpty\\(\\)$`)))) return { property: match[1], op: "notEmpty" };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\.isEmpty\\(\\)$`)))) return { property: match[1], op: "empty" };
  if ((match = raw.match(new RegExp(`^!\\s*${PROP_EXPR}\\.contains\\((.+)\\)$`)))) return { property: match[1], op: "notContains", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\.contains\\((.+)\\)$`)))) return { property: match[1], op: "contains", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*>=\\s*(.+)$`)))) return { property: match[1], op: "gte", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*<=\\s*(.+)$`)))) return { property: match[1], op: "lte", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\.date\\(\\)\\s*==\\s*(.+)$`)))) {
    const relative = parseRelativeDateExpression(match[2]);
    if (relative) return { property: match[1], op: "dateEq", value: relative };
    const fixed = match[2].match(/^date\((.+)\)$/);
    if (fixed) return { property: match[1], op: "dateEq", value: parseLiteral(fixed[1]) };
  }
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\.date\\(\\)\\s*!=\\s*(.+)$`)))) {
    const relative = parseRelativeDateExpression(match[2]);
    if (relative) return { property: match[1], op: "dateNeq", value: relative };
    const fixed = match[2].match(/^date\((.+)\)$/);
    if (fixed) return { property: match[1], op: "dateNeq", value: parseLiteral(fixed[1]) };
  }
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*!=\\s*(.+)$`)))) return { property: match[1], op: "neq", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*==\\s*(.+)$`)))) {
    const value = parseLiteral(match[2]);
    if (value === true) return { property: match[1], op: "isTrue" };
    if (value === false) return { property: match[1], op: "isFalse" };
    return { property: match[1], op: "eq", value };
  }
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*<\\s*(today\\(\\)(?:\\s*[+-]\\s*["'][^"']+["'])?)$`)))) {
    const value = parseRelativeDateExpression(match[2]);
    if (value) return { property: match[1], op: "before", value };
  }
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*>\\s*(today\\(\\)(?:\\s*[+-]\\s*["'][^"']+["'])?)$`)))) {
    const value = parseRelativeDateExpression(match[2]);
    if (value) return { property: match[1], op: "after", value };
  }
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*<\\s*date\\((.+)\\)$`)))) return { property: match[1], op: "before", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*>\\s*date\\((.+)\\)$`)))) return { property: match[1], op: "after", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*<\\s*(.+)$`)))) return { property: match[1], op: "lt", value: parseLiteral(match[2]) };
  if ((match = raw.match(new RegExp(`^${PROP_EXPR}\\s*>\\s*(.+)$`)))) return { property: match[1], op: "gt", value: parseLiteral(match[2]) };
  return null;
}

function parseLiteral(raw: string): unknown {
  const text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function conditionToExpr(cond: FilterCondition): string {
  const prop = cond.property;
  switch (cond.op) {
    case "empty": return `${prop}.isEmpty()`;
    case "notEmpty": return `!${prop}.isEmpty()`;
    case "contains": return `${prop}.contains(${literal(cond.value)})`;
    case "notContains": return `!${prop}.contains(${literal(cond.value)})`;
    case "eq": return `${prop} == ${literal(cond.value)}`;
    case "neq": return `${prop} != ${literal(cond.value)}`;
    case "dateEq": return `${prop}.date() == ${isRelativeDateValue(cond.value) ? relativeDateExpression(cond.value) : `date(${literal(cond.value)})`}`;
    case "dateNeq": return `${prop}.date() != ${isRelativeDateValue(cond.value) ? relativeDateExpression(cond.value) : `date(${literal(cond.value)})`}`;
    case "gt": return `${prop} > ${literal(cond.value)}`;
    case "lt": return `${prop} < ${literal(cond.value)}`;
    case "gte": return `${prop} >= ${literal(cond.value)}`;
    case "lte": return `${prop} <= ${literal(cond.value)}`;
    case "isTrue": return `${prop} == true`;
    case "isFalse": return `${prop} == false`;
    case "before": return isRelativeDateValue(cond.value)
      ? `${prop} < ${relativeDateExpression(cond.value)}`
      : `${prop} < date(${literal(cond.value)})`;
    case "after": return isRelativeDateValue(cond.value)
      ? `${prop} > ${relativeDateExpression(cond.value)}`
      : `${prop} > date(${literal(cond.value)})`;
  }
}

function literal(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value == null ? "" : value);
}

function inputValueString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function operatorLabel(op: FilterOp): string {
  switch (op) {
    case "eq": return "=";
    case "neq": return "!=";
    case "dateEq": return "=";
    case "dateNeq": return "!=";
    case "contains": return "contains";
    case "notContains": return "not contains";
    case "empty": return "empty";
    case "notEmpty": return "not empty";
    case "gt": return ">";
    case "lt": return "<";
    case "gte": return ">=";
    case "lte": return "<=";
    case "isTrue": return "true";
    case "isFalse": return "false";
    case "before": return "before";
    case "after": return "after";
  }
}
