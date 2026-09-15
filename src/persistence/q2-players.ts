import type { Q2CharacterCheckpoint, Q2PlayerIntermissionCheckpoint, Q2PlayerStateCheckpoint, Q2PlayersCheckpoint } from "../content/q2/base/player/checkpoint.ts";
import type { Q2PlayerCarry, Q2PlayerRules } from "../content/q2/base/player/types.ts";
import { readArmor, readInventoryEntry, readSavedActor } from "./save-image.ts";
import { readVector } from "./shared.ts";
import { readQ2AttackCheckpoint } from "./q2-foundation.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveReader } from "./value.ts";

function carry(reader: SaveReader): Q2PlayerCarry {
  return { health: reader.field("health").number(), maximumHealth: reader.field("maximumHealth").number(), armor: readArmor(reader.field("armor")), inventory: reader.field("inventory").list(readInventoryEntry),
    weapon: reader.field("weapon").nullable(value => value.string()), selectedItem: reader.field("selectedItem").nullable(namespaced), score: reader.field("score").number(), flags: reader.field("flags").number(), powerCubes: reader.field("powerCubes").number() };
}
function rules(reader: SaveReader): Q2PlayerRules {
  const n = (key: string): number => reader.field(key).number(), s = (key: string): string => reader.field(key).string();
  return { password: s("password"), spectatorPassword: s("spectatorPassword"), maxSpectators: n("maxSpectators"), cheats: reader.field("cheats").boolean(), timeLimitMinutes: n("timeLimitMinutes"), fragLimit: n("fragLimit"),
    mapList: reader.field("mapList").list(value => value.string()), mapListShuffle: reader.field("mapListShuffle").value === undefined ? false : reader.field("mapListShuffle").boolean(), nextMap: s("nextMap"), spawnPoint: s("spawnPoint"), floodMessages: n("floodMessages"), floodSeconds: n("floodSeconds"), floodWaitSeconds: n("floodWaitSeconds"),
    rollSpeed: n("rollSpeed"), rollAngle: n("rollAngle"), runPitch: n("runPitch"), runRoll: n("runRoll"), bobUp: n("bobUp"), bobPitch: n("bobPitch"), bobRoll: n("bobRoll"), gunOffset: readVector(reader.field("gunOffset")) };
}
function intermission(reader: SaveReader): Q2PlayerIntermissionCheckpoint {
  switch (reader.field("kind").choice("playing", "intermission")) {
    case "playing": return { kind: "playing" };
    case "intermission": return { kind: "intermission", map: reader.field("map").string(), started: reader.field("started").number(), exit: reader.field("exit").boolean(),
      landmark: reader.field("landmark").nullable(value => ({ player: readSavedActor(value.field("player")), name: value.field("name").string(), relativeOrigin: readVector(value.field("relativeOrigin")), relativeVelocity: readVector(value.field("relativeVelocity")), relativeViewAngles: readVector(value.field("relativeViewAngles")) })) };
  }
}
export function readQ2PlayerStateCheckpoint(reader: SaveReader): Q2PlayerStateCheckpoint {
  const n = (key: string): number => reader.field(key).number(), s = (key: string): string => reader.field(key).string(), b = (key: string): boolean => reader.field(key).boolean();
  const vector = (key: string) => readVector(reader.field(key));
  return { slot: reader.field("slot").integer(0), enteredAt: n("enteredAt"), useQ2Weapons: b("useQ2Weapons"), useQ2Inventory: b("useQ2Inventory"), spawnInventory: reader.field("spawnInventory").list(readInventoryEntry),
    userinfo: s("userinfo"), name: s("name"), skin: s("skin"), gender: reader.field("gender").choice("male", "female", "neutral"), fov: n("fov"), hand: reader.field("hand").choice("right", "left", "center"),
    spectator: b("spectator"), requestedSpectator: b("requestedSpectator"), connected: b("connected"), dead: b("dead"), gibbed: b("gibbed"), noclip: b("noclip"), god: b("god"), notarget: b("notarget"), score: n("score"), ping: n("ping"),
    respawnTime: n("respawnTime"), airFinished: n("airFinished"), nextDrownTime: n("nextDrownTime"), drownDamage: n("drownDamage"), oldWaterLevel: n("oldWaterLevel"), breatherSound: n("breatherSound"), painDebounce: n("painDebounce"),
    damageBlood: n("damageBlood"), damageArmor: n("damageArmor"), damagePowerArmor: n("damagePowerArmor"), damageKnockback: n("damageKnockback"), damageFrom: vector("damageFrom"), damageBlend: vector("damageBlend"), damageAlpha: n("damageAlpha"), bonusAlpha: n("bonusAlpha"),
    damagePitch: n("damagePitch"), damageRoll: n("damageRoll"), damageTime: n("damageTime"), powerArmorTime: n("powerArmorTime"), fallTime: n("fallTime"), fallValue: n("fallValue"), landmarkFreeFall: b("landmarkFreeFall"), landmarkNoiseTime: n("landmarkNoiseTime"),
    oldVelocity: vector("oldVelocity"), oldViewAngles: vector("oldViewAngles"), killerYaw: n("killerYaw"), buttons: n("buttons"), latchedButtons: n("latchedButtons"), weaponThunk: b("weaponThunk"), bobTime: n("bobTime"), bobMove: n("bobMove"), event: s("event"),
    animationPriority: n("animationPriority"), animationEnd: n("animationEnd"), animationDuck: b("animationDuck"), animationRun: b("animationRun"), loopSound: s("loopSound"), selectedItem: reader.field("selectedItem").nullable(namespaced),
    showScores: b("showScores"), showInventory: b("showInventory"), showHelp: b("showHelp"), chaseTarget: reader.field("chaseTarget").nullable(readSavedActor), coopRespawn: reader.field("coopRespawn").nullable(carry),
    floodTimes: [...reader.field("floodTimes").list(value => value.number())], floodLockUntil: n("floodLockUntil") };
}
export function readQ2PlayersCheckpoint(reader: SaveReader): Q2PlayersCheckpoint {
  return { version: reader.field("version").literal(1), corpseIndex: reader.field("corpseIndex").integer(0), deathAnimation: reader.field("deathAnimation").number(), painAnimation: reader.field("painAnimation").number(),
    rules: rules(reader.field("rules")), intermission: intermission(reader.field("intermission")), players: reader.field("players").list(value => ({ actor: readSavedActor(value.field("actor")), state: readQ2PlayerStateCheckpoint(value.field("state")) })) };
}
export function encodeQ2PlayersCheckpoint(checkpoint: Q2PlayersCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2PlayersCheckpoint(bytes: Uint8Array): Q2PlayersCheckpoint { return readQ2PlayersCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-players")); }
export function readQ2CharacterCheckpoint(reader: SaveReader): Q2CharacterCheckpoint {
  const entity = reader.field("entity"), n = (key: string): number => entity.field(key).number(), s = (key: string): string => entity.field(key).string();
  return { version: reader.field("version").literal(1), painIndex: reader.field("painIndex").number(), deathIndex: reader.field("deathIndex").number(), state: readQ2PlayerStateCheckpoint(reader.field("state")), rules: rules(reader.field("rules")), lastAttack: reader.field("lastAttack").nullable(readQ2AttackCheckpoint),
    entity: { model: s("model"), model2: s("model2"), model3: s("model3"), model4: s("model4"), skin: n("skin"), frame: n("frame"), oldFrame: n("oldFrame"), scale: n("scale"), effects: n("effects"), renderFlags: n("renderFlags"), flags: n("flags"), serverFlags: n("serverFlags"), viewHeight: n("viewHeight"), maxHealth: n("maxHealth"), sound: s("sound"), visible: entity.field("visible").boolean() } };
}
export function encodeQ2CharacterCheckpoint(checkpoint: Q2CharacterCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2CharacterCheckpoint(bytes: Uint8Array): Q2CharacterCheckpoint { return readQ2CharacterCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-character")); }
