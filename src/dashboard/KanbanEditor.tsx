import { useCallback, useEffect, useMemo, useState } from "react";
import { Columns3, Settings, X } from "lucide-react";
import { t } from "src/i18n";
import type { LlmHubPlugin } from "src/plugin";
import { parseKanbanFile, serializeKanbanFile, type KanbanBoardDefinition } from "./kanbanFile";
import type { WidgetContext } from "./types";
import KanbanWidget from "./widgets/KanbanWidget";
import { KanbanConfigEditor } from "./widgets/config-editors/KanbanConfigEditor";

interface KanbanEditorProps {
  plugin: LlmHubPlugin;
  sourcePath: string;
  fileName: string;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}

export function KanbanEditor({ plugin, sourcePath, fileName, yamlContent, onYamlChange }: KanbanEditorProps) {
  const parsed = useMemo(() => parseKanbanFile(yamlContent), [yamlContent]);
  const [definition, setDefinition] = useState<KanbanBoardDefinition | null>(parsed);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => setDefinition(parsed), [parsed]);

  const updateDefinition = useCallback((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const next = value as KanbanBoardDefinition;
    setDefinition(next);
    onYamlChange(serializeKanbanFile(next));
  }, [onYamlChange]);

  const ctx = useMemo<WidgetContext>(() => ({
    app: plugin.app,
    plugin,
    sourcePath,
    size: { w: 12, h: 12 },
    editMode: false,
    widgetId: sourcePath,
    onConfigChange: updateDefinition,
  }), [plugin, sourcePath, updateDefinition]);

  return (
    <div className="llm-hub-kanban-view">
      <div className="llm-hub-db-toolbar">
        <div className="llm-hub-db-toolbar-left">
          <Columns3 size={16} />
          <span className="llm-hub-db-title">{fileName}</span>
        </div>
        <div className="llm-hub-db-toolbar-right">
          <button
            type="button"
            className="llm-hub-db-toolbtn"
            onClick={() => setShowSettings(true)}
            title={t("dashboard.settings")}
          >
            <Settings size={14} />
            {t("dashboard.settings")}
          </button>
        </div>
      </div>

      <div className="llm-hub-kanban-view-body">
        {definition
          ? <KanbanWidget config={definition} ctx={ctx} />
          : <div className="llm-hub-db-widget-empty">{t("dashboard.kanbanFileError")}</div>}
      </div>

      {showSettings && definition && (
        <div className="llm-hub-db-panel-overlay" onClick={() => setShowSettings(false)}>
          <div className="llm-hub-db-panel" onClick={(event) => event.stopPropagation()}>
            <div className="llm-hub-db-modal-header">
              <div className="llm-hub-db-panel-title">
                <Columns3 size={18} />
                <h3>{t("dashboard.settings")}</h3>
              </div>
              <button
                type="button"
                className="llm-hub-db-iconbtn"
                onClick={() => setShowSettings(false)}
                title={t("dashboard.done")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="llm-hub-db-panel-body">
              <p className="llm-hub-db-hint">{t("dashboard.settingsAutoSaved")}</p>
              <KanbanConfigEditor
                config={definition}
                onChange={updateDefinition}
                app={plugin.app}
                plugin={plugin}
                widgetId={sourcePath}
                sourcePath={sourcePath}
                hideFilePicker
              />
            </div>
            <div className="llm-hub-db-panel-footer is-end">
              <button className="llm-hub-db-primary-btn" onClick={() => setShowSettings(false)}>
                {t("dashboard.done")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
