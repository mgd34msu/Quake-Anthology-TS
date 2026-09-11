import { readQ2ProInt23 } from './codecs/q2pro-fields.ts';
// q2proto_read_gamemsg.inc. GPL-2.0-or-later.
import type { Vec3 } from '../../contracts/math.ts';
import { Q2TempType } from './temp-types.ts';
import { MSG_ReadByte, MSG_ReadCoord, MSG_ReadDir, MSG_ReadFloat, MSG_ReadLong, MSG_ReadShort, checkMessageRead } from './message.ts';
import type { SizeBuf } from './message.ts';
import { readElement } from './state.ts';
export type Q2TempField = {
    readonly kind: 'integer';
    readonly name: 'entity1' | 'entity2' | 'count' | 'color' | 'time';
    readonly value: number;
} | {
    readonly kind: 'vector';
    readonly name: 'position1' | 'position2' | 'direction' | 'offset';
    readonly value: Vec3;
};
export interface Q2TempEntity {
    readonly type: number;
    readonly fields: readonly Q2TempField[];
    readonly raw: Uint8Array;
}
export function readGamePosition(message: SizeBuf, floating: boolean, int23 = false): Vec3 {
    const read = int23 ? (m: SizeBuf) => readQ2ProInt23(m) / 8 : floating ? MSG_ReadFloat : MSG_ReadCoord;
    return { x: read(message), y: read(message), z: read(message) };
}
export function readTempEntity(message: SizeBuf, floating: boolean, q2proExtended = false, int23 = false): Q2TempEntity {
    const start = message.readcount, type = MSG_ReadByte(message), fields: Q2TempField[] = [];
    const integer = (name: Extract<Q2TempField, {
        kind: 'integer';
    }>['name'], read: (m: SizeBuf) => number): number => { const value = read(message); fields.push({ kind: 'integer', name, value }); return value; };
    const position = (name: Extract<Q2TempField, {
        kind: 'vector';
    }>['name']): void => { fields.push({ kind: 'vector', name, value: readGamePosition(message, floating, int23) }); };
    const direction = (): void => { const value = new Float32Array(3); MSG_ReadDir(message, value); fields.push({ kind: 'vector', name: 'direction', value: { x: readElement(value, 0), y: readElement(value, 1), z: readElement(value, 2) } }); };
    switch (type) {
        case Q2TempType.TE_BLOOD:
        case Q2TempType.TE_GUNSHOT:
        case Q2TempType.TE_SPARKS:
        case Q2TempType.TE_BULLET_SPARKS:
        case Q2TempType.TE_SCREEN_SPARKS:
        case Q2TempType.TE_SHIELD_SPARKS:
        case Q2TempType.TE_SHOTGUN:
        case Q2TempType.TE_BLASTER:
        case Q2TempType.TE_GREENBLOOD:
        case Q2TempType.TE_BLASTER2:
        case Q2TempType.TE_FLECHETTE:
        case Q2TempType.TE_HEATBEAM_SPARKS:
        case Q2TempType.TE_HEATBEAM_STEAM:
        case Q2TempType.TE_MOREBLOOD:
        case Q2TempType.TE_ELECTRIC_SPARKS:
        case Q2TempType.TE_BLUEHYPERBLASTER_2:
        case Q2TempType.TE_BERSERK_SLAM:
            position('position1');
            direction();
            break;
        case Q2TempType.TE_SPLASH:
        case Q2TempType.TE_LASER_SPARKS:
        case Q2TempType.TE_WELDING_SPARKS:
        case Q2TempType.TE_TUNNEL_SPARKS:
            integer('count', MSG_ReadByte);
            position('position1');
            direction();
            integer('color', MSG_ReadByte);
            break;
        case Q2TempType.TE_BLUEHYPERBLASTER:
        case Q2TempType.TE_RAILTRAIL:
        case Q2TempType.TE_RAILTRAIL2:
        case Q2TempType.TE_BUBBLETRAIL:
        case Q2TempType.TE_DEBUGTRAIL:
        case Q2TempType.TE_BUBBLETRAIL2:
        case Q2TempType.TE_BFG_LASER:
        case Q2TempType.TE_BFG_ZAP:
            position('position1');
            position('position2');
            break;
        case Q2TempType.TE_GRENADE_EXPLOSION:
        case Q2TempType.TE_GRENADE_EXPLOSION_WATER:
        case Q2TempType.TE_EXPLOSION2:
        case Q2TempType.TE_PLASMA_EXPLOSION:
        case Q2TempType.TE_ROCKET_EXPLOSION:
        case Q2TempType.TE_ROCKET_EXPLOSION_WATER:
        case Q2TempType.TE_EXPLOSION1:
        case Q2TempType.TE_EXPLOSION1_NP:
        case Q2TempType.TE_EXPLOSION1_BIG:
        case Q2TempType.TE_BFG_EXPLOSION:
        case Q2TempType.TE_BFG_BIGEXPLOSION:
        case Q2TempType.TE_BOSSTPORT:
        case Q2TempType.TE_PLAIN_EXPLOSION:
        case Q2TempType.TE_CHAINFIST_SMOKE:
        case Q2TempType.TE_TRACKER_EXPLOSION:
        case Q2TempType.TE_TELEPORT_EFFECT:
        case Q2TempType.TE_DBALL_GOAL:
        case Q2TempType.TE_WIDOWSPLASH:
        case Q2TempType.TE_NUKEBLAST:
        case Q2TempType.TE_EXPLOSION1_NL:
        case Q2TempType.TE_EXPLOSION2_NL:
            position('position1');
            break;
        case Q2TempType.TE_PARASITE_ATTACK:
        case Q2TempType.TE_MEDIC_CABLE_ATTACK:
        case Q2TempType.TE_HEATBEAM:
        case Q2TempType.TE_MONSTER_HEATBEAM:
        case Q2TempType.TE_GRAPPLE_CABLE_2:
        case Q2TempType.TE_LIGHTNING_BEAM:
            integer('entity1', MSG_ReadShort);
            position('position1');
            position('position2');
            break;
        case Q2TempType.TE_GRAPPLE_CABLE:
            integer('entity1', MSG_ReadShort);
            position('position1');
            position('position2');
            position('offset');
            break;
        case Q2TempType.TE_LIGHTNING:
            integer('entity1', MSG_ReadShort);
            integer('entity2', MSG_ReadShort);
            position('position1');
            position('position2');
            break;
        case Q2TempType.TE_FLASHLIGHT:
            position('position1');
            integer('entity1', MSG_ReadShort);
            break;
        case Q2TempType.TE_FORCEWALL:
            position('position1');
            position('position2');
            integer('color', MSG_ReadByte);
            break;
        case Q2TempType.TE_STEAM: {
            const entity = integer('entity1', MSG_ReadShort);
            integer('count', MSG_ReadByte);
            position('position1');
            direction();
            integer('color', MSG_ReadByte);
            integer('entity2', MSG_ReadShort);
            if (entity !== -1)
                integer('time', MSG_ReadLong);
            break;
        }
        case Q2TempType.TE_WIDOWBEAMOUT:
            integer('entity1', MSG_ReadShort);
            position('position1');
            break;
        case Q2TempType.TE_POWER_SPLASH:
            integer('entity1', MSG_ReadShort);
            integer('count', MSG_ReadByte);
            break;
        case Q2TempType.TE_Q2PRO_DAMAGE_DEALT:
            if (!q2proExtended)
                throw new Error('Q2PRO damage event needs its game message dialect');
            integer('count', MSG_ReadShort);
            break;
        default: throw new Error(`Unknown Q2 temporary entity ${type}`);
    }
    checkMessageRead(message);
    return { type, fields, raw: message.data.slice(start, message.readcount) };
}
