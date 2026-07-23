---
type: Feature
title: Dashboard
description: Dashboards are `.dashboard` files with responsive widget grids for Bases, files, web embeds, kanban, timelines, calendars, secrets, and memos.
tags: [dashboard, widgets, bases]
timestamp: 2026-07-04T00:00:00Z
---

# Dashboard

A dashboard is a `.dashboard` file owned and opened by the separate **Dashboard Hub** plugin. It stores a responsive widget grid as YAML. By default, new dashboards are created under `Dashboards/` and backing `.base` files under `Dashboards/Bases/`. The Base directory can be changed in Dashboard Hub settings; changing it does not move existing files. LLM Hub connects to Dashboard Hub as an optional AI provider rather than registering the file type itself.

Users create dashboards with the command "Dashboard Hub: Create dashboard" or by asking chat. The built-in `dashboard` skill knows the `.dashboard` schema and can author the dashboard plus backing `.base` files.

Dashboards save edits automatically. Widgets can be dragged, resized, configured with a gear button, maximized, restored, and added with the Add widget toolbar action.

The dashboard toolbar also includes undo, redo, horizontal align, and vertical align actions. Horizontal align redistributes widgets into up to three vertical columns across the grid. Vertical align redistributes widgets into up to three horizontal rows. Both actions use the current dashboard viewport height to choose target row counts and then save the resulting large-screen layout.

Core widget types:

- Base: renders an Obsidian Bases view from a `.base` file.
- File: renders Markdown, text, HTML, images, PDF, EPUB, and other vault files with reading memo support.
- Web Embed: shows a web page in an iframe.
- Kanban: shows notes as draggable cards grouped by a status property.
- Timeline: stores dated microblog-style posts with image attachments.
- Calendar: shows Timeline events and Timeline activity by date in a fixed month view with modal day details.
- Secret Manager: manages encrypted vault secrets.
- MemoList: lists reading memo files across the dashboard.

![Dashboard with Kanban, Calendar, and Timeline](../../../images/calendar.png)

# Related

- [Agent Skills](./agent-skills.md) explains AI dashboard authoring.
- [Dashboard Widgets](./dashboard-widgets.md) explains each widget type in detail.
- [Dashboard Schema](./dashboard-schema.md) explains layout storage and alignment behavior.
