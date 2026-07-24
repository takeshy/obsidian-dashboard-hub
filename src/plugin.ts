import {
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  type App,
  type EventRef,
  type SettingDefinitionItem,
} from "obsidian";
import { initLocale } from "src/i18n";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "src/ui/DashboardView";
import { KanbanView, KANBAN_VIEW_TYPE } from "src/ui/KanbanView";
import { ToolLauncherModal, type LauncherTool } from "src/ui/ToolLauncherModal";
import {
  createEmptyDashboard,
  dashboardPath,
  ensureVaultFolder,
  serializeDashboard,
} from "src/dashboard/dashboardFile";
import { DASHBOARD_FOLDER, normalizeBaseDirectory } from "src/dashboard/types";
import { registerCoreWidgets } from "src/dashboard/widgets/registry";
import {
  dashboardIntegrationContractErrors,
  shouldUnregisterDashboardIntegration,
  type DashboardIntegrationUnregisterRequest,
} from "src/integrations/dashboardAiContract";
import {
  DASHBOARD_SKILL,
  dashboardSkillForBaseDirectory,
  REGISTER_RUNTIME_SKILL_EVENT,
  REQUEST_RUNTIME_SKILLS_EVENT,
  UNREGISTER_RUNTIME_SKILL_EVENT,
} from "src/integrations/dashboardSkill";

export interface DashboardHubSettings {
  baseDirectory: string;
  preferredIntegrationId: string;
  preferredModels: Record<string, string>;
}

export interface DashboardAiIntegration {
  protocolVersion: 1;
  id: string;
  name: string;
  listModels: () => Promise<DashboardAiModel[]>;
  getDefaultModel: () => Promise<string | null>;
  openChatWithDraft?: (draft: string) => void | Promise<void>;
  askChatAboutSelection?: (request: { text: string; sourcePath?: string }) => void | Promise<void>;
  runWorkflow?: (request: { workflowPath: string; outputVariable?: string; abortSignal?: AbortSignal }) => Promise<string>;
  generateBase?: (request: BaseGenerationRequest) => Promise<string>;
  rewriteText?: (request: RewriteRequest) => Promise<string>;
  generateWorkflow?: (request: WorkflowGenerationRequest) => Promise<string>;
}

export interface DashboardAiModel {
  id: string;
  name: string;
  capabilities: { text: boolean; vaultRead: boolean; tools: boolean };
}

export interface BaseGenerationRequest {
  modelId: string;
  instruction: string;
  currentYaml?: string;
  basePath?: string;
  allowVaultRead: boolean;
  previousResult?: string;
  abortSignal?: AbortSignal;
}

export interface RewriteRequest {
  modelId: string;
  content: string;
  instruction: string;
  previousResult?: string;
  context: "timeline" | "memo";
  abortSignal?: AbortSignal;
}

export interface WorkflowGenerationRequest {
  modelId: string;
  mode: "create" | "modify";
  instruction: string;
  currentMarkdown?: string;
  previousResult?: string;
  outputContract: { outputVariable: string; format: "markdown" | "html" };
  allowVaultRead: boolean;
  abortSignal?: AbortSignal;
}

export type DashboardCapability = "chat" | "workflow" | "base-generation" | "text-rewrite" | "workflow-generation";

const DEFAULT_SETTINGS: DashboardHubSettings = {
  baseDirectory: DASHBOARD_FOLDER,
  preferredIntegrationId: "",
  preferredModels: {},
};

export class DashboardHubPlugin extends Plugin {
  settings: DashboardHubSettings = DEFAULT_SETTINGS;
  private integrations = new Map<string, DashboardAiIntegration>();

  async onload(): Promise<void> {
    initLocale();
    await this.loadSettings();
    registerCoreWidgets();

    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.registerView(KANBAN_VIEW_TYPE, (leaf) => new KanbanView(leaf, this));
    try {
      this.registerExtensions(["dashboard"], DASHBOARD_VIEW_TYPE);
    } catch (error) {
      console.error("Dashboard Hub: .dashboard is already registered. Disable dashboard ownership in the other Hub plugins.", error);
      new Notice("Could not register .dashboard because another plugin owns it.");
    }
    try {
      this.registerExtensions(["kanban"], KANBAN_VIEW_TYPE);
    } catch (error) {
      console.error("Dashboard Hub: .kanban is already registered by another plugin.", error);
      new Notice("Could not register .kanban because another plugin owns it.");
    }

    this.addRibbonIcon("rocket", "Open dashboard hub", () => new ToolLauncherModal(this).open());
    this.addCommand({
      id: "open-launcher",
      name: "Open launcher",
      callback: () => new ToolLauncherModal(this).open(),
    });
    this.addCommand({
      id: "create-dashboard",
      name: "Create dashboard",
      callback: () => void this.createDashboard(),
    });
    for (const tool of ["workflow", "timeline", "calendar", "memo-list", "kanban", "secret-manager"] as LauncherTool[]) {
      this.addCommand({
        id: `open-${tool}`,
        name: `Open ${tool}`,
        callback: () => new ToolLauncherModal(this, tool).open(),
      });
    }

    this.addSettingTab(new DashboardHubSettingTab(this.app, this));
    this.registerIntegrationEvents();
    this.registerSkillContributionEvents();
    window.setTimeout(() => {
      this.announceReady();
      this.publishDashboardSkill();
    }, 0);
  }

  onunload(): void {
    const workspace = this.app.workspace as unknown as { trigger: (name: string, value: unknown) => void };
    workspace.trigger(UNREGISTER_RUNTIME_SKILL_EVENT, { ownerId: DASHBOARD_SKILL.ownerId, id: DASHBOARD_SKILL.id });
    this.integrations.clear();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as (Partial<DashboardHubSettings> & { encryption?: unknown }) | null;
    const { encryption: legacyEncryption, ...current } = loaded ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...current,
      baseDirectory: normalizeBaseDirectory(current.baseDirectory),
      preferredModels: { ...DEFAULT_SETTINGS.preferredModels, ...(current.preferredModels ?? {}) },
    };
    // Secret files carry their own encrypted private key and salt. Remove the
    // obsolete plugin-level key copy left by early Dashboard Hub builds.
    if (legacyEncryption !== undefined) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setBaseDirectory(value: string): Promise<void> {
    this.settings.baseDirectory = normalizeBaseDirectory(value);
    await this.saveSettings();
    this.publishDashboardSkill();
    const workspace = this.app.workspace as unknown as { trigger: (name: string) => void };
    workspace.trigger("dashboard-hub:base-directory-changed");
  }

  registerIntegration(integration: DashboardAiIntegration): () => void {
    const contractErrors = dashboardIntegrationContractErrors(integration);
    if (contractErrors.length > 0) {
      console.warn(`Dashboard Hub: invalid AI integration ${integration.id || "(unknown)"}: ${contractErrors.join(", ")}`);
      return () => undefined;
    }
    this.integrations.set(integration.id, integration);
    return () => {
      if (this.integrations.get(integration.id) === integration) this.integrations.delete(integration.id);
    };
  }

  unregisterIntegration(request: DashboardIntegrationUnregisterRequest): boolean {
    if (!request.id) return false;
    const current = this.integrations.get(request.id);
    if (!shouldUnregisterDashboardIntegration(current, request)) return false;
    return this.integrations.delete(request.id);
  }

  getIntegrations(): DashboardAiIntegration[] {
    return [...this.integrations.values()];
  }

  private supports(integration: DashboardAiIntegration, capability: DashboardCapability): boolean {
    if (capability === "chat") return Boolean(integration.openChatWithDraft || integration.askChatAboutSelection);
    if (capability === "workflow") return Boolean(integration.runWorkflow);
    if (capability === "base-generation") return Boolean(integration.generateBase);
    if (capability === "text-rewrite") return Boolean(integration.rewriteText);
    return Boolean(integration.generateWorkflow);
  }

  getIntegrationsFor(capability: DashboardCapability): DashboardAiIntegration[] {
    return this.getIntegrations().filter((integration) => this.supports(integration, capability));
  }

  hasCapability(capability: DashboardCapability): boolean {
    return this.getIntegrationsFor(capability).length > 0;
  }

  private preferredIntegration(capability: DashboardCapability): DashboardAiIntegration | null {
    const preferred = this.integrations.get(this.settings.preferredIntegrationId);
    if (preferred && this.supports(preferred, capability)) return preferred;
    return this.getIntegrationsFor(capability)[0] ?? null;
  }

  async listModels(capability: DashboardCapability): Promise<{ integration: DashboardAiIntegration; models: DashboardAiModel[]; defaultModelId: string | null }> {
    const integration = this.preferredIntegration(capability);
    if (!integration) throw new Error("No compatible AI plugin is connected to Dashboard Hub.");
    const [models, providerDefault] = await Promise.all([integration.listModels(), integration.getDefaultModel()]);
    for (const model of models) {
      if (!model.id || !model.name || !model.capabilities || typeof model.capabilities.text !== "boolean") {
        throw new Error(`AI integration ${integration.id} returned an invalid model entry.`);
      }
    }
    const defaultModelId = this.settings.preferredModels[`${integration.id}:${capability}`] || providerDefault;
    return { integration, models: models.filter((model) => model.capabilities.text), defaultModelId };
  }

  rememberModel(integrationId: string, capability: DashboardCapability, modelId: string): void {
    this.settings.preferredModels[`${integrationId}:${capability}`] = modelId;
    void this.saveSettings();
  }

  openChatWithDraft(draft: string): void {
    const integration = this.preferredIntegration("chat");
    if (!integration?.openChatWithDraft) {
      new Notice("No AI plugin is connected.");
      return;
    }
    void integration.openChatWithDraft(draft);
  }

  askChatAboutSelection(request: { text: string; sourcePath?: string }): void {
    const integration = this.preferredIntegration("chat");
    if (!integration?.askChatAboutSelection) {
      new Notice("No AI plugin is connected.");
      return;
    }
    void integration.askChatAboutSelection(request);
  }

  async runWorkflow(request: { workflowPath: string; outputVariable?: string; abortSignal?: AbortSignal }): Promise<string> {
    const integration = this.preferredIntegration("workflow");
    if (!integration?.runWorkflow) throw new Error("No AI plugin with Workflow support is connected to Dashboard Hub.");
    return integration.runWorkflow(request);
  }

  async generateBase(request: BaseGenerationRequest): Promise<string> {
    const integration = this.preferredIntegration("base-generation");
    if (!integration?.generateBase) throw new Error("No AI plugin with Base generation support is connected to Dashboard Hub.");
    return integration.generateBase(request);
  }

  async rewriteText(request: RewriteRequest): Promise<string> {
    const integration = this.preferredIntegration("text-rewrite");
    if (!integration?.rewriteText) throw new Error("No AI plugin with text rewriting support is connected to Dashboard Hub.");
    return integration.rewriteText(request);
  }

  async generateWorkflow(request: WorkflowGenerationRequest): Promise<string> {
    const integration = this.preferredIntegration("workflow-generation");
    if (!integration?.generateWorkflow) throw new Error("No AI plugin with Workflow generation support is connected to Dashboard Hub.");
    return integration.generateWorkflow(request);
  }

  async createDashboard(requestedName = "Dashboard"): Promise<TFile | null> {
    const baseName = requestedName
      .trim()
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Dashboard";
    let name = baseName;
    const baseDirectory = this.settings.baseDirectory;
    let path = dashboardPath(name, baseDirectory);
    for (let index = 2; this.app.vault.getAbstractFileByPath(path); index += 1) {
      name = `${baseName} ${index}`;
      path = dashboardPath(name, baseDirectory);
    }
    try {
      await ensureVaultFolder(this.app.vault, baseDirectory);
      const file = await this.app.vault.create(path, serializeDashboard(createEmptyDashboard()));
      await this.app.workspace.getLeaf(true).openFile(file);
      return file;
    } catch (error) {
      new Notice(`Failed to create dashboard: ${String(error)}`);
      return null;
    }
  }

  private registerIntegrationEvents(): void {
    const workspace = this.app.workspace as unknown as {
      on: {
        (name: "dashboard-hub:register-integration", callback: (value: DashboardAiIntegration) => void): EventRef;
        (name: "dashboard-hub:unregister-integration", callback: (value: DashboardIntegrationUnregisterRequest) => void): EventRef;
      };
    };
    this.registerEvent(workspace.on("dashboard-hub:register-integration", (value) => {
      if (value?.id && value.name) this.registerIntegration(value);
    }));
    this.registerEvent(workspace.on("dashboard-hub:unregister-integration", (value) => {
      this.unregisterIntegration(value);
    }));
  }

  private announceReady(): void {
    const workspace = this.app.workspace as unknown as { trigger: (name: string, plugin: DashboardHubPlugin) => void };
    workspace.trigger("dashboard-hub:ready", this);
  }

  private registerSkillContributionEvents(): void {
    const workspace = this.app.workspace as unknown as {
      on: (name: string, callback: () => void) => EventRef;
    };
    this.registerEvent(workspace.on(REQUEST_RUNTIME_SKILLS_EVENT, () => this.publishDashboardSkill()));
  }

  private publishDashboardSkill(): void {
    const workspace = this.app.workspace as unknown as { trigger: (name: string, value: unknown) => void };
    workspace.trigger(REGISTER_RUNTIME_SKILL_EVENT, dashboardSkillForBaseDirectory(this.settings.baseDirectory));
  }
}

/** Compatibility name used by the dashboard components while they are shared. */
export type LlmHubPlugin = DashboardHubPlugin;

class DashboardHubSettingTab extends PluginSettingTab {
  constructor(app: App, private dashboardPlugin: DashboardHubPlugin) {
    super(app, dashboardPlugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<"baseDirectory">[] {
    return [{
      name: "Base directory",
      desc: "Root folder for dashboards and their bases, kanbans, memos, timelines, and cached data. Changing it does not move existing files.",
      control: {
        type: "text",
        key: "baseDirectory",
        defaultValue: DASHBOARD_FOLDER,
        placeholder: DASHBOARD_FOLDER,
      },
    }];
  }

  getControlValue(key: string): unknown {
    return key === "baseDirectory" ? this.dashboardPlugin.settings.baseDirectory : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "baseDirectory" && typeof value === "string") {
      await this.dashboardPlugin.setBaseDirectory(value);
    }
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Base directory")
      .setDesc("Root folder for dashboards and their bases, kanbans, memos, timelines, and cached data. Changing it does not move existing files.")
      .addText((textInput) => {
        textInput
          .setPlaceholder(DASHBOARD_FOLDER)
          .setValue(this.dashboardPlugin.settings.baseDirectory)
          .onChange(async (value) => {
            await this.dashboardPlugin.setBaseDirectory(value);
          });
      });

  }
}
