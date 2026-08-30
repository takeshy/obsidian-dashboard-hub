import type { KanbanChecklistItem } from "./kanbanTask";

export interface KanbanAiTask {
  title: string;
  description: string;
  due: string;
  checklist: KanbanChecklistItem[];
}

export const KANBAN_AI_SOURCE = `Convert the user's request into one or more actionable tasks.
Today is {{today}}.
Return ONLY a JSON array. Each item must have this exact shape:
{"title":"short task title","description":"helpful detail or empty string","due":"YYYY-MM-DD or empty string","checklist":[{"text":"subtask","completed":false}]}
Resolve relative dates from today. Do not invent a deadline. Keep the user's language.`;

function stripFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function validIsoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function parseKanbanAiTasks(value: string): KanbanAiTask[] {
  const parsed = JSON.parse(stripFence(value)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("AI response must be a JSON array.");
  const tasks = parsed.flatMap((item): KanbanAiTask[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) return [];
    const due = validIsoDate(record.due);
    const checklist = Array.isArray(record.checklist)
      ? record.checklist.flatMap((entry): KanbanChecklistItem[] => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const text = String((entry as Record<string, unknown>).text ?? "").trim();
          return text ? [{ text, completed: Boolean((entry as Record<string, unknown>).completed) }] : [];
        })
      : [];
    return [{
      title,
      description: typeof record.description === "string" ? record.description.trim() : "",
      due,
      checklist,
    }];
  });
  if (tasks.length === 0) throw new Error("AI did not return any valid tasks.");
  return tasks.slice(0, 20);
}
