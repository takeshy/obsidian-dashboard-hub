import {
  debounce,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  TFile,
  type App,
  type EventRef,
  type SettingDefinitionItem,
} from "obsidian";
import { initLocale, t } from "src/i18n";
import { cryptoCache } from "src/core/cryptoCache";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "src/ui/DashboardView";
import { KanbanView, KANBAN_VIEW_TYPE } from "src/ui/KanbanView";
import { ToolLauncherModal, type LauncherTool } from "src/ui/ToolLauncherModal";
import { CreateDashboardModal } from "src/ui/CreateDashboardModal";
import {
  createEmptyDashboard,
  dashboardPath,
  ensureVaultFolder,
  serializeDashboard,
} from "src/dashboard/dashboardFile";
import { DASHBOARD_FOLDER, normalizeBaseDirectory } from "src/dashboard/types";
import { registerCoreWidgets } from "src/dashboard/widgets/registry";
import { sanitizeTimelineName } from "src/dashboard/timelineEvents";
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
import { appendInstructionHistory } from "src/ui/instructionHistory";
import { blueskyCredentials, clearBlueskySession, DEFAULT_BLUESKY_SERVICE, verifyBluesky, type BlueskyCredentials } from "src/dashboard/blueskyClient";

export interface DashboardHubSettings {
  baseDirectory: string;
  activityTimelineName: string;
  preferredIntegrationId: string;
  preferredModels: Record<string, string>;
  aiInstructionHistory: Partial<Record<DashboardCapability, string[]>>;
  timelineAi: TimelineAiSettings;
  bluesky: BlueskySettings;
}

/** Posting Timeline threads to Bluesky. The app password itself lives in Obsidian's secret storage. */
export interface BlueskySettings {
  enabled: boolean;
  handle: string;
  /** Name of the Obsidian secret that holds the app password. */
  appPasswordSecret: string;
  service: string;
  /** True once a connection check succeeded with the current handle, secret and server. */
  verified: boolean;
}

const LEGACY_BLUESKY_SECRET = "dashboard-hub-bluesky-app-password";

/** How @ai answers may look things up. `search` is "", "web" or "rag:<setting name>". */
export interface TimelineAiSettings {
  allowVaultRead: boolean;
  search: string;
  /** MCP server names the Hub should connect for @ai answers. */
  mcpServers: string[];
  /** Skill ids (the Hub's skill folder paths) whose instructions apply to @ai answers. */
  skills: string[];
}

export interface TimelineAiChoices {
  integration: DashboardAiIntegration;
  models: DashboardAiModel[];
  modelId: string;
  options: TimelineAnswerOptions;
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
  answerTimeline?: (request: TimelineAnswerRequest) => Promise<string>;
  /** What answerTimeline can use with the given model. */
  getTimelineAnswerOptions?: (modelId: string) => Promise<TimelineAnswerOptions>;
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

export interface TimelineAnswerRequest {
  modelId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  question: string;
  /** Allow read-only Vault tools. */
  allowVaultRead?: boolean;
  /** Use the provider's web search. Never combined with ragSetting. */
  webSearch?: boolean;
  /** Name of the Hub's RAG setting to search. */
  ragSetting?: string;
  /** Names of the Hub's MCP servers to connect. */
  mcpServers?: string[];
  /** Ids of the Hub's Skills to follow. */
  skills?: string[];
  abortSignal?: AbortSignal;
}

export interface TimelineAnswerOptions {
  vaultRead: boolean;
  webSearch: boolean;
  ragSettings: string[];
  mcpServers?: string[];
  skills?: { id: string; name: string }[];
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

export type DashboardCapability = "chat" | "workflow" | "base-generation" | "text-rewrite" | "workflow-generation" | "timeline-reply";

const DEFAULT_SETTINGS: DashboardHubSettings = {
  baseDirectory: DASHBOARD_FOLDER,
  activityTimelineName: "Timeline",
  preferredIntegrationId: "",
  preferredModels: {},
  aiInstructionHistory: {},
  timelineAi: { allowVaultRead: false, search: "", mcpServers: [], skills: [] },
  bluesky: { enabled: false, handle: "", appPasswordSecret: "", service: "", verified: false },
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
      id: "new-timeline-post",
      name: "New Timeline post",
      callback: () => new ToolLauncherModal(this, "timeline", true).open(),
    });
    this.addCommand({
      id: "create-dashboard",
      name: "Create dashboard",
      callback: () => this.promptCreateDashboard(),
    });
    for (const tool of ["workflow", "timeline", "calendar", "memo-list", "kanban", "secret-manager", "file", "base"] as LauncherTool[]) {
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
    cryptoCache.clear();
    clearBlueskySession();
    const workspace = this.app.workspace as unknown as { trigger: (name: string, value: unknown) => void };
    workspace.trigger(UNREGISTER_RUNTIME_SKILL_EVENT, { ownerId: DASHBOARD_SKILL.ownerId, id: DASHBOARD_SKILL.id });
    this.integrations.clear();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as (Partial<DashboardHubSettings> & { encryption?: unknown }) | null;
    const { encryption: legacyEncryption, ...current } = loaded ?? {};
    const storedBluesky = (current.bluesky ?? {}) as Partial<BlueskySettings> & { appPassword?: unknown };
    // Early builds kept the app password in data.json; move it into Obsidian's secret storage.
    const legacyPassword = typeof storedBluesky.appPassword === "string" ? storedBluesky.appPassword.trim() : "";
    if (legacyPassword && !storedBluesky.appPasswordSecret) {
      this.app.secretStorage.setSecret(LEGACY_BLUESKY_SECRET, legacyPassword);
    }
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...current,
      baseDirectory: normalizeBaseDirectory(current.baseDirectory),
      activityTimelineName: sanitizeTimelineName(current.activityTimelineName ?? "Timeline"),
      preferredModels: { ...DEFAULT_SETTINGS.preferredModels, ...(current.preferredModels ?? {}) },
      aiInstructionHistory: { ...DEFAULT_SETTINGS.aiInstructionHistory, ...(current.aiInstructionHistory ?? {}) },
      timelineAi: { ...DEFAULT_SETTINGS.timelineAi, ...(current.timelineAi ?? {}) },
      bluesky: {
        enabled: typeof storedBluesky.enabled === "boolean" ? storedBluesky.enabled : Boolean(legacyPassword),
        handle: typeof storedBluesky.handle === "string" ? storedBluesky.handle.trim() : "",
        appPasswordSecret: typeof storedBluesky.appPasswordSecret === "string" && storedBluesky.appPasswordSecret
          ? storedBluesky.appPasswordSecret
          : legacyPassword ? LEGACY_BLUESKY_SECRET : "",
        service: typeof storedBluesky.service === "string" ? storedBluesky.service.trim() : "",
        // Legacy passwords were only saved after the dialog had signed in with them.
        verified: typeof storedBluesky.verified === "boolean" ? storedBluesky.verified : Boolean(legacyPassword),
      },
    };
    // Secret files carry their own encrypted private key and salt. Remove the
    // obsolete plugin-level key copy left by early Dashboard Hub builds, and the
    // plaintext Bluesky app password now held in secret storage.
    if (legacyEncryption !== undefined || storedBluesky.appPassword !== undefined) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getInstructionHistory(capability: DashboardCapability): string[] {
    return this.settings.aiInstructionHistory[capability] ?? [];
  }

  rememberInstruction(capability: DashboardCapability, instruction: string): void {
    this.settings.aiInstructionHistory[capability] = appendInstructionHistory(
      this.getInstructionHistory(capability), instruction,
    );
    void this.saveSettings();
  }

  async setBaseDirectory(value: string): Promise<void> {
    this.settings.baseDirectory = normalizeBaseDirectory(value);
    await this.saveSettings();
    this.publishDashboardSkill();
    const workspace = this.app.workspace as unknown as { trigger: (name: string) => void };
    workspace.trigger("dashboard-hub:base-directory-changed");
  }

  async setActivityTimelineName(value: string): Promise<void> {
    this.settings.activityTimelineName = sanitizeTimelineName(value);
    await this.saveSettings();
    this.publishDashboardSkill();
  }

  registerIntegration(integration: DashboardAiIntegration): () => void {
    const contractErrors = dashboardIntegrationContractErrors(integration);
    if (contractErrors.length > 0) {
      console.warn(`Dashboard Hub: invalid AI integration ${integration.id || "(unknown)"}: ${contractErrors.join(", ")}`);
      return () => undefined;
    }
    this.integrations.set(integration.id, integration);
    this.notifyIntegrationChange();
    return () => {
      if (this.integrations.get(integration.id) === integration) {
        this.integrations.delete(integration.id);
        this.notifyIntegrationChange();
      }
    };
  }

  unregisterIntegration(request: DashboardIntegrationUnregisterRequest): boolean {
    if (!request.id) return false;
    const current = this.integrations.get(request.id);
    if (!shouldUnregisterDashboardIntegration(current, request)) return false;
    const removed = this.integrations.delete(request.id);
    if (removed) this.notifyIntegrationChange();
    return removed;
  }

  private notifyIntegrationChange(): void {
    const workspace = this.app.workspace as unknown as { trigger: (name: string) => void };
    workspace.trigger("dashboard-hub:integrations-changed");
  }

  getIntegrations(): DashboardAiIntegration[] {
    return [...this.integrations.values()];
  }

  private supports(integration: DashboardAiIntegration, capability: DashboardCapability): boolean {
    if (capability === "chat") return Boolean(integration.openChatWithDraft || integration.askChatAboutSelection);
    if (capability === "workflow") return Boolean(integration.runWorkflow);
    if (capability === "base-generation") return Boolean(integration.generateBase);
    if (capability === "timeline-reply") return Boolean(integration.answerTimeline || integration.rewriteText);
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

  async setTimelineAi(patch: Partial<TimelineAiSettings>): Promise<void> {
    this.settings.timelineAi = { ...this.settings.timelineAi, ...patch };
    await this.saveSettings();
  }

  async setBluesky(patch: Partial<BlueskySettings>): Promise<void> {
    const previous = this.settings.bluesky;
    const next = {
      ...previous,
      ...patch,
      handle: (patch.handle ?? previous.handle).trim(),
      service: (patch.service ?? previous.service).trim(),
    };
    // A different account or server needs a new connection check.
    if (next.handle !== previous.handle || next.appPasswordSecret !== previous.appPasswordSecret || next.service !== previous.service) {
      next.verified = patch.verified ?? false;
      clearBlueskySession();
    }
    this.settings.bluesky = next;
    await this.saveSettings();
    if (next.enabled !== previous.enabled || next.verified !== previous.verified) {
      const workspace = this.app.workspace as unknown as { trigger: (name: string) => void };
      workspace.trigger("dashboard-hub:bluesky-changed");
    }
  }

  /** Bluesky posting is offered only when it is on and the connection check succeeded. */
  isBlueskyReady(): boolean {
    return this.settings.bluesky.enabled && this.settings.bluesky.verified;
  }

  private storedBlueskyCredentials(): BlueskyCredentials | null {
    const { handle, appPasswordSecret, service } = this.settings.bluesky;
    if (!appPasswordSecret) return null;
    return blueskyCredentials({ handle, appPassword: this.app.secretStorage.getSecret(appPasswordSecret) ?? "", service });
  }

  /** Credentials for posting, or null when Bluesky is not ready. */
  getBlueskyCredentials(): BlueskyCredentials | null {
    return this.isBlueskyReady() ? this.storedBlueskyCredentials() : null;
  }

  /** Sign in with the stored settings and mark them verified on success. */
  async checkBlueskyConnection(): Promise<void> {
    const credentials = this.storedBlueskyCredentials();
    if (!credentials) {
      await this.setBluesky({ verified: false });
      throw new Error(t("bluesky.connectError"));
    }
    try {
      await verifyBluesky(credentials);
    } catch (error) {
      await this.setBluesky({ verified: false });
      throw error;
    }
    await this.setBluesky({ verified: true });
  }

  /** Model and lookup options for @ai answers, or null when no Hub can answer. */
  async getTimelineAiChoices(): Promise<TimelineAiChoices | null> {
    let listed: Awaited<ReturnType<DashboardHubPlugin["listModels"]>>;
    try {
      listed = await this.listModels("timeline-reply");
    } catch {
      return null;
    }
    const { integration, models } = listed;
    const modelId = models.find((model) => model.id === listed.defaultModelId)?.id || models[0]?.id || "";
    const none: TimelineAnswerOptions = { vaultRead: false, webSearch: false, ragSettings: [], mcpServers: [], skills: [] };
    const options = integration.answerTimeline && integration.getTimelineAnswerOptions && modelId
      ? await integration.getTimelineAnswerOptions(modelId).catch(() => none)
      : none;
    return { integration, models, modelId, options };
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
      .replace(/\.dashboard$/i, "")
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

  promptCreateDashboard(): void {
    new CreateDashboardModal(this.app, (fileName) => this.createDashboard(fileName)).open();
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
    workspace.trigger(REGISTER_RUNTIME_SKILL_EVENT, dashboardSkillForBaseDirectory(
      this.settings.baseDirectory,
      this.settings.activityTimelineName,
    ));
  }
}

/** Compatibility name used by the dashboard components while they are shared. */
/** @deprecated Use DashboardHubPlugin. Kept for source compatibility. */
export type LlmHubPlugin = DashboardHubPlugin;

function blueskyAppPasswordDesc(): DocumentFragment {
  return createFragment((fragment) => {
    fragment.appendText(`${t("settings.blueskyAppPasswordDesc")} `);
    fragment.createEl("a", { text: t("settings.blueskyOpenAppPasswords"), href: "https://bsky.app/settings/app-passwords" });
  });
}

/** The connection status row: a check button and the current state. Returns a cleanup. */
function renderBlueskyCheck(app: App, plugin: DashboardHubPlugin, setting: Setting, flush: () => void): () => void {
  const showStatus = () => {
    const { verified, handle } = plugin.settings.bluesky;
    setting.setDesc(verified ? t("settings.blueskyVerified", { handle }) : t("settings.blueskyNotVerified"));
    setting.descEl.toggleClass("mod-warning", !verified);
  };
  showStatus();
  setting.addButton((button) => {
    button.setButtonText(t("settings.blueskyVerifyButton")).setCta().onClick(async () => {
      flush();
      button.setDisabled(true).setButtonText(t("settings.blueskyVerifying"));
      try {
        await plugin.checkBlueskyConnection();
        new Notice(t("settings.blueskyVerified", { handle: plugin.settings.bluesky.handle }));
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error));
      } finally {
        button.setDisabled(false).setButtonText(t("settings.blueskyVerifyButton"));
        showStatus();
      }
    });
  });
  const workspace = app.workspace as unknown as { on: (name: string, callback: () => void) => EventRef };
  const ref = workspace.on("dashboard-hub:bluesky-changed", showStatus);
  return () => app.workspace.offref(ref);
}

type SettingKey = "baseDirectory" | "activityTimelineName" | "blueskyEnabled" | "blueskyHandle" | "blueskyService";

class DashboardHubSettingTab extends PluginSettingTab {
  constructor(app: App, private dashboardPlugin: DashboardHubPlugin) {
    super(app, dashboardPlugin);
  }

  // Bluesky text fields save once typing pauses instead of on every keystroke.
  private saveBlueskyHandle = debounce((value: string) => void this.dashboardPlugin.setBluesky({ handle: value }), 600, true);
  private saveBlueskyService = debounce((value: string) => void this.dashboardPlugin.setBluesky({ service: value }), 600, true);

  private flushBlueskyFields(): void {
    this.saveBlueskyHandle.run();
    this.saveBlueskyService.run();
  }

  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    const blueskyOn = () => this.dashboardPlugin.settings.bluesky.enabled;
    return [{
      name: "Base directory",
      desc: "Root folder for dashboards and their bases, kanbans, memos, timelines, and cached data. Changing it does not move existing files.",
      control: {
        type: "text",
        key: "baseDirectory",
        defaultValue: DASHBOARD_FOLDER,
        placeholder: DASHBOARD_FOLDER,
      },
    }, {
      name: "Activity Timeline name",
      desc: "Single Timeline that receives automatic memo, Kanban, and Calendar activity.",
      control: {
        type: "text",
        key: "activityTimelineName",
        defaultValue: "Timeline",
        placeholder: "Timeline",
      },
    }, {
      name: t("settings.timelineAiHeading"),
      desc: t("settings.timelineAiDesc"),
      render: (setting) => {
        setting.setHeading();
        // The rows depend on the connected AI Hub, so they render imperatively after the heading.
        const container = createDiv({ cls: "dashboard-hub-setting-rows" });
        setting.settingEl.after(container);
        this.renderTimelineAi(container);
        return () => {
          this.hide();
          container.remove();
        };
      },
    }, {
      type: "group",
      heading: t("settings.blueskyHeading"),
      items: [{
        name: t("settings.blueskyEnabled"),
        desc: t("settings.blueskyDesc"),
        control: { type: "toggle", key: "blueskyEnabled" },
      }, {
        name: t("settings.blueskyHandle"),
        desc: t("settings.blueskyHandleDesc"),
        visible: blueskyOn,
        control: { type: "text", key: "blueskyHandle", placeholder: "alice.bsky.social" },
      }, {
        name: t("settings.blueskyAppPassword"),
        desc: blueskyAppPasswordDesc(),
        visible: blueskyOn,
        render: (setting) => {
          setting.addComponent((el) => new SecretComponent(this.app, el)
            .setValue(this.dashboardPlugin.settings.bluesky.appPasswordSecret)
            .onChange(async (value) => {
              await this.dashboardPlugin.setBluesky({ appPasswordSecret: value });
            }));
        },
      }, {
        name: t("settings.blueskyService"),
        desc: t("settings.blueskyServiceDesc"),
        visible: blueskyOn,
        control: { type: "text", key: "blueskyService", placeholder: DEFAULT_BLUESKY_SERVICE },
      }, {
        name: t("settings.blueskyVerify"),
        visible: blueskyOn,
        render: (setting) => renderBlueskyCheck(this.app, this.dashboardPlugin, setting, () => this.flushBlueskyFields()),
      }],
    }];
  }

  getControlValue(key: string): unknown {
    if (key === "baseDirectory") return this.dashboardPlugin.settings.baseDirectory;
    if (key === "activityTimelineName") return this.dashboardPlugin.settings.activityTimelineName;
    if (key === "blueskyEnabled") return this.dashboardPlugin.settings.bluesky.enabled;
    if (key === "blueskyHandle") return this.dashboardPlugin.settings.bluesky.handle;
    if (key === "blueskyService") return this.dashboardPlugin.settings.bluesky.service;
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "baseDirectory" && typeof value === "string") {
      await this.dashboardPlugin.setBaseDirectory(value);
    } else if (key === "activityTimelineName" && typeof value === "string") {
      await this.dashboardPlugin.setActivityTimelineName(value);
    } else if (key === "blueskyEnabled" && typeof value === "boolean") {
      await this.dashboardPlugin.setBluesky({ enabled: value });
      this.refreshDomState();
    } else if (key === "blueskyHandle" && typeof value === "string") {
      this.saveBlueskyHandle(value);
    } else if (key === "blueskyService" && typeof value === "string") {
      this.saveBlueskyService(value);
    }
  }

  display(): void {
    this.hide();
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

    new Setting(this.containerEl)
      .setName("Activity Timeline name")
      .setDesc("Single Timeline that receives automatic memo, Kanban, and Calendar activity.")
      .addText((textInput) => {
        textInput
          .setPlaceholder("Timeline")
          .setValue(this.dashboardPlugin.settings.activityTimelineName)
          .onChange(async (value) => {
            await this.dashboardPlugin.setActivityTimelineName(value);
          });
      });

    new Setting(this.containerEl).setName(t("settings.timelineAiHeading")).setHeading();
    this.containerEl.createEl("p", { cls: "setting-item-description", text: t("settings.timelineAiDesc") });
    this.renderTimelineAi(this.containerEl.createDiv());

    new Setting(this.containerEl).setName(t("settings.blueskyHeading")).setHeading();
    this.renderBluesky(this.containerEl.createDiv());
  }

  hide(): void {
    this.blueskyCheckCleanup?.();
    this.blueskyCheckCleanup = null;
    if (this.integrationsRef) this.app.workspace.offref(this.integrationsRef);
    this.integrationsRef = null;
  }

  private integrationsRef: EventRef | null = null;

  private blueskyCheckCleanup: (() => void) | null = null;

  private renderBluesky(container: HTMLElement): void {
    this.blueskyCheckCleanup?.();
    this.blueskyCheckCleanup = null;
    container.empty();
    const plugin = this.dashboardPlugin;
    const bluesky = plugin.settings.bluesky;
    new Setting(container)
      .setName(t("settings.blueskyEnabled"))
      .setDesc(t("settings.blueskyDesc"))
      .addToggle((toggle) => {
        toggle.setValue(bluesky.enabled).onChange(async (value) => {
          await plugin.setBluesky({ enabled: value });
          this.renderBluesky(container);
        });
      });
    if (!bluesky.enabled) return;
    new Setting(container)
      .setName(t("settings.blueskyHandle"))
      .setDesc(t("settings.blueskyHandleDesc"))
      .addText((textInput) => {
        textInput
          .setPlaceholder("alice.bsky.social")
          .setValue(bluesky.handle)
          .onChange(this.saveBlueskyHandle);
      });
    new Setting(container)
      .setName(t("settings.blueskyAppPassword"))
      .setDesc(blueskyAppPasswordDesc())
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(bluesky.appPasswordSecret)
        .onChange(async (value) => {
          await plugin.setBluesky({ appPasswordSecret: value });
        }));
    new Setting(container)
      .setName(t("settings.blueskyService"))
      .setDesc(t("settings.blueskyServiceDesc"))
      .addText((textInput) => {
        textInput
          .setPlaceholder(DEFAULT_BLUESKY_SERVICE)
          .setValue(bluesky.service)
          .onChange(this.saveBlueskyService);
      });
    this.blueskyCheckCleanup = renderBlueskyCheck(this.app, plugin, new Setting(container).setName(t("settings.blueskyVerify")), () => this.flushBlueskyFields());
  }

  private renderTimelineAi(container: HTMLElement): void {
    const plugin = this.dashboardPlugin;
    if (!this.integrationsRef) {
      const workspace = this.app.workspace as unknown as { on: (name: string, callback: () => void) => EventRef };
      this.integrationsRef = workspace.on("dashboard-hub:integrations-changed", () => this.renderTimelineAi(container));
    }
    const render = async () => {
      const choices = await plugin.getTimelineAiChoices();
      if (!choices) {
        container.empty();
        container.createEl("p", { cls: "setting-item-description", text: t("settings.timelineAiNoHub") });
        return;
      }
      const { integration, models, modelId, options } = choices;
      const current = plugin.settings.timelineAi;
      container.empty();

      new Setting(container)
        .setName(t("settings.timelineAiModel"))
        .setDesc(integration.name)
        .addDropdown((dropdown) => {
          for (const model of models) dropdown.addOption(model.id, model.name);
          dropdown.setValue(modelId).onChange((value) => {
            plugin.rememberModel(integration.id, "timeline-reply", value);
            void render();
          });
        });

      if (!integration.answerTimeline) {
        container.createEl("p", { cls: "setting-item-description mod-warning", text: t("settings.timelineAiLegacyHub", { name: integration.name }) });
        return;
      }

      new Setting(container)
        .setName(t("settings.timelineAiVaultRead"))
        .setDesc(options.vaultRead ? t("settings.timelineAiVaultReadDesc") : t("settings.timelineAiUnsupported"))
        .addToggle((toggle) => {
          toggle.setValue(options.vaultRead && current.allowVaultRead).setDisabled(!options.vaultRead)
            .onChange((value) => void plugin.setTimelineAi({ allowVaultRead: value }));
        });

      const searchValues = [
        ...(options.webSearch ? ["web"] : []),
        ...options.ragSettings.map((name) => `rag:${name}`),
      ];
      new Setting(container)
        .setName(t("settings.timelineAiSearch"))
        .setDesc(searchValues.length > 0 ? t("settings.timelineAiSearchDesc") : t("settings.timelineAiUnsupported"))
        .addDropdown((dropdown) => {
          dropdown.addOption("", t("settings.timelineAiSearchNone"));
          if (options.webSearch) dropdown.addOption("web", t("settings.timelineAiSearchWeb"));
          for (const name of options.ragSettings) dropdown.addOption(`rag:${name}`, `RAG: ${name}`);
          dropdown.setValue(searchValues.includes(current.search) ? current.search : "")
            .setDisabled(searchValues.length === 0)
            .onChange((value) => void plugin.setTimelineAi({ search: value }));
        });

      const toggleList = (heading: string, desc: string, items: { id: string; name: string }[], key: "mcpServers" | "skills") => {
        if (items.length === 0) return;
        new Setting(container).setName(heading).setDesc(desc);
        for (const entry of items) {
          new Setting(container)
            .setName(entry.name)
            .setClass("dashboard-hub-setting-indent")
            .addToggle((toggle) => {
              toggle.setValue(current[key].includes(entry.id)).onChange((value) => {
                const selected = plugin.settings.timelineAi[key].filter((id) => id !== entry.id);
                void plugin.setTimelineAi({ [key]: value ? [...selected, entry.id] : selected });
              });
            });
        }
      };
      toggleList(t("settings.timelineAiMcp"), t("settings.timelineAiMcpDesc"), (options.mcpServers ?? []).map((name) => ({ id: name, name })), "mcpServers");
      toggleList(t("settings.timelineAiSkills"), t("settings.timelineAiSkillsDesc"), options.skills ?? [], "skills");
    };
    void render();
  }
}

