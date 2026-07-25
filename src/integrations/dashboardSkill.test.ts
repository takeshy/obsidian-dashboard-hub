import { describe, expect, it } from "vitest";
import { DASHBOARD_SKILL, dashboardSkillForBaseDirectory } from "./dashboardSkill";

describe("Dashboard Skill contribution", () => {
  it("publishes a versioned Dashboard-owned skill with its Base dependency", () => {
    expect(DASHBOARD_SKILL.protocolVersion).toBe(1);
    expect(DASHBOARD_SKILL.ownerId).toBe("dashboard-hub");
    expect(DASHBOARD_SKILL.dependencies).toContain("obsidian-bases");
    expect(DASHBOARD_SKILL.instructions).toContain("secret-manager");
    expect(DASHBOARD_SKILL.instructions).toContain("calendar");
    expect(DASHBOARD_SKILL.instructions).toContain("Timeline activity queries");
    expect(DASHBOARD_SKILL.instructions).toContain("scheduled day");
    expect(DASHBOARD_SKILL.instructions).toContain("Do not scan every");
  });

  it("publishes the configured activity Timeline name", () => {
    const skill = dashboardSkillForBaseDirectory("Workspace", "WorkLog");
    expect(skill.instructions).toContain("Workspace/Timeline/<name>/YYYY-MM-DD.md");
    expect(skill.instructions).toContain("Runtime activity Timeline name: `WorkLog`");
    expect(skill.instructions).toContain("widgets that display the activity log");
  });
});
