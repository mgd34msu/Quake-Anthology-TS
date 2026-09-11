// QuakeWorld cl_input.c and sv_user.c movement bundles. GPL-2.0-or-later.
import type { QwUserCommand } from '../../contracts/protocol.ts';
import type { Vec3 } from '../../contracts/math.ts';
import { MessageReader, SizeBuf, PacketError, MSG_WriteByte, MSG_WriteShort, SZ_Write } from './message.ts';
import { createQuakeWorldCodec, protocolFlags } from './profile.ts';
import type { QuakeWorldProfile } from './profile.ts';
import { QwUsercmdT } from './qw-constants.ts';
import { qwCommand, qwWireCommand } from './quakeworld.ts';
import { quakeWorldChecksum } from './checksum.ts';
export interface QuakeWorldMove {
    readonly oldest: QwUserCommand;
    readonly previous: QwUserCommand;
    readonly current: QwUserCommand;
    readonly lossPercent: number;
}
export type QuakeWorldClientMessage = {
    readonly kind: 'nop';
} | {
    readonly kind: 'string-command';
    readonly text: string;
} | {
    readonly kind: 'delta';
    readonly sequence: number;
} | {
    readonly kind: 'spectator-teleport';
    readonly origin: Vec3;
} | {
    readonly kind: 'upload';
    readonly percent: number;
    readonly bytes: Uint8Array;
} | {
    readonly kind: 'move';
    readonly bundle: QuakeWorldMove;
};
export function writeQuakeWorldMove(sb: SizeBuf, profile: QuakeWorldProfile, bundle: QuakeWorldMove, sequence: number): void {
    const codec = createQuakeWorldCodec(profile, new MessageReader(new Uint8Array(0)));
    MSG_WriteByte(sb, 3);
    const checksumOffset = sb.cursize;
    MSG_WriteByte(sb, 0);
    MSG_WriteByte(sb, bundle.lossPercent);
    const a = qwWireCommand(bundle.oldest), b = qwWireCommand(bundle.previous), c = qwWireCommand(bundle.current);
    codec.writeDeltaUsercmd(sb, new QwUsercmdT(), a);
    codec.writeDeltaUsercmd(sb, a, b);
    codec.writeDeltaUsercmd(sb, b, c);
    sb.data[checksumOffset] = quakeWorldChecksum(sb.data.subarray(checksumOffset + 1, sb.cursize), sequence);
}
export function decodeQuakeWorldClient(bytes: Uint8Array, profile: QuakeWorldProfile, sequence: number): readonly QuakeWorldClientMessage[] {
    const r = new MessageReader(bytes), codec = createQuakeWorldCodec(profile, r), out: QuakeWorldClientMessage[] = [];
    let moved = false;
    while (r.remaining) {
        switch (r.Byte()) {
            case 1:
                out.push({ kind: 'nop' });
                break;
            case 4:
                out.push({ kind: 'string-command', text: r.String() });
                break;
            case 5:
                out.push({ kind: 'delta', sequence: r.Byte() });
                break;
            case 6:
                out.push({ kind: 'spectator-teleport', origin: { x: codec.readCoord(protocolFlags(profile)), y: codec.readCoord(protocolFlags(profile)), z: codec.readCoord(protocolFlags(profile)) } });
                break;
            case 7: {
                const size = r.Short(), percent = r.Byte();
                out.push({ kind: 'upload', percent, bytes: r.bytes(size) });
                break;
            }
            case 3: {
                if (moved)
                    throw new PacketError('Multiple moves in one packet', r.offset - 1);
                moved = true;
                const check = r.Byte(), start = r.offset, lossPercent = r.Byte(), a = new QwUsercmdT(), b = new QwUsercmdT(), c = new QwUsercmdT();
                codec.readDeltaUsercmd(new QwUsercmdT(), a);
                codec.readDeltaUsercmd(a, b);
                codec.readDeltaUsercmd(b, c);
                r.finish();
                if (quakeWorldChecksum(bytes.subarray(start, r.offset), sequence) !== check)
                    throw new PacketError('Invalid movement checksum', start - 1);
                out.push({ kind: 'move', bundle: { oldest: qwCommand(a), previous: qwCommand(b), current: qwCommand(c), lossPercent } });
                break;
            }
            default: throw new PacketError('Unknown QuakeWorld client message', r.offset - 1);
        }
        r.finish();
    }
    return out;
}
export function writeQuakeWorldUpload(sb: SizeBuf, bytes: Uint8Array, percent: number): void {
    if (bytes.length > 768)
        throw new RangeError('QuakeWorld upload block too large');
    MSG_WriteByte(sb, 7);
    MSG_WriteShort(sb, bytes.length);
    MSG_WriteByte(sb, percent);
    SZ_Write(sb, bytes);
}
/** Server loss recovery retains the source cutoff and suppresses repeated fire on lastcmd. */
export class QuakeWorldCommandReplay {
    private last: QwUserCommand = qwCommand(new QwUsercmdT());
    run(bundle: QuakeWorldMove, dropped: number, paused: boolean, apply: (command: QwUserCommand) => void): void {
        if (!paused) {
            if (dropped < 20) {
                for (let pending = dropped; pending > 2; pending--)
                    apply(this.last);
                if (dropped > 1)
                    apply(bundle.oldest);
                if (dropped > 0)
                    apply(bundle.previous);
            }
            apply(bundle.current);
        }
        this.last = { ...bundle.current, angles: { ...bundle.current.angles }, buttons: 0 };
    }
}
export function splitQuakeWorldCommand(command: QwUserCommand, apply: (command: QwUserCommand) => void): void {
    if (command.milliseconds > 50) {
        const half = { ...command, milliseconds: Math.trunc(command.milliseconds / 2) };
        splitQuakeWorldCommand(half, apply);
        splitQuakeWorldCommand(half, apply);
    }
    else
        apply(command);
}
