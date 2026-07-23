import { describe, expect, it } from "vitest";
import { parseRelativeDateExpression, relativeDateExpression } from "./baseRelativeDate";

describe("Base relative date filters", () => {
  it("uses today without an offset for zero", () => {
    expect(relativeDateExpression({ kind: "relative-date", amount: 0, unit: "day", direction: "past" })).toBe("today()");
  });

  it("uses the explicitly selected offset direction", () => {
    expect(relativeDateExpression({ kind: "relative-date", amount: 3, unit: "day", direction: "past" })).toBe('today() - "3 days"');
    expect(relativeDateExpression({ kind: "relative-date", amount: 3, unit: "day", direction: "future" })).toBe('today() + "3 days"');
  });

  it("parses day, month, and year expressions", () => {
    expect(parseRelativeDateExpression('today() - "2 days"')).toEqual({ kind: "relative-date", amount: 2, unit: "day", direction: "past" });
    expect(parseRelativeDateExpression('today() + "1 month"')).toEqual({ kind: "relative-date", amount: 1, unit: "month", direction: "future" });
    expect(parseRelativeDateExpression('today() + "4 years"')).toEqual({ kind: "relative-date", amount: 4, unit: "year", direction: "future" });
  });
});
