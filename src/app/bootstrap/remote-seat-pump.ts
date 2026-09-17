import type { RemoteSeatSource } from './remote-seat-source.ts';

interface Publication {
  ready(): boolean;
  execute(): Promise<void>;
  reject(error: Error): void;
}

/** A seat can await world publication without holding another seat's packet poll. */
export class RemoteSeatPump {
  private pendingPoll: Promise<void> | null = null;
  private pendingDrain: Promise<void> | null = null;
  private failure: { readonly error: unknown } | null = null;
  private readonly publications: Publication[] = [];
  readonly retirementError = new Error('Remote seat publication was retired');
  private closing: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly source: { readonly network: Pick<RemoteSeatSource['network'], 'poll'>; readonly close: RemoteSeatSource['close'] }) {}

  poll(nowMilliseconds: number): void {
    if (this.closed || this.pendingPoll !== null || this.failure !== null) return;
    this.pendingPoll = Promise.resolve().then(async () => {
      try { if (!this.closed) await this.source.network.poll(nowMilliseconds); }
      catch (error) { if (error !== this.retirementError) this.failure = { error }; }
      finally { this.pendingPoll = null; }
    });
  }

  throwFailure(): void { if (this.failure !== null) throw this.failure.error; }

  enqueue<T>(operation: () => T | Promise<T>, ready: () => boolean = () => true): Promise<T> {
    if (this.closed) return Promise.reject(this.retirementError);
    return new Promise<T>((resolve, reject) => {
      this.publications.push({ ready, reject, execute: async () => {
        try { resolve(await operation()); }
        catch (error) { reject(error); throw error; }
      } });
    });
  }

  drainReady(): Promise<void> {
    if (this.pendingDrain !== null) return this.pendingDrain;
    if (this.closed) return Promise.resolve();
    this.pendingDrain = Promise.resolve().then(async () => {
      try {
        while (!this.closed) {
          const next = this.publications[0];
          if (next === undefined || !next.ready()) return;
          this.publications.shift();
          await next.execute();
        }
      } finally { this.pendingDrain = null; }
    });
    return this.pendingDrain;
  }

  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    for (const publication of this.publications.splice(0)) publication.reject(this.retirementError);
    this.closing = (async () => {
      try {
        try { await this.pendingDrain; } catch (error) { if (error !== this.retirementError) this.failure ??= { error }; }
        await this.pendingPoll;
      } finally { await this.source.close(); }
      this.throwFailure();
    })();
    return this.closing;
  }
}
