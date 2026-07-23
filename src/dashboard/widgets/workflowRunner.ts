// Workflow widget execution + sidecar result cache.
//
// EXECUTION MODEL (ported from gemihub): the widget render path reads ONLY from
// the sidecar cache and never executes. Execution is triggered explicitly by the
// refresh button, the config editor's test-run, or the interval auto-run (a
// stale-on-open check plus a recurring timer while the dashboard view is open).
// The cache lives in a normal synced data file under Dashboards/Data so results
// survive reopen without bloating the `.dashboard` file.

import type { App } from "obsidian";
import type { LlmHubPlugin } from "src/plugin";
import { ensureVaultFolder } from "../dashboardFile";
import { DASHBOARD_FOLDER } from "../types";

export interface WorkflowCacheRecord {
  ranAt: number;
  status: "ok" | "error";
  /** markdown/html output text. */
  text?: string;
  error?: string;
}

/**
 * Ask the selected AI integration to execute its own Workflow engine. The
 * Dashboard owns only the UI and result cache.
 */
export async function runWorkflowText(
  plugin: LlmHubPlugin,
  workflowPath: string,
  outputVariable: string | undefined,
  abortSignal: AbortSignal,
): Promise<string> {
  return plugin.runWorkflow({ workflowPath, outputVariable, abortSignal });
}

// --- Sidecar cache (normal synced file under Dashboards/Data) ---

export const WORKFLOW_CACHE_FOLDER = `${DASHBOARD_FOLDER}/Data`;

export function workflowCachePath(dashboardPath: string, baseDirectory = DASHBOARD_FOLDER): string {
  return `${baseDirectory}/Data/${encodeURIComponent(dashboardPath)}.json`;
}

async function loadCacheFile(app: App, dashboardPath: string, baseDirectory = DASHBOARD_FOLDER): Promise<Record<string, WorkflowCacheRecord>> {
  const path = workflowCachePath(dashboardPath, baseDirectory);
  try {
    if (!(await app.vault.adapter.exists(path))) return {};
    return JSON.parse(await app.vault.adapter.read(path)) as Record<string, WorkflowCacheRecord>;
  } catch {
    return {};
  }
}

export async function loadWidgetCache(
  app: App,
  dashboardPath: string,
  widgetId: string,
  baseDirectory = DASHBOARD_FOLDER,
): Promise<WorkflowCacheRecord | null> {
  if (!dashboardPath || !widgetId) return null;
  const caches = await loadCacheFile(app, dashboardPath, baseDirectory);
  return caches[widgetId] ?? null;
}

// Serialize read-modify-write per sidecar file. Multiple workflow widgets can
// auto-update concurrently when a dashboard opens; without this, two saves that
// both read `{}` would clobber each other (last write wins).
const saveQueues = new Map<string, Promise<void>>();

// Cache-change notifications so a widget can reload its rendered output after its
// sidecar entry is rewritten elsewhere (e.g. the config editor's test-run or AI
// generation, which runs the workflow without the widget knowing).
type CacheListener = () => void;
const cacheListeners = new Map<string, Set<CacheListener>>();

function cacheListenerKey(dashboardPath: string, widgetId: string): string {
  return `${dashboardPath}\0${widgetId}`;
}

/**
 * Subscribe to cache writes for a specific widget. Returns an unsubscribe fn.
 */
export function onWidgetCacheChange(
  dashboardPath: string,
  widgetId: string,
  listener: CacheListener,
): () => void {
  const key = cacheListenerKey(dashboardPath, widgetId);
  let set = cacheListeners.get(key);
  if (!set) {
    set = new Set();
    cacheListeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = cacheListeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) cacheListeners.delete(key);
  };
}

export async function saveWidgetCache(
  app: App,
  dashboardPath: string,
  widgetId: string,
  record: WorkflowCacheRecord,
  baseDirectory = DASHBOARD_FOLDER,
): Promise<void> {
  if (!dashboardPath || !widgetId) return;
  const path = workflowCachePath(dashboardPath, baseDirectory);
  const prev = saveQueues.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // a prior failure must not break the chain
    .then(async () => {
      const caches = await loadCacheFile(app, dashboardPath, baseDirectory);
      caches[widgetId] = record;
      await ensureVaultFolder(app.vault, `${baseDirectory}/Data`);
      await app.vault.adapter.write(path, JSON.stringify(caches, null, 2));
    });
  saveQueues.set(path, next);
  try {
    await next;
  } finally {
    if (saveQueues.get(path) === next) saveQueues.delete(path);
  }
  cacheListeners.get(cacheListenerKey(dashboardPath, widgetId))?.forEach((l) => l());
}
