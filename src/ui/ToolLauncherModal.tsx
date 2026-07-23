import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal, TFile } from "obsidian";
import { CalendarDays, Columns3, FileKey2, History, LayoutDashboard, NotebookTabs, Plus, Rocket } from "lucide-react";
import type { LlmHubPlugin } from "src/plugin";
import { t } from "src/i18n";
import type { WidgetContext } from "src/dashboard/types";
import TimelineWidget from "src/dashboard/widgets/TimelineWidget";
import CalendarWidget from "src/dashboard/widgets/CalendarWidget";
import MemoListWidget from "src/dashboard/widgets/MemoListWidget";
import KanbanWidget from "src/dashboard/widgets/KanbanWidget";
import SecretManagerWidget from "src/dashboard/widgets/SecretManagerWidget";

export type LauncherTool = "dashboard" | "timeline" | "calendar" | "memo-list" | "kanban" | "secret-manager";

const TOOLS = [
  { id: "dashboard", label: "launcher.dashboard", help: "launcher.dashboardHelp", icon: LayoutDashboard },
  { id: "timeline", label: "launcher.timeline", help: "launcher.timelineHelp", icon: History },
  { id: "calendar", label: "launcher.calendar", help: "launcher.calendarHelp", icon: CalendarDays },
  { id: "memo-list", label: "launcher.memos", help: "launcher.memosHelp", icon: NotebookTabs },
  { id: "kanban", label: "launcher.kanban", help: "launcher.kanbanHelp", icon: Columns3 },
  { id: "secret-manager", label: "launcher.secrets", help: "launcher.secretsHelp", icon: FileKey2 },
] as const;

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
        {TOOLS.map((item) => <button type="button" key={item.id} onClick={() => setTool(item.id)}>
          <span className="llm-hub-launcher-tool-icon"><item.icon size={22} /></span>
          <div className="llm-hub-launcher-tool-copy"><strong>{t(item.label)}</strong><small>{t(item.help)}</small></div>
        </button>)}
      </div>}
      {tool === "dashboard" && <DashboardLauncher plugin={plugin} onClose={onClose} />}
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
