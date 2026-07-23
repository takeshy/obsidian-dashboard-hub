export interface AgentSkillContribution {
  protocolVersion: 1;
  ownerId: string;
  id: string;
  name: string;
  description: string;
  instructions: string;
  dependencies?: string[];
  revision: string;
}

export const DASHBOARD_SKILL: AgentSkillContribution = {
  protocolVersion: 1,
  ownerId: "dashboard-hub",
  id: "dashboard",
  name: "dashboard",
  description: "Create Dashboard Hub .dashboard files and arrange Bases, files, workflows, kanban boards, timelines, calendars, memos, secrets, and web pages in a grid.",
  revision: "1.0.0",
  dependencies: ["obsidian-bases"],
  instructions: `# Dashboard Hub Skill

Create YAML \`.dashboard\` files for Dashboard Hub. Store them under \`Dashboards/\`.
Use the Obsidian Bases dependency for any backing \`.base\` files and store those
under \`Dashboards/Bases/\`.

## Schema

\`\`\`yaml
version: 1
grid:
  cols: 12
  rowHeight: 80
  gap: 8
widgets:
  - id: unique-id
    type: base
    layout:
      lg: { x: 0, y: 0, w: 6, h: 5 }
      sm: { x: 0, y: 0, w: 12, h: 5 }
    config: {}
\`\`\`

Every widget needs a unique \`id\`, a known \`type\`, \`layout.lg\`, and a
mapping in \`config\`. The wide grid has 12 columns. Do not overlap widgets.
The narrow \`sm\` layout is optional and is derived as a full-width stack when omitted.

## Widget types

- \`base\`: \`{ base: "Dashboards/Bases/Tasks.base" }\`. It always displays
  the first view in the Base file. Change that first view's \`type\` to select
  table, cards, or list presentation; do not add a \`view\` field.
- \`file\`: \`{ path: "Notes/Home.md", showHeader: true }\`.
- \`web\`: \`{ url: "https://example.com", showHeader: true }\`.
- \`workflow\`: \`{ workflow: "workflows/Digest.md", output: "markdown", outputVariable: "result", refreshInterval: 0 }\`.
- \`kanban\`: \`{ title: "Tasks", tag: "task", folder: "", statusProperty: "status", titleProperty: "", timelineName: "Timeline", columns: [{ value: "todo", label: "To Do" }, { value: "done", label: "Done" }], showUnspecified: true, displayFields: [] }\`.
- \`timeline\`: \`{ name: "Timeline", latestCount: 20 }\`.
- \`calendar\`: \`{ timelineName: "Timeline" }\`. Calendar events use the named timeline; do not add a Files setting.
- \`memo-list\`: \`{}\`.
- \`secret-manager\`: \`{ folder: "Secrets" }\`.

Unknown widget types are preserved but cannot render their content.

## Workflow

1. Determine what the dashboard should show.
2. Create required backing Bases and workflows first.
3. Create \`Dashboards/<Name>.dashboard\` as valid YAML.
4. Lay out non-overlapping widgets on the 12-column grid.
5. Verify referenced vault paths and the first Base view's name and type.
6. Verify every widget type and config against the list above.

Do not add a view selector or \`config.view\`. A Base widget always renders and
edits the first view defined in its \`.base\` file.`,
};

export function dashboardSkillForBaseDirectory(baseDirectory: string): AgentSkillContribution {
  return {
    ...DASHBOARD_SKILL,
    instructions: DASHBOARD_SKILL.instructions.replace(/Dashboards/g, () => baseDirectory),
  };
}

export const REGISTER_RUNTIME_SKILL_EVENT = "ai-skill-registry:register";
export const UNREGISTER_RUNTIME_SKILL_EVENT = "ai-skill-registry:unregister";
export const REQUEST_RUNTIME_SKILLS_EVENT = "ai-skill-registry:request";
