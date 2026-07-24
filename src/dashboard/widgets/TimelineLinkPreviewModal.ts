import { App, Component, MarkdownRenderer, Modal, Notice, setIcon, TFile } from "obsidian";
import { t } from "src/i18n";

function splitLinkTarget(target: string): string {
  return target.split("#")[0].split("|")[0].trim();
}

export class TimelineLinkPreviewModal extends Modal {
  private component = new Component();
  private file: TFile | null;

  private openFile(): void {
    this.close();
    void this.app.workspace.openLinkText(this.target, this.sourcePath, true);
  }

  constructor(
    app: App,
    private target: string,
    private sourcePath: string,
  ) {
    super(app);
    this.file = app.metadataCache.getFirstLinkpathDest(splitLinkTarget(target), sourcePath);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("llm-hub-db-timeline-link-modal");

    const header = contentEl.createDiv({ cls: "llm-hub-db-timeline-link-modal-header" });
    header.createEl("h3", {
      text: this.file?.basename ?? this.target,
      cls: "llm-hub-db-timeline-link-modal-title",
    });

    const openBtn = header.createEl("button", { cls: "llm-hub-db-timeline-link-modal-open" });
    setIcon(openBtn, "lucide-external-link");
    openBtn.setAttribute("aria-label", t("input.openFile"));
    openBtn.addEventListener("click", () => this.openFile());

    const body = contentEl.createDiv({
      cls: "llm-hub-db-timeline-link-modal-body markdown-rendered",
    });

    if (!this.file) {
      body.createEl("p", { text: t("dashboard.fileNotFound") });
      return;
    }

    // cachedRead is only valid for text files. Feeding EPUB/PDF/image bytes to
    // MarkdownRenderer can lock the UI while it parses a huge invalid string.
    if (this.file.extension.toLowerCase() !== "md") {
      body.createEl("p", { text: t("dashboard.binaryPreviewUnavailable") });
      const button = body.createEl("button", {
        cls: "llm-hub-db-primary-btn",
        text: t("dashboard.openFile"),
      });
      button.addEventListener("click", () => this.openFile());
      return;
    }

    this.component.load();
    void this.app.vault.cachedRead(this.file).then((content) => {
      if (!body.isConnected) return;
      void MarkdownRenderer.render(this.app, content, body, this.file?.path ?? this.sourcePath, this.component);
    }).catch((err: unknown) => {
      new Notice(err instanceof Error ? err.message : String(err));
    });
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}
