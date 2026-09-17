import { ipxAddress } from '../network/common/endpoint.ts';
import type { IpxAddress } from '../network/common/endpoint.ts';
import type { NativeIpxCapability } from '../network/common/ipx-host.ts';
import type { DatagramTransport, ReceiveEvent } from '../network/common/transport.ts';
import { UnsupportedTransportError } from '../network/common/transport.ts';
import type { NativeSocket } from './ipx-native.ts';

class NativeIpxTransport implements DatagramTransport<IpxAddress> {
  private ended = false;
  private fault: Error | null = null;
  private faultReported = false;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly socket: NativeSocket) {}
  get address(): IpxAddress { return this.socket.address; }
  get maxDatagramBytes(): number { return this.socket.maxDatagramBytes; }
  get closed(): boolean { return this.ended; }
  private open(): void { if (this.ended) throw new Error('Native IPX socket is closed'); }
  private failed(error: unknown): void { this.fault ??= error instanceof Error ? error : new Error(String(error)); this.stopTimer(); }
  private stopTimer(): void { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }
  send(to: IpxAddress, payload: Uint8Array): boolean {
    this.open(); ipxAddress(to.network, to.node, to.port);
    if (payload.length > this.maxDatagramBytes) throw new RangeError('Datagram exceeds native IPX payload limit');
    if (this.fault !== null) return false;
    try { return this.socket.send(to, payload); } catch (error) { this.failed(error); this.notify(); return false; }
  }
  poll(): ReceiveEvent<IpxAddress> | null {
    this.open();
    if (this.fault === null) { try { return this.socket.receive(); } catch (error) { this.failed(error); } }
    if (this.fault !== null && !this.faultReported) { this.faultReported = true; return { kind: 'error', error: this.fault }; }
    return null;
  }
  private notify(): void { for (const listener of [...this.listeners]) if (this.listeners.has(listener)) listener(); }
  subscribeReadable(listener: () => void): () => void {
    this.open(); this.listeners.add(listener);
    if (this.timer === null && this.fault === null) this.timer = setInterval(() => {
      if (this.ended) return;
      let ready = false;
      try { ready = this.socket.readable(); } catch (error) { this.failed(error); ready = true; }
      if (ready) this.notify();
    }, 4);
    if (this.fault !== null && !this.faultReported) queueMicrotask(() => { if (!this.ended && this.listeners.has(listener)) listener(); });
    return () => { this.listeners.delete(listener); if (this.listeners.size === 0) this.stopTimer(); };
  }
  close(): void {
    if (this.ended) return;
    this.ended = true; this.stopTimer();
    try { this.socket.close(); } finally { try { this.notify(); } finally { this.listeners.clear(); } }
  }
}

/** Loading the application does not load libraries or acquire sockets. */
export function bunNativeIpxCapability(): NativeIpxCapability {
  if (process.platform !== 'linux' && process.platform !== 'win32') return { kind: 'unavailable', reason: `No AF_IPX socket ABI is implemented for ${process.platform}` };
  if (process.platform === 'win32' ? process.arch !== 'x64' : process.arch !== 'x64' && process.arch !== 'arm64')
    return { kind: 'unavailable', reason: `Native IPX requires Linux x64/arm64 glibc or Windows x64 Winsock; this host is ${process.platform}/${process.arch}` };
  return { kind: 'available', async bind(options) {
    try {
      const { bindNativeIpxSocket } = await import('./ipx-native.ts');
      return new NativeIpxTransport(bindNativeIpxSocket(options));
    }
    catch (error) {
      if (error instanceof UnsupportedTransportError) throw error;
      throw new Error(`Native IPX ${process.platform}/${process.arch} bind failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  } };
}
