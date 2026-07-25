import { t } from "src/i18n";
import type { ConfigEditorProps } from "../../types";
import type { SecretManagerConfig } from "../../secretManager";

export function SecretManagerConfigEditor({ config, onChange }: ConfigEditorProps) {
  const cfg = (config ?? {}) as SecretManagerConfig;
  return (
    <div className="dashboard-hub-db-fields">
      <div className="dashboard-hub-db-field">
        <label>{t("dashboard.secretFolder")}</label>
        <input type="text" value={cfg.folder ?? ""} onChange={(event) => onChange({ ...cfg, folder: event.target.value })} placeholder="Secrets" />
        <p className="dashboard-hub-db-hint">{t("dashboard.secretFolderHint")}</p>
      </div>
    </div>
  );
}
