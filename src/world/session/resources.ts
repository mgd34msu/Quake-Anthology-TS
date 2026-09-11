export interface SessionResource { close(): undefined; }

/** Reverse acquisition order follows the Q3 host's deferred resource cleanup. */
export class ResourceScope implements SessionResource {
  private cleanups: (() => undefined)[] = [];
  private closed = false;

  constructor(readonly name: string) {}

  get isClosed(): boolean { return this.closed; }

  assertOpen(): undefined {
    if (this.closed) throw new Error(`${this.name} is closed`);
    return undefined;
  }

  own<T extends SessionResource>(resource: T): T {
    this.defer(() => resource.close());
    return resource;
  }

  defer(cleanup: () => undefined): undefined {
    this.assertOpen();
    this.cleanups.push(cleanup);
    return undefined;
  }

  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    const errors: unknown[] = [];
    let cleanup = this.cleanups.pop();
    while (cleanup !== undefined) {
      try { cleanup(); } catch (error) { errors.push(error); }
      cleanup = this.cleanups.pop();
    }
    if (errors.length > 0) throw new AggregateError(errors, `Failed to close ${this.name}`);
    return undefined;
  }
}
