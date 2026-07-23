import { describe, expect, it } from "vitest";
import { DASHBOARD_SKILL } from "./dashboardSkill";

describe("Dashboard Skill contribution", () => {
  it("publishes a versioned Dashboard-owned skill with its Base dependency", () => {
    expect(DASHBOARD_SKILL.protocolVersion).toBe(1);
    expect(DASHBOARD_SKILL.ownerId).toBe("dashboard-hub");
    expect(DASHBOARD_SKILL.dependencies).toContain("obsidian-bases");
    expect(DASHBOARD_SKILL.instructions).toContain("secret-manager");
    expect(DASHBOARD_SKILL.instructions).toContain("calendar");
  });
});
