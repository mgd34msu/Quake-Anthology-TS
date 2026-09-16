import { Q3ClientConnection } from '../../../network/q3/client.ts';
import type { Q3ClientClock, Q3ClockOptions } from '../../../network/q3/clock.ts';
import type { DemoEnd, DemoMessageReader } from '../../../network/q3/demo.ts';
import { q3ApplicationClientBindings } from './q3-client.ts';
import type { Q3ApplicationClientHost } from './q3-client.ts';

export type Q3DemoFrame = { readonly kind: 'pending' }
  | { readonly kind: 'frame'; readonly serverTime: number }
  | { readonly kind: 'end'; readonly end: DemoEnd; readonly timing: ReturnType<Q3ClientClock['demoTiming']> };

/** CL_PlayDemo_f and CL_SetCGameTime over recorded messages; the caller owns rendering and completion. */
export class Q3DemoPlayback {
  readonly connection: Q3ClientConnection;
  private state: 'loading' | 'primed' | 'active' | 'ended' | 'closed' = 'loading';
  private end: DemoEnd | null = null;
  private firstFrameSkipped = false;
  private busy = false;
  constructor(readonly options: { readonly host: Q3ApplicationClientHost; readonly clock: Q3ClientClock; readonly reader: DemoMessageReader }) {
    this.connection = new Q3ClientConnection(options.host.identity, 'baseq3', { kind: 'demo', reader: options.reader }, q3ApplicationClientBindings(options.host, {
      assertCurrent: () => this.assertCurrent(),
      cleared: () => { this.state = 'loading'; },
      primed: () => {
        if (options.host.downloading) throw new Error('Q3 demo cannot wait for package downloads');
        this.state = 'primed';
      },
      snapshot() {},
    }));
    options.host.attach(this.connection);
  }
  get phase(): 'loading' | 'primed' | 'active' | 'ended' | 'closed' { return this.state; }
  private assertCurrent(): void {
    if (this.state === 'closed') throw new Error('Q3 demo belongs to a retired source');
  }
  private begin(): void {
    this.assertCurrent();
    if (this.busy) throw new Error('Q3 demo message processing is already in progress');
    this.busy = true;
  }
  private async read(realTime: number): Promise<DemoEnd | null> {
    this.assertCurrent();
    if (this.end !== null) return this.end;
    const message = await this.connection.readDemo(realTime);
    this.assertCurrent();
    if ('kind' in message && message.kind === 'end') { this.end = message; this.state = 'ended'; return message; }
    return null;
  }
  async prime(realTime: number): Promise<DemoEnd | null> {
    this.begin();
    try {
      while (this.phase === 'loading') { const end = await this.read(realTime); if (end !== null) return end; }
      return this.end;
    } finally { this.busy = false; }
  }
  async advanceFrame(realTime: number, options: Omit<Q3ClockOptions, 'demo'>): Promise<Q3DemoFrame> {
    this.begin();
    try {
      const completed = (end: DemoEnd): Q3DemoFrame => ({ kind: 'end', end, timing: options.timedemo ? this.options.clock.demoTiming(realTime) : null });
      if (this.end !== null) return completed(this.end);
      while (this.phase === 'loading') { const end = await this.read(realTime); if (end !== null) return completed(end); }
      if (!this.firstFrameSkipped) { this.firstFrameSkipped = true; return { kind: 'pending' }; }
      if (this.phase === 'primed') {
        const end = await this.read(realTime); if (end !== null) return completed(end);
        const snapshot = this.connection.history.latest;
        if (snapshot !== null && (snapshot.flags & 2) === 0) this.state = 'active';
      }
      if (this.phase !== 'active') return { kind: 'pending' };
      const time = this.options.clock.advance(realTime, { ...options, demo: true });
      if (time === null) return { kind: 'pending' };
      while (this.options.clock.needsDemoMessage()) {
        const end = await this.read(realTime); if (end !== null) return completed(end);
        if (this.phase !== 'active') return { kind: 'pending' };
      }
      return { kind: 'frame', serverTime: time };
    } finally { this.busy = false; }
  }
  close(): void { this.state = 'closed'; }
}
