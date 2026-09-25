export type SessionToken = Readonly<{ generation: number; scopeKey: string | null }>;

/** Invalidates asynchronous work whenever the signed-in account or event changes. */
export class SessionGuard {
  private generation = 0;
  private scopeKey: string | null = null;

  enter(scopeKey: string | null): void {
    if (scopeKey === this.scopeKey) return;
    this.scopeKey = scopeKey;
    this.generation += 1;
  }

  invalidate(): void {
    this.generation += 1;
  }

  capture(): SessionToken {
    return { generation: this.generation, scopeKey: this.scopeKey };
  }

  isCurrent(token: SessionToken): boolean {
    return token.generation === this.generation && token.scopeKey === this.scopeKey;
  }
}

export class SessionChangedError extends Error {
  constructor() {
    super("The account or game event changed while the request was running.");
    this.name = "SessionChangedError";
  }
}
