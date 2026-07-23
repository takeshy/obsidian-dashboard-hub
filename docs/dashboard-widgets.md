---
type: Feature Reference
title: Dashboard Widgets
description: Detailed behavior, settings, storage, and caveats for every built-in dashboard widget type.
tags: [dashboard, widgets, base, kanban, secret-manager, timeline, calendar]
timestamp: 2026-07-11T00:00:00Z
---

# Dashboard Widgets

Dashboard widgets are provided by the separate Dashboard Hub plugin and selected from its Add widget palette. LLM Hub connects to Dashboard Hub for optional AI actions. Unknown widget types are preserved and shown as placeholders.

Widgets share common dashboard controls: drag to move, resize from the corner, open settings with the gear button, maximize/restore, delete from settings, and use toolbar undo/redo. The toolbar's horizontal and vertical align actions redistribute all widgets into balanced columns or rows.

# Base Widget

The Base widget renders the first view of an Obsidian `.base` file using Obsidian's native Bases UI. Use it for structured note lists, tables, card views, and list views instead of rebuilding those views manually.

Settings and actions:

- Base file - vault path to the `.base` file.
- New Base - creates a `.base` file under `<Base directory>/Bases/`.
- View editor - edits the first view's name, type, order, sort, limit, filters, card image, list indentation, and raw YAML. The editor handles the `table`, `cards`, and `list` types.
- Date filters accept a fixed date, `today()`, or a relative number of days, months, or years with an explicit past (`-`) or future (`+`) direction. Date equality compares the date portion so time-bearing values can match today.

If the `.base` file changed outside the settings panel, the editor reloads before saving to avoid overwriting newer content.

# File Widget

The File widget renders a vault file inline. Supported file types include Markdown, text, HTML, JSON, CSV/TSV, JavaScript/TypeScript, CSS, XML, YAML, images, PDF, and EPUB. Unsupported files show an open button. Plain-text files (text, JSON, CSV, code, and similar) are edited inline; a Save button writes changes back to the file.

Settings:

- File - searchable picker for the vault file path.
- Show header - shows a compact header with file path, open button, and memo button.

For document reading, selected text has context actions:

- Copy - copy selected text.
- Ask AI - prefill Chat with the selected text.
- Add to memo - attach the selected quote to a reading memo.

Memos are stored under `<Base directory>/Memos/` using the source file path. Quote anchors include context when possible so memo links can jump back to repeated text more reliably. While the memo panel is open, saved memo ranges are highlighted. Empty memo text is allowed when a quote link is attached. The memo panel's open and collapsed state is saved in the widget config (`memoPanelOpen`, `memoPanelCollapsed`), so it persists with the dashboard.

# Web Embed Widget

The Web widget embeds an `http` or `https` URL in an iframe.

Settings:

- URL - page URL to embed.
- Show header - shows a compact header with URL and browser-open button.

Some sites block iframes with `X-Frame-Options` or `Content-Security-Policy`; those pages may appear blank. Use the browser-open button for blocked pages.

# Kanban Widget

The Kanban widget renders notes matching a tag and/or folder filter as cards grouped by a frontmatter status property. Dragging a card to another column updates that note's frontmatter. Dragging within a column persists manual card order. Clicking a card opens a preview modal with an open-note action.

Settings:

- Board title - optional header title.
- Tag filter - only show notes with this tag; omit `#`; empty means all tags.
- Folder filter - only show notes whose path starts with this folder; empty means the whole vault.
- Status property - frontmatter property used for columns; default `status`.
- Title property - frontmatter property shown as card title; empty uses file name.
- Columns - ordered list of status values and labels.
- Display fields - ordered frontmatter fields shown below the title, such as `priority` or `due`.
- Show unmatched cards column - shows an "Unspecified" column for notes whose status matches no configured column.
- Linked Timeline - optional existing Timeline selected with a searchable picker. When set, every move to a different column appends a `Kanban · <board name>` info callout with the task link and old/new status labels in its body. Clearing the picker disables Timeline integration.

The New button creates a note matching the board filters: folder, tag, selected column status, and (when configured) the title property are written into the new note.

Kanban definitions are stored as reusable `.kanban` files under `<Base directory>/Kanbans/`. Legacy inline widget definitions are migrated there automatically when a dashboard is opened. The shared board file stores filters, columns, title/display fields, and public board settings; per-widget card order remains in the `.dashboard` file, so the same board can be reused across dashboards with independent card ordering.

# Secret Manager Widget

The Secret Manager widget lists `.encrypted` vault files and lets the user create, search, unlock, copy, edit, and open encrypted secrets from a dashboard. It uses the keys configured in Dashboard Hub settings, or keys imported from an installed Hub AI plugin.

Settings and behavior:

- Folder - optional root folder for `.encrypted` files; default is `Secrets`.
- Search - matches secret name, description, and public metadata without decrypting values.
- Detail modal - shows modified time instead of the vault path, includes an open-file action, and can unlock/copy/edit the secret.
- Public metadata - stored outside the ciphertext for search/listing and edited as `key: value` pairs; do not put sensitive values there.
- Secret value - decrypted only in memory while unlocked and saved back encrypted.

# Timeline Widget

The Timeline widget stores short dated posts under `<Base directory>/Timeline/<name>/`, one Markdown file per day. It renders a chronological feed (oldest first) that auto-scrolls to the latest post, with composer, filters, pinned posts, image attachments, inline editing, and AI-assisted rewriting. A Load older button at the top of the feed loads earlier posts.

Settings:

- Timeline name - folder name under `<Base directory>/Timeline/`; sanitized for file paths.
- Latest posts to show - initial number of recent posts to render.
- Collapse after lines - visual line threshold for collapsed preview; default 8.
- Collapse after characters - character threshold for collapsed preview; default 440.

Posts can contain tags, images, and wikilinks. Typing `[[` in the composer or inline editor opens a file suggestion popup; arrow keys or Tab navigate and Enter inserts the link. Long posts and embedded notes collapse with Show more / Show less. Timeline image attachments are saved under `<Base directory>/Timeline/<name>/attachments/<date>/`.

# Calendar Widget

The Calendar widget connects to one named Timeline and shows a fixed-size monthly calendar. Day markers distinguish scheduled events and Timeline activity.

Clicking a date opens a modal instead of expanding the widget. The modal shows events scheduled for the date and Timeline posts written on the date.

![Calendar day details](../../../images/calendar_date.png)

Events are stored in the selected Timeline's per-day Markdown file as normal Timeline posts with a `calendar-event` marker and an Obsidian calendar callout. Changing the event date in the modal moves the post to the corresponding day file. An event appears on its scheduled date, while its registration also appears as Timeline activity on the date it was written.

Settings:

- Timeline name - Timeline folder to read and write; default `Timeline`.
![Calendar event form](../../../images/calendar_event.png)

# MemoList Widget

The MemoList widget lists File-widget memo files under `<Base directory>/Memos/`. Use it as an index for reading notes across PDFs, EPUBs, Markdown notes, and other files. A search box filters rows by source file path, and long lists are paginated 20 rows per page.

Clicking a memo row does not navigate away from the dashboard. The MemoList widget maximizes and temporarily displays the selected source file with its memo panel open. Restoring the widget returns to the MemoList.

# Unknown Widget Placeholder

If a dashboard contains a widget type that is not registered in the current plugin version, LLM Hub renders an Unknown placeholder and preserves the widget config on save. This prevents data loss when opening dashboards created by newer versions or extensions.
