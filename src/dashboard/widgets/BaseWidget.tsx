// Base widget — embeds a named view of an Obsidian `.base` file via the native
// embed system, so the dashboard shows the real Bases UI (table / cards / list).

import { TFile } from "obsidian";
import { t } from "src/i18n";
import type { WidgetContext } from "../types";
import ObsidianMarkdown from "./ObsidianMarkdown";

export interface BaseConfig {
  /** Vault path of the `.base` file, e.g. "Dashboards/Bases/Tasks.base". */
  base?: string;
  /** @deprecated Ignored; Dashboard Hub always renders the first Base view. */
  view?: unknown;
}

/** Legacy config.view values are intentionally ignored: Bases owns its first view. */
export function buildBaseEmbed(linktext: string, _config: BaseConfig): string {
  return `![[${linktext}]]`;
}

export default function BaseWidget({
  config,
  ctx,
}: {
  config: unknown;
  ctx?: WidgetContext;
}) {
  const cfg = (config ?? {}) as BaseConfig;
  const basePath = (cfg.base ?? "").trim();

  if (!ctx) return null;

  if (!basePath) {
    return <div className="llm-hub-db-widget-empty">{t("dashboard.baseSelectFile")}</div>;
  }

  const file = ctx.app.vault.getAbstractFileByPath(basePath);
  // Prefer the resolved linktext (handles folders / shortest unique link); fall
  // back to the configured basename so a not-yet-cached file still attempts to
  // embed (Obsidian renders its own "not found" notice if it truly is missing).
  const linktext = file instanceof TFile
    ? ctx.app.metadataCache.fileToLinktext(file, ctx.sourcePath)
    : basePath.replace(/^.*\//, "");

  // A Base widget always follows the first view in the file. Its name and type
  // remain editable in settings, without a second view selector.
  const embed = buildBaseEmbed(linktext, cfg);

  return (
    <ObsidianMarkdown
      app={ctx.app}
      markdown={embed}
      sourcePath={ctx.sourcePath}
      className="llm-hub-db-base"
    />
  );
}
