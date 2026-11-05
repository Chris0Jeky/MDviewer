/** Session-only coordinates. No source text, DOM nodes, or storage APIs belong here. */
export interface EditorPosition {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
  scrollTop: number;
  scrollLeft: number;
}

export interface DocumentPosition {
  editor?: EditorPosition;
  preview?: { page: number; offset: number };
  reader?: { scrollTop: number; scrollLeft: number };
}

/** The web workspace can open arbitrary batches; positions have an independent cap. */
export const MAX_SESSION_POSITIONS = 64;

export class SessionPositions {
  private readonly entries = new Map<string, DocumentPosition>();

  constructor(private readonly limit = MAX_SESSION_POSITIONS) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid position capacity");
  }

  get size(): number { return this.entries.size; }

  get(id: string): DocumentPosition | undefined {
    const value = this.entries.get(id);
    if (!value) return undefined;
    this.entries.delete(id);
    this.entries.set(id, value);
    return structuredClone(value);
  }

  set(id: string, position: DocumentPosition): void {
    const value = { ...this.entries.get(id), ...structuredClone(position) };
    this.entries.delete(id);
    this.entries.set(id, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  take(id: string): DocumentPosition | undefined {
    const value = this.get(id);
    this.entries.delete(id);
    return value;
  }

  clear(): void { this.entries.clear(); }
}

export function clampEditorPosition(position: EditorPosition, length: number): EditorPosition {
  const offset = (value: number): number => Math.min(length, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));
  const start = offset(position.start);
  return {
    start,
    end: Math.max(start, offset(position.end)),
    direction: position.direction,
    scrollTop: Math.max(0, Number.isFinite(position.scrollTop) ? position.scrollTop : 0),
    scrollLeft: Math.max(0, Number.isFinite(position.scrollLeft) ? position.scrollLeft : 0),
  };
}
