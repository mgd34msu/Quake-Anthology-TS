import { resolveAddress } from '../common/endpoint.ts';
import type { Ipv4Address } from '../common/endpoint.ts';
import type { Q3Address, Q3Challenge } from './admission.ts';
import { encodeConnectionlessText } from './connectionless.ts';

export interface Q3ServerAuthorizationOptions {
    resolve?(): Promise<Ipv4Address>;
    enabled(): boolean;
    gameDirectory(): string;
    strictAuth(): string;
    send(address: Q3Address, packet: Uint8Array): void;
    print(text: string): void;
}

/** SV_GetChallenge uses the existing server socket and caches the native authorization endpoint. */
export class Q3ServerAuthorization {
    private lookup: Promise<Ipv4Address | null> | null = null;
    private resolved: Ipv4Address | null = null;
    constructor(private readonly options: Q3ServerAuthorizationOptions) {}
    get address(): Ipv4Address | null { return this.resolved; }
    private async resolve(): Promise<Ipv4Address | null> {
        try {
            const address = this.options.resolve === undefined ? await resolveAddress('authorize.quake3arena.com', 27952, 4) : await this.options.resolve();
            if (address.kind !== 'ipv4') throw new Error('Q3 authorization requires IPv4');
            this.resolved = address;
            return address;
        } catch (error) {
            this.options.print(`Couldn't resolve Q3 authorization server: ${error instanceof Error ? error.message : String(error)}\n`);
            return null;
        }
    }
    async request(challenge: Readonly<Q3Challenge>): Promise<void> {
        const client = challenge.address, number = challenge.challenge;
        if (client === null || client.kind !== 'ipv4' || !this.options.enabled()) return;
        this.lookup ??= this.resolve();
        const authority = await this.lookup;
        if (authority === null || !this.options.enabled() || challenge.address !== client || challenge.challenge !== number) return;
        const game = this.options.gameDirectory() || 'baseq3';
        if (game.length >= 1024) throw new RangeError('Q3 authorization game directory exceeds source buffer');
        this.options.send(authority, encodeConnectionlessText(`getIpAuthorize ${number} ${client.host.join('.')} ${game} 0 ${this.options.strictAuth()}`));
    }
}
