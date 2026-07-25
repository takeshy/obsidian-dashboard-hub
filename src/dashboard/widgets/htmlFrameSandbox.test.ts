import { describe, expect, it } from "vitest";
import { htmlFrameSandbox } from "./htmlFrameSandbox";

describe("htmlFrameSandbox", () => {
  it("keeps scripts disabled while allowing quote integration by default", () => {
    expect(htmlFrameSandbox(false)).toBe("allow-same-origin allow-popups");
  });

  it("isolates script-enabled HTML from the parent origin", () => {
    const sandbox = htmlFrameSandbox(true);
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });
});
