# Dashboard Hub

[English](README.md) | [日本語](README_ja.md)

**Your vault, on one screen — with a record of the work that matters.**

Dashboard Hub is an Obsidian plugin built around a single idea: the tools you
work in should leave a trail. Move a Kanban card, reschedule an event, or save a
reading memo, and Dashboard Hub writes it to a Timeline — a dated, plain
Markdown log of your activity that lives in your vault and belongs to you.

Around that log sit the tools that feed it: Obsidian Bases, Kanban boards,
Calendars, a reading workspace for PDFs and EPUBs, embedded web pages, and a
password-protected Secret Manager for the credentials you reach for every day.

![A Dashboard Hub workspace with Kanban, Calendar, and Timeline widgets](docs/images/dashboard-overview.png)

Dashboard Hub works standalone. No AI account, no API key, no external database.

## The Timeline is the point

Most dashboards show you the present. The Timeline widget accumulates your past.
It is a chronological feed you can post to directly — tags, wikilinks, pinned
posts, filters, image attachments — but it also fills itself as you work:

| When you… | The Timeline records |
| --- | --- |
| Drag a Kanban card to a new column | The board, a link to the note, and `old status` → `new status` |
| Reschedule a Calendar event | The event summary and `old date` → `new date` |
| Create, edit, or delete a reading memo | The action, a link to the source document, and the memo with its quote |
| Write a post yourself | Whatever you wrote — a note to self, what you're working on, why you changed your mind |

![Timeline showing Calendar events and automatically recorded reading memo activity](docs/images/dashboard-timeline.png)

Entries are Obsidian callouts appended to
`<Base directory>/Timeline/<name>/YYYY-MM-DD.md`, one file per day, separated
by `---`. Nothing is hidden in a database: you can read last Tuesday in any text
editor, grep it, back it up, or open it as a note.

Two things follow from that:

- **The Calendar is a view of the Timeline, not a separate store.** It collects
  events and activity from a named Timeline into a monthly view with day details.
- **Your activity log is a queryable file tree.** Ask "what did I do on the 12th?"
  and the answer is one file. This makes the log a natural input for an AI plugin
  that can read your vault (see [Optional: add AI](#optional-add-ai)).

Automatic memo, Kanban, and Calendar activity is collected in one Timeline named
`Timeline` by default. Change the global **Activity Timeline name** in Dashboard
Hub settings to use a different log.

## Secret Manager, one keystroke away

The credentials you actually need during the day — API keys, tokens, and logins
for things that have no business being in a browser vault — live in `.encrypted`
files under `Secrets/`.

Open the rocket launcher in the ribbon, pick **Secret Manager**, type part of an
ID, and copy the value. Unlock a secret once and secrets protected with the same
password require no additional prompt for the rest of the session. Each secret
can carry its own metadata fields, and values can be edited in place.

**How it works.** Every `.encrypted` file contains its own password-protected
private key and salt, so there is no plugin-level keychain or vault-wide master
file to lose. Secret values are encrypted with AES-GCM, and RSA-OAEP wraps the
random data key. This separates write capability from unlock capability: data
can be encrypted with the public key while the password-protected private key
remains locked.

New files declare crypto format version 1 and protect the private key using
PBKDF2-SHA256 with 600,000 iterations. Older unversioned files remain readable
with their original 100,000-iteration parameters. The session password is kept
in memory only and cleared when the plugin unloads or Obsidian closes; decrypted
private keys are used transiently during decryption. Nothing sensitive is
written to plugin settings.

Secret Manager is built for fast retrieval inside your vault. It is not a
replacement for a hardened, audited password manager, and the security of a file
is the security of the password you chose for it.

## Read, annotate, and return to the source

The File widget makes a dashboard a place to read, not just to survey. Open a
PDF, EPUB, or Markdown note, select a passage, and save a memo with its quote
context. Saved ranges are highlighted while the memo panel is open, and links
jump back to the quoted text. MemoList gathers those annotations into one
searchable index — and each memo also lands on the Timeline, so a month later
you can see not just what you highlighted but when you were reading it.

![Taking linked reading memos from a PDF](docs/images/dashboard-memos.gif)

## Build the screen you want

Mix native Obsidian Bases, notes, documents, websites, tasks, and events in one
view. Drag, resize, maximize, and configure widgets; undo and redo; arrange the
whole layout into balanced rows or columns. Small-screen layouts are derived
automatically. Edits save as you go.

![Rearranging widgets on a dashboard](docs/images/dashboard-arrange.gif)

Every dashboard is a readable YAML `.dashboard` file with a documented schema.
It can be inspected, versioned, searched, and backed up with ordinary tools.
There is no external database or service to keep running.

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

The core activity tools also run on their own. The launcher opens Dashboard,
Workflow, Timeline, Calendar, MemoList, Kanban, and Secret Manager without
building a full dashboard first.

## Get started

1. Install and enable Dashboard Hub. It requires Obsidian 1.10.0 or later.
2. Open the rocket launcher in the ribbon, or run **Dashboard Hub: Create
   dashboard** from the command palette.
3. Choose **Add widget**, configure it, and drag or resize it into place.

The default **Base directory** is `Dashboards`; change it in Dashboard Hub
settings. Automatic memo, Kanban, and Calendar activity is collected in one
Timeline named `Timeline` by default; its global name is configurable in the
same settings. New dashboards and their supporting files use these locations
below it:

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

Dashboard Hub is fully usable on its own. If you also install a compatible
Obsidian plugin, it can add AI actions without taking ownership of your
dashboards. Search Obsidian's Community plugins for
**[Gemini Helper](https://github.com/takeshy/obsidian-gemini-helper)**,
**[Local LLM Hub](https://github.com/takeshy/obsidian-local-llm-hub)**, or
**[LLM Hub](https://github.com/takeshy/obsidian-llm-hub)** and install the one
that fits your setup.

Connected plugins can answer questions about a selection or reading memo,
generate or edit a Base, rewrite a Timeline post, and create, edit, or run
Workflows. Dashboard Hub keeps the model picker, cancellation, validation,
before/after review, and Apply flow; the connected plugin supplies the models and
executes the request.

Because the configured activity Timeline is plain dated Markdown in your vault,
an AI plugin with vault access can read it directly. Dashboard Hub publishes its
Base directory and Timeline name to connected plugins, allowing date-based
activity questions to read the requested day's file without scanning the entire
history.

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
