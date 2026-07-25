import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";
import type { App } from "obsidian";
import { getWidgetDef } from "./widgets/registry";
import type { Widget } from "./types";
import type { DashboardHubPlugin } from "src/plugin";
import { t } from "src/i18n";

interface WidgetSettingsPanelProps {
  widget: Widget;
  app: App;
  plugin: DashboardHubPlugin;
  sourcePath: string;
  onChange: (config: unknown) => void;
  onClose: () => void;
  onDone: () => void;
  onDelete: () => void;
}

/**
 * Side panel for editing a widget's configuration. Renders the widget type's
 * ConfigEditor (if any) and provides a delete action.
 */
export function WidgetSettingsPanel({
  widget,
  app,
  plugin,
  sourcePath,
  onChange,
  onClose,
  onDone,
  onDelete,
}: WidgetSettingsPanelProps) {
  const def = getWidgetDef(widget.type);
  const ConfigEditor = def.ConfigEditor;

  const panel = (
    <div className="dashboard-hub-db-panel-overlay" onClick={onClose}>
      <div className="dashboard-hub-db-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dashboard-hub-db-modal-header">
          <div className="dashboard-hub-db-panel-title">
            <span className="dashboard-hub-db-palette-icon">{def.icon}</span>
            <h3>{def.label}</h3>
          </div>
          <button className="dashboard-hub-db-iconbtn" onClick={onClose} title={t("dashboard.done")}>
            <X size={18} />
          </button>
        </div>

        <div className="dashboard-hub-db-panel-body">
          {ConfigEditor ? (
            <>
              <p className="dashboard-hub-db-hint">{t("dashboard.settingsAutoSaved")}</p>
              <ConfigEditor
                key={widget.id}
                config={widget.config}
                onChange={onChange}
                app={app}
                plugin={plugin}
                widgetId={widget.id}
                sourcePath={sourcePath}
              />
            </>
          ) : (
            <p className="dashboard-hub-db-empty-hint">{t("dashboard.noSettings")}</p>
          )}
        </div>

        <div className="dashboard-hub-db-panel-footer">
          <button className="dashboard-hub-db-danger-link" onClick={onDelete}>
            <Trash2 size={14} />
            {t("dashboard.deleteWidget")}
          </button>
          <button className="dashboard-hub-db-primary-btn" onClick={onDone}>
            {t("dashboard.done")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
