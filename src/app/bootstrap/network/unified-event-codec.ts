import { SaveReader, namespaced } from '../../../persistence/value.ts';
import type { ActorId, ClientId, SeatId, ProviderId } from '../../../contracts/identity.ts';
import { createContentId } from '../../../contracts/content.ts';
import type { ContentId, ResourceId } from '../../../contracts/content.ts';
import type { ItemId, ObjectiveId } from '../../../contracts/gameplay.ts';
import type { SimulationEvent } from '../../../contracts/session.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { UnifiedIdentityDecoder } from './unified-types.ts';
import { EntityState } from '../../../network/q3/state/entity.ts';
import type { Trajectory } from '../../../network/q3/state/trajectory.ts';

const MAX_EVENT_BYTES = 16 * 1024 * 1024;
function boundedList<T>(reader: SaveReader, read: (item: SaveReader) => T): readonly T[] {
  const items = reader.list(item => item);
  if (items.length > 65536) return reader.fail('invalid event list length');
  return items.map(read);
}
function readActorId(reader: SaveReader, identity: UnifiedIdentityDecoder): ActorId { return identity.actor(reader.field('slot').integer(0), reader.field('generation').integer(0)); }
function writeActorId(value: ActorId): unknown { return { slot: value.slot, generation: value.generation }; }
function readClientId(reader: SaveReader, identity: UnifiedIdentityDecoder): ClientId { return identity.client(reader.field('slot').integer(0), reader.field('generation').integer(0)); }
function writeClientId(value: ClientId): unknown { return { slot: value.slot, generation: value.generation }; }
function readSeatId(reader: SaveReader, identity: UnifiedIdentityDecoder): SeatId { return identity.seat(reader.field('index').integer(0)); }
function writeSeatId(value: SeatId): unknown { return { index: value.index }; }
function readProviderId(reader: SaveReader, _identity: UnifiedIdentityDecoder): ProviderId { return namespaced(reader); }
function writeProviderId(value: ProviderId): unknown { return value; }
function readItemId(reader: SaveReader, _identity: UnifiedIdentityDecoder): ItemId { return namespaced(reader); }
function writeItemId(value: ItemId): unknown { return value; }
function readObjectiveId(reader: SaveReader, _identity: UnifiedIdentityDecoder): ObjectiveId { return namespaced(reader); }
function writeObjectiveId(value: ObjectiveId): unknown { return value; }
function readResourceId(reader: SaveReader, identity: UnifiedIdentityDecoder): ResourceId {
  const value = reader.string();
  if (!/^resource:unified:[0-9a-f]{64}$/.test(value)) return reader.fail('expected negotiated unified resource identity');
  return identity.resourceId(`resource:${value.slice(9)}`);
}
function writeResourceId(value: ResourceId): unknown {
  if (!/^resource:unified:[0-9a-f]{64}$/.test(value)) throw new RangeError('Unified events require negotiated resource identities');
  return value;
}
function readContentId(reader: SaveReader, _identity: UnifiedIdentityDecoder): ContentId {
  const parts = reader.string().split(':');
  const [family, edition, packageName, revision] = parts;
  if ((family !== 'q1' && family !== 'q2' && family !== 'q3') || edition === undefined || packageName === undefined || revision === undefined || parts.length !== 4) return reader.fail('invalid content identity');
  return createContentId({ family, edition, package: packageName, revision });
}
function writeContentId(value: ContentId): unknown { return value; }
function readVector(reader: SaveReader) { return { x: reader.field('x').finite(), y: reader.field('y').finite(), z: reader.field('z').finite() }; }
function writeVector(value: { readonly x: number; readonly y: number; readonly z: number }): unknown { return { x: value.x, y: value.y, z: value.z }; }
function readTrajectory(reader: SaveReader): Trajectory<number> { return { type: reader.field('type').finite(), time: reader.field('time').finite(), duration: reader.field('duration').finite(), base: readVector(reader.field('base')), delta: readVector(reader.field('delta')) }; }
function writeTrajectory(value: Trajectory<number>): unknown { return { type: value.type, time: value.time, duration: value.duration, base: writeVector(value.base), delta: writeVector(value.delta) }; }
function readEntityState(reader: SaveReader, _identity: UnifiedIdentityDecoder): EntityState {
  const state = new EntityState();
  state.pos = readTrajectory(reader.field('pos')); state.apos = readTrajectory(reader.field('apos'));
  state.origin = readVector(reader.field('origin')); state.origin2 = readVector(reader.field('origin2')); state.angles = readVector(reader.field('angles')); state.angles2 = readVector(reader.field('angles2'));
  state.number = reader.field('number').finite(); state.eType = reader.field('eType').finite(); state.eFlags = reader.field('eFlags').finite();
  state.time = reader.field('time').finite(); state.time2 = reader.field('time2').finite(); state.otherEntityNum = reader.field('otherEntityNum').finite(); state.otherEntityNum2 = reader.field('otherEntityNum2').finite();
  state.groundEntityNum = reader.field('groundEntityNum').finite(); state.constantLight = reader.field('constantLight').finite(); state.loopSound = reader.field('loopSound').finite(); state.modelindex = reader.field('modelindex').finite(); state.modelindex2 = reader.field('modelindex2').finite();
  state.clientNum = reader.field('clientNum').finite(); state.frame = reader.field('frame').finite(); state.solid = reader.field('solid').finite(); state.event = reader.field('event').finite(); state.eventParm = reader.field('eventParm').finite();
  state.powerups = reader.field('powerups').finite(); state.weapon = reader.field('weapon').finite(); state.legsAnim = reader.field('legsAnim').finite(); state.torsoAnim = reader.field('torsoAnim').finite(); state.generic1 = reader.field('generic1').finite();
  return state;
}
function writeEntityState(value: EntityState): unknown {
  return { number: value.number, eType: value.eType, eFlags: value.eFlags, pos: writeTrajectory(value.pos), apos: writeTrajectory(value.apos), time: value.time, time2: value.time2,
    origin: writeVector(value.origin), origin2: writeVector(value.origin2), angles: writeVector(value.angles), angles2: writeVector(value.angles2),
    otherEntityNum: value.otherEntityNum, otherEntityNum2: value.otherEntityNum2, groundEntityNum: value.groundEntityNum, constantLight: value.constantLight, loopSound: value.loopSound, modelindex: value.modelindex, modelindex2: value.modelindex2,
    clientNum: value.clientNum, frame: value.frame, solid: value.solid, event: value.event, eventParm: value.eventParm, powerups: value.powerups, weapon: value.weapon, legsAnim: value.legsAnim, torsoAnim: value.torsoAnim, generic1: value.generic1 };
}

type MusicEvent = Extract<SimulationPresentationEvent, { readonly kind: "music" }>["event"];
function readMusicEvent(reader: SaveReader): MusicEvent {
  const kind = reader.field("kind").choice("cd-track", "pause");
  return kind === "cd-track" ? { kind, track: reader.field("track").finite() } : { kind, paused: reader.field("paused").boolean() };
}
function writeMusicEvent(event: MusicEvent): unknown {
  return event.kind === "cd-track" ? { kind: event.kind, track: event.track } : { kind: event.kind, paused: event.paused };
}

type EventSimulationPresentationEvent = SimulationPresentationEvent;
type EventSimulationPresentationEventQ1 = Extract<EventSimulationPresentationEvent, { readonly kind: "q1" }>;

type EventQ1Event = EventSimulationPresentationEventQ1["event"];

type EventQ1EventSound = Extract<EventQ1Event, { readonly kind: "sound" }>;

type EventVec3 = Exclude<EventQ1EventSound["origin"], undefined>;
function readEventVec3(reader: SaveReader, identity: UnifiedIdentityDecoder): EventVec3 { void identity; return { "x": reader.field("x").finite(), "y": reader.field("y").finite(), "z": reader.field("z").finite() }; }
function writeEventVec3(value: EventVec3): unknown { return { "x": value["x"], "y": value["y"], "z": value["z"] }; }

type EventQ1EventMessage = Extract<EventQ1Event, { readonly kind: "message" }>;

type EventQ1EventMessageArgs = Exclude<EventQ1EventMessage["args"], undefined>;

function readEventQ1EventMessageArgs(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1EventMessageArgs { void identity; return boundedList(reader, item => (typeof item.value === 'string' ? item.string() : item.finite())); }
function writeEventQ1EventMessageArgs(value: EventQ1EventMessageArgs): unknown { return value.map(item => item); }

type EventQ1EventMessageParts = Exclude<EventQ1EventMessage["parts"], undefined>;
type EventQ1MessagePart = EventQ1EventMessageParts[number];
function readEventQ1MessagePart(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1MessagePart { void identity; return { "text": reader.field("text").string(), ...(reader.field("args").value === undefined ? {} : { "args": readEventQ1EventMessageArgs(reader.field("args"), identity) }) }; }
function writeEventQ1MessagePart(value: EventQ1MessagePart): unknown { return { "text": value["text"], ...(value["args"] === undefined ? {} : { "args": writeEventQ1EventMessageArgs(value["args"]) }) }; }

function readEventQ1EventMessageParts(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1EventMessageParts { void identity; return boundedList(reader, item => readEventQ1MessagePart(item, identity)); }
function writeEventQ1EventMessageParts(value: EventQ1EventMessageParts): unknown { return value.map(item => writeEventQ1MessagePart(item)); }

type EventQ1EventEffect = Extract<EventQ1Event, { readonly kind: "effect" }>;

type EventQ1EventEffectActor = EventQ1EventEffect["actor"];
function readEventQ1EventEffectActor(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1EventEffectActor { void identity; return reader.value === null ? null : readActorId(reader, identity); }
function writeEventQ1EventEffectActor(value: EventQ1EventEffectActor): unknown { return value === null ? null : writeActorId(value); }

type EventQ1EventColoredExplosion = Extract<EventQ1Event, { readonly kind: "colored-explosion" }>;

function readEventQ1EventColoredExplosion(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1EventColoredExplosion { void identity; return { "kind": reader.field("kind").literal("colored-explosion"), "origin": readEventVec3(reader.field("origin"), identity), "colorStart": reader.field("colorStart").finite(), "colorLength": reader.field("colorLength").finite() }; }
function writeEventQ1EventColoredExplosion(value: EventQ1EventColoredExplosion): unknown { return { "kind": value["kind"], "origin": writeEventVec3(value["origin"]), "colorStart": value["colorStart"], "colorLength": value["colorLength"] }; }

type EventQ1EventLightstyle = Extract<EventQ1Event, { readonly kind: "lightstyle" }>;

function readEventQ1EventLightstyle(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1EventLightstyle { void identity; return { "kind": reader.field("kind").literal("lightstyle"), "style": reader.field("style").finite(), "pattern": reader.field("pattern").string() }; }
function writeEventQ1EventLightstyle(value: EventQ1EventLightstyle): unknown { return { "kind": value["kind"], "style": value["style"], "pattern": value["pattern"] }; }

type EventQ1EventWeapon = Extract<EventQ1Event, { readonly kind: "weapon" }>;

type EventQ1Weapon = EventQ1EventWeapon["weapon"];
function readEventQ1Weapon(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1Weapon { void identity; return reader.choice<"axe" | "shotgun" | "supershotgun" | "nailgun" | "supernailgun" | "grenadelauncher" | "rocketlauncher" | "lightning" | "hipnotic:laser" | "hipnotic:mjolnir" | "hipnotic:proximity" | "rogue:lava-nailgun" | "rogue:lava-supernailgun" | "rogue:multi-grenade" | "rogue:multi-rocket" | "rogue:plasma" | "rogue:grapple" | "mg3:laser" | "mg3:mjolnir" | "ctf:grapple">("axe", "shotgun", "supershotgun", "nailgun", "supernailgun", "grenadelauncher", "rocketlauncher", "lightning", "hipnotic:laser", "hipnotic:mjolnir", "hipnotic:proximity", "rogue:lava-nailgun", "rogue:lava-supernailgun", "rogue:multi-grenade", "rogue:multi-rocket", "rogue:plasma", "rogue:grapple", "mg3:laser", "mg3:mjolnir", "ctf:grapple"); }
function writeEventQ1Weapon(value: EventQ1Weapon): unknown { return value; }

type EventQ1CharacterAttack = Exclude<EventQ1EventWeapon["attack"], undefined>;

function readEventQ1CharacterAttack(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1CharacterAttack { void identity; switch (reader.field('kind').string()) { case "axe": return ({ "kind": reader.field("kind").literal("axe"), "variant": reader.field("variant").choice<0 | 1 | 2 | 3>(0, 1, 2, 3) });
case "shotgun": case "rocket": case "nail": case "lightning": return ({ "kind": reader.field("kind").choice<"shotgun" | "rocket" | "nail" | "lightning">("shotgun", "rocket", "nail", "lightning") }); default: return reader.fail('unknown event variant'); } }
function writeEventQ1CharacterAttack(value: EventQ1CharacterAttack): unknown { switch (value.kind) { case "axe": return ({ "kind": value["kind"], "variant": value["variant"] });
case "shotgun": case "rocket": case "nail": case "lightning": return ({ "kind": value["kind"] }); } }

function readEventQ1Event(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1Event { void identity; switch (reader.field('kind').string()) { case "stop-sound": return ({ "kind": reader.field("kind").literal("stop-sound"), "actor": readActorId(reader.field("actor"), identity), "channel": reader.field("channel").finite() });
case "sound": return ({ "kind": reader.field("kind").literal("sound"), ...(reader.field("origin").value === undefined ? {} : { "origin": readEventVec3(reader.field("origin"), identity) }), "actor": readActorId(reader.field("actor"), identity), "path": reader.field("path").string(), "channel": reader.field("channel").choice<"auto" | "weapon" | "voice" | "item" | "body" | -1 | 5 | 6 | 7>("auto", "weapon", "voice", "item", "body", -1, 5, 6, 7), "attenuation": reader.field("attenuation").finite(), "volume": reader.field("volume").finite() });
case "ambient": return ({ "kind": reader.field("kind").literal("ambient"), "origin": readEventVec3(reader.field("origin"), identity), "path": reader.field("path").string(), "volume": reader.field("volume").finite(), "attenuation": reader.field("attenuation").finite() });
case "message": return ({ "kind": reader.field("kind").literal("message"), "player": readActorId(reader.field("player"), identity), "text": reader.field("text").string(), "center": reader.field("center").boolean(), ...(reader.field("args").value === undefined ? {} : { "args": readEventQ1EventMessageArgs(reader.field("args"), identity) }), ...(reader.field("parts").value === undefined ? {} : { "parts": readEventQ1EventMessageParts(reader.field("parts"), identity) }) });
case "effect": return ({ "kind": reader.field("kind").literal("effect"), "effect": reader.field("effect").choice<"blood" | "gunshot" | "spike" | "superspike" | "explosion" | "teleport" | "muzzleflash" | "pickup" | "lava-splash" | "tar-explosion" | "meat-spray" | "wizard-spike" | "knight-spike">("blood", "gunshot", "spike", "superspike", "explosion", "teleport", "muzzleflash", "pickup", "lava-splash", "tar-explosion", "meat-spray", "wizard-spike", "knight-spike"), "actor": readEventQ1EventEffectActor(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "amount": reader.field("amount").finite(), ...(reader.field("muzzle").value === undefined ? {} : { muzzle: { origin: readEventVec3(reader.field("muzzle").field("origin"), identity), angles: readEventVec3(reader.field("muzzle").field("angles"), identity) } }) });
case "colored-explosion": return readEventQ1EventColoredExplosion(reader, identity);
case "static-model": return ({ "kind": reader.field("kind").literal("static-model"), "path": reader.field("path").string(), "frame": reader.field("frame").finite(), "colorMap": reader.field("colorMap").finite(), "skin": reader.field("skin").finite(), "origin": readEventVec3(reader.field("origin"), identity), "angles": readEventVec3(reader.field("angles"), identity) });
case "particles": return ({ "kind": reader.field("kind").literal("particles"), "origin": readEventVec3(reader.field("origin"), identity), "direction": readEventVec3(reader.field("direction"), identity), "color": reader.field("color").finite(), "count": reader.field("count").finite() });
case "server-command": return ({ "kind": reader.field("kind").literal("server-command"), "text": reader.field("text").string() });
case "camera": return ({ "kind": reader.field("kind").literal("camera"), "player": readActorId(reader.field("player"), identity), "origin": readEventVec3(reader.field("origin"), identity), "angles": readEventVec3(reader.field("angles"), identity), ...(reader.field("viewOffset").value === undefined ? {} : { "viewOffset": readEventVec3(reader.field("viewOffset"), identity) }) });
case "beam": return ({ "kind": reader.field("kind").literal("beam"), "style": reader.field("style").choice<"lightning1" | "lightning2" | "lightning3" | "grapple">("lightning1", "lightning2", "lightning3", "grapple"), "actor": readActorId(reader.field("actor"), identity), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity) });
case "lightstyle": return readEventQ1EventLightstyle(reader, identity);
case "monster-total": return ({ "kind": reader.field("kind").literal("monster-total"), "total": reader.field("total").finite() });
case "secret": case "monster-killed": return ({ "kind": reader.field("kind").choice<"secret" | "monster-killed">("secret", "monster-killed"), "actor": readActorId(reader.field("actor"), identity), "total": reader.field("total").finite(), "found": reader.field("found").finite() });
case "weapon": return ({ "kind": reader.field("kind").literal("weapon"), "player": readActorId(reader.field("player"), identity), "weapon": readEventQ1Weapon(reader.field("weapon"), identity), "viewModel": reader.field("viewModel").string(), "frame": reader.field("frame").finite(), "punch": reader.field("punch").finite(), ...(reader.field("attack").value === undefined ? {} : { "attack": readEventQ1CharacterAttack(reader.field("attack"), identity) }) });
case "teleport-player": return ({ "kind": reader.field("kind").literal("teleport-player"), "player": readActorId(reader.field("player"), identity), "angles": readEventVec3(reader.field("angles"), identity), "lockUntil": reader.field("lockUntil").finite() });
case "powerup": return ({ "kind": reader.field("kind").literal("powerup"), "player": readActorId(reader.field("player"), identity), "powerup": reader.field("powerup").choice<"quad" | "invulnerability" | "invisibility" | "suit" | "hipnotic:wetsuit" | "hipnotic:empathy" | "rogue:shield" | "rogue:antigrav" | "mg3:lavasuit">("quad", "invulnerability", "invisibility", "suit", "hipnotic:wetsuit", "hipnotic:empathy", "rogue:shield", "rogue:antigrav", "mg3:lavasuit"), "expires": reader.field("expires").finite() });
case "intermission": return ({ "kind": reader.field("kind").literal("intermission"), "origin": readEventVec3(reader.field("origin"), identity), "angles": readEventVec3(reader.field("angles"), identity), "map": reader.field("map").string(), "exitAfter": reader.field("exitAfter").finite(), "track": reader.field("track").finite() });
case "finale": return ({ "kind": reader.field("kind").literal("finale"), "text": reader.field("text").string(), "stage": reader.field("stage").choice<1 | 2 | 3 | 4 | 5 | 6>(1, 2, 3, 4, 5, 6) });
case "achievement": return ({ "kind": reader.field("kind").literal("achievement"), "player": readEventQ1EventEffectActor(reader.field("player"), identity), "id": reader.field("id").string() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ1Event(value: EventQ1Event): unknown { switch (value.kind) { case "stop-sound": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "channel": value["channel"] });
case "sound": return ({ "kind": value["kind"], ...(value["origin"] === undefined ? {} : { "origin": writeEventVec3(value["origin"]) }), "actor": writeActorId(value["actor"]), "path": value["path"], "channel": value["channel"], "attenuation": value["attenuation"], "volume": value["volume"] });
case "ambient": return ({ "kind": value["kind"], "origin": writeEventVec3(value["origin"]), "path": value["path"], "volume": value["volume"], "attenuation": value["attenuation"] });
case "message": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "text": value["text"], "center": value["center"], ...(value["args"] === undefined ? {} : { "args": writeEventQ1EventMessageArgs(value["args"]) }), ...(value["parts"] === undefined ? {} : { "parts": writeEventQ1EventMessageParts(value["parts"]) }) });
case "effect": return ({ "kind": value["kind"], "effect": value["effect"], "actor": writeEventQ1EventEffectActor(value["actor"]), "origin": writeEventVec3(value["origin"]), "amount": value["amount"], ...(value.muzzle === undefined ? {} : { muzzle: { origin: writeEventVec3(value.muzzle.origin), angles: writeEventVec3(value.muzzle.angles) } }) });
case "colored-explosion": return writeEventQ1EventColoredExplosion(value);
case "static-model": return ({ "kind": value["kind"], "path": value["path"], "frame": value["frame"], "colorMap": value["colorMap"], "skin": value["skin"], "origin": writeEventVec3(value["origin"]), "angles": writeEventVec3(value["angles"]) });
case "particles": return ({ "kind": value["kind"], "origin": writeEventVec3(value["origin"]), "direction": writeEventVec3(value["direction"]), "color": value["color"], "count": value["count"] });
case "server-command": return ({ "kind": value["kind"], "text": value["text"] });
case "camera": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "origin": writeEventVec3(value["origin"]), "angles": writeEventVec3(value["angles"]), ...(value["viewOffset"] === undefined ? {} : { "viewOffset": writeEventVec3(value["viewOffset"]) }) });
case "beam": return ({ "kind": value["kind"], "style": value["style"], "actor": writeActorId(value["actor"]), "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]) });
case "lightstyle": return writeEventQ1EventLightstyle(value);
case "monster-total": return ({ "kind": value["kind"], "total": value["total"] });
case "secret": case "monster-killed": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "total": value["total"], "found": value["found"] });
case "weapon": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "weapon": writeEventQ1Weapon(value["weapon"]), "viewModel": value["viewModel"], "frame": value["frame"], "punch": value["punch"], ...(value["attack"] === undefined ? {} : { "attack": writeEventQ1CharacterAttack(value["attack"]) }) });
case "teleport-player": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "angles": writeEventVec3(value["angles"]), "lockUntil": value["lockUntil"] });
case "powerup": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "powerup": value["powerup"], "expires": value["expires"] });
case "intermission": return ({ "kind": value["kind"], "origin": writeEventVec3(value["origin"]), "angles": writeEventVec3(value["angles"]), "map": value["map"], "exitAfter": value["exitAfter"], "track": value["track"] });
case "finale": return ({ "kind": value["kind"], "text": value["text"], "stage": value["stage"] });
case "achievement": return ({ "kind": value["kind"], "player": writeEventQ1EventEffectActor(value["player"]), "id": value["id"] }); } }

type EventSimulationPresentationEventQ1SourceEntity = Exclude<EventSimulationPresentationEventQ1["sourceEntity"], undefined>;
function readEventSimulationPresentationEventQ1SourceEntity(reader: SaveReader, identity: UnifiedIdentityDecoder): EventSimulationPresentationEventQ1SourceEntity { void identity; return reader.value === null ? null : reader.finite(); }
function writeEventSimulationPresentationEventQ1SourceEntity(value: EventSimulationPresentationEventQ1SourceEntity): unknown { return value === null ? null : value; }

type EventSimulationPresentationEventQ1Fog = Extract<EventSimulationPresentationEvent, { readonly kind: "q1-fog" }>;

type EventSimulationPresentationEventQ1FogEvent = EventSimulationPresentationEventQ1Fog["event"];

type EventQ1FogTransition = EventSimulationPresentationEventQ1FogEvent["transition"];
type EventQ1Fog = EventQ1FogTransition["previous"];
function readEventQ1Fog(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1Fog { void identity; return { "density": reader.field("density").finite(), "color": readEventVec3(reader.field("color"), identity) }; }
function writeEventQ1Fog(value: EventQ1Fog): unknown { return { "density": value["density"], "color": writeEventVec3(value["color"]) }; }

function readEventQ1FogTransition(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1FogTransition { void identity; return { "previous": readEventQ1Fog(reader.field("previous"), identity), "target": readEventQ1Fog(reader.field("target"), identity), "start": reader.field("start").finite(), "duration": reader.field("duration").finite() }; }
function writeEventQ1FogTransition(value: EventQ1FogTransition): unknown { return { "previous": writeEventQ1Fog(value["previous"]), "target": writeEventQ1Fog(value["target"]), "start": value["start"], "duration": value["duration"] }; }

type EventSimulationPresentationEventQ1Composition = Extract<EventSimulationPresentationEvent, { readonly kind: "q1-composition" }>;

type EventQ1CompositionEvent = EventSimulationPresentationEventQ1Composition["event"];
type EventQ1CompositionEventAddon = Extract<EventQ1CompositionEvent, { readonly kind: "addon" }>;

type EventQ1AddonEvent = EventQ1CompositionEventAddon["event"];

type EventQ1AddonEventSellScreen = Extract<EventQ1AddonEvent, { readonly kind: "sell-screen" }>;

function readEventQ1AddonEventSellScreen(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1AddonEventSellScreen { void identity; return { "kind": reader.field("kind").literal("sell-screen") }; }
function writeEventQ1AddonEventSellScreen(value: EventQ1AddonEventSellScreen): unknown { return { "kind": value["kind"] }; }

type EventQ1AddonEventAlpha = Extract<EventQ1AddonEvent, { readonly kind: "alpha" }>;

function readEventQ1AddonEventAlpha(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1AddonEventAlpha { void identity; return { "kind": reader.field("kind").literal("alpha"), "actor": readActorId(reader.field("actor"), identity), "alpha": reader.field("alpha").finite() }; }
function writeEventQ1AddonEventAlpha(value: EventQ1AddonEventAlpha): unknown { return { "kind": value["kind"], "actor": writeActorId(value["actor"]), "alpha": value["alpha"] }; }

type EventQ1AddonEventDeveloperMessage = Extract<EventQ1AddonEvent, { readonly kind: "developer-message" }>;

function readEventQ1AddonEventDeveloperMessage(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1AddonEventDeveloperMessage { void identity; return { "kind": reader.field("kind").literal("developer-message"), "text": reader.field("text").string() }; }
function writeEventQ1AddonEventDeveloperMessage(value: EventQ1AddonEventDeveloperMessage): unknown { return { "kind": value["kind"], "text": value["text"] }; }

function readEventQ1AddonEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1AddonEvent { void identity; switch (reader.field('kind').string()) { case "music": return ({ "kind": reader.field("kind").literal("music"), "track": reader.field("track").finite(), "loopTrack": reader.field("loopTrack").finite() });
case "sell-screen": return readEventQ1AddonEventSellScreen(reader, identity);
case "alpha": return readEventQ1AddonEventAlpha(reader, identity);
case "rune-collected": return ({ "kind": reader.field("kind").literal("rune-collected"), "player": readActorId(reader.field("player"), identity), "bits": reader.field("bits").finite(), "program": reader.field("program").choice<"dopa" | "mg1" | "mg3" | "ctf">("dopa", "mg1", "mg3", "ctf") });
case "cutscene": return ({ "kind": reader.field("kind").literal("cutscene"), "camera": readEventVec3(reader.field("camera"), identity), "angles": readEventVec3(reader.field("angles"), identity) });
case "fog": return ({ "kind": reader.field("kind").literal("fog"), "player": readEventQ1EventEffectActor(reader.field("player"), identity), "density": reader.field("density").finite(), "color": readEventVec3(reader.field("color"), identity), "skyFactor": reader.field("skyFactor").finite(), "duration": reader.field("duration").finite() });
case "punch-angle": return ({ "kind": reader.field("kind").literal("punch-angle"), "player": readActorId(reader.field("player"), identity), "angles": readEventVec3(reader.field("angles"), identity) });
case "view-roll": return ({ "kind": reader.field("kind").literal("view-roll"), "player": readActorId(reader.field("player"), identity), "roll": reader.field("roll").finite() });
case "lightning": return ({ "kind": reader.field("kind").literal("lightning"), "actor": readActorId(reader.field("actor"), identity), "style": reader.field("style").choice<1 | 2 | 3>(1, 2, 3), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity) });
case "colored-explosion": return readEventQ1EventColoredExplosion(reader, identity);
case "monster-count": return ({ "kind": reader.field("kind").literal("monster-count"), "count": reader.field("count").finite() });
case "developer-message": return readEventQ1AddonEventDeveloperMessage(reader, identity);
case "actor-effects": return ({ "kind": reader.field("kind").literal("actor-effects"), "actor": readActorId(reader.field("actor"), identity), "effects": reader.field("effects").finite() });
case "debug-bounds": return ({ "kind": reader.field("kind").literal("debug-bounds"), "min": readEventVec3(reader.field("min"), identity), "max": readEventVec3(reader.field("max"), identity), "color": reader.field("color").finite(), "lifetime": reader.field("lifetime").finite(), "depthTest": reader.field("depthTest").boolean() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ1AddonEvent(value: EventQ1AddonEvent): unknown { switch (value.kind) { case "music": return ({ "kind": value["kind"], "track": value["track"], "loopTrack": value["loopTrack"] });
case "sell-screen": return writeEventQ1AddonEventSellScreen(value);
case "alpha": return writeEventQ1AddonEventAlpha(value);
case "rune-collected": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "bits": value["bits"], "program": value["program"] });
case "cutscene": return ({ "kind": value["kind"], "camera": writeEventVec3(value["camera"]), "angles": writeEventVec3(value["angles"]) });
case "fog": return ({ "kind": value["kind"], "player": writeEventQ1EventEffectActor(value["player"]), "density": value["density"], "color": writeEventVec3(value["color"]), "skyFactor": value["skyFactor"], "duration": value["duration"] });
case "punch-angle": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "angles": writeEventVec3(value["angles"]) });
case "view-roll": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "roll": value["roll"] });
case "lightning": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "style": value["style"], "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]) });
case "colored-explosion": return writeEventQ1EventColoredExplosion(value);
case "monster-count": return ({ "kind": value["kind"], "count": value["count"] });
case "developer-message": return writeEventQ1AddonEventDeveloperMessage(value);
case "actor-effects": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "effects": value["effects"] });
case "debug-bounds": return ({ "kind": value["kind"], "min": writeEventVec3(value["min"]), "max": writeEventVec3(value["max"]), "color": value["color"], "lifetime": value["lifetime"], "depthTest": value["depthTest"] }); } }

type EventQ1CompositionEventClient = Extract<EventQ1CompositionEvent, { readonly kind: "client" }>;

type EventQ1ClientSnapshot = EventQ1CompositionEventClient["client"];
type EventQ1ClientSnapshotUserinfo = EventQ1ClientSnapshot["userinfo"];
type EventQ1ClientSnapshotUserinfoItem = EventQ1ClientSnapshotUserinfo[number];
function readEventQ1ClientSnapshotUserinfoItem(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1ClientSnapshotUserinfoItem { void identity; return { "key": reader.field("key").string(), "value": reader.field("value").string() }; }
function writeEventQ1ClientSnapshotUserinfoItem(value: EventQ1ClientSnapshotUserinfoItem): unknown { return { "key": value["key"], "value": value["value"] }; }

function readEventQ1ClientSnapshotUserinfo(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1ClientSnapshotUserinfo { void identity; return boundedList(reader, item => readEventQ1ClientSnapshotUserinfoItem(item, identity)); }
function writeEventQ1ClientSnapshotUserinfo(value: EventQ1ClientSnapshotUserinfo): unknown { return value.map(item => writeEventQ1ClientSnapshotUserinfoItem(item)); }

function readEventQ1ClientSnapshot(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1ClientSnapshot { void identity; return { "actor": readActorId(reader.field("actor"), identity), "slot": reader.field("slot").finite(), "name": reader.field("name").string(), "frags": reader.field("frags").finite(), "shirt": reader.field("shirt").finite(), "pants": reader.field("pants").finite(), "team": reader.field("team").finite(), "observer": reader.field("observer").boolean(), "noTarget": reader.field("noTarget").boolean(), "userinfo": readEventQ1ClientSnapshotUserinfo(reader.field("userinfo"), identity) }; }
function writeEventQ1ClientSnapshot(value: EventQ1ClientSnapshot): unknown { return { "actor": writeActorId(value["actor"]), "slot": value["slot"], "name": value["name"], "frags": value["frags"], "shirt": value["shirt"], "pants": value["pants"], "team": value["team"], "observer": value["observer"], "noTarget": value["noTarget"], "userinfo": writeEventQ1ClientSnapshotUserinfo(value["userinfo"]) }; }

type EventQ1CompositionEventCtfStatus = Extract<EventQ1CompositionEvent, { readonly kind: "ctf-status" }>;

type EventCtfStatus = EventQ1CompositionEventCtfStatus["status"];
function readEventCtfStatus(reader: SaveReader, identity: UnifiedIdentityDecoder): EventCtfStatus { void identity; return { "red": reader.field("red").finite(), "blue": reader.field("blue").finite(), "flags": reader.field("flags").finite(), "runeItems": reader.field("runeItems").finite() }; }
function writeEventCtfStatus(value: EventCtfStatus): unknown { return { "red": value["red"], "blue": value["blue"], "flags": value["flags"], "runeItems": value["runeItems"] }; }

type EventQ1CompositionEventPrompt = Extract<EventQ1CompositionEvent, { readonly kind: "prompt" }>;

type EventQ1CompositionEventPromptChoices = EventQ1CompositionEventPrompt["choices"];
type EventQ1CompositionEventPromptChoicesItem = EventQ1CompositionEventPromptChoices[number];
function readEventQ1CompositionEventPromptChoicesItem(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1CompositionEventPromptChoicesItem { void identity; return { "label": reader.field("label").string(), "impulse": reader.field("impulse").finite() }; }
function writeEventQ1CompositionEventPromptChoicesItem(value: EventQ1CompositionEventPromptChoicesItem): unknown { return { "label": value["label"], "impulse": value["impulse"] }; }

function readEventQ1CompositionEventPromptChoices(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1CompositionEventPromptChoices { void identity; return boundedList(reader, item => readEventQ1CompositionEventPromptChoicesItem(item, identity)); }
function writeEventQ1CompositionEventPromptChoices(value: EventQ1CompositionEventPromptChoices): unknown { return value.map(item => writeEventQ1CompositionEventPromptChoicesItem(item)); }

type EventQ1CompositionEventLevelPresentation = Extract<EventQ1CompositionEvent, { readonly kind: "level-presentation" }>;

type EventQ1SourceFinale = EventQ1CompositionEventLevelPresentation["event"];
type EventQ1SourceFinaleFinale = Extract<EventQ1SourceFinale, { readonly kind: "finale" }>;
function readEventQ1SourceFinaleFinale(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1SourceFinaleFinale { void identity; return { "kind": reader.field("kind").literal("finale"), "text": reader.field("text").string(), "track": reader.field("track").finite() }; }
function writeEventQ1SourceFinaleFinale(value: EventQ1SourceFinaleFinale): unknown { return { "kind": value["kind"], "text": value["text"], "track": value["track"] }; }

function readEventQ1SourceFinale(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1SourceFinale { void identity; switch (reader.field('kind').string()) { case "finale": return readEventQ1SourceFinaleFinale(reader, identity);
case "sell-screen": return readEventQ1AddonEventSellScreen(reader, identity); default: return reader.fail('unknown event variant'); } }
function writeEventQ1SourceFinale(value: EventQ1SourceFinale): unknown { switch (value.kind) { case "finale": return writeEventQ1SourceFinaleFinale(value);
case "sell-screen": return writeEventQ1AddonEventSellScreen(value); } }

function readEventQ1CompositionEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1CompositionEvent { void identity; switch (reader.field('kind').string()) { case "addon": return ({ "kind": reader.field("kind").literal("addon"), "event": readEventQ1AddonEvent(reader.field("event"), identity) });
case "client": return ({ "kind": reader.field("kind").literal("client"), "client": readEventQ1ClientSnapshot(reader.field("client"), identity) });
case "client-left": return ({ "kind": reader.field("kind").literal("client-left"), "actor": readActorId(reader.field("actor"), identity), "slot": reader.field("slot").finite() });
case "ctf-status": return ({ "kind": reader.field("kind").literal("ctf-status"), "actor": readActorId(reader.field("actor"), identity), "status": readEventCtfStatus(reader.field("status"), identity) });
case "ctf-capture": return ({ "kind": reader.field("kind").literal("ctf-capture"), "team": reader.field("team").choice<"red" | "blue">("red", "blue"), "total": reader.field("total").finite() });
case "prompt": return ({ "kind": reader.field("kind").literal("prompt"), "actor": readActorId(reader.field("actor"), identity), "title": reader.field("title").string(), "choices": readEventQ1CompositionEventPromptChoices(reader.field("choices"), identity) });
case "clear-prompt": return ({ "kind": reader.field("kind").literal("clear-prompt"), "actor": readActorId(reader.field("actor"), identity) });
case "source-log": return ({ "kind": reader.field("kind").literal("source-log"), "actor": readActorId(reader.field("actor"), identity), "action": reader.field("action").string() });
case "developer-message": return readEventQ1AddonEventDeveloperMessage(reader, identity);
case "level-presentation": return ({ "kind": reader.field("kind").literal("level-presentation"), "event": readEventQ1SourceFinale(reader.field("event"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventQ1CompositionEvent(value: EventQ1CompositionEvent): unknown { switch (value.kind) { case "addon": return ({ "kind": value["kind"], "event": writeEventQ1AddonEvent(value["event"]) });
case "client": return ({ "kind": value["kind"], "client": writeEventQ1ClientSnapshot(value["client"]) });
case "client-left": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "slot": value["slot"] });
case "ctf-status": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "status": writeEventCtfStatus(value["status"]) });
case "ctf-capture": return ({ "kind": value["kind"], "team": value["team"], "total": value["total"] });
case "prompt": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "title": value["title"], "choices": writeEventQ1CompositionEventPromptChoices(value["choices"]) });
case "clear-prompt": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]) });
case "source-log": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "action": value["action"] });
case "developer-message": return writeEventQ1AddonEventDeveloperMessage(value);
case "level-presentation": return ({ "kind": value["kind"], "event": writeEventQ1SourceFinale(value["event"]) }); } }

type EventSimulationPresentationEventQ1Level = Extract<EventSimulationPresentationEvent, { readonly kind: "q1-level" }>;

type EventQ1IntermissionResult = EventSimulationPresentationEventQ1Level["event"];

function readEventQ1IntermissionResult(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ1IntermissionResult { void identity; switch (reader.field('kind').string()) { case "waiting": return ({ "kind": reader.field("kind").literal("waiting") });
case "travel": return ({ "kind": reader.field("kind").literal("travel"), "map": reader.field("map").string() });
case "finale": return readEventQ1SourceFinaleFinale(reader, identity);
case "sell-screen": return readEventQ1AddonEventSellScreen(reader, identity); default: return reader.fail('unknown event variant'); } }
function writeEventQ1IntermissionResult(value: EventQ1IntermissionResult): unknown { switch (value.kind) { case "waiting": return ({ "kind": value["kind"] });
case "travel": return ({ "kind": value["kind"], "map": value["map"] });
case "finale": return writeEventQ1SourceFinaleFinale(value);
case "sell-screen": return writeEventQ1AddonEventSellScreen(value); } }

type EventSimulationPresentationEventQ2 = Extract<EventSimulationPresentationEvent, { readonly kind: "q2" }>;

type EventQ2PresentationEvent = EventSimulationPresentationEventQ2["event"];
type EventQ2PresentationEventModel = Extract<EventQ2PresentationEvent, { readonly kind: "model" }>;

type EventQ2PresentationEventModelAttachedModels = EventQ2PresentationEventModel["attachedModels"];
function readEventQ2PresentationEventModelAttachedModels(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PresentationEventModelAttachedModels { void identity; return boundedList(reader, item => item.string()); }
function writeEventQ2PresentationEventModelAttachedModels(value: EventQ2PresentationEventModelAttachedModels): unknown { return value.map(item => item); }

type EventQ2PresentationEventPoi = Extract<EventQ2PresentationEvent, { readonly kind: "poi" }>;

type EventQ2PresentationEventPoiFields = EventQ2PresentationEventPoi["fields"];
function readEventQ2PresentationEventPoiFields(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PresentationEventPoiFields { void identity; const result = new Map<string, string>(); boundedList(reader, item => { const key = item.field('key').string(); if (result.has(key)) return item.fail('duplicate map key'); result.set(key, item.field('value').string()); }); return result; }
function writeEventQ2PresentationEventPoiFields(value: EventQ2PresentationEventPoiFields): unknown { return [...value].map(([key, entry]) => ({ key, value: entry })); }

type EventQ2PresentationEventDynamicLight = Extract<EventQ2PresentationEvent, { readonly kind: "dynamic-light" }>;

type EventQ2PresentationEventDynamicLightCone = EventQ2PresentationEventDynamicLight["cone"];
type EventQ2PresentationEventDynamicLightConeValue = NonNullable<EventQ2PresentationEventDynamicLightCone>;
function readEventQ2PresentationEventDynamicLightConeValue(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PresentationEventDynamicLightConeValue { void identity; return { "direction": readEventVec3(reader.field("direction"), identity), "cosHalfAngle": reader.field("cosHalfAngle").finite() }; }
function writeEventQ2PresentationEventDynamicLightConeValue(value: EventQ2PresentationEventDynamicLightConeValue): unknown { return { "direction": writeEventVec3(value["direction"]), "cosHalfAngle": value["cosHalfAngle"] }; }

function readEventQ2PresentationEventDynamicLightCone(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PresentationEventDynamicLightCone { void identity; return reader.value === null ? null : readEventQ2PresentationEventDynamicLightConeValue(reader, identity); }
function writeEventQ2PresentationEventDynamicLightCone(value: EventQ2PresentationEventDynamicLightCone): unknown { return value === null ? null : writeEventQ2PresentationEventDynamicLightConeValue(value); }

function readEventQ2PresentationEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PresentationEvent { void identity; switch (reader.field('kind').string()) { case "model": return ({ "kind": reader.field("kind").literal("model"), "actor": readActorId(reader.field("actor"), identity), "path": reader.field("path").string(), "attachedModels": readEventQ2PresentationEventModelAttachedModels(reader.field("attachedModels"), identity), "frame": reader.field("frame").finite(), "oldFrame": reader.field("oldFrame").finite(), "scale": reader.field("scale").finite(), "alpha": reader.field("alpha").finite(), "skin": reader.field("skin").finite(), "effects": reader.field("effects").finite(), "renderFlags": reader.field("renderFlags").finite() });
case "visibility": return ({ "kind": reader.field("kind").literal("visibility"), "actor": readActorId(reader.field("actor"), identity), "visible": reader.field("visible").boolean() });
case "sound": return ({ "kind": reader.field("kind").literal("sound"), "actor": readEventQ1EventEffectActor(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "path": reader.field("path").string(), "channel": reader.field("channel").finite(), "volume": reader.field("volume").finite(), "attenuation": reader.field("attenuation").finite(), "reliable": reader.field("reliable").boolean(), "loop": reader.field("loop").choice<"start" | "stop" | "once">("start", "stop", "once"), ...(reader.field("loopOwner").value === undefined ? {} : { "loopOwner": readProviderId(reader.field("loopOwner"), identity) }) });
case "centerprint": return ({ "kind": reader.field("kind").literal("centerprint"), "actor": readActorId(reader.field("actor"), identity), "text": reader.field("text").string(), ...(reader.field("instant").value === undefined ? {} : { "instant": reader.field("instant").boolean() }), ...(reader.field("durationSeconds").value === undefined ? {} : { "durationSeconds": reader.field("durationSeconds").finite() }) });
case "print": return ({ "kind": reader.field("kind").literal("print"), "actor": readEventQ1EventEffectActor(reader.field("actor"), identity), "level": reader.field("level").choice<"low" | "medium" | "high" | "chat">("low", "medium", "high", "chat"), "text": reader.field("text").string() });
case "help": return ({ "kind": reader.field("kind").literal("help"), "slot": reader.field("slot").choice<1 | 2>(1, 2), "text": reader.field("text").string() });
case "lightstyle": return readEventQ1EventLightstyle(reader, identity);
case "music": return ({ "kind": reader.field("kind").literal("music"), "track": reader.field("track").string() });
case "effect": return ({ "kind": reader.field("kind").literal("effect"), "effect": reader.field("effect").string(), "origin": readEventVec3(reader.field("origin"), identity), "direction": readEventVec3(reader.field("direction"), identity), "count": reader.field("count").finite(), "color": reader.field("color").finite() });
case "damage-indicator": return ({ "kind": reader.field("kind").literal("damage-indicator"), "actor": readActorId(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "amount": reader.field("amount").finite() });
case "pickup": return ({ "kind": reader.field("kind").literal("pickup"), "player": readActorId(reader.field("player"), identity), "item": readItemId(reader.field("item"), identity), "icon": reader.field("icon").string(), "name": reader.field("name").string() });
case "poi": return ({ "kind": reader.field("kind").literal("poi"), "origin": readEventVec3(reader.field("origin"), identity), "message": reader.field("message").string(), "fields": readEventQ2PresentationEventPoiFields(reader.field("fields"), identity) });
case "dynamic-light": return ({ "kind": reader.field("kind").literal("dynamic-light"), "actor": readActorId(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "color": readEventVec3(reader.field("color"), identity), "visible": reader.field("visible").boolean(), "radius": reader.field("radius").finite(), "intensity": reader.field("intensity").finite(), "resolution": reader.field("resolution").finite(), "fadeStart": reader.field("fadeStart").finite(), "fadeEnd": reader.field("fadeEnd").finite(), "lightstyle": reader.field("lightstyle").finite(), "cone": readEventQ2PresentationEventDynamicLightCone(reader.field("cone"), identity) });
case "beam": return ({ "kind": reader.field("kind").literal("beam"), "actor": readActorId(reader.field("actor"), identity), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity), "width": reader.field("width").finite(), "color": reader.field("color").finite(), "visible": reader.field("visible").boolean() });
case "monster-beam": return ({ "kind": reader.field("kind").literal("monster-beam"), "effect": reader.field("effect").choice<"parasite" | "medic">("parasite", "medic"), "actor": readActorId(reader.field("actor"), identity), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity) });
case "monster-muzzleflash": return ({ "kind": reader.field("kind").literal("monster-muzzleflash"), "actor": readActorId(reader.field("actor"), identity), "flash": reader.field("flash").finite(), "origin": readEventVec3(reader.field("origin"), identity), "direction": readEventVec3(reader.field("direction"), identity) });
case "entity-event": return ({ "kind": reader.field("kind").literal("entity-event"), "actor": readActorId(reader.field("actor"), identity), "event": reader.field("event").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2PresentationEvent(value: EventQ2PresentationEvent): unknown { switch (value.kind) { case "model": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "path": value["path"], "attachedModels": writeEventQ2PresentationEventModelAttachedModels(value["attachedModels"]), "frame": value["frame"], "oldFrame": value["oldFrame"], "scale": value["scale"], "alpha": value["alpha"], "skin": value["skin"], "effects": value["effects"], "renderFlags": value["renderFlags"] });
case "visibility": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "visible": value["visible"] });
case "sound": return ({ "kind": value["kind"], "actor": writeEventQ1EventEffectActor(value["actor"]), "origin": writeEventVec3(value["origin"]), "path": value["path"], "channel": value["channel"], "volume": value["volume"], "attenuation": value["attenuation"], "reliable": value["reliable"], "loop": value["loop"], ...(value["loopOwner"] === undefined ? {} : { "loopOwner": writeProviderId(value["loopOwner"]) }) });
case "centerprint": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "text": value["text"], ...(value["instant"] === undefined ? {} : { "instant": value["instant"] }), ...(value["durationSeconds"] === undefined ? {} : { "durationSeconds": value["durationSeconds"] }) });
case "print": return ({ "kind": value["kind"], "actor": writeEventQ1EventEffectActor(value["actor"]), "level": value["level"], "text": value["text"] });
case "help": return ({ "kind": value["kind"], "slot": value["slot"], "text": value["text"] });
case "lightstyle": return writeEventQ1EventLightstyle(value);
case "music": return ({ "kind": value["kind"], "track": value["track"] });
case "effect": return ({ "kind": value["kind"], "effect": value["effect"], "origin": writeEventVec3(value["origin"]), "direction": writeEventVec3(value["direction"]), "count": value["count"], "color": value["color"] });
case "damage-indicator": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "origin": writeEventVec3(value["origin"]), "amount": value["amount"] });
case "pickup": return ({ "kind": value["kind"], "player": writeActorId(value["player"]), "item": writeItemId(value["item"]), "icon": value["icon"], "name": value["name"] });
case "poi": return ({ "kind": value["kind"], "origin": writeEventVec3(value["origin"]), "message": value["message"], "fields": writeEventQ2PresentationEventPoiFields(value["fields"]) });
case "dynamic-light": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "origin": writeEventVec3(value["origin"]), "color": writeEventVec3(value["color"]), "visible": value["visible"], "radius": value["radius"], "intensity": value["intensity"], "resolution": value["resolution"], "fadeStart": value["fadeStart"], "fadeEnd": value["fadeEnd"], "lightstyle": value["lightstyle"], "cone": writeEventQ2PresentationEventDynamicLightCone(value["cone"]) });
case "beam": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]), "width": value["width"], "color": value["color"], "visible": value["visible"] });
case "monster-beam": return ({ "kind": value["kind"], "effect": value["effect"], "actor": writeActorId(value["actor"]), "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]) });
case "monster-muzzleflash": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "flash": value["flash"], "origin": writeEventVec3(value["origin"]), "direction": writeEventVec3(value["direction"]) });
case "entity-event": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "event": value["event"] }); } }

type EventSimulationPresentationEventQ2Weapon = Extract<EventSimulationPresentationEvent, { readonly kind: "q2-weapon" }>;

type EventQ2WeaponEvent = EventSimulationPresentationEventQ2Weapon["event"];

type EventQ2WeaponEventViewWeapon = Extract<EventQ2WeaponEvent, { readonly kind: "view-weapon" }>;

type EventQ2WeaponEventViewWeaponWeapon = EventQ2WeaponEventViewWeapon["weapon"];
function readEventQ2WeaponEventViewWeaponWeapon(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2WeaponEventViewWeaponWeapon { void identity; return reader.value === null ? null : reader.string(); }
function writeEventQ2WeaponEventViewWeaponWeapon(value: EventQ2WeaponEventViewWeaponWeapon): unknown { return value === null ? null : value; }

function readEventQ2WeaponEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2WeaponEvent { void identity; switch (reader.field('kind').string()) { case "muzzleflash": return ({ "kind": reader.field("kind").literal("muzzleflash"), "actor": readActorId(reader.field("actor"), identity), "flash": reader.field("flash").finite(), "silenced": reader.field("silenced").boolean() });
case "beam": return ({ "kind": reader.field("kind").literal("beam"), "effect": reader.field("effect").choice<"rail" | "rail-water" | "bfg-laser" | "bfg-zap" | "bubble-trail" | "bfg-lightning" | "heatbeam" | "monster-heatbeam">("rail", "rail-water", "bfg-laser", "bfg-zap", "bubble-trail", "bfg-lightning", "heatbeam", "monster-heatbeam"), "actor": readActorId(reader.field("actor"), identity), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity), "duration": reader.field("duration").finite() });
case "view-weapon": return ({ "kind": reader.field("kind").literal("view-weapon"), "actor": readActorId(reader.field("actor"), identity), "weapon": readEventQ2WeaponEventViewWeaponWeapon(reader.field("weapon"), identity), "model": reader.field("model").string(), "playerModel": reader.field("playerModel").finite(), "frame": reader.field("frame").finite(), "skin": reader.field("skin").finite(), "rate": reader.field("rate").finite(), "kickOrigin": readEventVec3(reader.field("kickOrigin"), identity), "kickAngles": readEventVec3(reader.field("kickAngles"), identity) });
case "player-animation": return ({ "kind": reader.field("kind").literal("player-animation"), "actor": readActorId(reader.field("actor"), identity), "priority": reader.field("priority").choice<"attack" | "pain" | "reverse">("attack", "pain", "reverse"), "first": reader.field("first").finite(), "last": reader.field("last").finite(), "resetTime": reader.field("resetTime").boolean() });
case "invisibility-reveal": return ({ "kind": reader.field("kind").literal("invisibility-reveal"), "actor": readActorId(reader.field("actor"), identity), "until": reader.field("until").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2WeaponEvent(value: EventQ2WeaponEvent): unknown { switch (value.kind) { case "muzzleflash": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "flash": value["flash"], "silenced": value["silenced"] });
case "beam": return ({ "kind": value["kind"], "effect": value["effect"], "actor": writeActorId(value["actor"]), "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]), "duration": value["duration"] });
case "view-weapon": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "weapon": writeEventQ2WeaponEventViewWeaponWeapon(value["weapon"]), "model": value["model"], "playerModel": value["playerModel"], "frame": value["frame"], "skin": value["skin"], "rate": value["rate"], "kickOrigin": writeEventVec3(value["kickOrigin"]), "kickAngles": writeEventVec3(value["kickAngles"]) });
case "player-animation": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "priority": value["priority"], "first": value["first"], "last": value["last"], "resetTime": value["resetTime"] });
case "invisibility-reveal": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "until": value["until"] }); } }

type EventSimulationPresentationEventQ2Composition = Extract<EventSimulationPresentationEvent, { readonly kind: "q2-composition" }>;

type EventQ2CompositionEvent = EventSimulationPresentationEventQ2Composition["event"];
type EventQ2CompositionEventCtf = Extract<EventQ2CompositionEvent, { readonly kind: "ctf" }>;

type EventQ2CtfEvent = EventQ2CompositionEventCtf["event"];
type EventQ2CtfEventScoreboard = Extract<EventQ2CtfEvent, { readonly kind: "scoreboard" }>;

type EventQ2CtfEventScoreboardRed = EventQ2CtfEventScoreboard["red"];
type EventQ2CtfScoreRow = EventQ2CtfEventScoreboardRed[number];
type EventQ2CtfScoreRowCarriedFlag = EventQ2CtfScoreRow["carriedFlag"];
function readEventQ2CtfScoreRowCarriedFlag(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfScoreRowCarriedFlag { void identity; return (reader.value === null ? null : reader.choice<1 | 2>(1, 2)); }
function writeEventQ2CtfScoreRowCarriedFlag(value: EventQ2CtfScoreRowCarriedFlag): unknown { return value; }

function readEventQ2CtfScoreRow(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfScoreRow { void identity; return { "slot": reader.field("slot").finite(), "name": reader.field("name").string(), "score": reader.field("score").finite(), "ping": reader.field("ping").finite(), "carriedFlag": readEventQ2CtfScoreRowCarriedFlag(reader.field("carriedFlag"), identity) }; }
function writeEventQ2CtfScoreRow(value: EventQ2CtfScoreRow): unknown { return { "slot": value["slot"], "name": value["name"], "score": value["score"], "ping": value["ping"], "carriedFlag": writeEventQ2CtfScoreRowCarriedFlag(value["carriedFlag"]) }; }

function readEventQ2CtfEventScoreboardRed(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventScoreboardRed { void identity; return boundedList(reader, item => readEventQ2CtfScoreRow(item, identity)); }
function writeEventQ2CtfEventScoreboardRed(value: EventQ2CtfEventScoreboardRed): unknown { return value.map(item => writeEventQ2CtfScoreRow(item)); }

type EventQ2CtfEventScoreboardCaptures = EventQ2CtfEventScoreboard["captures"];
function readEventQ2CtfEventScoreboardCaptures(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventScoreboardCaptures { void identity; const items = boundedList(reader, item => item); if (items.length !== 2) return reader.fail('invalid tuple length');
const item0 = items[0]; if (item0 === undefined) return reader.fail('missing tuple item');
const item1 = items[1]; if (item1 === undefined) return reader.fail('missing tuple item');
return [item0.finite(), item1.finite()]; }
function writeEventQ2CtfEventScoreboardCaptures(value: EventQ2CtfEventScoreboardCaptures): unknown { return [value[0], value[1]]; }

type EventQ2CtfEventHud = Extract<EventQ2CtfEvent, { readonly kind: "hud" }>;

type EventQ2CtfEventHudFlagStates = EventQ2CtfEventHud["flagStates"];

function readEventQ2CtfEventHudFlagStates(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventHudFlagStates { void identity; const items = boundedList(reader, item => item); if (items.length !== 2) return reader.fail('invalid tuple length');
const item0 = items[0]; if (item0 === undefined) return reader.fail('missing tuple item');
const item1 = items[1]; if (item1 === undefined) return reader.fail('missing tuple item');
return [item0.choice<"base" | "dropped" | "taken">("base", "dropped", "taken"), item1.choice<"base" | "dropped" | "taken">("base", "dropped", "taken")]; }
function writeEventQ2CtfEventHudFlagStates(value: EventQ2CtfEventHudFlagStates): unknown { return [value[0], value[1]]; }

type EventQ2CtfEventHudTech = EventQ2CtfEventHud["tech"];
function readEventQ2CtfEventHudTech(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventHudTech { void identity; return (reader.value === null ? null : reader.choice<"item_tech1" | "item_tech2" | "item_tech3" | "item_tech4">("item_tech1", "item_tech2", "item_tech3", "item_tech4")); }
function writeEventQ2CtfEventHudTech(value: EventQ2CtfEventHudTech): unknown { return value; }

type EventQ2CtfEventMenu = Extract<EventQ2CtfEvent, { readonly kind: "menu" }>;

type EventQ2CtfEventMenuEntries = EventQ2CtfEventMenu["entries"];
type EventQ2CtfEventMenuEntriesItem = EventQ2CtfEventMenuEntries[number];
type EventQ2CtfEventMenuEntriesItemAction = EventQ2CtfEventMenuEntriesItem["action"];
function readEventQ2CtfEventMenuEntriesItemAction(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventMenuEntriesItemAction { void identity; return (reader.value === null ? null : reader.choice<"join-red" | "join-blue" | "observer" | "chase" | "credits" | "match" | "ready" | "notready" | "admin-settings" | "admin-start" | "admin-cancel" | "close">("join-red", "join-blue", "observer", "chase", "credits", "match", "ready", "notready", "admin-settings", "admin-start", "admin-cancel", "close")); }
function writeEventQ2CtfEventMenuEntriesItemAction(value: EventQ2CtfEventMenuEntriesItemAction): unknown { return value; }

function readEventQ2CtfEventMenuEntriesItem(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventMenuEntriesItem { void identity; return { "label": reader.field("label").string(), "action": readEventQ2CtfEventMenuEntriesItemAction(reader.field("action"), identity) }; }
function writeEventQ2CtfEventMenuEntriesItem(value: EventQ2CtfEventMenuEntriesItem): unknown { return { "label": value["label"], "action": writeEventQ2CtfEventMenuEntriesItemAction(value["action"]) }; }

function readEventQ2CtfEventMenuEntries(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventMenuEntries { void identity; return boundedList(reader, item => readEventQ2CtfEventMenuEntriesItem(item, identity)); }
function writeEventQ2CtfEventMenuEntries(value: EventQ2CtfEventMenuEntries): unknown { return value.map(item => writeEventQ2CtfEventMenuEntriesItem(item)); }

type EventQ2CtfEventAdminSettings = Extract<EventQ2CtfEvent, { readonly kind: "admin-settings" }>;

type EventQ2CtfAdminSettings = EventQ2CtfEventAdminSettings["settings"];
function readEventQ2CtfAdminSettings(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfAdminSettings { void identity; return { "matchMinutes": reader.field("matchMinutes").finite(), "setupMinutes": reader.field("setupMinutes").finite(), "startSeconds": reader.field("startSeconds").finite(), "weaponsStay": reader.field("weaponsStay").boolean(), "instantItems": reader.field("instantItems").boolean(), "quadDrop": reader.field("quadDrop").boolean(), "instantWeapons": reader.field("instantWeapons").boolean(), "matchLock": reader.field("matchLock").boolean() }; }
function writeEventQ2CtfAdminSettings(value: EventQ2CtfAdminSettings): unknown { return { "matchMinutes": value["matchMinutes"], "setupMinutes": value["setupMinutes"], "startSeconds": value["startSeconds"], "weaponsStay": value["weaponsStay"], "instantItems": value["instantItems"], "quadDrop": value["quadDrop"], "instantWeapons": value["instantWeapons"], "matchLock": value["matchLock"] }; }

type EventQ2CtfEventGrappleCable = Extract<EventQ2CtfEvent, { readonly kind: "grapple-cable" }>;

function readEventQ2CtfEventGrappleCable(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEventGrappleCable { void identity; return { "kind": reader.field("kind").literal("grapple-cable"), "actor": readActorId(reader.field("actor"), identity), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity), "offset": readEventVec3(reader.field("offset"), identity) }; }
function writeEventQ2CtfEventGrappleCable(value: EventQ2CtfEventGrappleCable): unknown { return { "kind": value["kind"], "actor": writeActorId(value["actor"]), "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]), "offset": writeEventVec3(value["offset"]) }; }

function readEventQ2CtfEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CtfEvent { void identity; switch (reader.field('kind').string()) { case "scoreboard": return ({ "kind": reader.field("kind").literal("scoreboard"), "actor": readActorId(reader.field("actor"), identity), "red": readEventQ2CtfEventScoreboardRed(reader.field("red"), identity), "blue": readEventQ2CtfEventScoreboardRed(reader.field("blue"), identity), "spectators": readEventQ2CtfEventScoreboardRed(reader.field("spectators"), identity), "captures": readEventQ2CtfEventScoreboardCaptures(reader.field("captures"), identity), "totals": readEventQ2CtfEventScoreboardCaptures(reader.field("totals"), identity), "layout": reader.field("layout").string() });
case "hud": return ({ "kind": reader.field("kind").literal("hud"), "actor": readActorId(reader.field("actor"), identity), "captures": readEventQ2CtfEventScoreboardCaptures(reader.field("captures"), identity), "flagStates": readEventQ2CtfEventHudFlagStates(reader.field("flagStates"), identity), "team": reader.field("team").choice<0 | 1 | 2>(0, 1, 2), "carriedFlag": readEventQ2CtfScoreRowCarriedFlag(reader.field("carriedFlag"), identity), "tech": readEventQ2CtfEventHudTech(reader.field("tech"), identity), "idTarget": readEventQ1EventEffectActor(reader.field("idTarget"), identity), "blinkTeam": readEventQ2CtfScoreRowCarriedFlag(reader.field("blinkTeam"), identity), "match": reader.field("match").string() });
case "menu": return ({ "kind": reader.field("kind").literal("menu"), "actor": readActorId(reader.field("actor"), identity), "title": reader.field("title").string(), "entries": readEventQ2CtfEventMenuEntries(reader.field("entries"), identity) });
case "match-status": return ({ "kind": reader.field("kind").literal("match-status"), "text": reader.field("text").string() });
case "admin-settings": return ({ "kind": reader.field("kind").literal("admin-settings"), "actor": readActorId(reader.field("actor"), identity), "settings": readEventQ2CtfAdminSettings(reader.field("settings"), identity) });
case "grapple-cable": return readEventQ2CtfEventGrappleCable(reader, identity); default: return reader.fail('unknown event variant'); } }
function writeEventQ2CtfEvent(value: EventQ2CtfEvent): unknown { switch (value.kind) { case "scoreboard": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "red": writeEventQ2CtfEventScoreboardRed(value["red"]), "blue": writeEventQ2CtfEventScoreboardRed(value["blue"]), "spectators": writeEventQ2CtfEventScoreboardRed(value["spectators"]), "captures": writeEventQ2CtfEventScoreboardCaptures(value["captures"]), "totals": writeEventQ2CtfEventScoreboardCaptures(value["totals"]), "layout": value["layout"] });
case "hud": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "captures": writeEventQ2CtfEventScoreboardCaptures(value["captures"]), "flagStates": writeEventQ2CtfEventHudFlagStates(value["flagStates"]), "team": value["team"], "carriedFlag": writeEventQ2CtfScoreRowCarriedFlag(value["carriedFlag"]), "tech": writeEventQ2CtfEventHudTech(value["tech"]), "idTarget": writeEventQ1EventEffectActor(value["idTarget"]), "blinkTeam": writeEventQ2CtfScoreRowCarriedFlag(value["blinkTeam"]), "match": value["match"] });
case "menu": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "title": value["title"], "entries": writeEventQ2CtfEventMenuEntries(value["entries"]) });
case "match-status": return ({ "kind": value["kind"], "text": value["text"] });
case "admin-settings": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "settings": writeEventQ2CtfAdminSettings(value["settings"]) });
case "grapple-cable": return writeEventQ2CtfEventGrappleCable(value); } }

type EventQ2CompositionEventLmctf = Extract<EventQ2CompositionEvent, { readonly kind: "lmctf" }>;

type EventLmctfEvent = EventQ2CompositionEventLmctf["event"];
type EventLmctfEventMenu = Extract<EventLmctfEvent, { readonly kind: "menu" }>;
type EventLmctfEventMenuEntries = EventLmctfEventMenu["entries"];
type EventLmctfEventMenuEntriesItem = EventLmctfEventMenuEntries[number];
function readEventLmctfEventMenuEntriesItem(reader: SaveReader, identity: UnifiedIdentityDecoder): EventLmctfEventMenuEntriesItem { void identity; return { "label": reader.field("label").string(), "command": readEventQ2WeaponEventViewWeaponWeapon(reader.field("command"), identity) }; }
function writeEventLmctfEventMenuEntriesItem(value: EventLmctfEventMenuEntriesItem): unknown { return { "label": value["label"], "command": writeEventQ2WeaponEventViewWeaponWeapon(value["command"]) }; }

function readEventLmctfEventMenuEntries(reader: SaveReader, identity: UnifiedIdentityDecoder): EventLmctfEventMenuEntries { void identity; return boundedList(reader, item => readEventLmctfEventMenuEntriesItem(item, identity)); }
function writeEventLmctfEventMenuEntries(value: EventLmctfEventMenuEntries): unknown { return value.map(item => writeEventLmctfEventMenuEntriesItem(item)); }

type EventLmctfEventScoreboard = Extract<EventLmctfEvent, { readonly kind: "scoreboard" }>;
type EventLmctfEventScoreboardRows = EventLmctfEventScoreboard["rows"];
type EventLmctfScoreRow = EventLmctfEventScoreboardRows[number];
function readEventLmctfScoreRow(reader: SaveReader, identity: UnifiedIdentityDecoder): EventLmctfScoreRow { void identity; return { "actor": readActorId(reader.field("actor"), identity), "slot": reader.field("slot").finite(), "name": reader.field("name").string(), "team": reader.field("team").choice<0 | 1 | 2>(0, 1, 2), "score": reader.field("score").finite(), "ping": reader.field("ping").finite() }; }
function writeEventLmctfScoreRow(value: EventLmctfScoreRow): unknown { return { "actor": writeActorId(value["actor"]), "slot": value["slot"], "name": value["name"], "team": value["team"], "score": value["score"], "ping": value["ping"] }; }

function readEventLmctfEventScoreboardRows(reader: SaveReader, identity: UnifiedIdentityDecoder): EventLmctfEventScoreboardRows { void identity; return boundedList(reader, item => readEventLmctfScoreRow(item, identity)); }
function writeEventLmctfEventScoreboardRows(value: EventLmctfEventScoreboardRows): unknown { return value.map(item => writeEventLmctfScoreRow(item)); }

type EventLmctfEventHud = Extract<EventLmctfEvent, { readonly kind: "hud" }>;
type EventLmctfEventHudRune = EventLmctfEventHud["rune"];
function readEventLmctfEventHudRune(reader: SaveReader, identity: UnifiedIdentityDecoder): EventLmctfEventHudRune { void identity; return (reader.value === null ? null : reader.choice<"damage" | "resist" | "haste" | "regen" | "vampire">("damage", "resist", "haste", "regen", "vampire")); }
function writeEventLmctfEventHudRune(value: EventLmctfEventHudRune): unknown { return value; }

function readEventLmctfEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventLmctfEvent { void identity; switch (reader.field('kind').string()) { case "grapple-cable": return readEventQ2CtfEventGrappleCable(reader, identity);
case "menu": return ({ "kind": reader.field("kind").literal("menu"), "actor": readActorId(reader.field("actor"), identity), "title": reader.field("title").string(), "entries": readEventLmctfEventMenuEntries(reader.field("entries"), identity) });
case "scoreboard": return ({ "kind": reader.field("kind").literal("scoreboard"), "actor": readActorId(reader.field("actor"), identity), "rows": readEventLmctfEventScoreboardRows(reader.field("rows"), identity), "layout": reader.field("layout").string() });
case "hud": return ({ "kind": reader.field("kind").literal("hud"), "actor": readActorId(reader.field("actor"), identity), "team": reader.field("team").choice<0 | 1 | 2>(0, 1, 2), "carriedFlag": reader.field("carriedFlag").boolean(), "rune": readEventLmctfEventHudRune(reader.field("rune"), identity), "layout": reader.field("layout").string() });
case "score-log": return ({ "kind": reader.field("kind").literal("score-log"), "actor": readActorId(reader.field("actor"), identity), "victim": readEventQ1EventEffectActor(reader.field("victim"), identity), "name": reader.field("name").string(), "amount": reader.field("amount").finite(), "seconds": reader.field("seconds").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventLmctfEvent(value: EventLmctfEvent): unknown { switch (value.kind) { case "grapple-cable": return writeEventQ2CtfEventGrappleCable(value);
case "menu": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "title": value["title"], "entries": writeEventLmctfEventMenuEntries(value["entries"]) });
case "scoreboard": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "rows": writeEventLmctfEventScoreboardRows(value["rows"]), "layout": value["layout"] });
case "hud": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "team": value["team"], "carriedFlag": value["carriedFlag"], "rune": writeEventLmctfEventHudRune(value["rune"]), "layout": value["layout"] });
case "score-log": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "victim": writeEventQ1EventEffectActor(value["victim"]), "name": value["name"], "amount": value["amount"], "seconds": value["seconds"] }); } }

type EventQ2CompositionEventMissionpackPlayer = Extract<EventQ2CompositionEvent, { readonly kind: "missionpack-player" }>;

type EventQ2MissionPackPlayerEffect = EventQ2CompositionEventMissionpackPlayer["event"];

function readEventQ2MissionPackPlayerEffect(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2MissionPackPlayerEffect { void identity; switch (reader.field('kind').string()) { case "tracker-pain": return ({ "kind": reader.field("kind").literal("tracker-pain"), "actor": readActorId(reader.field("actor"), identity), "until": reader.field("until").finite() });
case "nuke-blind": return ({ "kind": reader.field("kind").literal("nuke-blind"), "actor": readActorId(reader.field("actor"), identity), "until": reader.field("until").finite() });
case "ir": return ({ "kind": reader.field("kind").literal("ir"), "actor": readActorId(reader.field("actor"), identity), "until": reader.field("until").finite() });
case "sphere-camera": return ({ "kind": reader.field("kind").literal("sphere-camera"), "actor": readActorId(reader.field("actor"), identity), "sphere": readEventQ1EventEffectActor(reader.field("sphere"), identity), "origin": readEventVec3(reader.field("origin"), identity), "angles": readEventVec3(reader.field("angles"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2MissionPackPlayerEffect(value: EventQ2MissionPackPlayerEffect): unknown { switch (value.kind) { case "tracker-pain": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "until": value["until"] });
case "nuke-blind": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "until": value["until"] });
case "ir": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "until": value["until"] });
case "sphere-camera": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "sphere": writeEventQ1EventEffectActor(value["sphere"]), "origin": writeEventVec3(value["origin"]), "angles": writeEventVec3(value["angles"]) }); } }

type EventQ2CompositionEventMissionpackEntity = Extract<EventQ2CompositionEvent, { readonly kind: "missionpack-entity" }>;

type EventQ2MissionPackEntityEvent = EventQ2CompositionEventMissionpackEntity["event"];

function readEventQ2MissionPackEntityEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2MissionPackEntityEvent { void identity; switch (reader.field('kind').string()) { case "steam": return ({ "kind": reader.field("kind").literal("steam"), "id": reader.field("id").finite(), "origin": readEventVec3(reader.field("origin"), identity), "direction": readEventVec3(reader.field("direction"), identity), "count": reader.field("count").finite(), "color": reader.field("color").finite(), "speed": reader.field("speed").finite(), "milliseconds": reader.field("milliseconds").finite() });
case "force-wall": return ({ "kind": reader.field("kind").literal("force-wall"), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity), "color": reader.field("color").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2MissionPackEntityEvent(value: EventQ2MissionPackEntityEvent): unknown { switch (value.kind) { case "steam": return ({ "kind": value["kind"], "id": value["id"], "origin": writeEventVec3(value["origin"]), "direction": writeEventVec3(value["direction"]), "count": value["count"], "color": value["color"], "speed": value["speed"], "milliseconds": value["milliseconds"] });
case "force-wall": return ({ "kind": value["kind"], "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]), "color": value["color"] }); } }

function readEventQ2CompositionEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2CompositionEvent { void identity; switch (reader.field('kind').string()) { case "ctf": return ({ "kind": reader.field("kind").literal("ctf"), "event": readEventQ2CtfEvent(reader.field("event"), identity) });
case "lmctf": return ({ "kind": reader.field("kind").literal("lmctf"), "event": readEventLmctfEvent(reader.field("event"), identity) });
case "grapple-prediction": return ({ "kind": reader.field("kind").literal("grapple-prediction"), "actor": readActorId(reader.field("actor"), identity), "suppressed": reader.field("suppressed").boolean() });
case "kick": return ({ "kind": reader.field("kind").literal("kick"), "actor": readActorId(reader.field("actor"), identity) });
case "missionpack-player": return ({ "kind": reader.field("kind").literal("missionpack-player"), "event": readEventQ2MissionPackPlayerEffect(reader.field("event"), identity) });
case "missionpack-entity": return ({ "kind": reader.field("kind").literal("missionpack-entity"), "event": readEventQ2MissionPackEntityEvent(reader.field("event"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2CompositionEvent(value: EventQ2CompositionEvent): unknown { switch (value.kind) { case "ctf": return ({ "kind": value["kind"], "event": writeEventQ2CtfEvent(value["event"]) });
case "lmctf": return ({ "kind": value["kind"], "event": writeEventLmctfEvent(value["event"]) });
case "grapple-prediction": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "suppressed": value["suppressed"] });
case "kick": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]) });
case "missionpack-player": return ({ "kind": value["kind"], "event": writeEventQ2MissionPackPlayerEffect(value["event"]) });
case "missionpack-entity": return ({ "kind": value["kind"], "event": writeEventQ2MissionPackEntityEvent(value["event"]) }); } }

type EventSimulationPresentationEventQ2Rerelease = Extract<EventSimulationPresentationEvent, { readonly kind: "q2-rerelease" }>;

type EventQ2RereleaseEvent = EventSimulationPresentationEventQ2Rerelease["event"];
type EventQ2RereleaseEventDebugShapes = Extract<EventQ2RereleaseEvent, { readonly kind: "debug-shapes" }>;

type EventQ2RereleaseEventDebugShapesLines = EventQ2RereleaseEventDebugShapes["lines"];
type EventDebugLine = EventQ2RereleaseEventDebugShapesLines[number];
type EventVec4 = EventDebugLine["color"];
function readEventVec4(reader: SaveReader, identity: UnifiedIdentityDecoder): EventVec4 { void identity; return { "x": reader.field("x").finite(), "y": reader.field("y").finite(), "z": reader.field("z").finite(), "w": reader.field("w").finite() }; }
function writeEventVec4(value: EventVec4): unknown { return { "x": value["x"], "y": value["y"], "z": value["z"], "w": value["w"] }; }

function readEventDebugLine(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDebugLine { void identity; return { "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity), "color": readEventVec4(reader.field("color"), identity), "depthTest": reader.field("depthTest").boolean() }; }
function writeEventDebugLine(value: EventDebugLine): unknown { return { "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]), "color": writeEventVec4(value["color"]), "depthTest": value["depthTest"] }; }

function readEventQ2RereleaseEventDebugShapesLines(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2RereleaseEventDebugShapesLines { void identity; return boundedList(reader, item => readEventDebugLine(item, identity)); }
function writeEventQ2RereleaseEventDebugShapesLines(value: EventQ2RereleaseEventDebugShapesLines): unknown { return value.map(item => writeEventDebugLine(item)); }

type EventQ2RereleaseEventWorldText = Extract<EventQ2RereleaseEvent, { readonly kind: "world-text" }>;

type EventWorldTextInput = EventQ2RereleaseEventWorldText["text"];
type EventWorldTextInputOrientation = EventWorldTextInput["orientation"];

function readEventWorldTextInputOrientation(reader: SaveReader, identity: UnifiedIdentityDecoder): EventWorldTextInputOrientation { void identity; switch (reader.field('kind').string()) { case "billboard": return ({ "kind": reader.field("kind").literal("billboard") });
case "fixed": return ({ "kind": reader.field("kind").literal("fixed"), "angles": readEventVec3(reader.field("angles"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventWorldTextInputOrientation(value: EventWorldTextInputOrientation): unknown { switch (value.kind) { case "billboard": return ({ "kind": value["kind"] });
case "fixed": return ({ "kind": value["kind"], "angles": writeEventVec3(value["angles"]) }); } }

function readEventWorldTextInput(reader: SaveReader, identity: UnifiedIdentityDecoder): EventWorldTextInput { void identity; return { "text": reader.field("text").string(), "origin": readEventVec3(reader.field("origin"), identity), "color": readEventVec4(reader.field("color"), identity), "cellSize": reader.field("cellSize").finite(), ...(reader.field("distanceCullFactor").value === undefined ? {} : { "distanceCullFactor": reader.field("distanceCullFactor").finite() }), "orientation": readEventWorldTextInputOrientation(reader.field("orientation"), identity), "depthTest": reader.field("depthTest").boolean(), "font": reader.field("font").choice<"classic" | "selected">("classic", "selected") }; }
function writeEventWorldTextInput(value: EventWorldTextInput): unknown { return { "text": value["text"], "origin": writeEventVec3(value["origin"]), "color": writeEventVec4(value["color"]), "cellSize": value["cellSize"], ...(value["distanceCullFactor"] === undefined ? {} : { "distanceCullFactor": value["distanceCullFactor"] }), "orientation": writeEventWorldTextInputOrientation(value["orientation"]), "depthTest": value["depthTest"], "font": value["font"] }; }

type EventQ2RereleaseEventFog = Extract<EventQ2RereleaseEvent, { readonly kind: "fog" }>;
type EventQ2FogState = EventQ2RereleaseEventFog["value"];
type EventQ2Fog = EventQ2FogState["fog"];
function readEventQ2Fog(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2Fog { void identity; return { "density": reader.field("density").finite(), "color": readEventVec3(reader.field("color"), identity), "skyFactor": reader.field("skyFactor").finite() }; }
function writeEventQ2Fog(value: EventQ2Fog): unknown { return { "density": value["density"], "color": writeEventVec3(value["color"]), "skyFactor": value["skyFactor"] }; }

type EventQ2HeightFog = EventQ2FogState["heightFog"];
function readEventQ2HeightFog(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2HeightFog { void identity; return { "startColor": readEventVec3(reader.field("startColor"), identity), "startDistance": reader.field("startDistance").finite(), "endColor": readEventVec3(reader.field("endColor"), identity), "endDistance": reader.field("endDistance").finite(), "falloff": reader.field("falloff").finite(), "density": reader.field("density").finite() }; }
function writeEventQ2HeightFog(value: EventQ2HeightFog): unknown { return { "startColor": writeEventVec3(value["startColor"]), "startDistance": value["startDistance"], "endColor": writeEventVec3(value["endColor"]), "endDistance": value["endDistance"], "falloff": value["falloff"], "density": value["density"] }; }

function readEventQ2FogState(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2FogState { void identity; return { "fog": readEventQ2Fog(reader.field("fog"), identity), "heightFog": readEventQ2HeightFog(reader.field("heightFog"), identity) }; }
function writeEventQ2FogState(value: EventQ2FogState): unknown { return { "fog": writeEventQ2Fog(value["fog"]), "heightFog": writeEventQ2HeightFog(value["heightFog"]) }; }

type EventQ2RereleaseEventEndOfUnit = Extract<EventQ2RereleaseEvent, { readonly kind: "end-of-unit" }>;

type EventQ2RereleaseEventEndOfUnitLevels = EventQ2RereleaseEventEndOfUnit["levels"];
type EventQ2RereleaseLevelEntry = EventQ2RereleaseEventEndOfUnitLevels[number];
function readEventQ2RereleaseLevelEntry(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2RereleaseLevelEntry { void identity; return { "map": reader.field("map").string(), "name": reader.field("name").string(), "visitOrder": reader.field("visitOrder").finite(), "totalSecrets": reader.field("totalSecrets").finite(), "foundSecrets": reader.field("foundSecrets").finite(), "totalMonsters": reader.field("totalMonsters").finite(), "killedMonsters": reader.field("killedMonsters").finite(), "time": reader.field("time").finite() }; }
function writeEventQ2RereleaseLevelEntry(value: EventQ2RereleaseLevelEntry): unknown { return { "map": value["map"], "name": value["name"], "visitOrder": value["visitOrder"], "totalSecrets": value["totalSecrets"], "foundSecrets": value["foundSecrets"], "totalMonsters": value["totalMonsters"], "killedMonsters": value["killedMonsters"], "time": value["time"] }; }

function readEventQ2RereleaseEventEndOfUnitLevels(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2RereleaseEventEndOfUnitLevels { void identity; return boundedList(reader, item => readEventQ2RereleaseLevelEntry(item, identity)); }
function writeEventQ2RereleaseEventEndOfUnitLevels(value: EventQ2RereleaseEventEndOfUnitLevels): unknown { return value.map(item => writeEventQ2RereleaseLevelEntry(item)); }

function readEventQ2RereleaseEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2RereleaseEvent { void identity; switch (reader.field('kind').string()) { case "debug-shapes": return ({ "kind": reader.field("kind").literal("debug-shapes"), "lines": readEventQ2RereleaseEventDebugShapesLines(reader.field("lines"), identity), "lifetimeMilliseconds": reader.field("lifetimeMilliseconds").finite() });
case "world-text": return ({ "kind": reader.field("kind").literal("world-text"), "text": readEventWorldTextInput(reader.field("text"), identity), "lifetime": reader.field("lifetime").finite() });
case "localized-print": return ({ "kind": reader.field("kind").literal("localized-print"), "actor": readEventQ1EventEffectActor(reader.field("actor"), identity), "level": reader.field("level").choice<"low" | "medium" | "high" | "chat">("low", "medium", "high", "chat"), "text": reader.field("text").string(), "args": readEventQ2PresentationEventModelAttachedModels(reader.field("args"), identity) });
case "mission-objective": return ({ "kind": reader.field("kind").literal("mission-objective"), "actor": readActorId(reader.field("actor"), identity), "text": reader.field("text").string(), "args": readEventQ2PresentationEventModelAttachedModels(reader.field("args"), identity), "talkSound": reader.field("talkSound").boolean() });
case "mission-status": return ({ "kind": reader.field("kind").literal("mission-status"), "actor": readActorId(reader.field("actor"), identity), "iconVisible": reader.field("iconVisible").boolean() });
case "screen-blend": return ({ "kind": reader.field("kind").literal("screen-blend"), "actor": readActorId(reader.field("actor"), identity), "blend": readEventVec4(reader.field("blend"), identity) });
case "help-computer": return ({ "kind": reader.field("kind").literal("help-computer"), "actor": readActorId(reader.field("actor"), identity), "visible": reader.field("visible").boolean(), "primary": reader.field("primary").string(), "secondary": reader.field("secondary").string(), "slowTime": reader.field("slowTime").boolean() });
case "fog": return ({ "kind": reader.field("kind").literal("fog"), "actor": readActorId(reader.field("actor"), identity), "value": readEventQ2FogState(reader.field("value"), identity), "transitionMilliseconds": reader.field("transitionMilliseconds").finite() });
case "flashlight": return ({ "kind": reader.field("kind").literal("flashlight"), "actor": readActorId(reader.field("actor"), identity), "enabled": reader.field("enabled").boolean(), "hand": reader.field("hand").choice<"right" | "left" | "center">("right", "left", "center") });
case "poi": return ({ "kind": reader.field("kind").literal("poi"), "actor": readActorId(reader.field("actor"), identity), "position": readEventVec3(reader.field("position"), identity), "image": reader.field("image").string(), "duration": reader.field("duration").finite(), "color": reader.field("color").finite() });
case "remove-poi": return { kind: "remove-poi", actor: readActorId(reader.field("actor"), identity), key: reader.field("key").finite() };
case "keyed-poi": return { kind: "keyed-poi", actor: readActorId(reader.field("actor"), identity), key: reader.field("key").finite(), position: readEventVec3(reader.field("position"), identity), image: reader.field("image").string(), duration: reader.field("duration").finite(), color: reader.field("color").finite(), flags: reader.field("flags").finite() };
case "directional-damage": return { kind: "directional-damage", actor: readActorId(reader.field("actor"), identity), direction: readEventVec3(reader.field("direction"), identity), damage: reader.field("damage").finite(), health: reader.field("health").boolean(), armor: reader.field("armor").boolean(), shield: reader.field("shield").boolean() };
case "help-path": return ({ "kind": reader.field("kind").literal("help-path"), "actor": readActorId(reader.field("actor"), identity), "first": reader.field("first").boolean(), "position": readEventVec3(reader.field("position"), identity), "direction": readEventVec3(reader.field("direction"), identity) });
case "coop-respawn": return ({ "kind": reader.field("kind").literal("coop-respawn"), "actor": readActorId(reader.field("actor"), identity), "state": reader.field("state").choice<"none" | "in-combat" | "bad-area" | "blocked" | "waiting" | "no-lives">("none", "in-combat", "bad-area", "blocked", "waiting", "no-lives"), "lives": reader.field("lives").finite() });
case "autosave": return ({ "kind": reader.field("kind").literal("autosave") });
case "alpha": return readEventQ1AddonEventAlpha(reader, identity);
case "end-of-unit": return ({ "kind": reader.field("kind").literal("end-of-unit"), "levels": readEventQ2RereleaseEventEndOfUnitLevels(reader.field("levels"), identity), "buttonTime": reader.field("buttonTime").finite() });
case "player-dogtag": return ({ "kind": reader.field("kind").literal("player-dogtag"), "actor": readActorId(reader.field("actor"), identity), "value": reader.field("value").string() });
case "dynamic-light": return ({ "kind": reader.field("kind").literal("dynamic-light"), "actor": readActorId(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "radius": reader.field("radius").finite(), "color": readEventVec3(reader.field("color"), identity), "visible": reader.field("visible").boolean() });
case "restart-level": return ({ "kind": reader.field("kind").literal("restart-level"), "map": reader.field("map").string() });
case "story": return ({ "kind": reader.field("kind").literal("story"), "text": reader.field("text").string() });
case "achievement": return ({ "kind": reader.field("kind").literal("achievement"), "id": reader.field("id").string() });
case "sky": return ({ "kind": reader.field("kind").literal("sky"), "name": reader.field("name").string(), "rotation": reader.field("rotation").finite(), "autoRotate": reader.field("autoRotate").boolean(), "axis": readEventVec3(reader.field("axis"), identity) });
case "healthbar": return ({ "kind": reader.field("kind").literal("healthbar"), "actor": readActorId(reader.field("actor"), identity), "slot": reader.field("slot").finite(), "target": readActorId(reader.field("target"), identity), "name": reader.field("name").string(), "fraction": reader.field("fraction").finite(), "visible": reader.field("visible").boolean() });
case "item-visibility": return ({ "kind": reader.field("kind").literal("item-visibility"), "actor": readActorId(reader.field("actor"), identity), "item": readActorId(reader.field("item"), identity), "visible": reader.field("visible").boolean() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2RereleaseEvent(value: EventQ2RereleaseEvent): unknown { switch (value.kind) { case "debug-shapes": return ({ "kind": value["kind"], "lines": writeEventQ2RereleaseEventDebugShapesLines(value["lines"]), "lifetimeMilliseconds": value["lifetimeMilliseconds"] });
case "world-text": return ({ "kind": value["kind"], "text": writeEventWorldTextInput(value["text"]), "lifetime": value["lifetime"] });
case "localized-print": return ({ "kind": value["kind"], "actor": writeEventQ1EventEffectActor(value["actor"]), "level": value["level"], "text": value["text"], "args": writeEventQ2PresentationEventModelAttachedModels(value["args"]) });
case "mission-objective": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "text": value["text"], "args": writeEventQ2PresentationEventModelAttachedModels(value["args"]), "talkSound": value["talkSound"] });
case "mission-status": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "iconVisible": value["iconVisible"] });
case "screen-blend": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "blend": writeEventVec4(value["blend"]) });
case "help-computer": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "visible": value["visible"], "primary": value["primary"], "secondary": value["secondary"], "slowTime": value["slowTime"] });
case "fog": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "value": writeEventQ2FogState(value["value"]), "transitionMilliseconds": value["transitionMilliseconds"] });
case "flashlight": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "enabled": value["enabled"], "hand": value["hand"] });
case "poi": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "position": writeEventVec3(value["position"]), "image": value["image"], "duration": value["duration"], "color": value["color"] });
case "remove-poi": return { ...value, actor: writeActorId(value.actor) };
case "keyed-poi": return { ...value, actor: writeActorId(value.actor), position: writeEventVec3(value.position) };
case "directional-damage": return { ...value, actor: writeActorId(value.actor), direction: writeEventVec3(value.direction) };
case "help-path": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "first": value["first"], "position": writeEventVec3(value["position"]), "direction": writeEventVec3(value["direction"]) });
case "coop-respawn": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "state": value["state"], "lives": value["lives"] });
case "autosave": return ({ "kind": value["kind"] });
case "alpha": return writeEventQ1AddonEventAlpha(value);
case "end-of-unit": return ({ "kind": value["kind"], "levels": writeEventQ2RereleaseEventEndOfUnitLevels(value["levels"]), "buttonTime": value["buttonTime"] });
case "player-dogtag": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "value": value["value"] });
case "dynamic-light": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "origin": writeEventVec3(value["origin"]), "radius": value["radius"], "color": writeEventVec3(value["color"]), "visible": value["visible"] });
case "restart-level": return ({ "kind": value["kind"], "map": value["map"] });
case "story": return ({ "kind": value["kind"], "text": value["text"] });
case "achievement": return ({ "kind": value["kind"], "id": value["id"] });
case "sky": return ({ "kind": value["kind"], "name": value["name"], "rotation": value["rotation"], "autoRotate": value["autoRotate"], "axis": writeEventVec3(value["axis"]) });
case "healthbar": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "slot": value["slot"], "target": writeActorId(value["target"]), "name": value["name"], "fraction": value["fraction"], "visible": value["visible"] });
case "item-visibility": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "item": writeActorId(value["item"]), "visible": value["visible"] }); } }

type EventSimulationPresentationEventQ2Player = Extract<EventSimulationPresentationEvent, { readonly kind: "q2-player" }>;

type EventQ2PlayerEvent = EventSimulationPresentationEventQ2Player["event"];

type EventQ2PlayerEventView = Extract<EventQ2PlayerEvent, { readonly kind: "view" }>;

type EventQ2PlayerView = EventQ2PlayerEventView["view"];
type EventQ2PlayerViewSelectedItem = EventQ2PlayerView["selectedItem"];
function readEventQ2PlayerViewSelectedItem(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerViewSelectedItem { void identity; return reader.value === null ? null : readItemId(reader, identity); }
function writeEventQ2PlayerViewSelectedItem(value: EventQ2PlayerViewSelectedItem): unknown { return value === null ? null : writeItemId(value); }

type EventQ2PlayerViewTimer = EventQ2PlayerView["timer"];
type EventQ2PlayerViewTimerValue = NonNullable<EventQ2PlayerViewTimer>;
function readEventQ2PlayerViewTimerValue(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerViewTimerValue { void identity; return { "item": readItemId(reader.field("item"), identity), "seconds": reader.field("seconds").finite() }; }
function writeEventQ2PlayerViewTimerValue(value: EventQ2PlayerViewTimerValue): unknown { return { "item": writeItemId(value["item"]), "seconds": value["seconds"] }; }

function readEventQ2PlayerViewTimer(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerViewTimer { void identity; return reader.value === null ? null : readEventQ2PlayerViewTimerValue(reader, identity); }
function writeEventQ2PlayerViewTimer(value: EventQ2PlayerViewTimer): unknown { return value === null ? null : writeEventQ2PlayerViewTimerValue(value); }

function readEventQ2PlayerView(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerView { void identity; return { "angles": readEventVec3(reader.field("angles"), identity), "offset": readEventVec3(reader.field("offset"), identity), "kickAngles": readEventVec3(reader.field("kickAngles"), identity), "gunAngles": readEventVec3(reader.field("gunAngles"), identity), "gunOffset": readEventVec3(reader.field("gunOffset"), identity), "blend": readEventVec4(reader.field("blend"), identity), "fov": reader.field("fov").finite(), "underwater": reader.field("underwater").boolean(), "flashes": reader.field("flashes").finite(), "health": reader.field("health").finite(), "armor": reader.field("armor").finite(), "ammo": reader.field("ammo").finite(), "score": reader.field("score").finite(), "selectedItem": readEventQ2PlayerViewSelectedItem(reader.field("selectedItem"), identity), "timer": readEventQ2PlayerViewTimer(reader.field("timer"), identity), "spectator": reader.field("spectator").boolean(), "layouts": reader.field("layouts").finite() }; }
function writeEventQ2PlayerView(value: EventQ2PlayerView): unknown { return { "angles": writeEventVec3(value["angles"]), "offset": writeEventVec3(value["offset"]), "kickAngles": writeEventVec3(value["kickAngles"]), "gunAngles": writeEventVec3(value["gunAngles"]), "gunOffset": writeEventVec3(value["gunOffset"]), "blend": writeEventVec4(value["blend"]), "fov": value["fov"], "underwater": value["underwater"], "flashes": value["flashes"], "health": value["health"], "armor": value["armor"], "ammo": value["ammo"], "score": value["score"], "selectedItem": writeEventQ2PlayerViewSelectedItem(value["selectedItem"]), "timer": writeEventQ2PlayerViewTimer(value["timer"]), "spectator": value["spectator"], "layouts": value["layouts"] }; }

type EventQ2PlayerEventScoreboard = Extract<EventQ2PlayerEvent, { readonly kind: "scoreboard" }>;
type EventQ2PlayerEventScoreboardRows = EventQ2PlayerEventScoreboard["rows"];
type EventQ2ScoreRow = EventQ2PlayerEventScoreboardRows[number];
function readEventQ2ScoreRow(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2ScoreRow { void identity; return { "slot": reader.field("slot").finite(), "name": reader.field("name").string(), "score": reader.field("score").finite(), "ping": reader.field("ping").finite(), "minutes": reader.field("minutes").finite(), "spectator": reader.field("spectator").boolean() }; }
function writeEventQ2ScoreRow(value: EventQ2ScoreRow): unknown { return { "slot": value["slot"], "name": value["name"], "score": value["score"], "ping": value["ping"], "minutes": value["minutes"], "spectator": value["spectator"] }; }

function readEventQ2PlayerEventScoreboardRows(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerEventScoreboardRows { void identity; return boundedList(reader, item => readEventQ2ScoreRow(item, identity)); }
function writeEventQ2PlayerEventScoreboardRows(value: EventQ2PlayerEventScoreboardRows): unknown { return value.map(item => writeEventQ2ScoreRow(item)); }

type EventQ2PlayerEventInventory = Extract<EventQ2PlayerEvent, { readonly kind: "inventory" }>;

type EventQ2PlayerEventInventoryEntries = EventQ2PlayerEventInventory["entries"];
type EventInventoryEntry = EventQ2PlayerEventInventoryEntries[number];
type EventInventoryCountPolicy = Exclude<EventInventoryEntry["countPolicy"], undefined>;

function readEventInventoryCountPolicy(reader: SaveReader, identity: UnifiedIdentityDecoder): EventInventoryCountPolicy { void identity; switch (reader.field('kind').string()) { case "stack": return ({ "kind": reader.field("kind").literal("stack") });
case "source-counter": return ({ "kind": reader.field("kind").literal("source-counter"), "arithmetic": reader.field("arithmetic").choice<"binary32" | "binary64" | "int32">("binary32", "binary64", "int32") }); default: return reader.fail('unknown event variant'); } }
function writeEventInventoryCountPolicy(value: EventInventoryCountPolicy): unknown { switch (value.kind) { case "stack": return ({ "kind": value["kind"] });
case "source-counter": return ({ "kind": value["kind"], "arithmetic": value["arithmetic"] }); } }

function readEventInventoryEntry(reader: SaveReader, identity: UnifiedIdentityDecoder): EventInventoryEntry { void identity; return { "item": readItemId(reader.field("item"), identity), "count": reader.field("count").finite(), "capacity": reader.field("capacity").finite(), ...(reader.field("countPolicy").value === undefined ? {} : { "countPolicy": readEventInventoryCountPolicy(reader.field("countPolicy"), identity) }) }; }
function writeEventInventoryEntry(value: EventInventoryEntry): unknown { return { "item": writeItemId(value["item"]), "count": value["count"], "capacity": value["capacity"], ...(value["countPolicy"] === undefined ? {} : { "countPolicy": writeEventInventoryCountPolicy(value["countPolicy"]) }) }; }

function readEventQ2PlayerEventInventoryEntries(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerEventInventoryEntries { void identity; return boundedList(reader, item => readEventInventoryEntry(item, identity)); }
function writeEventQ2PlayerEventInventoryEntries(value: EventQ2PlayerEventInventoryEntries): unknown { return value.map(item => writeEventInventoryEntry(item)); }

type EventQ2PlayerEventInventoryLabels = Exclude<EventQ2PlayerEventInventory["labels"], undefined>;
type EventQ2PlayerEventInventoryLabelsItem = EventQ2PlayerEventInventoryLabels[number];
function readEventQ2PlayerEventInventoryLabelsItem(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerEventInventoryLabelsItem { void identity; return { "item": readItemId(reader.field("item"), identity), "name": reader.field("name").string() }; }
function writeEventQ2PlayerEventInventoryLabelsItem(value: EventQ2PlayerEventInventoryLabelsItem): unknown { return { "item": writeItemId(value["item"]), "name": value["name"] }; }

function readEventQ2PlayerEventInventoryLabels(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerEventInventoryLabels { void identity; return boundedList(reader, item => readEventQ2PlayerEventInventoryLabelsItem(item, identity)); }
function writeEventQ2PlayerEventInventoryLabels(value: EventQ2PlayerEventInventoryLabels): unknown { return value.map(item => writeEventQ2PlayerEventInventoryLabelsItem(item)); }

function readEventQ2PlayerEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2PlayerEvent { void identity; switch (reader.field('kind').string()) { case "print": return ({ "kind": reader.field("kind").literal("print"), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "level": reader.field("level").choice<"low" | "medium" | "high" | "chat">("low", "medium", "high", "chat"), "text": reader.field("text").string() });
case "userinfo": return ({ "kind": reader.field("kind").literal("userinfo"), "actor": readActorId(reader.field("actor"), identity), "slot": reader.field("slot").finite(), "name": reader.field("name").string(), "skin": reader.field("skin").string() });
case "stufftext": return ({ "kind": reader.field("kind").literal("stufftext"), "actor": readActorId(reader.field("actor"), identity), "text": reader.field("text").string() });
case "view": return ({ "kind": reader.field("kind").literal("view"), "actor": readActorId(reader.field("actor"), identity), "view": readEventQ2PlayerView(reader.field("view"), identity) });
case "scoreboard": return ({ "kind": reader.field("kind").literal("scoreboard"), "actor": readActorId(reader.field("actor"), identity), "rows": readEventQ2PlayerEventScoreboardRows(reader.field("rows"), identity), "killer": readEventQ1EventEffectActor(reader.field("killer"), identity), "reliable": reader.field("reliable").boolean() });
case "inventory": return ({ "kind": reader.field("kind").literal("inventory"), "actor": readActorId(reader.field("actor"), identity), "entries": readEventQ2PlayerEventInventoryEntries(reader.field("entries"), identity), ...(reader.field("visible").value === undefined ? {} : { "visible": reader.field("visible").boolean() }), ...(reader.field("selected").value === undefined ? {} : { "selected": readEventQ2PlayerViewSelectedItem(reader.field("selected"), identity) }), ...(reader.field("labels").value === undefined ? {} : { "labels": readEventQ2PlayerEventInventoryLabels(reader.field("labels"), identity) }) });
case "help": return ({ "kind": reader.field("kind").literal("help"), "actor": readActorId(reader.field("actor"), identity), "visible": reader.field("visible").boolean() });
case "load-menu": return ({ "kind": reader.field("kind").literal("load-menu"), "actor": readActorId(reader.field("actor"), identity) });
case "trail": return ({ "kind": reader.field("kind").literal("trail"), "actor": readActorId(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "time": reader.field("time").finite() });
case "chase": return ({ "kind": reader.field("kind").literal("chase"), "actor": readActorId(reader.field("actor"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventQ2PlayerEvent(value: EventQ2PlayerEvent): unknown { switch (value.kind) { case "print": return ({ "kind": value["kind"], "target": writeEventQ1EventEffectActor(value["target"]), "level": value["level"], "text": value["text"] });
case "userinfo": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "slot": value["slot"], "name": value["name"], "skin": value["skin"] });
case "stufftext": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "text": value["text"] });
case "view": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "view": writeEventQ2PlayerView(value["view"]) });
case "scoreboard": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "rows": writeEventQ2PlayerEventScoreboardRows(value["rows"]), "killer": writeEventQ1EventEffectActor(value["killer"]), "reliable": value["reliable"] });
case "inventory": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "entries": writeEventQ2PlayerEventInventoryEntries(value["entries"]), ...(value["visible"] === undefined ? {} : { "visible": value["visible"] }), ...(value["selected"] === undefined ? {} : { "selected": writeEventQ2PlayerViewSelectedItem(value["selected"]) }), ...(value["labels"] === undefined ? {} : { "labels": writeEventQ2PlayerEventInventoryLabels(value["labels"]) }) });
case "help": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "visible": value["visible"] });
case "load-menu": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]) });
case "trail": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "origin": writeEventVec3(value["origin"]), "time": value["time"] });
case "chase": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "target": writeEventQ1EventEffectActor(value["target"]) }); } }

type EventSimulationPresentationEventQ3Character = Extract<EventSimulationPresentationEvent, { readonly kind: "q3-character" }>;

type EventQ3CharacterPresentationEvent = EventSimulationPresentationEventQ3Character["event"];
function readEventQ3CharacterPresentationEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3CharacterPresentationEvent { void identity; return { "sequence": reader.field("sequence").finite(), "timeMilliseconds": reader.field("timeMilliseconds").finite(), "event": reader.field("event").finite(), "parameter": reader.field("parameter").finite(), "actor": readActorId(reader.field("actor"), identity) }; }
function writeEventQ3CharacterPresentationEvent(value: EventQ3CharacterPresentationEvent): unknown { return { "sequence": value["sequence"], "timeMilliseconds": value["timeMilliseconds"], "event": value["event"], "parameter": value["parameter"], "actor": writeActorId(value["actor"]) }; }

type EventSimulationPresentationEventQ3Ballistics = Extract<EventSimulationPresentationEvent, { readonly kind: "q3-ballistics" }>;

type EventQ3SharedBallisticEvent = EventSimulationPresentationEventQ3Ballistics["event"];

type EventQ3SharedBallisticEventProjectile = Extract<EventQ3SharedBallisticEvent, { readonly kind: "projectile" }>;

type EventTrajectory = EventQ3SharedBallisticEventProjectile["trajectory"];
function readEventTrajectory(reader: SaveReader, identity: UnifiedIdentityDecoder): EventTrajectory { void identity; return { "type": reader.field("type").finite(), "time": reader.field("time").finite(), "duration": reader.field("duration").finite(), "base": readEventVec3(reader.field("base"), identity), "delta": readEventVec3(reader.field("delta"), identity) }; }
function writeEventTrajectory(value: EventTrajectory): unknown { return { "type": value["type"], "time": value["time"], "duration": value["duration"], "base": writeEventVec3(value["base"]), "delta": writeEventVec3(value["delta"]) }; }

type EventQ3SharedBallisticEventContact = Extract<EventQ3SharedBallisticEvent, { readonly kind: "contact" }>;

type EventQ3ContactEvent = EventQ3SharedBallisticEventContact["contact"];

function readEventQ3ContactEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3ContactEvent { void identity; switch (reader.field('kind').string()) { case "hit": return ({ "kind": reader.field("kind").literal("hit"), "point": readEventVec3(reader.field("point"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readActorId(reader.field("target"), identity) });
case "miss": return ({ "kind": reader.field("kind").literal("miss"), "point": readEventVec3(reader.field("point"), identity), "normal": readEventVec3(reader.field("normal"), identity) });
case "lightning-reflection": return ({ "kind": reader.field("kind").literal("lightning-reflection"), "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity) });
case "gauntlet-quad": return ({ "kind": reader.field("kind").literal("gauntlet-quad") }); default: return reader.fail('unknown event variant'); } }
function writeEventQ3ContactEvent(value: EventQ3ContactEvent): unknown { switch (value.kind) { case "hit": return ({ "kind": value["kind"], "point": writeEventVec3(value["point"]), "normal": writeEventVec3(value["normal"]), "target": writeActorId(value["target"]) });
case "miss": return ({ "kind": value["kind"], "point": writeEventVec3(value["point"]), "normal": writeEventVec3(value["normal"]) });
case "lightning-reflection": return ({ "kind": value["kind"], "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]) });
case "gauntlet-quad": return ({ "kind": value["kind"] }); } }

type EventQ3SharedBallisticEventShotgun = Extract<EventQ3SharedBallisticEvent, { readonly kind: "shotgun" }>;

type EventQ3ShotgunEvent = EventQ3SharedBallisticEventShotgun["shot"];
function readEventQ3ShotgunEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3ShotgunEvent { void identity; return { "muzzle": readEventVec3(reader.field("muzzle"), identity), "direction": readEventVec3(reader.field("direction"), identity), "seed": reader.field("seed").finite() }; }
function writeEventQ3ShotgunEvent(value: EventQ3ShotgunEvent): unknown { return { "muzzle": writeEventVec3(value["muzzle"]), "direction": writeEventVec3(value["direction"]), "seed": value["seed"] }; }

type EventQ3SharedBallisticEventRail = Extract<EventQ3SharedBallisticEvent, { readonly kind: "rail" }>;

type EventQ3RailTrail = EventQ3SharedBallisticEventRail["trail"];
type EventQ3RailTrailImpact = EventQ3RailTrail["impact"];
type EventQ3RailTrailImpactNone = Extract<EventQ3RailTrailImpact, { readonly kind: "none" }>;

function readEventQ3RailTrailImpactNone(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3RailTrailImpactNone { void identity; return { "kind": reader.field("kind").literal("none") }; }
function writeEventQ3RailTrailImpactNone(value: EventQ3RailTrailImpactNone): unknown { return { "kind": value["kind"] }; }

function readEventQ3RailTrailImpact(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3RailTrailImpact { void identity; switch (reader.field('kind').string()) { case "none": return readEventQ3RailTrailImpactNone(reader, identity);
case "surface": return ({ "kind": reader.field("kind").literal("surface"), "normal": readEventVec3(reader.field("normal"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventQ3RailTrailImpact(value: EventQ3RailTrailImpact): unknown { switch (value.kind) { case "none": return writeEventQ3RailTrailImpactNone(value);
case "surface": return ({ "kind": value["kind"], "normal": writeEventVec3(value["normal"]) }); } }

function readEventQ3RailTrail(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3RailTrail { void identity; return { "start": readEventVec3(reader.field("start"), identity), "end": readEventVec3(reader.field("end"), identity), "impact": readEventQ3RailTrailImpact(reader.field("impact"), identity) }; }
function writeEventQ3RailTrail(value: EventQ3RailTrail): unknown { return { "start": writeEventVec3(value["start"]), "end": writeEventVec3(value["end"]), "impact": writeEventQ3RailTrailImpact(value["impact"]) }; }

function readEventQ3SharedBallisticEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3SharedBallisticEvent { void identity; switch (reader.field('kind').string()) { case "remove": case "bounce": case "trail": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").choice<"remove" | "bounce" | "trail">("remove", "bounce", "trail"), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "fire": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("fire"), "volume": reader.field("volume").finite(), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "projectile": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("projectile"), "trajectory": readEventTrajectory(reader.field("trajectory"), identity), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "impact": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("impact"), "hitKind": reader.field("hitKind").choice<"wall" | "flesh">("wall", "flesh"), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "contact": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("contact"), "contact": readEventQ3ContactEvent(reader.field("contact"), identity), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "shotgun": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("shotgun"), "shot": readEventQ3ShotgunEvent(reader.field("shot"), identity), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "rail": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("rail"), "trail": readEventQ3RailTrail(reader.field("trail"), identity), "timeMilliseconds": reader.field("timeMilliseconds").finite() });
case "rail-award": return ({ "actor": readActorId(reader.field("actor"), identity), "weapon": reader.field("weapon").finite(), "origin": readEventVec3(reader.field("origin"), identity), "end": readEventVec3(reader.field("end"), identity), "normal": readEventVec3(reader.field("normal"), identity), "target": readEventQ1EventEffectActor(reader.field("target"), identity), "surfaceFlags": reader.field("surfaceFlags").finite(), "kind": reader.field("kind").literal("rail-award"), "count": reader.field("count").finite(), "until": reader.field("until").finite(), "timeMilliseconds": reader.field("timeMilliseconds").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ3SharedBallisticEvent(value: EventQ3SharedBallisticEvent): unknown { switch (value.kind) { case "remove": case "bounce": case "trail": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "timeMilliseconds": value["timeMilliseconds"] });
case "fire": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "volume": value["volume"], "timeMilliseconds": value["timeMilliseconds"] });
case "projectile": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "trajectory": writeEventTrajectory(value["trajectory"]), "timeMilliseconds": value["timeMilliseconds"] });
case "impact": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "hitKind": value["hitKind"], "timeMilliseconds": value["timeMilliseconds"] });
case "contact": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "contact": writeEventQ3ContactEvent(value["contact"]), "timeMilliseconds": value["timeMilliseconds"] });
case "shotgun": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "shot": writeEventQ3ShotgunEvent(value["shot"]), "timeMilliseconds": value["timeMilliseconds"] });
case "rail": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "trail": writeEventQ3RailTrail(value["trail"]), "timeMilliseconds": value["timeMilliseconds"] });
case "rail-award": return ({ "actor": writeActorId(value["actor"]), "weapon": value["weapon"], "origin": writeEventVec3(value["origin"]), "end": writeEventVec3(value["end"]), "normal": writeEventVec3(value["normal"]), "target": writeEventQ1EventEffectActor(value["target"]), "surfaceFlags": value["surfaceFlags"], "kind": value["kind"], "count": value["count"], "until": value["until"], "timeMilliseconds": value["timeMilliseconds"] }); } }

type EventSimulationPresentationEventQ3Source = Extract<EventSimulationPresentationEvent, { readonly kind: "q3-source" }>;

type EventQ3SourceEvent = EventSimulationPresentationEventQ3Source["event"];

function readEventQ3SourceEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ3SourceEvent { void identity; switch (reader.field('kind').string()) { case "print": case "log": return ({ "kind": reader.field("kind").choice<"print" | "log">("print", "log"), "text": reader.field("text").string() });
case "sound": return { kind: "sound", actor: readActorId(reader.field("actor"), identity), origin: readEventVec3(reader.field("origin"), identity), velocity: readEventVec3(reader.field("velocity"), identity), path: reader.field("path").string(), channel: reader.field("channel").integer(0), volume: reader.field("volume").finite(), loop: reader.field("loop").boolean() };
case "server-command": return ({ "kind": reader.field("kind").literal("server-command"), "client": reader.field("client").finite(), "text": reader.field("text").string() });
case "console-command": return ({ "kind": reader.field("kind").literal("console-command"), "execution": reader.field("execution").choice<"append" | "now">("append", "now"), "text": reader.field("text").string() });
case "drop-client": return ({ "kind": reader.field("kind").literal("drop-client"), "client": reader.field("client").finite(), "reason": reader.field("reason").string() });
case "configstring": return ({ "kind": reader.field("kind").literal("configstring"), "index": reader.field("index").finite(), "value": reader.field("value").string() });
case "entity-event": return ({ "kind": reader.field("kind").literal("entity-event"), "actor": readActorId(reader.field("actor"), identity), "state": readEntityState(reader.field("state"), identity), "origin": readEventVec3(reader.field("origin"), identity), "time": reader.field("time").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventQ3SourceEvent(value: EventQ3SourceEvent): unknown { switch (value.kind) { case "print": case "log": return ({ "kind": value["kind"], "text": value["text"] });
case "sound": return { ...value, actor: writeActorId(value.actor), origin: writeEventVec3(value.origin), velocity: writeEventVec3(value.velocity) };
case "server-command": return ({ "kind": value["kind"], "client": value["client"], "text": value["text"] });
case "console-command": return ({ "kind": value["kind"], "execution": value["execution"], "text": value["text"] });
case "drop-client": return ({ "kind": value["kind"], "client": value["client"], "reason": value["reason"] });
case "configstring": return ({ "kind": value["kind"], "index": value["index"], "value": value["value"] });
case "entity-event": return ({ "kind": value["kind"], "actor": writeActorId(value["actor"]), "state": writeEntityState(value["state"]), "origin": writeEventVec3(value["origin"]), "time": value["time"] }); } }

function readQ1ClientMetadata(reader: SaveReader): import('../simulation/types.ts').Q1ClientMetadataEvent {
  const kind = reader.field('kind').choice('name','social','player-info','colors','frags','ping'), slot = sourceClientInteger(reader.field('slot'),0,255);
  if (kind === 'name' || kind === 'social' || kind === 'player-info') return {kind,slot,value:reader.field('value').string()};
  return {kind,slot,value:sourceClientInteger(reader.field('value'),-32768,32767)};
}
function readEventSimulationPresentationEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventSimulationPresentationEvent { void identity; switch (reader.field('kind').string()) { case "q1": return ({ "kind": reader.field("kind").literal("q1"), "event": readEventQ1Event(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q1-fog": return ({ "kind": reader.field("kind").literal("q1-fog"), "event": ({ "kind": reader.field("event").field("kind").literal("transition"), "player": readEventQ1EventEffectActor(reader.field("event").field("player"), identity), "transition": readEventQ1FogTransition(reader.field("event").field("transition"), identity), "skyFactor": reader.field("event").field("skyFactor").finite() }), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q1-sky": return ({ "kind": reader.field("kind").literal("q1-sky"), "event": { kind: reader.field("event").field("kind").literal("skybox"), name: reader.field("event").field("name").string() }, "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q1-client": return ({ "kind": reader.field("kind").literal("q1-client"), "event": readQ1ClientMetadata(reader.field("event")), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q1-session": return ({ "kind": reader.field("kind").literal("q1-session"), "event": { kind: reader.field("event").field("kind").choice("level-completed", "back-to-lobby") }, "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "music": return ({ "kind": reader.field("kind").literal("music"), "event": readMusicEvent(reader.field("event")), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q1-composition": return ({ "kind": reader.field("kind").literal("q1-composition"), "event": readEventQ1CompositionEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q1-level": return ({ "kind": reader.field("kind").literal("q1-level"), "event": readEventQ1IntermissionResult(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q2": return ({ "kind": reader.field("kind").literal("q2"), "event": readEventQ2PresentationEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q2-weapon": return ({ "kind": reader.field("kind").literal("q2-weapon"), "event": readEventQ2WeaponEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "view-reset": return ({ "kind": reader.field("kind").literal("view-reset"), "reason": reader.field("reason").choice<"spawn" | "teleport" | "freeze" | "source">("spawn", "teleport", "freeze", "source"), "actor": readActorId(reader.field("actor"), identity), "angles": readEventVec3(reader.field("angles"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q2-composition": return ({ "kind": reader.field("kind").literal("q2-composition"), "event": readEventQ2CompositionEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q2-rerelease": return ({ "kind": reader.field("kind").literal("q2-rerelease"), "event": readEventQ2RereleaseEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q2-player": return ({ "kind": reader.field("kind").literal("q2-player"), "event": readEventQ2PlayerEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q3-character": return ({ "kind": reader.field("kind").literal("q3-character"), "event": readEventQ3CharacterPresentationEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q3-ballistics": return ({ "kind": reader.field("kind").literal("q3-ballistics"), "event": readEventQ3SharedBallisticEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) });
case "q3-source": return ({ "kind": reader.field("kind").literal("q3-source"), "event": readEventQ3SourceEvent(reader.field("event"), identity), "sequence": reader.field("sequence").finite(), "content": readContentId(reader.field("content"), identity), "seconds": reader.field("seconds").finite(), ...(reader.field("sourceEntity").value === undefined ? {} : { "sourceEntity": readEventSimulationPresentationEventQ1SourceEntity(reader.field("sourceEntity"), identity) }), ...(reader.field("recipient").value === undefined ? {} : { recipient: readActorId(reader.field("recipient"), identity) }) }); default: return reader.fail('unknown event variant'); } }
function writeEventSimulationPresentationEvent(value: EventSimulationPresentationEvent): unknown { switch (value.kind) { case "q1": return ({ "kind": value["kind"], "event": writeEventQ1Event(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q1-fog": return ({ "kind": value["kind"], "event": ({ "kind": value["event"]["kind"], "player": writeEventQ1EventEffectActor(value["event"]["player"]), "transition": writeEventQ1FogTransition(value["event"]["transition"]), "skyFactor": value["event"]["skyFactor"] }), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q1-sky": return ({ "kind": value["kind"], "event": { kind: value.event.kind, name: value.event.name }, "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q1-client": return ({ "kind": value["kind"], "event": { kind: value.event.kind, slot: value.event.slot, value: value.event.value }, "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q1-session": return ({ "kind": value["kind"], "event": { kind: value.event.kind }, "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "music": return ({ "kind": value["kind"], "event": writeMusicEvent(value.event), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q1-composition": return ({ "kind": value["kind"], "event": writeEventQ1CompositionEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q1-level": return ({ "kind": value["kind"], "event": writeEventQ1IntermissionResult(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q2": return ({ "kind": value["kind"], "event": writeEventQ2PresentationEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q2-weapon": return ({ "kind": value["kind"], "event": writeEventQ2WeaponEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "view-reset": return ({ "kind": value["kind"], "reason": value["reason"], "actor": writeActorId(value["actor"]), "angles": writeEventVec3(value["angles"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q2-composition": return ({ "kind": value["kind"], "event": writeEventQ2CompositionEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q2-rerelease": return ({ "kind": value["kind"], "event": writeEventQ2RereleaseEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q2-player": return ({ "kind": value["kind"], "event": writeEventQ2PlayerEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q3-character": return ({ "kind": value["kind"], "event": writeEventQ3CharacterPresentationEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q3-ballistics": return ({ "kind": value["kind"], "event": writeEventQ3SharedBallisticEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) });
case "q3-source": return ({ "kind": value["kind"], "event": writeEventQ3SourceEvent(value["event"]), "sequence": value["sequence"], "content": writeContentId(value["content"]), "seconds": value["seconds"], ...(value["sourceEntity"] === undefined ? {} : { "sourceEntity": writeEventSimulationPresentationEventQ1SourceEntity(value["sourceEntity"]) }), ...(value.recipient === undefined ? {} : { recipient: writeActorId(value.recipient) }) }); } }

type EventSimulationEvent = SimulationEvent;
type EventSourceTime = EventSimulationEvent["time"];

function readEventSourceTime(reader: SaveReader, identity: UnifiedIdentityDecoder): EventSourceTime { void identity; switch (reader.field('kind').string()) { case "seconds": return ({ "kind": reader.field("kind").literal("seconds"), "value": reader.field("value").finite() });
case "milliseconds": return ({ "kind": reader.field("kind").literal("milliseconds"), "value": reader.field("value").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventSourceTime(value: EventSourceTime): unknown { switch (value.kind) { case "seconds": return ({ "kind": value["kind"], "value": value["value"] });
case "milliseconds": return ({ "kind": value["kind"], "value": value["value"] }); } }

type EventEventAudience = EventSimulationEvent["audience"];

function readEventEventAudience(reader: SaveReader, identity: UnifiedIdentityDecoder): EventEventAudience { void identity; switch (reader.field('kind').string()) { case "world": return ({ "kind": reader.field("kind").literal("world") });
case "seat": return ({ "kind": reader.field("kind").literal("seat"), "seat": readSeatId(reader.field("seat"), identity) });
case "client": return ({ "kind": reader.field("kind").literal("client"), "client": readClientId(reader.field("client"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventEventAudience(value: EventEventAudience): unknown { switch (value.kind) { case "world": return ({ "kind": value["kind"] });
case "seat": return ({ "kind": value["kind"], "seat": writeSeatId(value["seat"]) });
case "client": return ({ "kind": value["kind"], "client": writeClientId(value["client"]) }); } }

type EventSimulationEventPayload = EventSimulationEvent["payload"];

type EventSimulationEventPayloadDamage = Extract<EventSimulationEventPayload, { readonly kind: "damage" }>;

type EventDamageOutcome = EventSimulationEventPayloadDamage["outcome"];
type EventDamageOutcomeStaleTarget = Extract<EventDamageOutcome, { readonly kind: "stale-target" }>;

type EventDamageRequest = EventDamageOutcomeStaleTarget["request"];
type EventAttackProvenance = EventDamageRequest["attack"];

type EventAttackProvenanceCause = EventAttackProvenance["cause"];

type EventAttackProvenanceCauseQ2 = Extract<EventAttackProvenanceCause, { readonly kind: "q2" }>;
type EventQ2NativeCause = Exclude<EventAttackProvenanceCauseQ2["native"], undefined>;
type EventQ2NativeCauseClassic = Extract<EventQ2NativeCause, { readonly edition: "classic" }>;

function readEventQ2NativeCauseClassic(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2NativeCauseClassic { void identity; return { "edition": reader.field("edition").literal("classic"), "game": reader.field("game").choice<"base" | "xatrix" | "rogue" | "ctf">("base", "xatrix", "rogue", "ctf"), "value": reader.field("value").finite() }; }
function writeEventQ2NativeCauseClassic(value: EventQ2NativeCauseClassic): unknown { return { "edition": value["edition"], "game": value["game"], "value": value["value"] }; }

type EventQ2NativeCauseRerelease = Extract<EventQ2NativeCause, { readonly edition: "rerelease" }>;

function readEventQ2NativeCauseRerelease(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2NativeCauseRerelease { void identity; return { "edition": reader.field("edition").literal("rerelease"), "id": reader.field("id").finite(), "friendlyFire": reader.field("friendlyFire").boolean(), "noPointLoss": reader.field("noPointLoss").boolean() }; }
function writeEventQ2NativeCauseRerelease(value: EventQ2NativeCauseRerelease): unknown { return { "edition": value["edition"], "id": value["id"], "friendlyFire": value["friendlyFire"], "noPointLoss": value["noPointLoss"] }; }

function readEventQ2NativeCause(reader: SaveReader, identity: UnifiedIdentityDecoder): EventQ2NativeCause { void identity; switch (reader.field('edition').string()) { case "classic": return readEventQ2NativeCauseClassic(reader, identity);
case "rerelease": return readEventQ2NativeCauseRerelease(reader, identity); default: return reader.fail('unknown event variant'); } }
function writeEventQ2NativeCause(value: EventQ2NativeCause): unknown { switch (value.edition) { case "classic": return writeEventQ2NativeCauseClassic(value);
case "rerelease": return writeEventQ2NativeCauseRerelease(value); } }

function readEventAttackProvenanceCause(reader: SaveReader, identity: UnifiedIdentityDecoder): EventAttackProvenanceCause { void identity; switch (reader.field('kind').string()) { case "q1": return ({ "kind": reader.field("kind").literal("q1"), "deathType": reader.field("deathType").string(), ...(reader.field("armorEffect").value === undefined ? {} : { "armorEffect": reader.field("armorEffect").choice<"bypass" | "half-effectiveness">("bypass", "half-effectiveness") }) });
case "q2": return ({ "kind": reader.field("kind").literal("q2"), "meansOfDeath": reader.field("meansOfDeath").finite(), "damageFlags": reader.field("damageFlags").finite(), ...(reader.field("native").value === undefined ? {} : { "native": readEventQ2NativeCause(reader.field("native"), identity) }) });
case "q3": return ({ "kind": reader.field("kind").literal("q3"), "meansOfDeath": reader.field("meansOfDeath").finite(), "damageFlags": reader.field("damageFlags").finite() });
case "environment": return ({ "kind": reader.field("kind").literal("environment"), "hazard": reader.field("hazard").choice<"fall" | "drown" | "lava" | "slime" | "crush" | "trigger">("fall", "drown", "lava", "slime", "crush", "trigger") }); default: return reader.fail('unknown event variant'); } }
function writeEventAttackProvenanceCause(value: EventAttackProvenanceCause): unknown { switch (value.kind) { case "q1": return ({ "kind": value["kind"], "deathType": value["deathType"], ...(value["armorEffect"] === undefined ? {} : { "armorEffect": value["armorEffect"] }) });
case "q2": return ({ "kind": value["kind"], "meansOfDeath": value["meansOfDeath"], "damageFlags": value["damageFlags"], ...(value["native"] === undefined ? {} : { "native": writeEventQ2NativeCause(value["native"]) }) });
case "q3": return ({ "kind": value["kind"], "meansOfDeath": value["meansOfDeath"], "damageFlags": value["damageFlags"] });
case "environment": return ({ "kind": value["kind"], "hazard": value["hazard"] }); } }

function readEventAttackProvenance(reader: SaveReader, identity: UnifiedIdentityDecoder): EventAttackProvenance { void identity; return { "sequence": reader.field("sequence").finite(), "time": readEventSourceTime(reader.field("time"), identity), "attacker": readEventQ1EventEffectActor(reader.field("attacker"), identity), "inflictor": readEventQ1EventEffectActor(reader.field("inflictor"), identity), ...(reader.field("originatingProjectile").value === undefined ? {} : { "originatingProjectile": readActorId(reader.field("originatingProjectile"), identity) }), "weapon": readEventQ2PlayerViewSelectedItem(reader.field("weapon"), identity), "weaponProvider": readProviderId(reader.field("weaponProvider"), identity), "combatProvider": readProviderId(reader.field("combatProvider"), identity), "inventoryProvider": readProviderId(reader.field("inventoryProvider"), identity), "movementProvider": readProviderId(reader.field("movementProvider"), identity), "cause": readEventAttackProvenanceCause(reader.field("cause"), identity) }; }
function writeEventAttackProvenance(value: EventAttackProvenance): unknown { return { "sequence": value["sequence"], "time": writeEventSourceTime(value["time"]), "attacker": writeEventQ1EventEffectActor(value["attacker"]), "inflictor": writeEventQ1EventEffectActor(value["inflictor"]), ...(value["originatingProjectile"] === undefined ? {} : { "originatingProjectile": writeActorId(value["originatingProjectile"]) }), "weapon": writeEventQ2PlayerViewSelectedItem(value["weapon"]), "weaponProvider": writeProviderId(value["weaponProvider"]), "combatProvider": writeProviderId(value["combatProvider"]), "inventoryProvider": writeProviderId(value["inventoryProvider"]), "movementProvider": writeProviderId(value["movementProvider"]), "cause": writeEventAttackProvenanceCause(value["cause"]) }; }

function readEventDamageRequest(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDamageRequest { void identity; return { "attack": readEventAttackProvenance(reader.field("attack"), identity), "target": readActorId(reader.field("target"), identity), "amount": reader.field("amount").finite(), "knockback": reader.field("knockback").finite(), "direction": readEventVec3(reader.field("direction"), identity), "point": readEventVec3(reader.field("point"), identity), "normal": readEventVec3(reader.field("normal"), identity), "delivery": reader.field("delivery").choice<"direct" | "radius">("direct", "radius") }; }
function writeEventDamageRequest(value: EventDamageRequest): unknown { return { "attack": writeEventAttackProvenance(value["attack"]), "target": writeActorId(value["target"]), "amount": value["amount"], "knockback": value["knockback"], "direction": writeEventVec3(value["direction"]), "point": writeEventVec3(value["point"]), "normal": writeEventVec3(value["normal"]), "delivery": value["delivery"] }; }

type EventDamageOutcomeCommitted = Extract<EventDamageOutcome, { readonly kind: "committed" }>;

type EventDamageDecision = EventDamageOutcomeCommitted["decision"];
type EventDamageDecisionMutations = EventDamageDecision["mutations"];
type EventDamageMutation = EventDamageDecisionMutations[number];

type EventDamageMutationArmor = Extract<EventDamageMutation, { readonly kind: "armor" }>;

type EventArmorState = EventDamageMutationArmor["before"];

type EventRegularArmorState = EventArmorState["regular"];
type EventPoweredProtectionState = EventArmorState["powered"];

function readEventPoweredProtectionState(reader: SaveReader, identity: UnifiedIdentityDecoder): EventPoweredProtectionState { void identity; switch (reader.field('kind').string()) { case "none": return readEventQ3RailTrailImpactNone(reader, identity);
case "screen": case "shield": return ({ "kind": reader.field("kind").choice<"screen" | "shield">("screen", "shield"), "cells": reader.field("cells").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventPoweredProtectionState(value: EventPoweredProtectionState): unknown { switch (value.kind) { case "none": return writeEventQ3RailTrailImpactNone(value);
case "screen": case "shield": return ({ "kind": value["kind"], "cells": value["cells"] }); } }

function readEventRegularArmorState(reader: SaveReader, identity: UnifiedIdentityDecoder): EventRegularArmorState { void identity; switch (reader.field('kind').string()) { case "none": return readEventQ3RailTrailImpactNone(reader, identity);
case "q1": return ({ "kind": reader.field("kind").literal("q1"), "points": reader.field("points").finite(), "absorption": reader.field("absorption").finite(), "item": readItemId(reader.field("item"), identity) });
case "q2": return ({ "kind": reader.field("kind").literal("q2"), "points": reader.field("points").finite(), "normalProtection": reader.field("normalProtection").finite(), "energyProtection": reader.field("energyProtection").finite(), "item": readItemId(reader.field("item"), identity) });
case "q3": return ({ "kind": reader.field("kind").literal("q3"), "points": reader.field("points").finite(), "protection": reader.field("protection").finite() }); default: return reader.fail('unknown event variant'); } }
function writeEventRegularArmorState(value: EventRegularArmorState): unknown { switch (value.kind) { case "none": return writeEventQ3RailTrailImpactNone(value);
case "q1": return ({ "kind": value["kind"], "points": value["points"], "absorption": value["absorption"], "item": writeItemId(value["item"]) });
case "q2": return ({ "kind": value["kind"], "points": value["points"], "normalProtection": value["normalProtection"], "energyProtection": value["energyProtection"], "item": writeItemId(value["item"]) });
case "q3": return ({ "kind": value["kind"], "points": value["points"], "protection": value["protection"] }); } }

function readEventArmorState(reader: SaveReader, identity: UnifiedIdentityDecoder): EventArmorState {
  return { regular: readEventRegularArmorState(reader.field("regular"), identity), powered: readEventPoweredProtectionState(reader.field("powered"), identity) };
}
function writeEventArmorState(value: EventArmorState): unknown {
  return { regular: writeEventRegularArmorState(value.regular), powered: writeEventPoweredProtectionState(value.powered) };
}

function readEventDamageMutation(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDamageMutation { void identity; switch (reader.field('kind').string()) { case "health": return ({ "kind": reader.field("kind").literal("health"), "before": reader.field("before").finite(), "after": reader.field("after").finite() });
case "armor": return ({ "kind": reader.field("kind").literal("armor"), "before": readEventArmorState(reader.field("before"), identity), "after": readEventArmorState(reader.field("after"), identity) });
case "source-velocity": return ({ "kind": reader.field("kind").literal("source-velocity"), "before": readEventVec3(reader.field("before"), identity), "after": readEventVec3(reader.field("after"), identity), "movementProvider": readProviderId(reader.field("movementProvider"), identity) });
case "impulse": return ({ "kind": reader.field("kind").literal("impulse"), "impulse": readEventVec3(reader.field("impulse"), identity), "movementProvider": readProviderId(reader.field("movementProvider"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventDamageMutation(value: EventDamageMutation): unknown { switch (value.kind) { case "health": return ({ "kind": value["kind"], "before": value["before"], "after": value["after"] });
case "armor": return ({ "kind": value["kind"], "before": writeEventArmorState(value["before"]), "after": writeEventArmorState(value["after"]) });
case "source-velocity": return ({ "kind": value["kind"], "before": writeEventVec3(value["before"]), "after": writeEventVec3(value["after"]), "movementProvider": writeProviderId(value["movementProvider"]) });
case "impulse": return ({ "kind": value["kind"], "impulse": writeEventVec3(value["impulse"]), "movementProvider": writeProviderId(value["movementProvider"]) }); } }

function readEventDamageDecisionMutations(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDamageDecisionMutations { void identity; return boundedList(reader, item => readEventDamageMutation(item, identity)); }
function writeEventDamageDecisionMutations(value: EventDamageDecisionMutations): unknown { return value.map(item => writeEventDamageMutation(item)); }

type EventDamageDecisionFeedback = Exclude<EventDamageDecision["feedback"], undefined>;

function readEventDamageDecisionFeedback(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDamageDecisionFeedback { void identity; switch (reader.field('kind').string()) { case "q2": return ({ "kind": reader.field("kind").literal("q2"), "powerArmor": reader.field("powerArmor").finite(), "armor": reader.field("armor").finite(), "blood": reader.field("blood").finite(), "knockback": reader.field("knockback").finite() });
case "q3": return ({ "kind": reader.field("kind").literal("q3"), "knockback": reader.field("knockback").finite(), "battlesuit": reader.field("battlesuit").boolean() }); default: return reader.fail('unknown event variant'); } }
function writeEventDamageDecisionFeedback(value: EventDamageDecisionFeedback): unknown { switch (value.kind) { case "q2": return ({ "kind": value["kind"], "powerArmor": value["powerArmor"], "armor": value["armor"], "blood": value["blood"], "knockback": value["knockback"] });
case "q3": return ({ "kind": value["kind"], "knockback": value["knockback"], "battlesuit": value["battlesuit"] }); } }

function readEventDamageDecision(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDamageDecision { void identity; return { "request": readEventDamageRequest(reader.field("request"), identity), "mutations": readEventDamageDecisionMutations(reader.field("mutations"), identity), "appliedDamage": reader.field("appliedDamage").finite(), "reaction": reader.field("reaction").choice<"none" | "pain" | "death">("none", "pain", "death"), ...(reader.field("feedback").value === undefined ? {} : { "feedback": readEventDamageDecisionFeedback(reader.field("feedback"), identity) }) }; }
function writeEventDamageDecision(value: EventDamageDecision): unknown { return { "request": writeEventDamageRequest(value["request"]), "mutations": writeEventDamageDecisionMutations(value["mutations"]), "appliedDamage": value["appliedDamage"], "reaction": value["reaction"], ...(value["feedback"] === undefined ? {} : { "feedback": writeEventDamageDecisionFeedback(value["feedback"]) }) }; }

function readEventDamageOutcome(reader: SaveReader, identity: UnifiedIdentityDecoder): EventDamageOutcome { void identity; switch (reader.field('kind').string()) { case "stale-target": return ({ "kind": reader.field("kind").literal("stale-target"), "request": readEventDamageRequest(reader.field("request"), identity) });
case "committed": return ({ "kind": reader.field("kind").literal("committed"), "decision": readEventDamageDecision(reader.field("decision"), identity), "survived": reader.field("survived").boolean() }); default: return reader.fail('unknown event variant'); } }
function writeEventDamageOutcome(value: EventDamageOutcome): unknown { switch (value.kind) { case "stale-target": return ({ "kind": value["kind"], "request": writeEventDamageRequest(value["request"]) });
case "committed": return ({ "kind": value["kind"], "decision": writeEventDamageDecision(value["decision"]), "survived": value["survived"] }); } }

type EventSimulationEventPayloadTransition = Extract<EventSimulationEventPayload, { readonly kind: "transition" }>;
type EventTransitionDecision = EventSimulationEventPayloadTransition["decision"];
type EventTransitionDecisionStay = Extract<EventTransitionDecision, { readonly kind: "stay" }>;

type EventTransitionDecisionStayBlocked = EventTransitionDecisionStay["blocked"];

function readEventTransitionDecisionStayBlocked(reader: SaveReader, identity: UnifiedIdentityDecoder): EventTransitionDecisionStayBlocked { void identity; return boundedList(reader, item => readObjectiveId(item, identity)); }
function writeEventTransitionDecisionStayBlocked(value: EventTransitionDecisionStayBlocked): unknown { return value.map(item => writeObjectiveId(item)); }

function readEventTransitionDecision(reader: SaveReader, identity: UnifiedIdentityDecoder): EventTransitionDecision { void identity; switch (reader.field('kind').string()) { case "stay": return ({ "kind": reader.field("kind").literal("stay"), "blocked": readEventTransitionDecisionStayBlocked(reader.field("blocked"), identity) });
case "round": return ({ "kind": reader.field("kind").literal("round"), "winner": readEventQ2WeaponEventViewWeaponWeapon(reader.field("winner"), identity) });
case "travel": return ({ "kind": reader.field("kind").literal("travel"), "map": readProviderId(reader.field("map"), identity), "spawnPoint": reader.field("spawnPoint").string(), "completeCampaign": reader.field("completeCampaign").boolean() });
case "campaign-complete": return ({ "kind": reader.field("kind").literal("campaign-complete"), "campaign": readProviderId(reader.field("campaign"), identity) }); default: return reader.fail('unknown event variant'); } }
function writeEventTransitionDecision(value: EventTransitionDecision): unknown { switch (value.kind) { case "stay": return ({ "kind": value["kind"], "blocked": writeEventTransitionDecisionStayBlocked(value["blocked"]) });
case "round": return ({ "kind": value["kind"], "winner": writeEventQ2WeaponEventViewWeaponWeapon(value["winner"]) });
case "travel": return ({ "kind": value["kind"], "map": writeProviderId(value["map"]), "spawnPoint": value["spawnPoint"], "completeCampaign": value["completeCampaign"] });
case "campaign-complete": return ({ "kind": value["kind"], "campaign": writeProviderId(value["campaign"]) }); } }

type EventSimulationEventPayloadMessage = Extract<EventSimulationEventPayload, { readonly kind: "message" }>;
type EventNetworkEvent = EventSimulationEventPayloadMessage["event"];

type EventNetworkEventSound = Extract<EventNetworkEvent, { readonly kind: "sound" }>;
type EventNetworkEventSoundOrigin = EventNetworkEventSound["origin"];
function readEventNetworkEventSoundOrigin(reader: SaveReader, identity: UnifiedIdentityDecoder): EventNetworkEventSoundOrigin { void identity; return reader.value === null ? null : readEventVec3(reader, identity); }
function writeEventNetworkEventSoundOrigin(value: EventNetworkEventSoundOrigin): unknown { return value === null ? null : writeEventVec3(value); }

type EventNetworkEventQ2Inventory = Extract<EventNetworkEvent, { readonly kind: "q2-inventory" }>;

type EventNetworkEventQ2InventoryCounts = EventNetworkEventQ2Inventory["counts"];
function readEventNetworkEventQ2InventoryCounts(reader: SaveReader, identity: UnifiedIdentityDecoder): EventNetworkEventQ2InventoryCounts { void identity; return boundedList(reader, item => item.finite()); }
function writeEventNetworkEventQ2InventoryCounts(value: EventNetworkEventQ2InventoryCounts): unknown { return value.map(item => item); }

function readEventNetworkEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventNetworkEvent { void identity; switch (reader.field('kind').string()) { case "print": return ({ "kind": reader.field("kind").literal("print"), "level": reader.field("level").finite(), "text": reader.field("text").string() });
case "center-print": return ({ "kind": reader.field("kind").literal("center-print"), "text": reader.field("text").string() });
case "command-text": return ({ "kind": reader.field("kind").literal("command-text"), "text": reader.field("text").string() });
case "config-string": return ({ "kind": reader.field("kind").literal("config-string"), "index": reader.field("index").finite(), "value": reader.field("value").string() });
case "sound": return ({ "kind": reader.field("kind").literal("sound"), "entityNumber": reader.field("entityNumber").finite(), "channel": reader.field("channel").finite(), "soundIndex": reader.field("soundIndex").finite(), "origin": readEventNetworkEventSoundOrigin(reader.field("origin"), identity), "volume": reader.field("volume").finite(), "attenuation": reader.field("attenuation").finite(), "delaySeconds": reader.field("delaySeconds").finite() });
case "q1-damage": return ({ "kind": reader.field("kind").literal("q1-damage"), "armor": reader.field("armor").finite(), "blood": reader.field("blood").finite(), "source": readEventVec3(reader.field("source"), identity) });
case "q1-particle": return ({ "kind": reader.field("kind").literal("q1-particle"), "origin": readEventVec3(reader.field("origin"), identity), "direction": readEventVec3(reader.field("direction"), identity), "count": reader.field("count").finite(), "color": reader.field("color").finite() });
case "q2-layout": return ({ "kind": reader.field("kind").literal("q2-layout"), "program": reader.field("program").string() });
case "q2-inventory": return ({ "kind": reader.field("kind").literal("q2-inventory"), "counts": readEventNetworkEventQ2InventoryCounts(reader.field("counts"), identity) });
case "q2-muzzle-flash": return ({ "kind": reader.field("kind").literal("q2-muzzle-flash"), "entityNumber": reader.field("entityNumber").finite(), "flash": reader.field("flash").finite(), "monster": reader.field("monster").boolean() });
case "q3-server-command": return ({ "kind": reader.field("kind").literal("q3-server-command"), "sequence": reader.field("sequence").finite(), "text": reader.field("text").string() });
case "disconnect": return ({ "kind": reader.field("kind").literal("disconnect"), "reason": reader.field("reason").string() }); default: return reader.fail('unknown event variant'); } }
function writeEventNetworkEvent(value: EventNetworkEvent): unknown { switch (value.kind) { case "print": return ({ "kind": value["kind"], "level": value["level"], "text": value["text"] });
case "center-print": return ({ "kind": value["kind"], "text": value["text"] });
case "command-text": return ({ "kind": value["kind"], "text": value["text"] });
case "config-string": return ({ "kind": value["kind"], "index": value["index"], "value": value["value"] });
case "sound": return ({ "kind": value["kind"], "entityNumber": value["entityNumber"], "channel": value["channel"], "soundIndex": value["soundIndex"], "origin": writeEventNetworkEventSoundOrigin(value["origin"]), "volume": value["volume"], "attenuation": value["attenuation"], "delaySeconds": value["delaySeconds"] });
case "q1-damage": return ({ "kind": value["kind"], "armor": value["armor"], "blood": value["blood"], "source": writeEventVec3(value["source"]) });
case "q1-particle": return ({ "kind": value["kind"], "origin": writeEventVec3(value["origin"]), "direction": writeEventVec3(value["direction"]), "count": value["count"], "color": value["color"] });
case "q2-layout": return ({ "kind": value["kind"], "program": value["program"] });
case "q2-inventory": return ({ "kind": value["kind"], "counts": writeEventNetworkEventQ2InventoryCounts(value["counts"]) });
case "q2-muzzle-flash": return ({ "kind": value["kind"], "entityNumber": value["entityNumber"], "flash": value["flash"], "monster": value["monster"] });
case "q3-server-command": return ({ "kind": value["kind"], "sequence": value["sequence"], "text": value["text"] });
case "disconnect": return ({ "kind": value["kind"], "reason": value["reason"] }); } }

function readEventSimulationEventPayload(reader: SaveReader, identity: UnifiedIdentityDecoder): EventSimulationEventPayload { void identity; switch (reader.field('kind').string()) { case "sound": return ({ "kind": reader.field("kind").literal("sound"), "resource": readResourceId(reader.field("resource"), identity), "actor": readEventQ1EventEffectActor(reader.field("actor"), identity), "origin": readEventVec3(reader.field("origin"), identity), "channel": reader.field("channel").finite(), "volume": reader.field("volume").finite(), "attenuation": reader.field("attenuation").finite() });
case "damage": return ({ "kind": reader.field("kind").literal("damage"), "outcome": readEventDamageOutcome(reader.field("outcome"), identity) });
case "transition": return ({ "kind": reader.field("kind").literal("transition"), "decision": readEventTransitionDecision(reader.field("decision"), identity) });
case "message": return ({ "kind": reader.field("kind").literal("message"), "event": readEventNetworkEvent(reader.field("event"), identity), ...(reader.field("sourcePresentationSequence").value === undefined ? {} : { "sourcePresentationSequence": reader.field("sourcePresentationSequence").finite() }) }); default: return reader.fail('unknown event variant'); } }
function writeEventSimulationEventPayload(value: EventSimulationEventPayload): unknown { switch (value.kind) { case "sound": return ({ "kind": value["kind"], "resource": writeResourceId(value["resource"]), "actor": writeEventQ1EventEffectActor(value["actor"]), "origin": writeEventVec3(value["origin"]), "channel": value["channel"], "volume": value["volume"], "attenuation": value["attenuation"] });
case "damage": return ({ "kind": value["kind"], "outcome": writeEventDamageOutcome(value["outcome"]) });
case "transition": return ({ "kind": value["kind"], "decision": writeEventTransitionDecision(value["decision"]) });
case "message": return ({ "kind": value["kind"], "event": writeEventNetworkEvent(value["event"]), ...(value["sourcePresentationSequence"] === undefined ? {} : { "sourcePresentationSequence": value["sourcePresentationSequence"] }) }); } }

function readEventSimulationEvent(reader: SaveReader, identity: UnifiedIdentityDecoder): EventSimulationEvent { void identity; return { "sequence": reader.field("sequence").finite(), "time": readEventSourceTime(reader.field("time"), identity), "audience": readEventEventAudience(reader.field("audience"), identity), "payload": readEventSimulationEventPayload(reader.field("payload"), identity) }; }
function writeEventSimulationEvent(value: EventSimulationEvent): unknown { return { "sequence": value["sequence"], "time": writeEventSourceTime(value["time"]), "audience": writeEventEventAudience(value["audience"]), "payload": writeEventSimulationEventPayload(value["payload"]) }; }

export function writeUnifiedSimulationEvent(event: SimulationEvent): unknown { return writeEventSimulationEvent(event); }
export function readUnifiedSimulationEvent(value: unknown, identity: UnifiedIdentityDecoder): SimulationEvent { return readEventSimulationEvent(new SaveReader(value, 'unified.simulation-event'), identity); }
export function encodeUnifiedPresentationEvents(events: readonly SimulationPresentationEvent[]): Uint8Array {
  if (events.length > 65536) throw new RangeError('Too many unified presentation events');
  const bytes = new TextEncoder().encode(JSON.stringify(events.map(event => writeEventSimulationPresentationEvent(event))));
  if (bytes.length > MAX_EVENT_BYTES) throw new RangeError('Unified presentation events exceed byte limit');
  return bytes;
}
export function decodeUnifiedPresentationEvents(bytes: Uint8Array, identity: UnifiedIdentityDecoder): readonly SimulationPresentationEvent[] {
  if (bytes.length > MAX_EVENT_BYTES) throw new RangeError('Unified presentation events exceed byte limit');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return boundedList(new SaveReader(value, 'unified.presentation-events'), reader => readEventSimulationPresentationEvent(reader, identity));
}

function sourceClientInteger(reader: SaveReader, minimum: number, maximum: number): number {
  const value=reader.integer(minimum);return value>maximum ? reader.fail('source client value out of range') : value;
}
