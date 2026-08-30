import { App, Modal, Setting } from "obsidian";
import { t } from "src/i18n";

export class CreateDashboardModal extends Modal {
  private fileName = "Dashboard";
  private submitted = false;

  constructor(app: App, private onSubmit: (fileName: string) => void | Promise<unknown>) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("launcher.dashboardCreate") });

    let fileNameInput: HTMLInputElement | null = null;
    new Setting(contentEl)
      .setName(t("launcher.dashboardFileName"))
      .setDesc(t("launcher.dashboardFileNameHint"))
      .addText((text) => {
        fileNameInput = text.inputEl;
        text.setValue(this.fileName).onChange((value) => { this.fileName = value; });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          this.submit();
        });
      });

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText(t("launcher.dashboardCreate"))
        .setCta()
        .onClick(() => this.submit()))
      .addButton((button) => button
        .setButtonText(t("common.cancel"))
        .onClick(() => this.close()));

    window.setTimeout(() => {
      fileNameInput?.focus();
      fileNameInput?.select();
    }, 0);
  }

  private submit(): void {
    if (this.submitted || !this.fileName.trim()) return;
    this.submitted = true;
    this.close();
    void this.onSubmit(this.fileName);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
