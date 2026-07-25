import { Globe, ExternalLink } from "lucide-react";
import { t } from "src/i18n";
import type { ConfigEditorProps } from "../../types";
import { safeWebUrl } from "../webUrl";

interface WebConfig {
  url?: string;
  showHeader?: boolean;
}

export function WebConfigEditor({ config, onChange }: ConfigEditorProps) {
  const cfg = (config ?? {}) as WebConfig;
  const url = cfg.url ?? "";
  const valid = !url || safeWebUrl(url) !== null;
  const showPreview = !!url && valid;

  return (
    <div className="dashboard-hub-db-fields">
      <div className="dashboard-hub-db-field">
        <label>{t("dashboard.url")}</label>
        <div className="dashboard-hub-db-input-icon">
          <Globe size={14} className="dashboard-hub-db-input-leadicon" />
          <input
            type="url"
            value={url}
            onChange={(e) => onChange({ ...cfg, url: e.target.value })}
            placeholder="https://example.com"
          />
        </div>
        {!valid && <p className="dashboard-hub-db-error">{t("dashboard.urlInvalid")}</p>}
      <p className="dashboard-hub-db-hint">{t("dashboard.webHint")}</p>
    </div>

    <div className="dashboard-hub-db-field">
      <label className="dashboard-hub-db-kanban-checkbox">
        <input
          type="checkbox"
          checked={cfg.showHeader !== false}
          onChange={(e) => onChange({ ...cfg, showHeader: e.target.checked })}
        />
        {t("dashboard.webShowHeader")}
      </label>
    </div>

    {showPreview && (
        <a
          className="dashboard-hub-db-web-open"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={13} />
          {t("dashboard.webOpenExternal")}
        </a>
      )}
    </div>
  );
}
