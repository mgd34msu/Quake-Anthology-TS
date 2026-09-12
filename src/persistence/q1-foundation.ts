import type { Q1EntitySourceState, Q1FoundationCheckpoint, Q1SavedEntity, Q1SavedPlayer } from "../content/q1/foundation/checkpoint.ts";
import type { Q1Weapon } from "../content/q1/foundation/types.ts";
import { Q1_WEAPON_IDS, Q1_POWERUP_IDS } from "../content/q1/foundation/types.ts";
import { Q1_MONSTER_SPECIES } from "../content/q1/foundation/entity.ts";
import { readSavedActor } from "./save-image.ts";
import { readBounds, readVector } from "./shared.ts";
import { namespaced, decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

function weapon(reader: SaveReader): Q1Weapon { return reader.choice(...Q1_WEAPON_IDS); }
function sourceState(reader: SaveReader): Q1EntitySourceState {
  const n = (name: string): number => reader.field(name).number();
  const s = (name: string): string => reader.field(name).string();
  const v = (name: string) => readVector(reader.field(name));
  return { model: s("model"), frame: n("frame"), skin: n("skin"), effects: n("effects"), solid: reader.field("solid").choice("none", "trigger", "bbox", "slidebox", "bsp"), movement: reader.field("movement").choice("none", "push", "step", "toss", "bounce", "fly", "flymissile", "noclip"),
    target: s("target"), targetname: s("targetname"), killtarget: s("killtarget"), message: s("message"), delay: n("delay"), spawnflags: n("spawnflags"), sounds: n("sounds"), wait: n("wait"), speed: n("speed"), damage: n("damage"), maxHealth: n("maxHealth"), aimedDamage: reader.field("aimedDamage").boolean(), nextThink: n("nextThink"), originalModel: s("originalModel"),
    pos1: v("pos1"), pos2: v("pos2"), dest1: v("dest1"), dest2: v("dest2"), movedir: v("movedir"), mangle: v("mangle"), state: reader.field("state").choice("bottom", "up", "top", "down"), triggerBounds: reader.field("triggerBounds").nullable(readBounds), attackFinished: n("attackFinished"), count: n("count"), activated: reader.field("activated").boolean(),
    projectile: reader.field("projectile").nullable(value => value.choice("rocket", "grenade", "spike", "superspike")), projectileWeapon: reader.field("projectileWeapon").nullable(weapon), angularVelocity: v("angularVelocity"), waterLevel: n("waterLevel"), waterType: reader.field("waterType").choice(0, -1, -2, -3, -4, -5, -6), movementFlags: n("movementFlags"), idealYaw: n("idealYaw"), yawSpeed: n("yawSpeed"), attackState: reader.field("attackState").choice("straight", "melee", "missile", "dodging") };
}
function entity(reader: SaveReader): Q1SavedEntity {
  const callbacks = reader.field("callbacks");
  const name = (key: string): string | null => callbacks.field(key).nullable(value => value.string());
  return { actor: readSavedActor(reader.field("actor")), actorProvider: namespaced(reader.field("actorProvider")), sourceSlot: reader.field("sourceSlot").nullable(value => value.integer(0)), classname: reader.field("classname").string(), sourceOrdinal: reader.field("sourceOrdinal").nullable(value => value.integer()), state: sourceState(reader.field("state")),
    fields: reader.field("fields").list(value => ({ key: value.field("key").string(), value: value.field("value").string() })), references: reader.field("references").list(value => ({ key: value.field("key").string(), actor: value.field("actor").nullable(readSavedActor) })), owner: reader.field("owner").nullable(readSavedActor), activator: reader.field("activator").nullable(readSavedActor), doorGroup: reader.field("doorGroup").list(readSavedActor),
    monster: reader.field("monster").nullable(value => ({ species: value.field("species").choice(...Q1_MONSTER_SPECIES), mode: value.field("mode").choice("stand", "walk", "run", "attack", "leap", "pain", "death"),
      frameIndex: value.field("frameIndex").number(), sequence: value.field("sequence").list(frame => frame.number()), firstFrame: value.field("firstFrame").number(), enemy: value.field("enemy").nullable(readSavedActor), oldEnemy: value.field("oldEnemy").nullable(readSavedActor), path: value.field("path").string(), pauseUntil: value.field("pauseUntil").number(), attackFinished: value.field("attackFinished").number(), painFinished: value.field("painFinished").number(), searchUntil: value.field("searchUntil").number(), deathDrop: value.field("deathDrop").boolean(), refired: value.field("refired").boolean() })),
    move: reader.field("move").nullable(value => ({ destination: readVector(value.field("destination")), done: value.field("done").string() })),
    callbacks: { think: name("think"), use: name("use"), touch: name("touch"), pain: name("pain"), die: name("die"), blocked: name("blocked"), pathEnd: name("pathEnd") } };
}
function player(reader: SaveReader): Q1SavedPlayer {
  const state = reader.field("state"), n = (name: string): number => state.field(name).number();
  return { actor: readSavedActor(reader.field("actor")), actorProvider: namespaced(reader.field("actorProvider")), state: { weapon: weapon(state.field("weapon")), primaryHolstered: state.field("primaryHolstered").boolean(), attackHeld: state.field("attackHeld").boolean(), jumpHeld: state.field("jumpHeld").boolean(), teleportUntil: n("teleportUntil"), attackFinished: n("attackFinished"), weaponFrame: n("weaponFrame"), weaponAnimationAt: n("weaponAnimationAt"), weaponAnimationBase: n("weaponAnimationBase"), continuousFiring: state.field("continuousFiring").boolean(), nextWeaponFrame: n("nextWeaponFrame"), lightningSoundAt: n("lightningSoundAt"), punchAngles: readVector(state.field("punchAngles")), nailSide: n("nailSide"),
    maxHealth: n("maxHealth"), megaRotAt: n("megaRotAt"), hostileUntil: n("hostileUntil"), viewAngles: readVector(state.field("viewAngles")), waterLevel: n("waterLevel"), airFinished: n("airFinished"), drownDamage: n("drownDamage"), drownAt: n("drownAt"), hazardAt: n("hazardAt"), autoSwitch: state.field("autoSwitch").choice("always", "new", "never") },
    powerups: reader.field("powerups").list(value => ({ kind: value.field("kind").choice(...Q1_POWERUP_IDS), expires: value.field("expires").number() })) };
}
export function readQ1FoundationCheckpoint(reader: SaveReader): Q1FoundationCheckpoint {
  const n = (name: string): number => reader.field(name).number();
  const basis = reader.field("basis"), precaches = reader.field("precaches");
  return { provider: namespaced(reader.field("provider")), format: reader.field("format").literal("q1-foundation"), version: reader.field("version").literal(5),
    precaches: { phase: precaches.field("phase").choice("loading", "frozen"), models: precaches.field("models").list(value => value.string()), sounds: precaches.field("sounds").list(value => value.string()) }, edition: reader.field("edition").choice("classic", "rerelease"), time: n("time"), frameSeconds: n("frameSeconds"), forceRetouch: n("forceRetouch"), sequence: reader.field("sequence").integer(0), nextDynamicSlot: reader.field("nextDynamicSlot").integer(0), totalSecrets: n("totalSecrets"), foundSecrets: n("foundSecrets"), totalMonsters: n("totalMonsters"), killedMonsters: n("killedMonsters"), worldType: n("worldType"), mapName: reader.field("mapName").string(),
    basis: { forward: readVector(basis.field("forward")), right: readVector(basis.field("right")), up: readVector(basis.field("up")) }, world: reader.field("world").nullable(readSavedActor), sightEntity: reader.field("sightEntity").nullable(readSavedActor), sightTime: n("sightTime"), intermission: reader.field("intermission").nullable(value => ({ map: value.field("map").string(), cause: value.field("cause").nullable(readSavedActor), exitAfter: value.field("exitAfter").number() })),
    entities: reader.field("entities").list(entity), players: reader.field("players").list(player), extensions: reader.field("extensions").list(value => ({ id: value.field("id").string(), bytes: value.field("bytes").bytes() })) };
}
export function encodeQ1FoundationCheckpoint(checkpoint: Q1FoundationCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ1FoundationCheckpoint(bytes: Uint8Array): Q1FoundationCheckpoint { return readQ1FoundationCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q1-foundation")); }
