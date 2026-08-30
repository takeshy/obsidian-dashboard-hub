import { Component, MarkdownRenderer, Modal, Notice, TFile, setIcon, type App } from "obsidian";
import { t } from "src/i18n";
import { epubToHtml } from "src/utils/epub";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);

export function canPreviewKanbanAttachment(file: TFile): boolean {
  const extension = file.extension.toLocaleLowerCase();
  return extension === "pdf" || extension === "epub" || extension === "md" || extension === "markdown"
    || IMAGE_EXTENSIONS.has(extension);
}

export async function downloadKanbanAttachment(app: App, file: TFile): Promise<void> {
  try {
    const content = await app.vault.readBinary(file);
    const url = URL.createObjectURL(new Blob([content]));
    const anchor = document.body.createEl("a", {
      cls: "dashboard-hub-db-kanban-attachment-download",
      attr: { href: url, download: file.name },
    });
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch (error) {
    new Notice(t("dashboard.kanbanAttachmentDownloadError"));
    console.error("Kanban: failed to download attachment", error);
  }
}

export class KanbanAttachmentModal extends Modal {
  private component = new Component();
  private closed = false;

  constructor(app: App, private file: TFile) {
    super(app);
  }

  onOpen(): void {
    this.closed = false;
    this.component.load();
    this.modalEl.addClass("dashboard-hub-db-kanban-attachment-modal");
    const header = this.contentEl.createDiv({ cls: "dashboard-hub-db-kanban-attachment-modal-header" });
    header.createEl("h3", { text: this.file.name });
    const download = header.createEl("button", {
      attr: { type: "button", "aria-label": t("dashboard.kanbanAttachmentDownload") },
    });
    setIcon(download, "download");
    download.addEventListener("click", () => void downloadKanbanAttachment(this.app, this.file));

    const preview = this.contentEl.createDiv({ cls: "dashboard-hub-db-kanban-attachment-preview" });
    const extension = this.file.extension.toLocaleLowerCase();
    const resourcePath = this.app.vault.getResourcePath(this.file);
    if (extension === "pdf") {
      preview.createEl("iframe", {
        attr: { src: resourcePath, title: this.file.name },
      });
    } else if (extension === "epub") {
      const frame = preview.createEl("iframe", {
        attr: { title: this.file.name, sandbox: "allow-same-origin" },
      });
      void this.app.vault.readBinary(this.file).then((buffer) => {
        if (!this.closed) frame.srcdoc = epubToHtml(new Uint8Array(buffer), this.file.name);
      }).catch((error: unknown) => this.showPreviewError(preview, error));
    } else if (extension === "md" || extension === "markdown") {
      preview.addClass("markdown-rendered");
      void this.app.vault.cachedRead(this.file).then((content) => {
        if (!this.closed) void MarkdownRenderer.render(this.app, content, preview, this.file.path, this.component);
      }).catch((error: unknown) => this.showPreviewError(preview, error));
    } else {
      preview.createEl("img", {
        attr: { src: resourcePath, alt: this.file.name },
      });
    }
  }

  private showPreviewError(preview: HTMLElement, error: unknown): void {
    if (this.closed) return;
    preview.empty();
    preview.createDiv({ cls: "dashboard-hub-db-widget-empty", text: t("dashboard.kanbanAttachmentPreviewError") });
    console.error("Kanban: failed to preview attachment", error);
  }

  onClose(): void {
    this.closed = true;
    this.component.unload();
    this.modalEl.removeClass("dashboard-hub-db-kanban-attachment-modal");
    this.contentEl.empty();
  }
}
