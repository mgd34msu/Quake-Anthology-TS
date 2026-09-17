/* CL_RequestAuthorization from id Software client/cl_main.c. GPL-2.0-or-later. */
import { CvarFlag } from '../../core/cvars/index.ts';
import type { CvarRegistry } from '../../core/cvars/index.ts';
import type { Q3CdKeyState } from '../../core/q3-cd-key.ts';
import { resolveAddress } from '../common/endpoint.ts';
import type { Ipv4Address } from '../common/endpoint.ts';
import { encodeConnectionlessText } from './connectionless.ts';

export interface Q3ClientAuthorizationOptions {
  readonly cvars: CvarRegistry;
  readonly keys: Pick<Q3CdKeyState, 'readAuthorization'>;
  demoRestricted(): boolean;
  resolve?(): Promise<Ipv4Address | null>;
  print(text: string): void;
}
/** Retained client-static authority address; the current connection supplies its socket and guard. */
export class Q3ClientAuthorization {
  private address: Ipv4Address | null = null;
  constructor(private readonly options: Q3ClientAuthorizationOptions) {}
  async request(assertCurrent: () => void, send: (address: Ipv4Address, packet: Uint8Array) => void): Promise<void> {
    assertCurrent();
    if (this.address === null) {
      let address: Ipv4Address | null;
      try {
        const result = this.options.resolve === undefined ? await resolveAddress('authorize.quake3arena.com', 27952, 4) : await this.options.resolve();
        address = result?.kind === 'ipv4' ? result : null;
      } catch { address = null; }
      assertCurrent();
      if (address === null) { this.options.print("Couldn't resolve Q3 authorization server\n"); return; }
      this.address = address;
    }
    let key = 'demota';
    if (!this.options.demoRestricted()) {
      key = '';
      const bytes = new Uint8Array(33); this.options.keys.readAuthorization(bytes);
      for (const byte of bytes.subarray(0, 32)) {
        if (byte === 0) break;
        if (byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122) key += String.fromCharCode(byte);
      }
    }
    this.options.cvars.register('cl_anonymous', '0', CvarFlag.Init | CvarFlag.SystemInfo);
    const anonymous = this.options.cvars.get('cl_anonymous')?.integerValue ?? 0;
    assertCurrent();
    send(this.address, encodeConnectionlessText(`getKeyAuthorize ${anonymous} ${key}`));
    assertCurrent();
  }
}
