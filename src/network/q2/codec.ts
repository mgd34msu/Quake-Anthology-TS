// Per-connection protocol selection. Wire identity never selects the game API.
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import { createMessage, loadMessage, checkMessageRead } from './message.ts';
import type { SizeBuf } from './message.ts';
import { createVanillaContext } from './codecs/vanilla.ts';
import { createRereleaseContext } from './codecs/q2repro.ts';
import { createR1Context } from './codecs/r1q2.ts';
import { createQ2ProContext } from './codecs/q2pro.ts';
import { createKexContext } from './codecs/kexdemo.ts';
import { q2proExtensions, q2proExtensionsV2 } from './codecs/q2pro-fields.ts';
import type { ProtocolCodec } from './codecs/codec.ts';
export type Q2CodecSupport = {
    readonly kind: 'supported';
    readonly encode: boolean;
    readonly decode: boolean;
} | {
    readonly kind: 'unbound';
    readonly reason: string;
};
export function q2CodecSupport(protocol: Q2ProtocolIdentity): Q2CodecSupport {
    if (protocol.kind === 'q2-q2pro' && protocol.revision === 1016)
        return { kind: 'unbound', reason: 'Q2PRO revision 1016 is reserved by the native protocol' };
    return { kind: 'supported', encode: true, decode: true };
}
export class Q2WireCodec {
    readonly message = createMessage(0);
    readonly codec: ProtocolCodec;
    readonly rerelease: ReturnType<typeof createRereleaseContext>;
    readonly kex: ReturnType<typeof createKexContext>;
    private readonly r1: ReturnType<typeof createR1Context>;
    private readonly q2pro: ReturnType<typeof createQ2ProContext>;
    constructor(readonly protocol: Q2ProtocolIdentity) {
        const support = q2CodecSupport(protocol);
        if (support.kind === 'unbound')
            throw new Error(support.reason);
        this.rerelease = createRereleaseContext(this.message);
        this.kex = createKexContext(this.message);
        this.r1 = createR1Context(this.message);
        this.q2pro = createQ2ProContext(this.message);
        switch (protocol.kind) {
            case 'q2-classic':
                this.codec = createVanillaContext(this.message).VANILLA_CODEC;
                break;
            case 'q2-r1q2':
                this.codec = this.r1.createR1Q2Codec(protocol.revision);
                break;
            case 'q2-q2pro':
                this.codec = this.q2pro.createQ2ProCodec(protocol.revision);
                break;
            case 'q2-rerelease':
                this.codec = this.rerelease.Q2REPRO_CODEC;
                break;
            case 'q2-private-classic':
                this.codec = this.rerelease.Q2REPRO_CLASSIC_CODEC;
                break;
            case 'q2-kex':
            case 'q2-kex-demo':
                this.kex.setKexProtocol(protocol.version);
                this.codec = this.kex.KEX_DEMO_CODEC;
                break;
        }
    }
    get q2proRevision(): number { return this.q2pro.features.revision; }
    get q2proExtended(): boolean { return this.protocol.kind === 'q2-q2pro' && q2proExtensions(this.q2pro.features); }
    get q2proExtendedV2(): boolean { return this.protocol.kind === 'q2-q2pro' && q2proExtensionsV2(this.q2pro.features); }
    get floatingCoordinates(): boolean { return this.protocol.kind === 'q2-rerelease' || this.protocol.kind === 'q2-private-classic' || this.protocol.kind === 'q2-kex'; }
    get wideIndexes(): boolean { return this.protocol.version >= 1038; }
    begin(bytes: Uint8Array): void { loadMessage(this.message, bytes); }
    finish(): void { checkMessageRead(this.message); }
    opcode(raw: number): number {
        if (this.protocol.kind === 'q2-r1q2') {
            this.r1.setR1Q2FrameExtrabits(raw & 0xe0);
            return raw & 31;
        }
        if (this.protocol.kind === 'q2-q2pro') {
            this.q2pro.noteQ2ProFrameOpcodeExtrabits(raw & 0xe0);
            return raw & 31;
        }
        return raw;
    }
    /** Compression envelopes resume their containing packet after the nested stream. */
    nested<T>(bytes: Uint8Array, read: () => T): T {
        const previous = { data: this.message.data, cursize: this.message.cursize, readcount: this.message.readcount };
        this.begin(bytes);
        try {
            const value = read();
            this.finish();
            return value;
        }
        finally {
            loadMessage(this.message, previous.data);
            this.message.cursize = previous.cursize;
            this.message.readcount = previous.readcount;
        }
    }
}
export function decodeWithQ2Codec<T>(wire: Q2WireCodec, bytes: Uint8Array, read: (codec: ProtocolCodec, message: SizeBuf) => T): T {
    wire.begin(bytes);
    const result = read(wire.codec, wire.message);
    wire.finish();
    return result;
}
