import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1UserCommand } from "../../../contracts/protocol.ts";
import type { ActorAnimationState, AnimationState, ArsenalState, MovementState, WeaponState } from "../../../contracts/movement.ts";
import type { TraceHit } from "../../../contracts/scene.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q1TravelState } from "../../../content/q1/base/travel.ts";
import { Q1_WEAPON_IDS } from "../../../content/q1/foundation/types.ts";
import type { Q3CharacterCheckpoint } from "../../../content/q3/foundation/character.ts";
import type { Q2PlayerView } from "../../../content/q2/base/player/types.ts";
import { readArmor, readSavedActor, savedActorId, readInventoryEntry } from "../../../persistence/save-image.ts";
import { readBounds, readTime, readVector } from "../../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../../persistence/value.ts";
import type { MovementPlayer } from "./players.ts";

type ActorReference = (saved: SavedActorId) => ActorId;
function triple(reader: SaveReader): readonly [number, number, number] {
  const values = reader.list(value => value.number());
  const [x, y, z] = values;
  if (values.length !== 3 || x === undefined || y === undefined || z === undefined) return reader.fail("expected three numbers");
  return [x, y, z];
}
export function saveHit(hit: TraceHit) { return hit.kind === "actor" ? { ...hit, actor: savedActorId(hit.actor) } : hit; }
export function readHit(reader: SaveReader, reference: ActorReference): TraceHit {
  switch (reader.field("kind").choice("none", "world", "actor")) {
    case "none": return { kind: "none" };
    case "world": return { kind: "world", model: reader.field("model").integer(0) };
    case "actor": return { kind: "actor", actor: reference(readSavedActor(reader.field("actor"))) };
  }
}
function saveMovement(state: MovementState) {
  if (state.kind === "q3") return { ...state, ground: saveHit(state.ground), jumpPad: state.jumpPad === null ? null : savedActorId(state.jumpPad) };
  if (state.kind === "q1-netquake" || state.kind === "q1-quakeworld") return { ...state, ground: saveHit(state.ground) };
  return state;
}
function readMovement(reader: SaveReader, reference: ActorReference): MovementState {
  const n = (key: string) => reader.field(key).number(), v = (key: string) => readVector(reader.field(key));
  switch (reader.field("kind").choice("q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3")) {
    case "q1-netquake": return { kind: "q1-netquake", origin: v("origin"), velocity: v("velocity"), angles: v("angles"), oldOrigin: v("oldOrigin"), angularVelocity: v("angularVelocity"),
      viewAngles: v("viewAngles"), punchAngles: v("punchAngles"), moveType: n("moveType"), flags: n("flags"), ground: readHit(reader.field("ground"), reference), waterLevel: n("waterLevel"), waterType: n("waterType"),
      teleportTimeSeconds: n("teleportTimeSeconds"), waterJumpDirection: v("waterJumpDirection"), idealPitch: n("idealPitch"), fixAngle: reader.field("fixAngle").boolean(), health: n("health") };
    case "q1-quakeworld": return { kind: "q1-quakeworld", origin: v("origin"), velocity: v("velocity"), angles: v("angles"), oldButtons: n("oldButtons"), waterJumpTimeSeconds: n("waterJumpTimeSeconds"),
      dead: reader.field("dead").boolean(), spectator: n("spectator"), ground: readHit(reader.field("ground"), reference) };
    case "q2-classic": return { kind: "q2-classic", type: n("type"), originEighths: triple(reader.field("originEighths")), velocityEighths: triple(reader.field("velocityEighths")), flags: n("flags"),
      timeEightMilliseconds: n("timeEightMilliseconds"), gravity: n("gravity"), deltaAngleShorts: triple(reader.field("deltaAngleShorts")) };
    case "q2-rerelease": return { kind: "q2-rerelease", type: n("type"), origin: v("origin"), velocity: v("velocity"), flags: n("flags"), timeMilliseconds: n("timeMilliseconds"), gravity: n("gravity"), deltaAngles: v("deltaAngles"), viewHeight: n("viewHeight") };
    case "q3": return { kind: "q3", commandTimeMilliseconds: n("commandTimeMilliseconds"), movementType: n("movementType"), bobCycle: n("bobCycle"), movementFlags: n("movementFlags"), movementTimeMilliseconds: n("movementTimeMilliseconds"),
      origin: v("origin"), velocity: v("velocity"), gravity: n("gravity"), speed: n("speed"), deltaAngleWords: triple(reader.field("deltaAngleWords")), movementDirection: n("movementDirection"), grapplePoint: v("grapplePoint"), flags: n("flags"),
      viewAngles: v("viewAngles"), viewHeight: n("viewHeight"), ground: readHit(reader.field("ground"), reference), predictableEventSequence: n("predictableEventSequence"),
      jumpPad: reader.field("jumpPad").nullable(value => reference(readSavedActor(value))), movementFrame: n("movementFrame"), jumpPadFrame: n("jumpPadFrame") };
  }
}
function readWeapon(reader: SaveReader): WeaponState {
  switch (reader.field("kind").choice("q1", "q2", "q3")) {
    case "q1": return { kind: "q1", frame: reader.field("frame").number(), attackFinishedSeconds: reader.field("attackFinishedSeconds").number(), sourceWeapon: reader.field("sourceWeapon").number() };
    case "q2": return { kind: "q2", gunFrame: reader.field("gunFrame").number(), state: reader.field("state").number(), pendingWeapon: reader.field("pendingWeapon").nullable(namespaced), machinegunShots: reader.field("machinegunShots").number(), grenadeTime: readTime(reader.field("grenadeTime")), grenadeBlewUp: reader.field("grenadeBlewUp").boolean() };
    case "q3": return { kind: "q3", sourceWeapon: reader.field("sourceWeapon").number(), state: reader.field("state").number(), timeMilliseconds: reader.field("timeMilliseconds").number() };
  }
}
function readArsenal(reader: SaveReader): ArsenalState {
  return { provider: namespaced(reader.field("provider")), activeWeapon: reader.field("activeWeapon").nullable(namespaced), state: readWeapon(reader.field("state")), ammo: reader.field("ammo").list(readInventoryEntry) };
}
export function readAnimation(reader: SaveReader): AnimationState {
  switch (reader.field("kind").choice("q1", "q2", "q3")) {
    case "q1": return { kind: "q1", frame: reader.field("frame").number(), nextFrameSeconds: reader.field("nextFrameSeconds").number() };
    case "q2": return { kind: "q2", frame: reader.field("frame").number(), endFrame: reader.field("endFrame").number(), priority: reader.field("priority").number(), duck: reader.field("duck").boolean(), run: reader.field("run").boolean() };
    case "q3": return { kind: "q3", legs: reader.field("legs").number(), torso: reader.field("torso").number(), legsTimerMilliseconds: reader.field("legsTimerMilliseconds").number(), torsoTimerMilliseconds: reader.field("torsoTimerMilliseconds").number() };
  }
}
function readActorAnimation(reader: SaveReader): ActorAnimationState { return { provider: namespaced(reader.field("provider")), state: readAnimation(reader.field("state")) }; }
export function captureMovementPlayer(player: MovementPlayer) {
  return { version: 1, netQuakeCommand: player.netQuakeCommand, actor: savedActorId(player.actor.id), clientSlot: player.client.slot, state: saveMovement(player.state), arsenal: player.arsenal, animation: player.animation,
    viewAngles: player.viewAngles, commandAngles: player.commandAngles, viewHeight: player.viewHeight, bounds: player.bounds, ground: saveHit(player.ground), waterLevel: player.waterLevel, waterType: player.waterType,
    intermission: player.intermission, cutscene: player.cutscene, gravityMultiplier: player.gravityMultiplier, worldGravity: player.worldGravity, buttons: player.buttons, previousButtons: player.previousButtons, lastSequence: player.lastSequence, lastWeaponSeconds: player.lastWeaponSeconds };
}
export function readMovementPlayer(reader: SaveReader, reference: ActorReference) {
  reader.field("version").literal(1);
  const netQuakeCommand = reader.field("netQuakeCommand").nullable((value): Q1UserCommand => ({ kind: value.field("kind").literal("q1-netquake"),
    acknowledgedServerTimeSeconds: value.field("acknowledgedServerTimeSeconds").finite(), viewAngles: readVector(value.field("viewAngles")),
    forwardMove: value.field("forwardMove").finite(), sideMove: value.field("sideMove").finite(), upMove: value.field("upMove").finite(),
    buttons: value.field("buttons").integer(0), impulse: value.field("impulse").integer(0) }));
  return { netQuakeCommand, actor: readSavedActor(reader.field("actor")), clientSlot: reader.field("clientSlot").integer(0), state: readMovement(reader.field("state"), reference), arsenal: readArsenal(reader.field("arsenal")), animation: readActorAnimation(reader.field("animation")),
    viewAngles: readVector(reader.field("viewAngles")), commandAngles: readVector(reader.field("commandAngles")), viewHeight: reader.field("viewHeight").number(), bounds: readBounds(reader.field("bounds")), ground: readHit(reader.field("ground"), reference),
    waterLevel: reader.field("waterLevel").number(), waterType: reader.field("waterType").number(), intermission: reader.field("intermission").boolean(), gravityMultiplier: reader.field("gravityMultiplier").number(), worldGravity: reader.field("worldGravity").number(), buttons: reader.field("buttons").number(),
    previousButtons: reader.field("previousButtons").number(), lastSequence: reader.field("lastSequence").integer(-1), lastWeaponSeconds: reader.field("lastWeaponSeconds").number(),
    cutscene: reader.field("cutscene").nullable(value => ({ origin: readVector(value.field("origin")), angles: readVector(value.field("angles")), viewOffset: readVector(value.field("viewOffset")) })) };
}
export function readQ3Character(reader: SaveReader): Q3CharacterCheckpoint {
  const animation = readAnimation(reader.field("animation"));
  if (animation.kind !== "q3") return reader.fail("Q3 character needs Q3 animation state");
  return { version: reader.field("version").literal(1), product: reader.field("product").choice("baseq3", "missionpack"), animation, flags: reader.field("flags").number(), eventSequence: reader.field("eventSequence").integer(0),
    respawnTime: reader.field("respawnTime").number(), spawnCount: reader.field("spawnCount").integer(0), dead: reader.field("dead").boolean(), gibbed: reader.field("gibbed").boolean(), initialized: reader.field("initialized").boolean() };
}
export function readQ1Travel(reader: SaveReader): Q1TravelState {
  const weapon = reader.field("weapon").string(), selected = Q1_WEAPON_IDS.find(value => value === weapon);
  if (selected === undefined) return reader.fail(`Unknown Q1 saved weapon ${weapon}`);
  return { health: reader.field("health").number(), maxHealth: reader.field("maxHealth").number(), armor: readArmor(reader.field("armor")), inventory: reader.field("inventory").list(readInventoryEntry), weapon: selected,
    extensions: reader.field("extensions").list(value => ({ id: value.field("id").string(), bytes: value.field("bytes").bytes() })) };
}
export function readQ2View(reader: SaveReader): Q2PlayerView {
  const v = (key: string) => readVector(reader.field(key)), n = (key: string) => reader.field(key).number(), blend = reader.field("blend");
  return { angles: v("angles"), offset: v("offset"), kickAngles: v("kickAngles"), gunAngles: v("gunAngles"), gunOffset: v("gunOffset"), blend: { ...readVector(blend), w: blend.field("w").number() },
    fov: n("fov"), underwater: reader.field("underwater").boolean(), flashes: n("flashes"), health: n("health"), armor: n("armor"), ammo: n("ammo"), score: n("score"), selectedItem: reader.field("selectedItem").nullable(namespaced),
    timer: reader.field("timer").nullable(value => ({ item: namespaced(value.field("item")), seconds: value.field("seconds").number() })), spectator: reader.field("spectator").boolean(), layouts: n("layouts") };
}
