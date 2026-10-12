import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpen, Database, FolderOpen, Globe, Plug, SearchX } from "lucide-react";
import { t } from "src/i18n";
import type { DashboardHubPlugin, TimelineAiChoices, TimelineAiSettings } from "src/plugin";

interface Props {
  plugin: DashboardHubPlugin;
  /** Called after every change so the composer button can show whether lookups are on. */
  onChange: (settings: TimelineAiSettings) => void;
}

// Chips keep the textarea focused, as the composer's other buttons do, so the
// mobile keyboard stays up while lookups are toggled.
const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault() };

function Chip({ on, disabled, icon, children, onClick }: { on: boolean; disabled?: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={`dashboard-hub-db-timeline-ai-chip${on ? " is-on" : ""}`} aria-pressed={on} disabled={disabled} {...keepFocus} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

/** @ai lookup settings, edited in place inside the composer. Shares settings with the settings tab. */
export function TimelineAiPanel({ plugin, onChange }: Props) {
  const [choices, setChoices] = useState<TimelineAiChoices | null | undefined>(undefined);
  const [settings, setSettings] = useState<TimelineAiSettings>(plugin.settings.timelineAi);

  const load = useCallback(() => {
    void plugin.getTimelineAiChoices().then(setChoices);
  }, [plugin]);
  useEffect(load, [load]);

  const update = (patch: Partial<TimelineAiSettings>) => {
    void plugin.setTimelineAi(patch).then(() => {
      setSettings(plugin.settings.timelineAi);
      onChange(plugin.settings.timelineAi);
    });
  };
  const toggleIn = (key: "mcpServers" | "skills", id: string) => {
    const current = settings[key];
    update({ [key]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] });
  };

  if (choices === undefined) return <div className="dashboard-hub-db-timeline-ai-panel is-loading">{t("dashboard.loading")}</div>;
  if (choices === null) return <div className="dashboard-hub-db-timeline-ai-panel"><p>{t("settings.timelineAiNoHub")}</p></div>;

  const { integration, models, modelId, options } = choices;
  const mcpServers = options.mcpServers ?? [];
  const skills = options.skills ?? [];
  const searchValues = ["", ...(options.webSearch ? ["web"] : []), ...options.ragSettings.map((name) => `rag:${name}`)];
  const search = searchValues.includes(settings.search) ? settings.search : "";

  return (
    <div className="dashboard-hub-db-timeline-ai-panel">
      <label className="dashboard-hub-db-timeline-ai-row">
        <span>{t("settings.timelineAiModel")}</span>
        <select
          value={modelId}
          onChange={(e) => {
            plugin.rememberModel(integration.id, "timeline-reply", e.target.value);
            // Lookups available depend on the model.
            load();
          }}
        >
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>

      {!integration.answerTimeline ? (
        <p className="mod-warning">{t("settings.timelineAiLegacyHub", { name: integration.name })}</p>
      ) : (
        <>
          <div className="dashboard-hub-db-timeline-ai-row">
            <span>{t("settings.timelineAiVaultRead")}</span>
            <div className="dashboard-hub-db-timeline-ai-chips">
              <Chip on={options.vaultRead && settings.allowVaultRead} disabled={!options.vaultRead} icon={<FolderOpen size={13} />}
                onClick={() => update({ allowVaultRead: !settings.allowVaultRead })}>
                {options.vaultRead ? t("settings.timelineAiVaultRead") : t("settings.timelineAiUnsupported")}
              </Chip>
            </div>
          </div>

          <div className="dashboard-hub-db-timeline-ai-row">
            <span>{t("settings.timelineAiSearch")}</span>
            <div className="dashboard-hub-db-timeline-ai-chips">
              <Chip on={search === ""} icon={<SearchX size={13} />} onClick={() => update({ search: "" })}>{t("settings.timelineAiSearchNone")}</Chip>
              {options.webSearch && <Chip on={search === "web"} icon={<Globe size={13} />} onClick={() => update({ search: "web" })}>{t("settings.timelineAiSearchWeb")}</Chip>}
              {options.ragSettings.map((name) => (
                <Chip key={name} on={search === `rag:${name}`} icon={<Database size={13} />} onClick={() => update({ search: `rag:${name}` })}>{name}</Chip>
              ))}
            </div>
          </div>

          {mcpServers.length > 0 && (
            <div className="dashboard-hub-db-timeline-ai-row">
              <span>{t("settings.timelineAiMcp")}</span>
              <div className="dashboard-hub-db-timeline-ai-chips">
                {mcpServers.map((server) => (
                  <Chip key={server} on={settings.mcpServers.includes(server)} icon={<Plug size={13} />} onClick={() => toggleIn("mcpServers", server)}>{server}</Chip>
                ))}
              </div>
            </div>
          )}

          {skills.length > 0 && (
            <div className="dashboard-hub-db-timeline-ai-row">
              <span>{t("settings.timelineAiSkills")}</span>
              <div className="dashboard-hub-db-timeline-ai-chips">
                {skills.map((skill) => (
                  <Chip key={skill.id} on={settings.skills.includes(skill.id)} icon={<BookOpen size={13} />} onClick={() => toggleIn("skills", skill.id)}>{skill.name}</Chip>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
