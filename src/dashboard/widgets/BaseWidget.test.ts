import { describe, expect, it } from "vitest";
import { buildBaseEmbed } from "./BaseWidget";

describe("BaseWidget first-view behavior", () => {
  it("ignores a legacy configured view and embeds the Base's first view", () => {
    expect(buildBaseEmbed("Dashboards/Bases/Tasks.base", {
      base: "Dashboards/Bases/Tasks.base",
      view: "Legacy second view",
    })).toBe("![[Dashboards/Bases/Tasks.base]]");
  });
});
