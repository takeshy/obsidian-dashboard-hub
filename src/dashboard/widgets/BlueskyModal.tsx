import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal, Notice, TFile, normalizePath, type App } from "obsidian";
import { ExternalLink, Image as ImageIcon, Loader2, Send, Type } from "lucide-react";
import { t } from "src/i18n";
import type { DashboardHubPlugin } from "src/plugin";
import {
  blueskyContent,
  blueskyImageCaption,
  blueskyPrefersImage,
  buildBlueskyPreview,
  prepareBlueskyImage,
  publishBlueskyPosts,
  type BlueskyEntry,
  type BlueskyImage,
  type BlueskyImageRef,
} from "../bluesky";
import { connectBluesky } from "../blueskyClient";
import { renderBlueskySnapshot } from "../blueskySnapshot";

const MAX_SOURCE_IMAGE_BYTES = 20_000_000;

function sniffImageMime(bytes: Uint8Array): string {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "";
}

function resolveImageFile(app: App, ref: BlueskyImageRef, sourcePath: string): TFile | null {
  if (ref.wiki) {
    const dest = app.metadataCache.getFirstLinkpathDest(ref.target, sourcePath)
      ?? app.metadataCache.getFirstLinkpathDest(ref.target.replace(/^\/+/, ""), sourcePath);
    return dest;
  }
  const dir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  for (const candidate of [dir ? `${dir}/${ref.target}` : ref.target, ref.target.replace(/^\/+/, "")]) {
    const file = app.vault.getAbstractFileByPath(normalizePath(candidate));
    if (file instanceof TFile) return file;
  }
  return null;
}

type Snapshot = { state: "pending" } | { state: "done"; images: BlueskyImage[] } | { state: "failed" };

/** What a text post shows: the published text and the Vault images attached to it. */
function TextBody({ app, entry }: { app: App; entry: BlueskyEntry }) {
  const content = useMemo(() => blueskyContent(entry.content), [entry.content]);
  const attachments = content.images
    .map(ref => resolveImageFile(app, ref, entry.sourcePath))
    .filter((file): file is TFile => file instanceof TFile);
  return <>
    {content.text && <span className="dashboard-hub-db-bluesky-entry-text">{content.text}</span>}
    {attachments.length > 0 && <span className="dashboard-hub-db-bluesky-entry-images">
      {attachments.map(file => <img key={file.path} src={app.vault.getResourcePath(file)} alt="" />)}
    </span>}
  </>;
}

function BlueskyDialog({ app, plugin, entries, initialId, onClose }: {
  app: App;
  plugin: DashboardHubPlugin;
  entries: BlueskyEntry[];
  initialId: string;
  onClose: () => void;
}) {
  const connected = Boolean(plugin.getBlueskyCredentials());
  const [selected, setSelected] = useState(() => new Set(entries.some(entry => entry.id === initialId) ? [initialId] : []));
  const [asImage, setAsImage] = useState(() => new Set(entries.filter(entry => blueskyPrefersImage(entry.content)).map(entry => entry.id)));
  const [snapshots, setSnapshots] = useState(() => new Map<string, Snapshot>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  // One render per entry for the dialog's lifetime, so a retried publish sends the same pictures.
  const renders = useRef(new Map<string, Promise<BlueskyImage[] | null>>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const loadEntryImage = async (ref: BlueskyImageRef, entry: BlueskyEntry): Promise<BlueskyImage> => {
    const file = resolveImageFile(app, ref, entry.sourcePath);
    if (!(file instanceof TFile)) throw new Error("Cannot find the Vault image");
    const raw = await app.vault.readBinary(file);
    if (raw.byteLength > MAX_SOURCE_IMAGE_BYTES) throw new Error("This image is too large for Bluesky");
    return prepareBlueskyImage(raw, sniffImageMime(new Uint8Array(raw)), ref.alt);
  };

  const setSnapshot = (id: string, snapshot: Snapshot) => setSnapshots(prev => new Map(prev).set(id, snapshot));

  /** The entry's pictures, or null when it cannot be drawn and goes out as text. Renders run one at a time. */
  const snapshotFor = (entry: BlueskyEntry): Promise<BlueskyImage[] | null> => {
    const existing = renders.current.get(entry.id);
    if (existing) return existing;
    setSnapshot(entry.id, { state: "pending" });
    const render = queue.current.then(() => renderBlueskySnapshot(app, entry.content, entry.sourcePath)).then(
      images => { setSnapshot(entry.id, { state: "done", images }); return images; },
      caught => {
        console.warn("Dashboard Hub: Bluesky image rendering failed", caught);
        setSnapshot(entry.id, { state: "failed" });
        return null;
      },
    );
    queue.current = render;
    renders.current.set(entry.id, render);
    return render;
  };

  useEffect(() => {
    for (const entry of entries) {
      if (selected.has(entry.id) && asImage.has(entry.id)) void snapshotFor(entry);
    }
  }, [entries, selected, asImage]);

  const toggleIn = (setter: typeof setSelected) => (id: string, checked: boolean) => {
    setter(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleEntry = toggleIn(setSelected);
  const setFormat = toggleIn(setAsImage);

  const rendering = [...selected].some(id => asImage.has(id) && snapshots.get(id)?.state === "pending");

  const publish = async () => {
    const credentials = plugin.getBlueskyCredentials();
    if (!credentials) throw new Error(t("bluesky.notConfigured"));
    const posts = await buildBlueskyPreview(entries, selected, loadEntryImage, { ids: asImage, render: snapshotFor });
    const connection = await connectBluesky(credentials);
    const result = await publishBlueskyPosts(connection.api, connection.did, posts);
    setUrls(result.urls);
    new Notice(t("bluesky.published"));
  };

  const imageBody = (entry: BlueskyEntry) => {
    const snapshot = snapshots.get(entry.id);
    if (!snapshot || snapshot.state === "pending") {
      return <span className="dashboard-hub-db-bluesky-entry-note"><Loader2 size={12} className="is-spinning" /> {t("bluesky.rendering")}</span>;
    }
    if (snapshot.state === "failed") {
      return <>
        <span className="dashboard-hub-db-bluesky-entry-note mod-warning">{t("bluesky.imageFallback")}</span>
        <TextBody app={app} entry={entry} />
      </>;
    }
    const caption = blueskyImageCaption(entry.content);
    return <>
      {caption && <span className="dashboard-hub-db-bluesky-entry-text">{caption}</span>}
      <span className="dashboard-hub-db-bluesky-entry-pages">
        {snapshot.images.map((image, index) => <img key={index} src={`data:${image.mime};base64,${image.data}`} alt={image.alt} />)}
      </span>
    </>;
  };

  return <div className="dashboard-hub-db-bluesky">
    <h2>{t("bluesky.title")}</h2>
    <p className="dashboard-hub-db-bluesky-desc">{t("bluesky.desc")}</p>
    {connected
      ? <p className="dashboard-hub-db-bluesky-connection">{t("bluesky.connectedAs", { handle: plugin.settings.bluesky.handle })}</p>
      : <p className="dashboard-hub-db-bluesky-error" role="alert">{t("bluesky.notConfigured")}</p>}
    <div className="dashboard-hub-db-bluesky-entries">
      {entries.map(entry => {
        const chosen = selected.has(entry.id);
        const image = chosen && asImage.has(entry.id);
        const locked = busy || urls.length > 0;
        return <div key={entry.id} className={`dashboard-hub-db-bluesky-entry${chosen ? " is-selected" : ""}`}>
          <div className="dashboard-hub-db-bluesky-entry-head">
            <label className="dashboard-hub-db-bluesky-entry-select">
              <input
                type="checkbox"
                checked={chosen}
                disabled={locked}
                onChange={event => toggleEntry(entry.id, event.target.checked)}
              />
              <strong>{entry.authorName || entry.speaker}</strong>
            </label>
            {chosen && <div className="dashboard-hub-db-bluesky-format" role="group" aria-label={t("bluesky.format")}>
              {([false, true] as const).map(value => <button
                key={String(value)}
                type="button"
                className={asImage.has(entry.id) === value ? "is-active" : ""}
                aria-pressed={asImage.has(entry.id) === value}
                disabled={locked}
                title={value ? t("bluesky.formatImageDesc") : undefined}
                onClick={() => setFormat(entry.id, value)}
              >
                {value ? <ImageIcon size={12} /> : <Type size={12} />}
                {value ? t("bluesky.formatImage") : t("bluesky.formatText")}
              </button>)}
            </div>}
          </div>
          <div className="dashboard-hub-db-bluesky-entry-body">
            {image ? imageBody(entry) : <TextBody app={app} entry={entry} />}
          </div>
        </div>;
      })}
    </div>
    {error && <p className="dashboard-hub-db-bluesky-error" role="alert">{error}</p>}
    {urls.length > 0 && <p className="dashboard-hub-db-bluesky-status" role="status">
      {t("bluesky.published")} <a href={urls[0]} target="_blank" rel="noreferrer">{t("bluesky.openPost")} <ExternalLink size={11} /></a>
    </p>}
    <div className="dashboard-hub-db-bluesky-footer">
      <button type="button" disabled={busy} onClick={onClose}>{t("common.close")}</button>
      {urls.length === 0 && <button
        type="button"
        className="dashboard-hub-db-primary-btn"
        disabled={busy || rendering || !connected || selected.size === 0}
        onClick={() => void run(publish)}
      >
        {busy || rendering ? <Loader2 size={13} className="is-spinning" /> : <Send size={13} />}
        {busy ? t("bluesky.publishing") : t("bluesky.publish")}
      </button>}
    </div>
  </div>;
}

export class BlueskyModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private plugin: DashboardHubPlugin,
    private entries: BlueskyEntry[],
    private initialId: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("dashboard-hub-db-bluesky-modal");
    this.contentEl.empty();
    this.root = createRoot(this.contentEl);
    this.root.render(<BlueskyDialog
      app={this.app}
      plugin={this.plugin}
      entries={this.entries}
      initialId={this.initialId}
      onClose={() => this.close()}
    />);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
