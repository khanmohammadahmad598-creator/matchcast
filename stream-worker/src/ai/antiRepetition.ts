/**
 * Anti-repetition guard: keeps a rolling window of spoken lines and rejects
 * candidates that are too similar to something said recently.
 */
export class AntiRepetition {
  private lines: string[] = [];

  constructor(private window: number = 25) {}

  setWindow(size: number): void {
    this.window = Math.max(0, size);
  }

  /** Normalises to a comparable token set (script-agnostic, punctuation free). */
  private tokens(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  }

  /** Jaccard similarity between two token sets. */
  private similarity(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared += 1;
    return shared / (a.size + b.size - shared);
  }

  isRepetition(candidate: string, threshold = 0.62): boolean {
    const tokens = this.tokens(candidate);
    for (const previous of this.lines) {
      if (previous.toLowerCase() === candidate.toLowerCase()) return true;
      if (this.similarity(tokens, this.tokens(previous)) >= threshold) return true;
    }
    return false;
  }

  remember(line: string): void {
    this.lines.push(line);
    while (this.lines.length > this.window) this.lines.shift();
  }

  recent(count = 8): string[] {
    return this.lines.slice(-count);
  }

  clear(): void {
    this.lines = [];
  }
}
