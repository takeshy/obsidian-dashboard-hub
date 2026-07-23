import { t } from "src/i18n";
import type { ConfigEditorProps } from "../../types";

interface CalendarConfig { timelineName?: string }

export function CalendarConfigEditor({ config, onChange }: ConfigEditorProps) {
  const value = (config ?? {}) as CalendarConfig;
  return <div className="llm-hub-db-config-form">
    <div className="llm-hub-db-config-field">
      <label>{t("dashboard.timelineName")}</label>
      <input type="text" value={value.timelineName ?? "Timeline"} onChange={(event) => onChange({ ...value, timelineName: event.target.value })} />
      <p className="llm-hub-db-hint">{t("dashboard.calendarTimelineHint")}</p>
    </div>
  </div>;
}
