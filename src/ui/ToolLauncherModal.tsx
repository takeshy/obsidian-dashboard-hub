import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal, TFile } from "obsidian";
import { CalendarDays, Columns3, FileKey2, History, LayoutDashboard, LoaderCircle, NotebookTabs, Plus, Rocket, Workflow as WorkflowIcon } from "lucide-react";
import type { LlmHubPlugin } from "src/plugin";
import { t } from "src/i18n";
import type { WidgetContext } from "src/dashboard/types";
import TimelineWidget from "src/dashboard/widgets/TimelineWidget";
import CalendarWidget from "src/dashboard/widgets/CalendarWidget";
import MemoListWidget from "src/dashboard/widgets/MemoListWidget";
import KanbanWidget from "src/dashboard/widgets/KanbanWidget";
import SecretManagerWidget from "src/dashboard/widgets/SecretManagerWidget";
import ObsidianMarkdown from "src/dashboard/widgets/ObsidianMarkdown";

export type LauncherTool = "dashboard" | "workflow" | "timeline" | "calendar" | "memo-list" | "kanban" | "secret-manager";

const TOOLS = [
  { id: "dashboard", label: "launcher.dashboard", help: "launcher.dashboardHelp", icon: LayoutDashboard },
  { id: "workflow", label: "launcher.workflow", help: "launcher.workflowHelp", icon: WorkflowIcon },
  { id: "timeline", label: "launcher.timeline", help: "launcher.timelineHelp", icon: History },
  { id: "calendar", label: "launcher.calendar", help: "launcher.calendarHelp", icon: CalendarDays },
  { id: "memo-list", label: "launcher.memos", help: "launcher.memosHelp", icon: NotebookTabs },
  { id: "kanban", label: "launcher.kanban", help: "launcher.kanbanHelp", icon: Columns3 },
  { id: "secret-manager", label: "launcher.secrets", help: "launcher.secretsHelp", icon: FileKey2 },
] as const;

function WorkflowLauncher({ plugin }: { plugin: LlmHubPlugin }) {
  const workflows = plugin.app.vault.getMarkdownFiles()
    .filter((file) => file.path.startsWith("workflows/"))
    .sort((a, b) => a.path.localeCompare(b.path));
  const [runningPath, setRunningPath] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; text?: string; error?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (file: TFile) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunningPath(file.path);
    setResult(null);
    try {
      const text = await plugin.runWorkflow({ workflowPath: file.path, abortSignal: abort.signal });
      if (!abort.signal.aborted) setResult({ path: file.path, text });
    } catch (error) {
      if (!abort.signal.aborted) setResult({ path: file.path, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setRunningPath(null);
      }
    }
  };

  if (!plugin.hasCapability("workflow")) {
    return <div className="llm-hub-db-widget-empty">{t("launcher.workflowUnavailable")}</div>;
  }

  return <div className="llm-hub-launcher-workflows">
    <div className="llm-hub-launcher-workflow-list">
      {workflows.length > 0 ? workflows.map((file) => <button
        type="button"
        key={file.path}
        className={result?.path === file.path ? "is-active" : ""}
        disabled={runningPath !== null}
        onClick={() => void run(file)}
      >
        {runningPath === file.path ? <LoaderCircle className="is-spinning" size={18} /> : <WorkflowIcon size={18} />}
        <span><strong>{file.basename}</strong><small>{file.path}</small></span>
      </button>) : <div className="llm-hub-db-widget-empty">{t("launcher.workflowEmpty")}</div>}
    </div>
    <div className="llm-hub-launcher-workflow-output">
      {runningPath && <div className="llm-hub-db-widget-empty">{t("dashboard.executing")}</div>}
      {!runningPath && result?.error && <div className="llm-hub-db-wf-error">{result.error}</div>}
      {!runningPath && result?.text != null && <ObsidianMarkdown
        app={plugin.app}
        markdown={result.text}
        sourcePath={result.path}
        className="llm-hub-db-markdown"
      />}
      {!runningPath && !result && <div className="llm-hub-db-widget-empty">{t("launcher.workflowSelect")}</div>}
    </div>
  </div>;
}

function DashboardLauncher({ plugin, onClose }: { plugin: LlmHubPlugin; onClose: () => void }) {
  const dashboards = plugin.app.vault.getFiles()
    .filter((file) => file.extension === "dashboard")
    .sort((a, b) => a.path.localeCompare(b.path));
  const open = (path: string) => {
    const file = plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    onClose();
    void plugin.app.workspace.getLeaf(true).openFile(file);
  };
  const create = () => {
    onClose();
    void plugin.createDashboard();
  };

  return <div className="llm-hub-launcher-dashboards">
    <button type="button" className="llm-hub-launcher-dashboard-create" onClick={create}><Plus size={17} />{t("launcher.dashboardCreate")}</button>
    {dashboards.length > 0 ? <div className="llm-hub-launcher-dashboard-list">
      {dashboards.map((file) => <button type="button" key={file.path} onClick={() => open(file.path)}>
        <LayoutDashboard size={18} />
        <span><strong>{file.basename}</strong><small>{file.path}</small></span>
      </button>)}
    </div> : <div className="llm-hub-db-widget-empty">{t("launcher.dashboardEmpty")}</div>}
  </div>;
}

function LauncherContent({ plugin, initialTool, onClose }: { plugin: LlmHubPlugin; initialTool: LauncherTool | null; onClose: () => void }) {
  const [tool, setTool] = useState<LauncherTool | null>(initialTool);
  const tools = TOOLS.filter((item) => item.id !== "workflow" || plugin.hasCapability("workflow"));
  const ctx: WidgetContext = {
    app: plugin.app,
    plugin,
    sourcePath: "",
    size: { w: 12, h: 8 },
  };
  const title = TOOLS.find((item) => item.id === tool)?.label;

  return <div className="llm-hub-launcher">
    <header className="llm-hub-launcher-header">
      {tool ? <button type="button" onClick={() => setTool(null)}>← {t("launcher.title")}</button> : <Rocket size={19} />}
      <strong>{title ? t(title) : t("launcher.title")}</strong>
    </header>
    <div className={`llm-hub-launcher-body${tool ? " is-tool" : ""}`}>
      {!tool && <div className="llm-hub-launcher-grid">
        {tools.map((item) => <button type="button" key={item.id} onClick={() => setTool(item.id)}>
          <span className="llm-hub-launcher-tool-icon"><item.icon size={22} /></span>
          <div className="llm-hub-launcher-tool-copy"><strong>{t(item.label)}</strong><small>{t(item.help)}</small></div>
        </button>)}
      </div>}
      {tool === "dashboard" && <DashboardLauncher plugin={plugin} onClose={onClose} />}
      {tool === "workflow" && <WorkflowLauncher plugin={plugin} />}
      {tool === "timeline" && <TimelineWidget config={{ name: "Timeline", latestCount: 20 }} ctx={ctx} />}
      {tool === "calendar" && <CalendarWidget config={{ timelineName: "Timeline" }} ctx={ctx} />}
      {tool === "memo-list" && <MemoListWidget ctx={ctx} />}
      {tool === "kanban" && <KanbanWidget config={{
        title: "Tasks",
        folder: "Tasks",
        statusProperty: "status",
        titleProperty: "title",
        timelineName: "Timeline",
        columns: [
          { value: "todo", label: t("launcher.kanbanTodo") },
          { value: "in-progress", label: t("launcher.kanbanDoing") },
          { value: "done", label: t("launcher.kanbanDone") },
        ],
      }} ctx={ctx} />}
      {tool === "secret-manager" && <SecretManagerWidget config={{ folder: "Secrets" }} ctx={ctx} />}
    </div>
  </div>;
}

export class ToolLauncherModal extends Modal {
  private root: Root | null = null;

  constructor(private plugin: LlmHubPlugin, private initialTool: LauncherTool | null = null) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("llm-hub-launcher-modal");
    this.contentEl.empty();
    this.root = createRoot(this.contentEl);
    this.root.render(<LauncherContent plugin={this.plugin} initialTool={this.initialTool} onClose={() => this.close()} />);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
