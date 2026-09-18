import type { MvdProfile } from './mvd-profile.ts';
import { mvdProfile } from './mvd-profile.ts';
import type { SizeBuf } from './message.ts';
import { createMessage, messageBytes, SZ_Write, MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteLong64, MSG_WriteFloat, MSG_WriteString } from './message.ts';
import { EntityStateT, PlayerStateT, ANGLE2SHORT } from './state.ts';
import * as mvd from './codecs/mvd.ts';
import { Q2WireCodec } from './codec.ts';
import { writeQ2ProInt23, writeQ2ProVar64, q2proFogBits, writeQ2ProFog } from './codecs/q2pro-fields.ts';
import { MVD_MAX_MESSAGE } from './mvd-recording.ts';
export type MvdRecipient = { readonly kind: 'all' } | { readonly kind: 'player'; readonly number: number } | { readonly kind: 'pvs' | 'phs'; readonly leaf: number };
export interface MvdEmission { readonly recipient: MvdRecipient; readonly reliable: boolean; readonly bytes: Uint8Array; }
export interface MvdCapture {
    readonly revision: number; readonly flags: number; readonly servercount: number; readonly gamedir: string; readonly dummy: number;
    readonly configStrings: ReadonlyMap<number, string>; readonly portalBits: Uint8Array;
    readonly players: ReadonlyMap<number, PlayerStateT>; readonly entities: readonly EntityStateT[];
    readonly messages: readonly MvdEmission[];
}
function differs(a: ArrayLike<number>, b: ArrayLike<number>): boolean { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; }
function playerDelta(message: SizeBuf, from: PlayerStateT | null, to: PlayerStateT | null, number: number, profile: MvdProfile): void {
    if (!mvd.MSG_ValidMvdClientNumber(number)) throw new RangeError('Invalid MVD player number');
    if (!profile.extended) { mvd.MSG_WriteDeltaMvdPlayerstate(message, from, to, number, from === null); return; }
    if (to === null) { MSG_WriteByte(message, number); MSG_WriteShort(message, mvd.PPS_MOREBITS); if (profile.fog) MSG_WriteByte(message, 1); return; }
    const previous = from ?? new PlayerStateT(), oldOrigin = profile.rerelease ? previous.pmove.originF : previous.pmove.origin, origin = profile.rerelease ? to.pmove.originF : to.pmove.origin;
    let bits = 0;
    if (to.pmove.pm_type !== previous.pmove.pm_type) bits |= mvd.PPS_M_TYPE;
    if (origin[0] !== oldOrigin[0] || origin[1] !== oldOrigin[1]) bits |= mvd.PPS_M_ORIGIN;
    if (origin[2] !== oldOrigin[2]) bits |= mvd.PPS_M_ORIGIN2;
    if (differs(to.viewoffset, previous.viewoffset)) bits |= mvd.PPS_VIEWOFFSET;
    if (ANGLE2SHORT(to.viewangles[0] ?? 0) !== ANGLE2SHORT(previous.viewangles[0] ?? 0) || ANGLE2SHORT(to.viewangles[1] ?? 0) !== ANGLE2SHORT(previous.viewangles[1] ?? 0)) bits |= mvd.PPS_VIEWANGLES;
    if (ANGLE2SHORT(to.viewangles[2] ?? 0) !== ANGLE2SHORT(previous.viewangles[2] ?? 0)) bits |= mvd.PPS_VIEWANGLE2;
    if (differs(to.kick_angles, previous.kick_angles)) bits |= mvd.PPS_KICKANGLES;
    if (to.gunindex !== previous.gunindex || to.gunskin !== previous.gunskin) bits |= mvd.PPS_WEAPONINDEX;
    if (to.gunframe !== previous.gunframe) bits |= mvd.PPS_WEAPONFRAME;
    if (differs(to.gunoffset, previous.gunoffset)) bits |= mvd.PPS_GUNOFFSET;
    if (differs(to.gunangles, previous.gunangles)) bits |= mvd.PPS_GUNANGLES;
    if (differs(to.blend, previous.blend) || (profile.v2 || profile.rerelease) && differs(to.damage_blend, previous.damage_blend)) bits |= mvd.PPS_BLEND;
    const fog = profile.fog ? q2proFogBits(previous.q2proFog, to.q2proFog) : 0;
    if (fog !== 0) bits |= mvd.PPS_MOREBITS | (1 << 17);
    if (to.fov !== previous.fov) bits |= mvd.PPS_FOV;
    if (to.rdflags !== previous.rdflags) bits |= mvd.PPS_RDFLAGS;
    let stats = 0n;
    for (let i = 0; i < (profile.v2 || profile.rerelease ? 64 : 32); i++) if (to.stats[i] !== previous.stats[i]) stats |= 1n << BigInt(i);
    if (stats !== 0n) bits |= mvd.PPS_STATS;
    if (bits === 0 && from !== null) return;
    MSG_WriteByte(message, number); MSG_WriteShort(message, bits); if (bits & mvd.PPS_MOREBITS) MSG_WriteByte(message, bits >>> 16);
    if (bits & mvd.PPS_M_TYPE) MSG_WriteByte(message, to.pmove.pm_type);
    for (let axis = 0; axis < 3; axis++) if (bits & (axis === 2 ? mvd.PPS_M_ORIGIN2 : mvd.PPS_M_ORIGIN)) {
        const value = origin[axis] ?? 0;
        if (profile.rerelease) MSG_WriteFloat(message, value); else if (profile.v2) writeQ2ProInt23(message, value, oldOrigin[axis] ?? 0); else MSG_WriteShort(message, value);
    }
    const vector = (value: Float32Array, scale: number, short: boolean): void => { for (const component of value) { const packed = Math.trunc(component * scale); if (short) MSG_WriteShort(message, packed); else MSG_WriteChar(message, packed); } };
    if (bits & mvd.PPS_VIEWOFFSET) vector(to.viewoffset, profile.rerelease ? 16 : 4, profile.rerelease);
    if (bits & mvd.PPS_VIEWANGLES) { MSG_WriteShort(message, ANGLE2SHORT(to.viewangles[0] ?? 0)); MSG_WriteShort(message, ANGLE2SHORT(to.viewangles[1] ?? 0)); }
    if (bits & mvd.PPS_VIEWANGLE2) MSG_WriteShort(message, ANGLE2SHORT(to.viewangles[2] ?? 0));
    if (bits & mvd.PPS_KICKANGLES) vector(to.kick_angles, profile.rerelease ? 1024 : 4, profile.rerelease);
    if (bits & mvd.PPS_WEAPONINDEX) MSG_WriteShort(message, to.gunindex | to.gunskin << 13);
    if (bits & mvd.PPS_WEAPONFRAME) { if (profile.rerelease) MSG_WriteShort(message, to.gunframe); else MSG_WriteByte(message, to.gunframe); }
    if (bits & mvd.PPS_GUNOFFSET) vector(to.gunoffset, profile.rerelease ? 512 : 8, true);
    if (bits & mvd.PPS_GUNANGLES) vector(to.gunangles, profile.rerelease ? 4096 : 65536 / 360, true);
    if (bits & mvd.PPS_BLEND) {
        if (profile.v2 || profile.rerelease) {
            let blend = 0;
            for (let i = 0; i < 4; i++) { if (to.blend[i] !== previous.blend[i]) blend |= 1 << i; if (to.damage_blend[i] !== previous.damage_blend[i]) blend |= 16 << i; }
            MSG_WriteByte(message, blend);
            for (let i = 0; i < 4; i++) if (blend & 1 << i) MSG_WriteByte(message, Math.trunc((to.blend[i] ?? 0) * 255));
            for (let i = 0; i < 4; i++) if (blend & 16 << i) MSG_WriteByte(message, Math.trunc((to.damage_blend[i] ?? 0) * 255));
        } else for (const value of to.blend) MSG_WriteByte(message, Math.trunc(value * 255));
    }
    if (fog !== 0) writeQ2ProFog(message, fog, to.q2proFog);
    if (bits & mvd.PPS_FOV) MSG_WriteByte(message, to.fov);
    if (bits & mvd.PPS_RDFLAGS) MSG_WriteByte(message, to.rdflags);
    if (bits & mvd.PPS_STATS) {
        if (profile.rerelease) MSG_WriteLong64(message, stats); else if (profile.v2) writeQ2ProVar64(message, stats); else MSG_WriteLong(message, Number(stats));
        for (let i = 0; i < 64; i++) if (stats & 1n << BigInt(i)) MSG_WriteShort(message, to.stats[i] ?? 0);
    }
}
export function encodeMvdEmission(event: MvdEmission): Uint8Array {
    const { recipient, reliable, bytes } = event;
    if (bytes.length < 1 || bytes.length >= 2048) throw new RangeError('MVD routed payload must contain1..2047bytes');
    const message = createMessage(bytes.length + 5), high = bytes.length >>> 8;
    const opcode = recipient.kind === 'player' ? reliable ? mvd.mvd_unicast_r : mvd.mvd_unicast : (reliable ? mvd.mvd_multicast_all_r : mvd.mvd_multicast_all) + (recipient.kind === 'phs' ? 1 : recipient.kind === 'pvs' ? 2 : 0);
    mvd.MSG_WriteMvdCmd(message, opcode, high); MSG_WriteByte(message, bytes.length);
    if (recipient.kind === 'player') { if (!mvd.MSG_ValidMvdClientNumber(recipient.number)) throw new RangeError('Invalid MVD recipient'); MSG_WriteByte(message, recipient.number); }
    else if (recipient.kind !== 'all') { if (!Number.isInteger(recipient.leaf) || recipient.leaf < 0 || recipient.leaf >= 65535) throw new RangeError('Invalid MVD leaf'); MSG_WriteShort(message, recipient.leaf); }
    SZ_Write(message, bytes, bytes.length); return messageBytes(message);
}
/** Inputs are fresh authoritative snapshots, not per-view network frames. */
export class MvdEncoder {
    private previous: MvdCapture | null = null;
    capture(capture: MvdCapture): readonly Uint8Array[] {
        const profile = mvdProfile(capture.revision, capture.flags), old = this.previous;
        const changedWorld = old === null || old.servercount !== capture.servercount || old.revision !== capture.revision || old.flags !== capture.flags;
        const wire = new Q2WireCodec(profile.protocol);
        if (profile.protocol.kind === 'q2-q2pro') wire.acceptQ2ProFeatures(profile.protocol.revision, profile.v2 ? 24 : 8);
        const message = createMessage(MVD_MAX_MESSAGE);
        if (changedWorld) {
            mvd.MSG_WriteMvdCmd(message, mvd.mvd_serverdata, profile.revision < 2012 || profile.rerelease ? capture.flags : 0);
            MSG_WriteLong(message, 37); MSG_WriteShort(message, capture.revision);
            if (profile.revision >= 2012 && !profile.rerelease) MSG_WriteShort(message, capture.flags);
            MSG_WriteLong(message, capture.servercount); MSG_WriteString(message, capture.gamedir); MSG_WriteShort(message, capture.dummy);
            for (const [index, value] of capture.configStrings) { if (index < 0 || index >= profile.maxConfigStrings) throw new RangeError('Invalid MVD configstring'); MSG_WriteShort(message, index); MSG_WriteString(message, value); }
            MSG_WriteShort(message, profile.maxConfigStrings);
        } else {
            for (const [index, value] of capture.configStrings) if (old.configStrings.get(index) !== value) { MSG_WriteByte(message, mvd.mvd_configstring); MSG_WriteShort(message, index); MSG_WriteString(message, value); }
            for (const index of old.configStrings.keys()) if (!capture.configStrings.has(index)) { MSG_WriteByte(message, mvd.mvd_configstring); MSG_WriteShort(message, index); MSG_WriteString(message, ''); }
            MSG_WriteByte(message, mvd.mvd_frame);
        }
        if (capture.portalBits.length > 255) throw new RangeError('MVD portal state too large');
        MSG_WriteByte(message, capture.portalBits.length); SZ_Write(message, capture.portalBits, capture.portalBits.length);
        const previousPlayers = changedWorld ? new Map<number, PlayerStateT>() : old.players;
        for (const [number, player] of capture.players) playerDelta(message, previousPlayers.get(number) ?? null, player, number, profile);
        for (const number of previousPlayers.keys()) if (!capture.players.has(number)) playerDelta(message, previousPlayers.get(number) ?? null, null, number, profile);
        MSG_WriteByte(message, 255);
        const previousEntities = new Map((changedWorld ? [] : old.entities).map(entity => [entity.number, entity])), current = new Set<number>();
        for (const entity of capture.entities) {
            if (entity.number < 1 || entity.number >= profile.maxEntities || current.has(entity.number)) throw new RangeError('Invalid MVD entity identity');
            current.add(entity.number); wire.codec.writeDeltaEntity(message, previousEntities.get(entity.number) ?? new EntityStateT(), entity, !previousEntities.has(entity.number), true);
        }
        for (const number of previousEntities.keys()) if (!current.has(number)) wire.codec.writeEntityRemove(message, number);
        wire.codec.writePacketEntitiesEnd(message);
        const result = [messageBytes(message), ...capture.messages.map(encodeMvdEmission)];
        this.previous = capture; return result;
    }
    reset(): void { this.previous = null; }
}
