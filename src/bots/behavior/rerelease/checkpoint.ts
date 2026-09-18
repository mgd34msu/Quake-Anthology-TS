import { SaveReader } from "../../../persistence/value.ts";
import type { RereleaseBehaviorCheckpoint } from "./profile.ts";
import type { BotBrainCheckpoint, BotBrainCheckpointMemory } from "./brain.ts";
import type { NavPathT, NavLinkType } from "./nav.ts";
function vector(r: SaveReader) { return { x: r.field("x").finite(), y: r.field("y").finite(), z: r.field("z").finite() }; }
function nullableVector(r: SaveReader) { return r.value === null ? null : vector(r); }
function mode(r: SaveReader) { return { gameType: r.field("gameType").string(), weaponStay: r.field("weaponStay").boolean(),
  ...(r.field("hasTeams").value === undefined ? {} : { hasTeams: r.field("hasTeams").boolean() }),
  ...(r.field("teamDamage").value === undefined ? {} : { teamDamage: r.field("teamDamage").boolean() }) }; }
function linkType(r: SaveReader): NavLinkType {
  const value = r.integer(0);
  switch (value) { case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: return value; default: return r.fail("Invalid navigation link type"); }
}
function path(r: SaveReader): NavPathT | null {
  if (r.value === null) return null;
  return { nodes: r.field("nodes").list(x => x.integer(0)), points: r.field("points").list(vector),
    links: r.field("links").list(link => link.value === null ? null : ({ from: link.field("from").integer(0), to: link.field("to").integer(0), type: linkType(link.field("type")),
      traversal: link.field("traversal").value === null ? null : { funnel: vector(link.field("traversal").field("funnel")), start: vector(link.field("traversal").field("start")), end: vector(link.field("traversal").field("end")) },
      entityBounds: link.field("entityBounds").value === null ? null : { mins: vector(link.field("entityBounds").field("mins")), maxs: vector(link.field("entityBounds").field("maxs")) } })),
    cost: r.field("cost").finite(), generation: r.field("generation").integer(0), mapDigest: r.field("mapDigest").string() };
}
function memory(r: SaveReader): BotBrainCheckpointMemory {
  const aim = r.field("aim"), follow = r.field("pathState"), goal = r.field("explicitGoal"), cmd = r.field("lastCmd");
  return {
    triggerWeapon: r.field("triggerWeapon").finite(),
    triggerHeldSince: r.field("triggerHeldSince").finite(),
    triggerReadyAt: r.field("triggerReadyAt").finite(),
    targetId: r.field("targetId").finite(),
    goalPoint: nullableVector(r.field("goalPoint")),
    goalEntityId: r.field("goalEntityId").finite(),
    stuckTrips: r.field("stuckTrips").finite(),
    goalIsLive: r.field("goalIsLive").boolean(),
    unstickUntil: r.field("unstickUntil").finite(),
    pressUntil: r.field("pressUntil").finite(),
    unstickSide: r.field("unstickSide").finite(),
    explicitGoalDone: r.field("explicitGoalDone").boolean(),
    explicitGoalFailed: r.field("explicitGoalFailed").boolean(),
    wedgeOrigin: nullableVector(r.field("wedgeOrigin")),
    wedgeSince: r.field("wedgeSince").finite(),
    lastSafeOrigin: nullableVector(r.field("lastSafeOrigin")),
    restPoint: nullableVector(r.field("restPoint")),
    restUntil: r.field("restUntil").finite(),
    guardRefusals: r.field("guardRefusals").finite(),
    lastGuardRefused: r.field("lastGuardRefused").boolean(),
    gapJumps: r.field("gapJumps").finite(),
    hazardFrames: r.field("hazardFrames").finite(),
    ownObjectiveHome: nullableVector(r.field("ownObjectiveHome")),
    enemyObjectiveHome: nullableVector(r.field("enemyObjectiveHome")),
    objectiveRole: r.field("objectiveRole").string(),
    touchGoal: r.field("touchGoal").boolean(),
    holdPosition: r.field("holdPosition").boolean(),
    gateShootAt: nullableVector(r.field("gateShootAt")),
    gateFiredAt: r.field("gateFiredAt").finite(),
    coopRegrouping: r.field("coopRegrouping").boolean(),
    coopRegroupAt: r.field("coopRegroupAt").finite(),
    coopRegroupUntil: r.field("coopRegroupUntil").finite(),
    levelStarted: r.field("levelStarted").boolean(),
    checkSixUntil: r.field("checkSixUntil").finite(),
    checkSixNextAt: r.field("checkSixNextAt").finite(),
    roamPoint: nullableVector(r.field("roamPoint")),
    roamUntil: r.field("roamUntil").finite(),
    spawnedOnce: r.field("spawnedOnce").boolean(),
    lastWeaponNumber: r.field("lastWeaponNumber").finite(),
    deadSince: r.field("deadSince").finite(),
    respawnWait: r.field("respawnWait").finite(),
    respawnPress: r.field("respawnPress").boolean(),
    aim: { pitch: aim.field("pitch").finite(), yaw: aim.field("yaw").finite(), pitchVelocity: aim.field("pitchVelocity").finite(), yawVelocity: aim.field("yawVelocity").finite(), modifierUntil: aim.field("modifierUntil").finite() },
    pathState: { path: path(follow.field("path")), index: follow.field("index").integer(0), stuckOrigin: vector(follow.field("stuckOrigin")), stuckSince: follow.field("stuckSince").finite(), stuckCount: follow.field("stuckCount").integer(0), liftWaitSince: follow.field("liftWaitSince").finite(), liftWaitZ: follow.field("liftWaitZ").finite(), jumpReadyAt: follow.field("jumpReadyAt").finite(), plannedAt: follow.field("plannedAt").finite() },
    awareness: r.field("awareness").list(entry => { const value = entry.field("value"); return { entity: entry.field("entity").integer(), value: {
      id: value.field("id").integer(), sight: value.field("sight").finite(), weapon: value.field("weapon").finite(), lastContact: value.field("lastContact").finite(), lastSeen: value.field("lastSeen").finite(), lastHeard: value.field("lastHeard").finite(), lastKnownOrigin: vector(value.field("lastKnownOrigin")) } }; }),
    unreachableUntil: r.field("unreachableUntil").list(entry => ({ entity: entry.field("entity").integer(), time: entry.field("time").finite() })),
    objectiveHome: r.field("objectiveHome").list(entry => ({ entity: entry.field("entity").integer(), origin: vector(entry.field("origin")) })),
    saidThisLevel: r.field("saidThisLevel").list(entry => entry.string()),
    explicitGoal: goal.value === null ? null : { owner: goal.field("owner").value === undefined ? "external" : goal.field("owner").choice("external", "objective"), kind: goal.field("kind").choice("point", "entity"), point: vector(goal.field("point")), entityId: goal.field("entityId").integer() },
    lastCmd: { forwardmove: cmd.field("forwardmove").finite(), sidemove: cmd.field("sidemove").finite(), upmove: cmd.field("upmove").finite(), buttons: cmd.field("buttons").integer(0), impulse: cmd.field("impulse").integer(0), viewAngles: vector(cmd.field("viewAngles")) },
  };
}
export function readRereleaseBehavior(value: unknown): RereleaseBehaviorCheckpoint {
  const r = new SaveReader(value, "bot.rerelease"), b = r.field("brain");
  const brain: BotBrainCheckpoint = { version: b.field("version").literal(1), skill: b.field("skill").string(), gameMode: mode(b.field("gameMode")), memory: memory(b.field("memory")) };
  return { version: r.field("version").literal(1), source: r.field("source").choice("q1-rerelease", "q2-rerelease"), definition: r.field("definition").string(), rng: r.field("rng").integer(), brain,
    pendingChats: r.field("pendingChats").list(entry => ({ time: entry.field("time").finite(), event: { locstring: entry.field("event").field("locstring").string(), type: entry.field("event").field("type").string(), delayMs: entry.field("event").field("delayMs").finite(), teamOnly: entry.field("event").field("teamOnly").boolean() } })) };
}
