import { ExternalLink } from "lucide-react";
import { t } from "src/i18n";
import type { WidgetContext } from "../types";
import { safeWebUrl } from "./webUrl";

interface WebConfig {
  url?: string;
  showHeader?: boolean;
}

export default function WebWidget({
  config,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const cfg = (config ?? {}) as WebConfig;
  const configuredUrl = typeof cfg.url === "string" ? cfg.url : "";
  const href = safeWebUrl(configuredUrl);
  const showHeader = cfg.showHeader !== false;

  if (!configuredUrl) {
    return <div className="dashboard-hub-db-widget-empty">{t("dashboard.noUrl")}</div>;
  }

  if (!href) {
    return <div className="dashboard-hub-db-widget-empty">{t("dashboard.urlInvalid")}</div>;
  }

  return (
    <div className="dashboard-hub-db-web-wrap">
      {showHeader && (
        <div className="dashboard-hub-db-web-header">
          <span className="dashboard-hub-db-web-url">{href}</span>
          <a
            className="dashboard-hub-db-iconbtn"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={t("dashboard.webOpenExternal")}
            aria-label={t("dashboard.webOpenExternal")}
          >
            <ExternalLink size={13} />
          </a>
        </div>
      )}
      <iframe
        className="dashboard-hub-db-web"
        src={href}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}
