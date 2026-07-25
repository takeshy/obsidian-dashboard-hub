# Dashboard Hub

[English](README.md) | [日本語](README_ja.md)

Dashboard Hub puts Obsidian Bases, files, Kanban boards, Calendars, Timelines,
web pages, reading memos, and encrypted secrets in one responsive dashboard.
Supported actions such as moving a Kanban card or saving a memo can also be
recorded in a dated Markdown Timeline.

![A Dashboard Hub workspace with Kanban, Calendar, and Timeline widgets](docs/images/dashboard-overview.png)

It works without an AI account, API key, or external database.

## Activity Timeline

You can post directly to a Timeline with tags, wikilinks, pinned posts, filters,
and image attachments. Dashboard Hub can also add entries for these actions:

| When you… | The Timeline records |
| --- | --- |
| Drag a Kanban card to a new column | The board, a link to the note, and `old status` → `new status` |
| Reschedule a Calendar event | The event summary and `old date` → `new date` |
| Create, edit, or delete a reading memo | The action, a link to the source document, and the memo with its quote |
| Write a post yourself | Whatever you wrote — a note to self, what you're working on, why you changed your mind |

![Timeline showing Calendar events and automatically recorded reading memo activity](docs/images/dashboard-timeline.png)

Entries are stored as Obsidian callouts in
`<Base directory>/Timeline/<name>/YYYY-MM-DD.md`, one file per day. Calendar
shows events and posts from a selected Timeline in a monthly view. Automatic
memo, Kanban, and Calendar activity uses the global **Activity Timeline name**,
which defaults to `Timeline`.

## Secret Manager

Secret Manager stores API keys, tokens, and other values as `.encrypted` files
under `Secrets/` by default. Secrets can be searched by name and public metadata,
copied, and edited in place. The password is cached in memory for the session.

It uses hybrid encryption: the public key can encrypt a value without a
password, but the password-protected private key is required to decrypt it.
Secret Manager is intended for convenient access inside a vault, not as a
replacement for a dedicated password manager.

## Reading memos

Open a PDF, EPUB, or Markdown note in the File widget, select text, and save a
memo with its quote context. Saved ranges are highlighted while the memo panel
is open, and selecting a memo jumps back to the source. MemoList provides a
searchable index, and memo changes are recorded in the activity Timeline.

![Taking linked reading memos from a PDF](docs/images/dashboard-memos.gif)

## Dashboards and layout

Widgets can be moved, resized, maximized, and configured. Layout changes support
undo and redo, and widgets can be arranged into equal rows or columns. A
small-screen layout is generated automatically. Changes are saved as you edit.

![Rearranging widgets on a dashboard](docs/images/dashboard-arrange.gif)

Each dashboard is stored as a readable YAML `.dashboard` file with a documented
schema. It can be inspected, versioned, searched, and backed up like other vault
files.

## Widgets

| Widget | What it brings to your dashboard |
| --- | --- |
| **Timeline** | Your activity log: automatic entries from other widgets plus your own posts, with tags, wikilinks, pinned posts, filters, and image attachments. |
| **Calendar** | Events and activity from a Timeline, collected into a monthly view with day details. Rescheduling logs back to the Timeline. |
| **Kanban** | Notes grouped by a frontmatter status field. Dragging a card updates the source note and records the change. Board definitions are reusable across dashboards. |
| **Secret Manager** | Password-protected `.encrypted` files: search, unlock, copy, edit in place, and per-secret metadata. |
| **File** | Markdown, text, HTML, images, PDF, EPUB, code, CSV, and more. Plain-text formats can be edited inline; PDF, EPUB, and Markdown support quote-linked memos. |
| **MemoList** | A searchable index of reading memos stored under the configured Base directory. |
| **Base** | Obsidian's native Bases tables, cards, and lists, with an editor for the first view. |
| **Web Embed** | Any embeddable HTTP or HTTPS page, with a quick link to open it in the browser. |
| **Workflow** | Run a connected Hub workflow and keep its Markdown or HTML output on the dashboard. |

The launcher opens Dashboard, Workflow, Timeline, Calendar, MemoList, Kanban,
and Secret Manager directly.

![Dashboard Hub launcher for opening each activity tool directly](docs/images/dashboard-launcher.png)

## Get started

1. Install and enable Dashboard Hub. It requires Obsidian 1.10.0 or later.
2. Open the rocket launcher in the ribbon, or run **Dashboard Hub: Create
   dashboard** from the command palette.
3. Choose **Add widget**, configure it, and drag or resize it into place.

The default **Base directory** is `Dashboards` and can be changed in the plugin
settings. New dashboards and supporting files use these locations:

```text
Dashboards/
├── *.dashboard             # YAML dashboard definitions
├── Bases/                  # Obsidian .base files
├── Kanbans/                # Reusable .kanban definitions
├── Memos/                  # Reading memos
└── Timeline/<name>/        # Activity log and attachments, one file per day
```

Secret Manager uses `.encrypted` files under `Secrets/` by default. Changing the
Base directory does not move existing files.

The interface is available in English, Japanese, Spanish, French, Chinese,
Korean, Portuguese, Italian, and German.

## Optional: add AI

AI features are optional. Install one of these compatible plugins from
Obsidian's Community plugins:
**[Gemini Helper](https://github.com/takeshy/obsidian-gemini-helper)**,
**[Local LLM Hub](https://github.com/takeshy/obsidian-local-llm-hub)**, or
**[LLM Hub](https://github.com/takeshy/obsidian-llm-hub)**.

Connected plugins provide the models and can answer questions about selected
text or reading memos, generate or edit a Base, rewrite Timeline posts, and
create, edit, or run Workflows.

Dashboard Hub shares its Base directory and activity Timeline name with the
connected plugin. Date-based questions can therefore read the requested day's
Markdown file without scanning the full history.

## Install from source

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<your-vault>/.obsidian/plugins/dashboard-hub/
```

Reload Obsidian and enable **Dashboard Hub** under Community plugins.

## Development

```bash
npm test     # vitest
npm run build
```

## License

MIT
