const MAX_INSTRUCTION_HISTORY = 30;

export function appendInstructionHistory(history: string[], instruction: string): string[] {
  const value = instruction.trim();
  if (!value) return history;
  return [...history.filter((entry) => entry !== value), value].slice(-MAX_INSTRUCTION_HISTORY);
}

/** Shell-style history navigation which restores the unfinished draft at the end. */
export class InstructionHistoryNavigator {
  private index: number;
  private draft = "";

  constructor(private readonly history: string[]) {
    this.index = history.length;
  }

  move(direction: -1 | 1, current: string): string | null {
    if (this.history.length === 0) return null;
    if (direction < 0) {
      if (this.index === this.history.length) this.draft = current;
      if (this.index === 0) return null;
      this.index -= 1;
      return this.history[this.index];
    }
    if (this.index === this.history.length) return null;
    this.index += 1;
    return this.index === this.history.length ? this.draft : this.history[this.index];
  }
}
