// Modal for creating a new kanban card. Collects a title and a target column
// (status); the widget turns the result into a note matching the board filters.

import { App, Modal, Platform, Setting } from "obsidian";
import { t } from "src/i18n";

interface ColumnOpt {
  value: string;
  label: string;
}

export interface NewCardInput {
  title: string;
  status: string;
}

export class KanbanNewCardModal extends Modal {
  private title = "";
  private status: string;
  private submitted = false;
  private removeViewportListeners: (() => void) | null = null;

  constructor(
    app: App,
    private columns: ColumnOpt[],
    private onSubmit: (data: NewCardInput) => void,
  ) {
    super(app);
    this.status = columns[0]?.value ?? "";
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("dashboard-hub-db-kanban-new-card-modal");
    contentEl.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest("button")) event.preventDefault();
    });

    if (Platform.isMobile) {
      const win = modalEl.ownerDocument.defaultView ?? window;
      const viewport = win.visualViewport;
      const updateKeyboardInset = () => {
        const inset = viewport
          ? Math.max(0, win.innerHeight - viewport.height - viewport.offsetTop)
          : 0;
        modalEl.style.setProperty("--dashboard-hub-db-kanban-keyboard-inset", `${inset}px`);
      };
      updateKeyboardInset();
      viewport?.addEventListener("resize", updateKeyboardInset);
      viewport?.addEventListener("scroll", updateKeyboardInset);
      win.addEventListener("resize", updateKeyboardInset);
      this.removeViewportListeners = () => {
        viewport?.removeEventListener("resize", updateKeyboardInset);
        viewport?.removeEventListener("scroll", updateKeyboardInset);
        win.removeEventListener("resize", updateKeyboardInset);
        modalEl.style.removeProperty("--dashboard-hub-db-kanban-keyboard-inset");
      };
    }

    contentEl.createEl("h3", { text: t("dashboard.kanbanNewCardTitle") });

    let titleInput: HTMLInputElement | null = null;
    new Setting(contentEl).setName(t("dashboard.kanbanNewCardNameLabel")).addText((txt) => {
      titleInput = txt.inputEl;
      txt
        .setPlaceholder(t("dashboard.kanbanNewCardName"))
        .onChange((v) => (this.title = v));
      txt.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
    });

    if (this.columns.length > 0) {
      new Setting(contentEl).setName(t("dashboard.kanbanNewCardColumn")).addDropdown((dd) => {
        for (const c of this.columns) dd.addOption(c.value, c.label || c.value);
        dd.setValue(this.status).onChange((v) => (this.status = v));
      });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText(t("dashboard.kanbanNewCardCreate"))
          .setCta()
          .onClick(() => this.submit()),
      )
      .addButton((b) => b.setButtonText(t("dashboard.cancel")).onClick(() => this.close()));

    window.setTimeout(() => titleInput?.focus(), 0);
  }

  private submit(): void {
    if (this.submitted) return;
    this.submitted = true;
    this.close();
    this.onSubmit({ title: this.title.trim(), status: this.status });
  }

  onClose(): void {
    this.removeViewportListeners?.();
    this.removeViewportListeners = null;
    this.modalEl.removeClass("dashboard-hub-db-kanban-new-card-modal");
    this.contentEl.empty();
  }
}
