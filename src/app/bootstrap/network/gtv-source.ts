import { GtvConnection } from '../../../network/q2/gtv-transport.ts';
import type { GtvEvent, GtvIdentity } from '../../../network/q2/gtv.ts';
import { MvdPlayback } from '../../../network/q2/mvd-playback.ts';
import { readMvdHeader, type MvdHeader } from '../../../network/q2/mvd-profile.ts';
import { Q2ClientReceiver, type Q2ClientReceiverHost } from './q2-client-receiver.ts';
import type { Q2MvdPresentation } from './q2-demo.ts';

export interface GtvSourceOptions {
  readonly host: string;
  readonly port: number;
  readonly identity: GtvIdentity;
  readonly signal?: AbortSignal;
}

/** One native DATA message waits for the retained presentation; TCP supplies backpressure. */
export class GtvRemoteSource {
  private connection: GtvConnection | null = null;
  private admitted: { readonly receiver: Q2ClientReceiver; readonly decoder: MvdPlayback; readonly presentation: Q2MvdPresentation } | null = null;
  private pending: { readonly bytes: Uint8Array; readonly release: () => void } | null = null;
  private firstHeader: MvdHeader | null = null;
  private ended = false;
  private polling = false;
  private failure: Error | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readonly ready: Promise<void>;
  private constructor() {
    this.ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
  }
  static async prepare(options: GtvSourceOptions): Promise<GtvRemoteSource> {
    const source = new GtvRemoteSource();
    const connect = GtvConnection.connect({ ...options, event: event => source.receive(event) }).then(connection => {
      if (source.ended) { connection.close(); throw new Error('GTV source retired during admission'); }
      source.connection = connection;
      connection.start();
    });
    try { await Promise.all([connect, source.ready]); return source; }
    catch (error: unknown) { source.close(); throw error; }
  }
  get header(): MvdHeader {
    if (this.firstHeader === null) throw new Error('GTV source has no admitted header');
    return this.firstHeader;
  }
  get phase(): 'loading' | 'active' | 'closed' { return this.ended ? 'closed' : this.admitted?.receiver.phase ?? 'loading'; }
  get time(): number | null { return this.admitted?.receiver.recordedTimeMilliseconds ?? null; }
  bind(host: Q2ClientReceiverHost, presentation: Q2MvdPresentation): void {
    if (this.ended || this.admitted !== null || this.firstHeader === null) throw new Error('GTV presentation admission is not available');
    this.admitted = { receiver: new Q2ClientReceiver(host, { kind: 'demo' }), decoder: new MvdPlayback(presentation.visibility), presentation };
  }
  private async receive(event: GtvEvent): Promise<void> {
    if (this.ended) return;
    if (event.kind === 'closed') { this.failure = new Error(event.reason); this.close(); return; }
    if (event.kind !== 'data') return;
    if (this.pending !== null) throw new Error('GTV DATA dispatch overlapped its consumer');
    if (this.firstHeader === null) {
      this.firstHeader = readMvdHeader(event.bytes);
      this.readyResolve?.(); this.readyResolve = null; this.readyReject = null;
    }
    await new Promise<void>(resolve => { this.pending = { bytes: event.bytes, release: resolve }; });
  }
  async poll(): Promise<void> {
    if (this.failure !== null) throw this.failure;
    if (this.ended || this.pending === null) return;
    if (this.polling) throw new Error('GTV source poll is already in progress');
    const admitted = this.admitted;
    if (admitted === null) throw new Error('GTV source has no presentation owner');
    const pending = this.pending;
    this.polling = true;
    try {
      for (const record of admitted.decoder.readRecords(pending.bytes)) {
        if (record.event.kind === 'frame') admitted.presentation.selectView(admitted.decoder.selectedPlayer);
        await admitted.receiver.receiveRecords([record], 0);
        if (this.ended) return;
      }
    } catch (error: unknown) { this.close(); throw error; }
    finally {
      if (this.pending === pending) this.pending = null;
      pending.release(); this.polling = false;
    }
  }
  selectPlayer(clientnum: number): void {
    if (this.admitted === null || this.ended) throw new Error('GTV source has no active viewer');
    this.admitted.decoder.selectPlayer(clientnum);
  }
  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.readyReject?.(this.failure ?? new Error('GTV source closed before admission'));
    this.readyResolve = null; this.readyReject = null;
    this.admitted?.receiver.close();
    this.connection?.close(); this.connection = null;
    const pending = this.pending; this.pending = null; pending?.release();
  }
}
