// Modal that previews a kanban card's note. The header shows the card title and
// an "open" icon that navigates to the actual note; the body renders the note's
// markdown read-only.

import { App, Component, MarkdownRenderer, Modal, TFile, setIcon } from "obsidian";
import { t } from "src/i18n";
import { parseKanbanTaskBody, replaceKanbanTaskBody } from "../kanbanTask";
import {
  canPreviewKanbanAttachment,
  downloadKanbanAttachment,
  KanbanAttachmentModal,
} from "./KanbanAttachmentModal";

export interface KanbanCardModalSummary {
  status: string;
  statusLabel: string;
  due: string;
  started: string;
  completed: string;
  tags: string[];
  checklistDone: number;
  checklistTotal: number;
  attachmentCount: number;
  fields: Array<{ field: string; label: string; value: string }>;
}

export class KanbanCardModal extends Modal {
  private component: Component;
  private checklistWriteQueue: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    private file: TFile,
    private title: string,
    private summary: KanbanCardModalSummary,
    private onOpenNote: () => void,
    private onEditTask?: () => void,
  ) {
    super(app);
    this.component = new Component();
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("dashboard-hub-db-kanban-card-modal");
    this.component.load();

    const header = contentEl.createDiv({ cls: "dashboard-hub-db-kanban-card-modal-header" });
    const title = header.createDiv({ cls: "dashboard-hub-db-kanban-card-modal-title markdown-rendered" });
    void MarkdownRenderer.render(this.app, this.title, title, this.file.path, this.component);
    if (this.onEditTask) {
      const editBtn = header.createEl("button", { cls: "dashboard-hub-db-kanban-card-modal-open" });
      setIcon(editBtn, "lucide-pencil");
      editBtn.setAttribute("aria-label", t("dashboard.kanbanTaskEdit"));
      editBtn.addEventListener("click", () => {
        this.close();
        this.onEditTask?.();
      });
    }
    const openBtn = header.createEl("button", { cls: "dashboard-hub-db-kanban-card-modal-open" });
    setIcon(openBtn, "lucide-external-link");
    openBtn.setAttribute("aria-label", t("dashboard.kanbanOpenNote"));
    openBtn.addEventListener("click", () => {
      this.close();
      this.onOpenNote();
    });
    const body = contentEl.createDiv({
      cls: "dashboard-hub-db-kanban-card-modal-body markdown-rendered",
    });
    this.renderSummary(contentEl, body);
    void this.app.vault.cachedRead(this.file).then(async (content) => {
      const markdownBody = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
      const task = parseKanbanTaskBody(markdownBody);
      const attachmentPaths = new Set(task.attachments.map((attachment) => attachment.path));
      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const link = target.closest<HTMLAnchorElement>("a.internal-link");
        if (!link || !body.contains(link)) return;
        const href = link.dataset.href || link.getAttribute("href") || "";
        const linkedFile = this.app.metadataCache.getFirstLinkpathDest(href, this.file.path);
        if (!(linkedFile instanceof TFile) || !attachmentPaths.has(linkedFile.path)) return;
        event.preventDefault();
        event.stopPropagation();
        if (canPreviewKanbanAttachment(linkedFile)) {
          new KanbanAttachmentModal(this.app, linkedFile).open();
        } else {
          void downloadKanbanAttachment(this.app, linkedFile);
        }
      });
      await MarkdownRenderer.render(this.app, content, body, this.file.path, this.component);
      const renderedCheckboxes = Array.from(body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const taskCheckboxes = task.checklist.length > 0
        ? renderedCheckboxes.slice(-task.checklist.length)
        : [];
      taskCheckboxes.forEach((checkbox, index) => {
        checkbox.disabled = false;
        checkbox.addEventListener("change", () => {
          task.checklist[index].completed = checkbox.checked;
          const progress = contentEl.querySelector<HTMLElement>(".dashboard-hub-db-kanban-modal-summary-item.is-checklist .dashboard-hub-db-kanban-modal-summary-value");
          if (progress) progress.textContent = `${task.checklist.filter((item) => item.completed).length} / ${task.checklist.length}`;
          this.checklistWriteQueue = this.checklistWriteQueue
            .catch(() => undefined)
            .then(async () => {
              const latestContent = await this.app.vault.read(this.file);
              const latestBody = latestContent.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
              const latestTask = parseKanbanTaskBody(latestBody);
              latestTask.checklist = task.checklist.map((item) => ({ ...item }));
              await this.app.vault.modify(this.file, replaceKanbanTaskBody(latestContent, latestTask));
            })
            .catch((error: unknown) => {
              console.error("Kanban: failed to update checklist", error);
            });
        });
      });
    });
  }

  private renderSummary(contentEl: HTMLElement, body: HTMLElement): void {
    const summary = contentEl.createDiv({ cls: "dashboard-hub-db-kanban-modal-summary" });
    contentEl.insertBefore(summary, body);
    const addItem = (label: string, value: string, className = "") => {
      if (!value) return;
      const item = summary.createDiv({ cls: `dashboard-hub-db-kanban-modal-summary-item ${className}`.trim() });
      item.createSpan({ cls: "dashboard-hub-db-kanban-modal-summary-label", text: label });
      item.createSpan({ cls: "dashboard-hub-db-kanban-modal-summary-value", text: value });
    };
    addItem(t("dashboard.kanbanTaskStatus"), this.summary.statusLabel || this.summary.status);
    addItem(t("dashboard.kanbanTaskDue"), this.summary.due, this.summary.due && !this.summary.completed && this.summary.due < this.localIsoDate() ? "is-overdue" : "");
    addItem(t("dashboard.kanbanTaskStarted"), this.summary.started);
    addItem(t("dashboard.kanbanTaskCompleted"), this.summary.completed, "is-completed");
    if (this.summary.checklistTotal > 0) {
      addItem(t("dashboard.kanbanTaskChecklist"), `${this.summary.checklistDone} / ${this.summary.checklistTotal}`, "is-checklist");
    }
    if (this.summary.attachmentCount > 0) {
      addItem(t("dashboard.kanbanTaskAttachments"), String(this.summary.attachmentCount));
    }
    if (this.summary.tags.length > 0) {
      const tags = summary.createDiv({ cls: "dashboard-hub-db-kanban-modal-tags" });
      tags.createSpan({ cls: "dashboard-hub-db-kanban-modal-summary-label", text: t("dashboard.kanbanTaskTags") });
      this.summary.tags.forEach((tag) => tags.createSpan({ cls: "dashboard-hub-db-kanban-modal-tag", text: `#${tag}` }));
    }
    this.summary.fields.forEach((field) => {
      const item = summary.createDiv({ cls: "dashboard-hub-db-kanban-modal-field" });
      if (field.label) item.createSpan({ cls: "dashboard-hub-db-kanban-modal-summary-label", text: field.label });
      const value = item.createDiv({ cls: "dashboard-hub-db-kanban-modal-field-value markdown-rendered" });
      void MarkdownRenderer.render(this.app, field.value, value, this.file.path, this.component);
    });
    if (!summary.hasChildNodes()) summary.remove();
  }

  private localIsoDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}
