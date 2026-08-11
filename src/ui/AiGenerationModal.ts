import { Modal, Notice, Setting, type App, type ButtonComponent, type ToggleComponent } from "obsidian";
import { t } from "src/i18n";
import type { DashboardAiModel, DashboardCapability, DashboardHubPlugin } from "src/plugin";
import { buildSplitDiffRows } from "./splitDiff";
import { InstructionHistoryNavigator } from "./instructionHistory";

interface GenerationRequest {
  modelId: string;
  instruction: string;
  previousResult?: string;
  allowVaultRead: boolean;
  abortSignal: AbortSignal;
}

interface AiGenerationModalOptions {
  plugin: DashboardHubPlugin;
  capability: Extract<DashboardCapability, "base-generation" | "text-rewrite" | "workflow-generation">;
  title: string;
  description: string;
  original: string;
  initialInstruction?: string;
  generate: (request: GenerationRequest) => Promise<string>;
  validate?: (result: string) => void | Promise<void>;
  onApply: (result: string) => void | Promise<void>;
}

/** Provider-neutral model selection, iterative generation, split comparison and apply UI. */
export class AiGenerationModal extends Modal {
  private abort: AbortController | null = null;

  constructor(app: App, private options: AiGenerationModalOptions) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("dashboard-hub-db-ai-modal-host");
    this.contentEl.empty();
    this.contentEl.addClass("dashboard-hub-db-ai-modal");
    this.contentEl.createEl("h2", { text: this.options.title });
    this.contentEl.createEl("p", { text: this.options.description, cls: "dashboard-hub-db-hint" });

    const modelSetting = new Setting(this.contentEl).setName(t("aiWorkflow.model"));
    const modelSelect = modelSetting.controlEl.createEl("select");
    modelSelect.disabled = true;

    let vaultToggle: ToggleComponent | null = null;
    if (this.options.capability !== "text-rewrite") {
      new Setting(this.contentEl)
        .setName(t("settings.vaultToolModeOptional"))
        .addToggle((toggle) => {
          vaultToggle = toggle;
          toggle.setValue(true).setDisabled(true);
        });
    }

    const instruction = this.contentEl.createEl("textarea", { cls: "dashboard-hub-db-ai-instruction" });
    instruction.rows = 4;
    instruction.value = this.options.initialInstruction ?? "";
    instruction.placeholder = t("dashboard.aiBaseAdditionalPlaceholder");
    const history = new InstructionHistoryNavigator(
      this.options.plugin.getInstructionHistory(this.options.capability),
    );
    instruction.addEventListener("keydown", (event) => {
      if (event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const atStart = instruction.selectionStart === instruction.selectionEnd
        && instruction.selectionStart <= instruction.value.indexOf("\n") + 1;
      const lastLineStart = instruction.value.lastIndexOf("\n") + 1;
      const atEnd = instruction.selectionStart === instruction.selectionEnd
        && instruction.selectionStart >= lastLineStart;
      const direction = event.key === "ArrowUp" && atStart ? -1 : event.key === "ArrowDown" && atEnd ? 1 : 0;
      if (!direction) return;
      const next = history.move(direction, instruction.value);
      if (next == null) return;
      event.preventDefault();
      instruction.value = next;
      instruction.setSelectionRange(next.length, next.length);
    });

    const diff = this.contentEl.createDiv({ cls: "dashboard-hub-db-ai-split" });
    const beforeCol = diff.createDiv({ cls: "dashboard-hub-db-ai-split-col" });
    beforeCol.createEl("strong", { text: t("diffModal.before") });
    const before = beforeCol.createDiv({ cls: "dashboard-hub-db-ai-diff-code" });
    const afterCol = diff.createDiv({ cls: "dashboard-hub-db-ai-split-col" });
    afterCol.createEl("strong", { text: t("diffModal.after") });
    const after = afterCol.createDiv({ cls: "dashboard-hub-db-ai-diff-code" });
    diff.hide();
    const preview = this.contentEl.createEl("textarea", { cls: "dashboard-hub-db-ai-preview" });
    preview.rows = 10;
    preview.placeholder = "Generated result";
    preview.hide();

    const renderDiff = (result: string) => {
      before.empty(); after.empty();
      for (const row of buildSplitDiffRows(this.options.original, result)) {
        before.createDiv({ cls: row.changed ? "is-removed" : "", text: row.before ?? " " });
        after.createDiv({ cls: row.changed ? "is-added" : "", text: row.after ?? " " });
      }
    };

    let models: DashboardAiModel[] = [];
    let generated = "";
    let integrationId = "";
    let busy = false;
    const actions = new Setting(this.contentEl);
    let generateButton: ButtonComponent;
    let cancelButton: ButtonComponent;
    let applyButton: ButtonComponent;

    const updateModelCapability = () => {
      const model = models.find((entry) => entry.id === modelSelect.value);
      vaultToggle?.setDisabled(!model?.capabilities.vaultRead);
      if (!model?.capabilities.vaultRead) vaultToggle?.setValue(false);
    };
    modelSelect.addEventListener("change", updateModelCapability);

    const setBusy = (next: boolean) => {
      busy = next;
      modelSelect.disabled = next || models.length === 0;
      instruction.disabled = next;
      generateButton?.setDisabled(next || !modelSelect.value);
      applyButton?.setDisabled(next || !generated.trim());
      cancelButton?.buttonEl.toggle(next);
    };

    actions.addButton((button) => {
      generateButton = button;
      button.setButtonText(t("dashboard.aiBaseGenerate")).setCta().onClick(async () => {
        if (busy || !instruction.value.trim() || !modelSelect.value) {
          if (!instruction.value.trim()) new Notice(t("dashboard.aiBaseDescribeRequired"));
          return;
        }
        this.abort?.abort();
        this.options.plugin.rememberInstruction(this.options.capability, instruction.value);
        const abort = new AbortController();
        this.abort = abort;
        setBusy(true);
        button.setButtonText(t("dashboard.aiBaseGenerating"));
        try {
          this.options.plugin.rememberModel(integrationId, this.options.capability, modelSelect.value);
          const result = await this.options.generate({
            modelId: modelSelect.value,
            instruction: instruction.value.trim(),
            previousResult: generated || undefined,
            allowVaultRead: vaultToggle?.getValue() ?? false,
            abortSignal: abort.signal,
          });
          if (abort.signal.aborted) return;
          await this.options.validate?.(result);
          generated = result;
          renderDiff(result);
          preview.value = result;
          diff.show();
          preview.show();
          instruction.value = "";
        } catch (error) {
          if (!abort.signal.aborted) new Notice(error instanceof Error ? error.message : String(error));
        } finally {
          if (this.abort === abort) this.abort = null;
          button.setButtonText(generated ? t("dashboard.aiBaseRegenerate") : t("dashboard.aiBaseGenerate"));
          setBusy(false);
        }
      });
    });
    actions.addButton((button) => {
      cancelButton = button;
      button.setButtonText(t("dashboard.cancel")).onClick(() => this.abort?.abort());
      button.buttonEl.hide();
    });
    actions.addButton((button) => {
      applyButton = button;
      button.setButtonText(t("dashboard.aiBaseApply")).setDisabled(true).onClick(async () => {
        const result = preview.value || generated;
        if (!result.trim()) return;
        await this.options.validate?.(result);
        await this.options.onApply(result);
        this.close();
      });
    });
    actions.addButton((button) => button.setButtonText(t("common.cancel")).onClick(() => this.close()));

    try {
      const response = await this.options.plugin.listModels(this.options.capability);
      integrationId = response.integration.id;
      models = response.models;
      modelSelect.empty();
      for (const model of models) modelSelect.createEl("option", { value: model.id, text: model.name });
      const preferred = models.find((model) => model.id === response.defaultModelId) ?? models[0];
      modelSelect.value = preferred?.id ?? "";
      updateModelCapability();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
    window.setTimeout(() => instruction.focus(), 0);
  }

  onClose(): void {
    this.abort?.abort();
    this.modalEl.removeClass("dashboard-hub-db-ai-modal-host");
    this.contentEl.empty();
  }
}
