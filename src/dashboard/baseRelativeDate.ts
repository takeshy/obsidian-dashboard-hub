export type RelativeDateUnit = "day" | "month" | "year";

export interface RelativeDateValue {
  kind: "relative-date";
  amount: number;
  unit: RelativeDateUnit;
  direction: "past" | "future";
}

export function isRelativeDateValue(value: unknown): value is RelativeDateValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RelativeDateValue>;
  return candidate.kind === "relative-date"
    && typeof candidate.amount === "number"
    && Number.isFinite(candidate.amount)
    && (candidate.unit === "day" || candidate.unit === "month" || candidate.unit === "year")
    && (candidate.direction === "past" || candidate.direction === "future");
}

export function relativeDateExpression(value: RelativeDateValue): string {
  const amount = Math.max(0, Math.floor(Math.abs(value.amount)));
  if (amount === 0) return "today()";
  const duration = `${amount} ${value.unit}${amount === 1 ? "" : "s"}`;
  return `today() ${value.direction === "past" ? "-" : "+"} ${JSON.stringify(duration)}`;
}

export function parseRelativeDateExpression(expression: string): RelativeDateValue | null {
  const source = expression.trim();
  if (/^today\(\)$/.test(source)) return { kind: "relative-date", amount: 0, unit: "day", direction: "future" };
  const match = source.match(/^today\(\)\s*([+-])\s*(["'])(\d+)\s*(d|days?|M|months?|y|years?)\2$/);
  if (!match) return null;
  const token = match[4];
  const unit: RelativeDateUnit = token === "M" || /^months?$/i.test(token)
    ? "month"
    : token === "y" || /^years?$/i.test(token)
      ? "year"
      : "day";
  return { kind: "relative-date", amount: Number(match[3]), unit, direction: match[1] === "-" ? "past" : "future" };
}
