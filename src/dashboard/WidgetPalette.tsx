import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { listWidgetDefs } from "./widgets/registry";
import type { WidgetDef } from "./types";
import { t } from "src/i18n";
import type { DashboardHubPlugin } from "src/plugin";

interface WidgetPaletteProps {
  onSelect: (def: WidgetDef) => void;
  onClose: () => void;
  plugin: DashboardHubPlugin;
}

/**
 * Modal palette showing all registered widget types. Selecting a type calls
 * onSelect with the WidgetDef.
 */
export function WidgetPalette({ onSelect, onClose, plugin }: WidgetPaletteProps) {
  const defs = listWidgetDefs().filter((def) => def.type !== "workflow" || plugin.hasCapability("workflow"));

  const modal = (
    <div className="dashboard-hub-db-modal-overlay" onClick={onClose}>
      <div className="dashboard-hub-db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dashboard-hub-db-modal-header">
          <h3>{t("dashboard.addWidget")}</h3>
          <button className="dashboard-hub-db-iconbtn" onClick={onClose} title={t("dashboard.cancel")}>
            <X size={18} />
          </button>
        </div>
        <div className="dashboard-hub-db-palette-grid">
          {defs.map((def) => (
            <button
              key={def.type}
              onClick={() => onSelect(def)}
              className="dashboard-hub-db-palette-item"
            >
              <div className="dashboard-hub-db-palette-icon">{def.icon}</div>
              <span>{def.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
