import { App, Modal, Notice, Platform, Setting, setIcon } from "obsidian";
import { t } from "src/i18n";
import {
  type KanbanAttachment,
  type KanbanChecklistItem,
} from "../kanbanTask";

interface ColumnOpt {
  value: string;
  label: string;
}

export interface KanbanTaskInput {
  title: string;
  status: string;
  due: string;
  description: string;
  checklist: KanbanChecklistItem[];
  attachments: KanbanAttachment[];
  files: File[];
}

interface KanbanTaskModalOptions {
  mode: "new" | "edit";
  columns: ColumnOpt[];
  initial?: Partial<KanbanTaskInput>;
  onSubmit: (data: KanbanTaskInput) => void | Promise<void>;
}

export class KanbanTaskModal extends Modal {
  private submitted = false;
  private removeViewportListeners: (() => void) | null = null;

  constructor(app: App, private options: KanbanTaskModalOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("dashboard-hub-db-kanban-task-modal");
    if (Platform.isMobile) this.installMobileViewportHandling();

    const state: KanbanTaskInput = {
      title: this.options.initial?.title ?? "",
      status: this.options.initial?.status ?? this.options.columns[0]?.value ?? "",
      due: this.options.initial?.due ?? "",
      description: this.options.initial?.description ?? "",
      checklist: (this.options.initial?.checklist ?? []).map((item) => ({ ...item })),
      attachments: (this.options.initial?.attachments ?? []).map((item) => ({ ...item })),
      files: [],
    };

    contentEl.createEl("h2", { text: this.options.mode === "new" ? t("dashboard.kanbanTaskNew") : t("dashboard.kanbanTaskEdit") });
    let titleInput: HTMLInputElement | null = null;
    let checklistHost: HTMLElement;

    new Setting(contentEl).setName(t("dashboard.kanbanNewCardNameLabel")).addText((text) => {
      titleInput = text.inputEl;
      text.setValue(state.title).setPlaceholder(t("dashboard.kanbanNewCardName")).onChange((value) => (state.title = value));
    });
    if (this.options.columns.length > 0) {
      new Setting(contentEl).setName(t("dashboard.kanbanNewCardColumn")).addDropdown((dropdown) => {
        for (const column of this.options.columns) dropdown.addOption(column.value, column.label || column.value);
        dropdown.setValue(state.status).onChange((value) => (state.status = value));
      });
    }
    new Setting(contentEl).setName(t("dashboard.kanbanTaskDue")).addText((text) => {
      text.inputEl.type = "date";
      text.setValue(state.due).onChange((value) => (state.due = value));
    });
    new Setting(contentEl).setName(t("dashboard.kanbanTaskDescription")).addTextArea((text) => {
      text.setValue(state.description).onChange((value) => (state.description = value));
      text.inputEl.rows = 4;
    });

    contentEl.createEl("h3", { text: t("dashboard.kanbanTaskChecklist") });
    checklistHost = contentEl.createDiv({ cls: "dashboard-hub-db-kanban-task-list" });
    const renderChecklist = () => {
      checklistHost.empty();
      state.checklist.forEach((item, index) => {
        const row = checklistHost.createDiv({ cls: "dashboard-hub-db-kanban-task-list-row" });
        const checked = row.createEl("input", { type: "checkbox" });
        checked.checked = item.completed;
        checked.addEventListener("change", () => (item.completed = checked.checked));
        const input = row.createEl("input", { type: "text", value: item.text, attr: { placeholder: t("dashboard.kanbanTaskChecklistItem") } });
        input.addEventListener("input", () => (item.text = input.value));
        const remove = row.createEl("button", { attr: { type: "button", "aria-label": t("common.delete") } });
        setIcon(remove, "trash-2");
        remove.addEventListener("click", () => {
          state.checklist.splice(index, 1);
          renderChecklist();
        });
      });
    };
    renderChecklist();
    const addChecklist = contentEl.createEl("button", { text: t("dashboard.kanbanTaskChecklistAdd"), attr: { type: "button" } });
    addChecklist.addEventListener("click", () => {
      state.checklist.push({ text: "", completed: false });
      renderChecklist();
      checklistHost.querySelector<HTMLInputElement>(".dashboard-hub-db-kanban-task-list-row:last-child input[type=text]")?.focus();
    });

    contentEl.createEl("h3", { text: t("dashboard.kanbanTaskAttachments") });
    const attachmentsHost = contentEl.createDiv({ cls: "dashboard-hub-db-kanban-attachments" });
    const renderAttachments = () => {
      attachmentsHost.empty();
      state.attachments.forEach((attachment, index) => {
        const row = attachmentsHost.createDiv({ cls: "dashboard-hub-db-kanban-attachment-row" });
        row.createSpan({ text: attachment.label });
        const remove = row.createEl("button", { attr: { type: "button", "aria-label": t("common.delete") } });
        setIcon(remove, "x");
        remove.addEventListener("click", () => {
          state.attachments.splice(index, 1);
          renderAttachments();
        });
      });
      state.files.forEach((file, index) => {
        const row = attachmentsHost.createDiv({ cls: "dashboard-hub-db-kanban-attachment-row is-new" });
        row.createSpan({ text: file.name });
        const remove = row.createEl("button", { attr: { type: "button", "aria-label": t("common.delete") } });
        setIcon(remove, "x");
        remove.addEventListener("click", () => {
          state.files.splice(index, 1);
          renderAttachments();
        });
      });
    };
    renderAttachments();
    const fileInput = contentEl.createEl("input", { type: "file", cls: "dashboard-hub-db-kanban-file-input", attr: { multiple: "true" } });
    fileInput.addEventListener("change", () => {
      state.files.push(...Array.from(fileInput.files ?? []));
      fileInput.value = "";
      renderAttachments();
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText(t("common.save")).setCta().onClick(() => void this.submit(state)))
      .addButton((button) => button.setButtonText(t("common.cancel")).onClick(() => this.close()));
    window.setTimeout(() => titleInput?.focus(), 0);
  }

  private async submit(state: KanbanTaskInput): Promise<void> {
    if (this.submitted) return;
    if (!state.title.trim()) {
      new Notice(t("dashboard.kanbanTaskTitleRequired"));
      return;
    }
    this.submitted = true;
    try {
      await this.options.onSubmit({
        ...state,
        title: state.title.trim(),
        description: state.description.trim(),
        checklist: state.checklist.filter((item) => item.text.trim()).map((item) => ({ ...item, text: item.text.trim() })),
      });
      this.close();
    } catch (error) {
      this.submitted = false;
      new Notice(t("dashboard.kanbanNewCardError"));
      console.error("Kanban: failed to save task", error);
    }
  }

  private installMobileViewportHandling(): void {
    const win = this.modalEl.ownerDocument.defaultView ?? window;
    const viewport = win.visualViewport;
    const update = () => {
      const inset = viewport ? Math.max(0, win.innerHeight - viewport.height - viewport.offsetTop) : 0;
      this.modalEl.style.setProperty("--dashboard-hub-db-kanban-keyboard-inset", `${inset}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    this.removeViewportListeners = () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }

  onClose(): void {
    this.removeViewportListeners?.();
    this.removeViewportListeners = null;
    this.modalEl.removeClass("dashboard-hub-db-kanban-task-modal");
    this.contentEl.empty();
  }
}
