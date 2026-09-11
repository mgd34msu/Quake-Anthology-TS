import type { Q2AttackCheckpoint, Q2EntityCheckpoint, Q2FoundationCheckpoint } from "../content/q2/foundation/checkpoint.ts";
import type { AttackProvenance, Q2NativeCause } from "../contracts/gameplay.ts";
import { readSavedActor } from "./save-image.ts";
import { readTime, readVector } from "./shared.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveReader } from "./value.ts";

function nativeCause(reader: SaveReader): Q2NativeCause {
  switch (reader.field("edition").choice("classic", "rerelease")) {
    case "classic": return { edition: "classic", game: reader.field("game").choice("base", "xatrix", "rogue", "ctf"), value: reader.field("value").integer() };
    case "rerelease": return { edition: "rerelease", id: reader.field("id").integer(0), friendlyFire: reader.field("friendlyFire").boolean(), noPointLoss: reader.field("noPointLoss").boolean() };
  }
}
function cause(reader: SaveReader): AttackProvenance["cause"] {
  switch (reader.field("kind").choice("q1", "q2", "q3", "environment")) {
    case "q1": return { kind: "q1", deathType: reader.field("deathType").string(), ...(reader.field("armorEffect").value === undefined ? {} : { armorEffect: reader.field("armorEffect").choice("bypass", "half-effectiveness") }) };
    case "q2": return { kind: "q2", meansOfDeath: reader.field("meansOfDeath").integer(), damageFlags: reader.field("damageFlags").integer(), ...(reader.field("native").value === undefined ? {} : { native: nativeCause(reader.field("native")) }) };
    case "q3": return { kind: "q3", meansOfDeath: reader.field("meansOfDeath").integer(), damageFlags: reader.field("damageFlags").integer() };
    case "environment": return { kind: "environment", hazard: reader.field("hazard").choice("fall", "drown", "lava", "slime", "crush", "trigger") };
  }
}
export function readQ2AttackCheckpoint(reader: SaveReader): Q2AttackCheckpoint {
  return { sequence: reader.field("sequence").integer(0), time: readTime(reader.field("time")), attacker: reader.field("attacker").nullable(readSavedActor), inflictor: reader.field("inflictor").nullable(readSavedActor),
    weapon: reader.field("weapon").nullable(namespaced), weaponProvider: namespaced(reader.field("weaponProvider")), combatProvider: namespaced(reader.field("combatProvider")), inventoryProvider: namespaced(reader.field("inventoryProvider")), movementProvider: namespaced(reader.field("movementProvider")), cause: cause(reader.field("cause")) };
}
function entity(reader: SaveReader): Q2EntityCheckpoint {
  const v = reader.field("values"), links = reader.field("links"), callbacks = reader.field("callbacks"), spawn = reader.field("spawn");
  const spawnValues = spawn.field("values").list(value => ({ key: value.field("key").string(), value: value.field("value").string() }));
  const n = (name: string): number => v.field(name).number();
  const s = (name: string): string => v.field(name).string();
  const b = (name: string): boolean => v.field(name).boolean();
  const link = (name: string) => links.field(name).nullable(readSavedActor);
  const callback = (name: string): string | null => callbacks.field(name).nullable(value => value.string());
  return { actor: readSavedActor(reader.field("actor")), sourceSlot: reader.field("sourceSlot").nullable(value => value.integer(0)),
    spawn: { classname: spawn.field("classname").string(), ordinal: spawn.field("ordinal").integer(), values: spawnValues },
    values: { classname: s("classname"), target: s("target"), targetname: s("targetname"), killtarget: s("killtarget"), combatTarget: s("combatTarget"), deathTarget: s("deathTarget"), healthTarget: v.field("healthTarget").value === undefined ? spawnValues.find(field => field.key === "healthtarget")?.value ?? "" : s("healthTarget"), itemTarget: v.field("itemTarget").value === undefined ? spawnValues.find(field => field.key === "itemtarget")?.value ?? "" : s("itemTarget"), message: s("message"), model: s("model"), model2: s("model2"), model3: s("model3"), model4: s("model4"),
      spawnflags: n("spawnflags"), delay: n("delay"), wait: n("wait"), speed: n("speed"), accel: n("accel"), decel: n("decel"), damage: n("damage"), damageRadius: n("damageRadius"), radiusDamage: n("radiusDamage"), count: n("count"), maxHealth: n("maxHealth"), viewHeight: n("viewHeight"), frame: n("frame"), oldFrame: n("oldFrame"), scale: n("scale"), alpha: v.field("alpha").value === undefined ? 1 : n("alpha"), skin: n("skin"), effects: n("effects"), renderFlags: n("renderFlags"), flags: n("flags"), serverFlags: n("serverFlags"), lightLevel: n("lightLevel"), powerCubes: n("powerCubes"), timestamp: n("timestamp"),
      noise: s("noise"), sound: s("sound"), volume: n("volume"), attenuation: n("attenuation"), random: n("random"), map: s("map"), style: n("style"), transitionStarted: b("transitionStarted"), clipMask: n("clipMask"), projectile: b("projectile"), dodgeable: b("dodgeable"), laserImmune: b("laserImmune"), damageableTarget: b("damageableTarget"), visible: b("visible"),
      solid: v.field("solid").choice("none", "trigger", "box", "brush"), motion: v.field("motion").choice("stationary", "push", "stop", "toss", "new-toss", "bounce", "wall-bounce", "fly-missile", "fly", "step"), gravity: n("gravity"), gravityVector: readVector(v.field("gravityVector")), angularVelocity: readVector(v.field("angularVelocity")), movedir: readVector(v.field("movedir")), pos1: readVector(v.field("pos1")), pos2: readVector(v.field("pos2")), nextThink: v.field("nextThink").nullable(value => value.number()) },
    links: { activator: link("activator"), enemy: link("enemy"), owner: link("owner"), goal: link("goal"), teamMaster: link("teamMaster"), teamChain: link("teamChain"), chain: link("chain"), beam: link("beam"), beam2: link("beam2"), proboscus: link("proboscus") }, lastAttack: reader.field("lastAttack").nullable(readQ2AttackCheckpoint),
    callbacks: { think: callback("think"), prethink: callback("prethink"), postthink: callback("postthink"), use: callback("use"), touch: callback("touch"), pain: callback("pain"), die: callback("die"), blocked: callback("blocked") } };
}
export function readQ2FoundationCheckpoint(reader: SaveReader): Q2FoundationCheckpoint {
  const counters = reader.field("counters"), n = (name: string): number => counters.field(name).number();
  return { version: reader.field("version").literal(1), nextSourceSlot: reader.field("nextSourceSlot").integer(0), sequence: reader.field("sequence").integer(0), freedSlots: reader.field("freedSlots").list(value => ({ slot: value.field("slot").integer(0), time: value.field("time").number() })),
    counters: { totalSecrets: n("totalSecrets"), foundSecrets: n("foundSecrets"), totalGoals: n("totalGoals"), foundGoals: n("foundGoals"), totalMonsters: n("totalMonsters"), killedMonsters: n("killedMonsters"), serverFlags: n("serverFlags") }, entities: reader.field("entities").list(entity) };
}
export function encodeQ2FoundationCheckpoint(checkpoint: Q2FoundationCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2FoundationCheckpoint(bytes: Uint8Array): Q2FoundationCheckpoint { return readQ2FoundationCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-foundation")); }
