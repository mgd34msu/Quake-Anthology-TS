import type { Q2MonsterPerceptionCheckpoint, Q2MonstersCheckpoint, Q2MonsterStateCheckpoint } from "../content/q2/foundation/monsters/checkpoint.ts";
import type { Q2AlternateFlyState } from "../content/q2/foundation/monsters/alternate-fly-state.ts";
import { readQ2AttackCheckpoint } from "./q2-foundation.ts";
import { readSavedActor } from "./save-image.ts";
import { readVector } from "./shared.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

function alternateFly(reader: SaveReader): Q2AlternateFlyState {
  const n = (name: string): number => reader.field(name).number(), b = (name: string): boolean => reader.field(name).boolean();
  return { alternateFly: b("alternateFly"), flyMinDistance: n("flyMinDistance"), flyMaxDistance: n("flyMaxDistance"), flyAcceleration: n("flyAcceleration"), flySpeed: n("flySpeed"),
    flyIdealPosition: readVector(reader.field("flyIdealPosition")), flyPositionTime: n("flyPositionTime"), flyBuzzard: b("flyBuzzard"), flyAbove: b("flyAbove"), flyPinned: b("flyPinned"), flyThrusters: b("flyThrusters"),
    flyRecoveryTime: n("flyRecoveryTime"), flyRecoveryDirection: readVector(reader.field("flyRecoveryDirection")), hintPath: b("hintPath"),
    pathing: reader.field("pathing").nullable(value => ({ firstMovePoint: readVector(value.field("firstMovePoint")), secondMovePoint: readVector(value.field("secondMovePoint")), traversalPending: value.field("traversalPending").boolean() })) };
}

function state(reader: SaveReader): Q2MonsterStateCheckpoint {
  const n = (name: string): number => reader.field(name).number(), b = (name: string): boolean => reader.field(name).boolean();
  return { ...alternateFly(reader), kind: reader.field("kind").string(), weapon: reader.field("weapon").choice("blaster", "shotgun", "machinegun"), locomotion: reader.field("locomotion").choice("walk", "fly", "swim", "stationary"), hasMelee: b("hasMelee"), hasRangedAttack: b("hasRangedAttack"), hasIdle: b("hasIdle"), hasSearch: b("hasSearch"), blindFire: b("blindFire"), goodGuy: b("goodGuy"), targetAnger: b("targetAnger"), ignoreShots: b("ignoreShots"), doNotCount: b("doNotCount"), spawnedBy: reader.field("spawnedBy").choice("none", "carrier", "medic", "widow"), commander: reader.field("commander").nullable(readSavedActor), monsterSlots: n("monsterSlots"), monsterUsed: n("monsterUsed"), brutal: b("brutal"), medic: b("medic"), resurrecting: b("resurrecting"),
    move: reader.field("move").string(), nextMove: reader.field("nextMove").nullable(value => value.string()), nextFrame: n("nextFrame"), nextMoveTime: n("nextMoveTime"), scale: n("scale"), gibHealth: n("gibHealth"), canTakeDamage: b("canTakeDamage"), dead: b("dead"), corpse: b("corpse"), gibbed: b("gibbed"), standGround: b("standGround"), temporaryStandGround: b("temporaryStandGround"), holdFrame: b("holdFrame"), ducked: b("ducked"), dodging: b("dodging"), charging: b("charging"), manualSteering: b("manualSteering"), combatPoint: b("combatPoint"), attackState: reader.field("attackState").choice("straight", "sliding", "melee", "missile", "blind"), lefty: b("lefty"),
    idealYaw: n("idealYaw"), yawSpeed: n("yawSpeed"), pauseTime: n("pauseTime"), idleTime: n("idleTime"), painTime: n("painTime"), fireWait: n("fireWait"), duckWait: n("duckWait"), nextDuckTime: n("nextDuckTime"), dodgeTime: n("dodgeTime"), attackFinished: n("attackFinished"), checkAttackTime: n("checkAttackTime"), strafeTime: n("strafeTime"), hadVisibility: b("hadVisibility"), closeSightTripped: b("closeSightTripped"), meleeTime: n("meleeTime"), searchTime: n("searchTime"), trailTime: n("trailTime"), showHostile: n("showHostile"),
    lastSighting: readVector(reader.field("lastSighting")), savedGoal: reader.field("savedGoal").nullable(readVector), lostSight: b("lostSight"), pursueNext: b("pursueNext"), pursueTemporary: b("pursueTemporary"), pursuitLastSeen: b("pursuitLastSeen"), blindFireTarget: readVector(reader.field("blindFireTarget")), blindFireDelay: n("blindFireDelay"), soundTarget: reader.field("soundTarget").nullable(value => ({ actor: readSavedActor(value.field("actor")), origin: readVector(value.field("origin")), time: value.field("time").number() })),
    oldEnemy: reader.field("oldEnemy").nullable(readSavedActor), moveTarget: reader.field("moveTarget").nullable(readSavedActor), combatTarget: reader.field("combatTarget").string(), cocked: b("cocked"), forceRefire: b("forceRefire"), normalHeight: n("normalHeight"), airFinished: n("airFinished"), environmentalDamageTime: n("environmentalDamageTime"), waterLevel: reader.field("waterLevel").choice(0, 1, 2, 3), waterType: n("waterType"), lastLinkCount: n("lastLinkCount"), jumpTime: n("jumpTime"), fliesTime: reader.field("fliesTime").nullable(value => value.number()) };
}
function perception(reader: SaveReader): Q2MonsterPerceptionCheckpoint {
  const sighting = (value: SaveReader) => ({ actor: readSavedActor(value.field("actor")), time: value.field("time").number() });
  const noise = (value: SaveReader) => ({ ...sighting(value), owner: readSavedActor(value.field("owner")), origin: readVector(value.field("origin")) });
  return { sightClient: reader.field("sightClient").nullable(readSavedActor), sight: reader.field("sight").nullable(sighting), alerted: reader.field("alerted").list(value => ({ actor: readSavedActor(value.field("actor")), sighting: sighting(value.field("sighting")) })), primary: reader.field("primary").nullable(noise), secondary: reader.field("secondary").nullable(noise),
    noises: reader.field("noises").list(value => ({ actor: readSavedActor(value.field("actor")), primary: readSavedActor(value.field("primary")), secondary: readSavedActor(value.field("secondary")) })),
    trails: reader.field("trails").list(value => ({ actor: readSavedActor(value.field("actor")), points: value.field("points").list(point => ({ origin: readVector(point.field("origin")), time: point.field("time").number(), yaw: point.field("yaw").number() })) })),
    playerOrigins: reader.field("playerOrigins").list(value => ({ actor: readSavedActor(value.field("actor")), origin: readVector(value.field("origin")) })), hostile: reader.field("hostile").list(sighting), lastFrame: reader.field("lastFrame").nullable(value => value.number()) };
}
export function readQ2MonstersCheckpoint(reader: SaveReader): Q2MonstersCheckpoint {
  return { version: reader.field("version").literal(1), actors: reader.field("actors").list(value => ({ actor: readSavedActor(value.field("actor")), definition: value.field("definition").string(), state: state(value.field("state")), pendingDamage: value.field("pendingDamage").nullable(pending => {
    const reaction = pending.field("reaction");
    return { reaction: { damage: reaction.field("damage").number(), kick: reaction.field("kick").number(), point: readVector(reaction.field("point")), attacker: reaction.field("attacker").nullable(readSavedActor), inflictor: reaction.field("inflictor").nullable(readSavedActor) }, attack: pending.field("attack").nullable(readQ2AttackCheckpoint) };
  }) })), perception: perception(reader.field("perception")) };
}
export function encodeQ2MonstersCheckpoint(checkpoint: Q2MonstersCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2MonstersCheckpoint(bytes: Uint8Array): Q2MonstersCheckpoint { return readQ2MonstersCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-monsters")); }
