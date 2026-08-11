import { describe, expect, it } from "vitest";
import { appendInstructionHistory, InstructionHistoryNavigator } from "./instructionHistory";

describe("AI instruction history", () => {
  it("moves through recent instructions and restores the unfinished draft", () => {
    const history = new InstructionHistoryNavigator(["shorten", "make it friendlier"]);
    expect(history.move(-1, "unfinished")).toBe("make it friendlier");
    expect(history.move(-1, "make it friendlier")).toBe("shorten");
    expect(history.move(-1, "shorten")).toBeNull();
    expect(history.move(1, "shorten")).toBe("make it friendlier");
    expect(history.move(1, "make it friendlier")).toBe("unfinished");
  });

  it("deduplicates a reused instruction and keeps it most recent", () => {
    expect(appendInstructionHistory(["a", "b"], " a ")).toEqual(["b", "a"]);
  });
});
