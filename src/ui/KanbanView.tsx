import { createRoot, type Root } from "react-dom/client";
import { TextFileView, type IconName, type WorkspaceLeaf } from "obsidian";
import { KanbanEditor } from "src/dashboard/KanbanEditor";
import type { LlmHubPlugin } from "src/plugin";

export const KANBAN_VIEW_TYPE = "dashboard-hub-kanban-view";

export class KanbanView extends TextFileView {
  private reactRoot: Root | null = null;
  private currentData = "";

  constructor(leaf: WorkspaceLeaf, private plugin: LlmHubPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return KANBAN_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename || "Kanban";
  }

  getIcon(): IconName {
    return "columns-3";
  }

  getViewData(): string {
    return this.currentData;
  }

  setViewData(data: string, clear: boolean): void {
    const changed = data !== this.currentData;
    this.currentData = data;
    if (clear) {
      this.reactRoot?.unmount();
      this.reactRoot = null;
    }
    if (!this.reactRoot || clear || changed) this.renderContent();
  }

  clear(): void {
    this.currentData = "";
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
  }

  private renderContent(): void {
    this.reactRoot?.unmount();
    const container = this.contentEl;
    container.empty();
    container.addClass("llm-hub-dashboard-container");
    this.reactRoot = createRoot(container);
    this.reactRoot.render(
      <KanbanEditor
        plugin={this.plugin}
        sourcePath={this.file?.path || ""}
        fileName={this.file?.basename || ""}
        yamlContent={this.currentData}
        onYamlChange={(yaml) => {
          this.currentData = yaml;
          this.requestSave();
        }}
      />,
    );
  }

  async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    this.reactRoot = null;
    await Promise.resolve();
  }
}
