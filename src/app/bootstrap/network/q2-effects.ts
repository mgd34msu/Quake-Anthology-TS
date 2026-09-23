import type { Vec3 } from '../../../contracts/math.ts';
import type { Q2PresentationEvent } from '../../../content/q2/foundation/host.ts';
import type { Q2WeaponEvent } from '../../../content/q2/foundation/weapons/types.ts';
import { Q2TempType } from '../../../network/q2/temp-types.ts';
import type { Q2TempEntity, Q2TempField } from '../../../network/q2/temp-entities.ts';
interface EffectEncoding {
    readonly name: string;
    readonly type: Q2TempType;
    readonly shape: 'position' | 'direction' | 'splash';
}
type BeamEvent = Extract<Q2WeaponEvent, { readonly kind: 'beam' }>;
const trails: readonly { readonly type: Q2TempType; readonly effect: BeamEvent['effect'] }[] = [
    { type: Q2TempType.TE_RAILTRAIL, effect: 'rail' },
    { type: Q2TempType.TE_BUBBLETRAIL, effect: 'bubble-trail' },
    { type: Q2TempType.TE_BFG_LASER, effect: 'bfg-laser' },
    { type: Q2TempType.TE_BFG_ZAP, effect: 'bfg-zap' },
];

/** These wire effects carry endpoints, without an owning entity number. */
export function q2BeamFromWire(value: Q2TempEntity): BeamEvent | null {
    const trail = trails.find(entry => entry.type === value.type);
    if (trail === undefined) return null;
    const start = value.fields.find(field => field.kind === 'vector' && field.name === 'position1');
    const end = value.fields.find(field => field.kind === 'vector' && field.name === 'position2');
    if (start?.kind !== 'vector' || end?.kind !== 'vector') throw new Error('Q2 trail requires both source endpoints');
    return { kind: 'beam', effect: trail.effect, actor: null, start: start.value, end: end.value, duration: 0.1 };
}
/** Q2 CL_ParseTEnt/g_utils message shapes; names match the source game presentation imports. */
const effects: readonly EffectEncoding[] = [
    { name: 'gunshot', type: Q2TempType.TE_GUNSHOT, shape: 'direction' },
    { name: 'blood', type: Q2TempType.TE_BLOOD, shape: 'direction' },
    { name: 'blaster', type: Q2TempType.TE_BLASTER, shape: 'direction' },
    { name: 'shotgun', type: Q2TempType.TE_SHOTGUN, shape: 'direction' },
    { name: 'sparks', type: Q2TempType.TE_SPARKS, shape: 'direction' },
    { name: 'screen-sparks', type: Q2TempType.TE_SCREEN_SPARKS, shape: 'direction' },
    { name: 'shield-sparks', type: Q2TempType.TE_SHIELD_SPARKS, shape: 'direction' },
    { name: 'bullet-sparks', type: Q2TempType.TE_BULLET_SPARKS, shape: 'direction' },
    { name: 'greenblood', type: Q2TempType.TE_GREENBLOOD, shape: 'direction' },
    { name: 'blaster2', type: Q2TempType.TE_BLASTER2, shape: 'direction' },
    { name: 'flechette', type: Q2TempType.TE_FLECHETTE, shape: 'direction' },
    { name: 'moreblood', type: Q2TempType.TE_MOREBLOOD, shape: 'direction' },
    { name: 'electric-sparks', type: Q2TempType.TE_ELECTRIC_SPARKS, shape: 'direction' },
    { name: 'splash', type: Q2TempType.TE_SPLASH, shape: 'splash' },
    { name: 'laser-sparks', type: Q2TempType.TE_LASER_SPARKS, shape: 'splash' },
    { name: 'welding-sparks', type: Q2TempType.TE_WELDING_SPARKS, shape: 'splash' },
    { name: 'tunnel-sparks', type: Q2TempType.TE_TUNNEL_SPARKS, shape: 'splash' },
    { name: 'explosion1', type: Q2TempType.TE_EXPLOSION1, shape: 'position' },
    { name: 'explosion2', type: Q2TempType.TE_EXPLOSION2, shape: 'position' },
    { name: 'rocket-explosion', type: Q2TempType.TE_ROCKET_EXPLOSION, shape: 'position' },
    { name: 'grenade-explosion', type: Q2TempType.TE_GRENADE_EXPLOSION, shape: 'position' },
    { name: 'rocket-explosion-water', type: Q2TempType.TE_ROCKET_EXPLOSION_WATER, shape: 'position' },
    { name: 'grenade-explosion-water', type: Q2TempType.TE_GRENADE_EXPLOSION_WATER, shape: 'position' },
    { name: 'bfg-explosion', type: Q2TempType.TE_BFG_EXPLOSION, shape: 'position' },
    { name: 'bfg-bigexplosion', type: Q2TempType.TE_BFG_BIGEXPLOSION, shape: 'position' },
    { name: 'boss-teleport', type: Q2TempType.TE_BOSSTPORT, shape: 'position' },
    { name: 'other-teleport', type: Q2TempType.TE_TELEPORT_EFFECT, shape: 'position' },
];
export function q2EffectToWire(event: Extract<Q2PresentationEvent, {
    readonly kind: 'effect';
}>): Q2TempEntity | null {
    const encoding = effects.find(value => value.name === event.effect.replace(/^q2:/, ''));
    if (encoding === undefined)
        return null;
    const fields: Q2TempField[] = [];
    if (encoding.shape === 'splash')
        fields.push({ kind: 'integer', name: 'count', value: event.count });
    fields.push({ kind: 'vector', name: 'position1', value: event.origin });
    if (encoding.shape !== 'position')
        fields.push({ kind: 'vector', name: 'direction', value: event.direction });
    if (encoding.shape === 'splash')
        fields.push({ kind: 'integer', name: 'color', value: event.color });
    return { type: encoding.type, fields, raw: new Uint8Array(0) };
}
export function q2EffectFromWire(value: Q2TempEntity): Extract<Q2PresentationEvent, {
    readonly kind: 'effect';
}> | null {
    const encoding = effects.find(entry => entry.type === value.type);
    if (encoding === undefined)
        return null;
    const zero: Vec3 = { x: 0, y: 0, z: 0 };
    const vector = (name: 'position1' | 'direction'): Vec3 => { const field = value.fields.find(field => field.kind === 'vector' && field.name === name); if (field === undefined || field.kind !== 'vector')
        return zero; return field.value; };
    const integer = (name: 'count' | 'color'): number => { const field = value.fields.find(field => field.kind === 'integer' && field.name === name); if (field === undefined || field.kind !== 'integer')
        return 0; return field.value; };
    return { kind: 'effect', effect: encoding.name, origin: vector('position1'), direction: vector('direction'), count: integer('count'), color: integer('color') };
}
