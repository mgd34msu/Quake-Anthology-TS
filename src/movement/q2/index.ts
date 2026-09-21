/* Quake II ClientThink/Pmove and rerelease game/cgame integration.
 * Copyright id Software / ZeniMax. GPL-2.0-or-later. */
import { sameActor, type ProviderId } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { MovementContact, MovementProvider, MovementServices, OrderedMovementEffect, Q2MovementInput, Q2MovementResult, Q2MovementState, Q2RereleaseMovementInput, Q2RereleaseMovementPresentation, Q2RereleaseMovementResult, Q2RereleaseMovementState } from "../../contracts/movement.ts";
import type { BspPlane, Q2SurfaceInfo, TraceResult, TraceShape } from "../../contracts/scene.ts";
import { pmoveClassic } from "./classic.ts";
import { pmoveRerelease } from "./rerelease.ts";
import type { Q2RereleaseMovementContext } from "./rerelease.ts";
import { Q2_PLAYER_BOUNDS } from "./dimensions.ts";
import { createMovementMath } from "./math.ts";
import { MASK_CLASSIC_PLAYERSOLID, plane, type ClassicPmove, type CplaneT, type CsurfaceT, type KexPmoveT, type MovementEntity, type TraceT, type Vec3 as SourceVec3 } from "./types.ts";

export { pmoveClassic } from "./classic.ts";
export { createRereleaseMovement, pmoveRerelease, Q2RereleaseMovementContext } from "./rerelease.ts";
export { Q2_PLAYER_BOUNDS } from "./dimensions.ts";
export { ButtonT, ContentsT, KexPmTypeT, PmflagsT, PmTypeT, WaterLevelT } from "./types.ts";
export type { ClassicPmove, KexPmoveT, PmConfigT, PmTraceFn, TraceT } from "./types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const vector = (source: SourceVec3): Vec3 => ({ x: source[0], y: source[1], z: source[2] });
const sourceVector = (value: Vec3): SourceVec3 => [value.x, value.y, value.z];
const bodyBounds = (shape: TraceShape): Bounds => shape.kind === "point" ? { min: zero, max: zero } : shape.bounds;
const sourcePlane = (value: BspPlane): CplaneT => ({ normal: sourceVector(value.normal), dist: value.distance, type: value.type, signbits: value.signbits });
const sourceSurface = (value: Q2SurfaceInfo | null): CsurfaceT | null => value === null ? null : { ...value };
const scenePlane = (value: CplaneT): BspPlane => ({ normal: vector(value.normal), distance: value.dist, type: value.type, signbits: value.signbits });

function commandDuration(milliseconds: number): void {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 255) throw new RangeError("Quake II usercmd duration must fit its source byte");
}

function traceAdapter(input: Q2MovementInput | Q2RereleaseMovementInput, services: MovementServices) {
  const entities: MovementEntity[] = [];
  const leafContents = input.kind === "q2-classic" ? "stored" : "merged";
  function canonical(hit: TraceResult["hit"]): MovementEntity | null {
    if (hit.kind === "none") return null;
    const prior = entities.find(candidate => candidate.kind === "world" && hit.kind === "world" ? candidate.model === hit.model
      : candidate.kind === "actor" && hit.kind === "actor" && sameActor(candidate.actor, hit.actor));
    if (prior !== undefined) return prior;
    entities.push(hit);
    return hit;
  }
  function trace(start: SourceVec3, mins: SourceVec3, maxs: SourceVec3, end: SourceVec3, mask: number, worldOnly = false): TraceT {
    const shape: TraceShape = input.shape.kind === "point" ? { kind: "point" }
      : { kind: input.shape.kind, bounds: { min: vector(mins), max: vector(maxs) } };
    const result = services.scene.trace({ start: vector(start), end: vector(end), shape,
      target: worldOnly ? { kind: "model", model: 0, origin: zero, angles: zero } : { kind: "world" },
      policy: { kind: "q2", contentsMask: mask, leafContents }, numeric: input.profile.numeric, passActor: input.actor.id });
    if (result.kind !== "q2") throw new Error("SceneQueries must return Q2 trace fields for a Q2 query policy");
    return { allsolid: result.allSolid, startsolid: result.startSolid, fraction: result.fraction, endpos: sourceVector(result.end),
      plane: sourcePlane(result.sourcePlane), plane2: result.secondary === null ? plane() : sourcePlane(result.secondary.plane),
      surface: sourceSurface(result.surface), surface2: result.secondary === null ? null : sourceSurface(result.secondary.surface),
      contents: result.contents, ent: canonical(result.hit), source: result };
  }
  function pointcontents(point: SourceVec3): number {
    const result = services.scene.pointContents({ point: vector(point), target: { kind: "world" },
      policy: { kind: "q2", contentsMask: -1, leafContents }, numeric: input.profile.numeric, passActor: input.actor.id });
    if (result.kind !== "q2") throw new Error("SceneQueries must return Q2 contents for a Q2 query policy");
    return leafContents === "stored" ? result.stored : result.merged;
  }
  return { trace, pointcontents };
}

function contactTrace(trace: TraceT): Extract<TraceResult, { readonly kind: "q2" }> {
  const result = trace.source;
  if (result.kind !== "q2") throw new Error("Q2 movement received a foreign trace representation");
  return { ...result, sourcePlane: scenePlane(trace.plane), surface: trace.surface,
    contact: result.contact.kind === "none" ? result.contact : { kind: "plane", plane: scenePlane(trace.plane) } };
}

function movementContacts(traces: readonly TraceT[]): MovementContact[] {
  const contacts: MovementContact[] = [];
  const touched = new Set<MovementEntity>();
  for (const trace of traces) {
    if (trace.ent === null || touched.has(trace.ent)) continue;
    touched.add(trace.ent);
    contacts.push({ target: trace.ent, trace: contactTrace(trace), substep: 0 });
  }
  return contacts;
}

function touchContacts<T extends Q2MovementState | Q2RereleaseMovementState>(input: Q2MovementInput | Q2RereleaseMovementInput, services: MovementServices, initial: T, contacts: readonly MovementContact[], effects: OrderedMovementEffect[]) {
  let state: Q2MovementState | Q2RereleaseMovementState = initial;
  for (const contact of contacts) {
    if (contact.target.kind === "none") continue;
    effects.push({ substep: 0, sequence: effects.length, time: input.frame.time,
      effect: { kind: "touch", target: contact.target, substep: 0 } });
    const rrTrace = input.kind === "q2-rerelease" && contact.trace.kind === "q2" ? contact.trace : null;
    const continuation = services.touch({ self: input.actor, other: contact.target,
      ...(rrTrace === null ? {} : { sourceTrace: { kind: "q2-rerelease", trace: rrTrace, inverted: true } }),
      plane: rrTrace?.sourcePlane ?? null,
      surface: rrTrace?.surface === null || rrTrace === null ? null : { name: rrTrace.surface.name, nativeFlags: rrTrace.surface.flags, nativeValue: rrTrace.surface.value } }, state);
    if (continuation.kind === "actor-removed") return continuation;
    if (continuation.state.kind !== input.kind) throw new Error("Touch changed Quake II movement family during one source command");
    state = continuation.state;
  }
  return { kind: "continue", state } satisfies { kind: "continue"; state: Q2MovementState | Q2RereleaseMovementState };
}

export function moveQ2Classic(input: Q2MovementInput, services: MovementServices): Q2MovementResult {
  const application = input.execution === "authoritative" ? services.inputApplication : undefined;
  if (application === undefined) return moveQ2ClassicPhysics(input, services);
  let result: Q2MovementResult;
  try {
    const before = application.begin(input.command, { ...input.frame, elapsed: { kind: "milliseconds", value: input.command.milliseconds } }, input.state);
    if (before.kind === "actor-removed") result = { kind: "q2-classic", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects: [] };
    else if (before.state.kind === "q2-classic") result = moveQ2ClassicPhysics({ ...input, state: before.state }, services);
    else throw new Error("Input callback changed Quake II movement family");
  } catch (error) { application.end(input.state, true); throw error; }
  const after = application.end(result.status === "active" ? result.state : input.state);
  if (after.kind === "actor-removed" || result.status === "actor-removed") return { kind: "q2-classic", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects: result.effects };
  if (after.state.kind !== "q2-classic") throw new Error("Input callback changed Quake II movement family");
  return { ...result, state: after.state };
}

function moveQ2ClassicPhysics(input: Q2MovementInput, services: MovementServices): Q2MovementResult {
  commandDuration(input.command.milliseconds);
  const { vec3 } = createMovementMath(services.numeric);
  const scene = traceAdapter(input, services);
  const body = bodyBounds(input.shape);
  const pm: ClassicPmove = {
    s: { pm_type: input.state.type, origin: [...input.state.originEighths], velocity: [...input.state.velocityEighths], pm_flags: input.state.flags,
      pm_time: input.state.timeEightMilliseconds, gravity: input.state.gravity, delta_angles: [...input.state.deltaAngleShorts] },
    cmd: { msec: input.command.milliseconds, angles: [...input.command.angleShorts], forwardmove: input.command.forwardMove, sidemove: input.command.sideMove,
      upmove: input.command.upMove, buttons: input.command.buttons, impulse: input.command.impulse, lightlevel: input.command.lightLevel },
    snapinitial: input.profile.snapInitial, numtouch: 0, touchents: [], touchtraces: [], viewangles: vec3(), viewheight: 0,
    mins: sourceVector(body.min), maxs: sourceVector(body.max), groundentity: null, watertype: 0, waterlevel: 0, characterBounds: body,
    trace: (start, mins, maxs, end) => scene.trace(start, mins, maxs, end, MASK_CLASSIC_PLAYERSOLID), pointcontents: scene.pointcontents,
  };
  pmoveClassic(pm, services.numeric, input.profile.airAccelerate, input.profile.strafejumpHack ?? false, input.environment.flight && input.environment.health > 0);
  const state: Q2MovementState = { kind: "q2-classic", type: pm.s.pm_type, originEighths: [...pm.s.origin], velocityEighths: [...pm.s.velocity],
    flags: pm.s.pm_flags, timeEightMilliseconds: pm.s.pm_time, gravity: pm.s.gravity, deltaAngleShorts: [...pm.s.delta_angles] };
  const contacts = movementContacts(pm.touchtraces.slice(0, pm.numtouch));
  const effects: OrderedMovementEffect[] = [];
  return { status: "active", kind: "q2-classic", actor: input.actor.id, commandSequence: input.commandSequence, state,
    bounds: { min: vector(pm.mins), max: vector(pm.maxs) }, viewAngles: vector(pm.viewangles), viewHeight: pm.viewheight,
    ground: pm.groundentity ?? { kind: "none" }, waterLevel: pm.waterlevel, waterType: pm.watertype,
    horizontalSpeed: services.numeric.squareRoot(services.numeric.add(services.numeric.multiply(pm.s.velocity[0] / 8, pm.s.velocity[0] / 8), services.numeric.multiply(pm.s.velocity[1] / 8, pm.s.velocity[1] / 8))),
    contacts, effects, arsenal: input.arsenal, animation: input.animation };
}

export function moveQ2Rerelease(input: Q2RereleaseMovementInput, services: MovementServices, context: Q2RereleaseMovementContext): Q2RereleaseMovementResult {
  const application = input.execution === "authoritative" ? services.inputApplication : undefined;
  if (application === undefined) return moveQ2RereleasePhysics(input, services, context);
  let result: Q2RereleaseMovementResult;
  try {
    const before = application.begin(input.command, { ...input.frame, elapsed: { kind: "milliseconds", value: input.command.milliseconds } }, input.state);
    if (before.kind === "actor-removed") result = { kind: "q2-rerelease", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects: [] };
    else if (before.state.kind === "q2-rerelease") result = moveQ2RereleasePhysics({ ...input, state: before.state }, services, context);
    else throw new Error("Input callback changed Quake II movement family");
  } catch (error) { application.end(input.state, true); throw error; }
  const after = application.end(result.status === "active" ? result.state : input.state);
  if (after.kind === "actor-removed" || result.status === "actor-removed") return { kind: "q2-rerelease", status: "actor-removed", actor: input.actor.id, commandSequence: input.commandSequence, effects: result.effects };
  if (after.state.kind !== "q2-rerelease") throw new Error("Input callback changed Quake II movement family");
  return { ...result, state: after.state };
}

function moveQ2RereleasePhysics(input: Q2RereleaseMovementInput, services: MovementServices, context: Q2RereleaseMovementContext): Q2RereleaseMovementResult {
  commandDuration(input.command.milliseconds);
  const { vec3 } = createMovementMath(services.numeric);
  const scene = traceAdapter(input, services);
  const body = bodyBounds(input.shape);
  const pm: KexPmoveT = {
    s: { pm_type: input.state.type, origin: sourceVector(input.state.origin), velocity: sourceVector(input.state.velocity), pm_flags: input.state.flags,
      pm_time: input.state.timeMilliseconds, gravity: input.state.gravity, delta_angles: sourceVector(input.state.deltaAngles), viewheight: input.state.viewHeight },
    cmd: { msec: input.command.milliseconds, angles: sourceVector(input.command.angles), forwardmove: input.command.forwardMove, sidemove: input.command.sideMove,
      buttons: input.command.buttons, server_frame: input.command.serverFrame }, snapinitial: input.snapInitial,
    touch: { num: 0, traces: [] }, viewangles: vec3(), mins: sourceVector(body.min), maxs: sourceVector(body.max), characterBounds: body,
    groundentity: null, groundplane: plane(), watertype: 0, waterlevel: 0, player: { kind: "actor", actor: input.actor.id },
    trace: (start, mins, maxs, end, _pass, mask) => scene.trace(start, mins, maxs, end, mask),
    clip: (start, mins, maxs, end, mask) => scene.trace(start, mins, maxs, end, mask, true), pointcontents: scene.pointcontents,
    viewoffset: sourceVector(input.viewOffset), screen_blend: [0, 0, 0, 0], rdflags: 0, jump_sound: false, step_clip: false, impact_delta: 0,
  };
  pmoveRerelease(pm, services.numeric, { airaccel: input.profile.airAccelerate, n64_physics: input.profile.n64Physics }, context, input.environment.flight && input.environment.health > 0);
  const presentation: Q2RereleaseMovementPresentation = { screenBlend: { x: pm.screen_blend[0], y: pm.screen_blend[1], z: pm.screen_blend[2], w: pm.screen_blend[3] },
    renderFlags: pm.rdflags, jumpSound: pm.jump_sound, stepClip: pm.step_clip, impactDelta: pm.impact_delta };
  const state: Q2RereleaseMovementState = { kind: "q2-rerelease", type: pm.s.pm_type, origin: vector(pm.s.origin), velocity: vector(pm.s.velocity),
    flags: pm.s.pm_flags, timeMilliseconds: pm.s.pm_time, gravity: pm.s.gravity, deltaAngles: vector(pm.s.delta_angles), viewHeight: pm.s.viewheight };
  const contacts = movementContacts(pm.touch.traces.slice(0, pm.touch.num));
  const effects: OrderedMovementEffect[] = [];
  return { status: "active", kind: "q2-rerelease", actor: input.actor.id, commandSequence: input.commandSequence, state,
    ...presentation, bounds: { min: vector(pm.mins), max: vector(pm.maxs) }, viewAngles: vector(pm.viewangles), viewHeight: pm.s.viewheight,
    ground: pm.groundentity ?? { kind: "none" }, waterLevel: pm.waterlevel, waterType: pm.watertype,
    horizontalSpeed: services.numeric.squareRoot(services.numeric.add(services.numeric.multiply(pm.s.velocity[0], pm.s.velocity[0]), services.numeric.multiply(pm.s.velocity[1], pm.s.velocity[1]))),
    contacts, effects, arsenal: input.arsenal, animation: input.animation };
}

/** One source usercmd is one movement call. Q2 does not apply QW's recursive splitting. */
export function createQ2ClassicMovementProvider(id: ProviderId): Extract<MovementProvider, { kind: "q2-classic" }> {
  return { id, kind: "q2-classic", move: moveQ2Classic };
}
export function createQ2RereleaseMovementProvider(id: ProviderId, context: Q2RereleaseMovementContext): Extract<MovementProvider, { kind: "q2-rerelease" }> {
  return { id, kind: "q2-rerelease", move: (input, services) => moveQ2Rerelease(input, services, context) };
}

/** Collision body defaults are explicit at recipe assembly, never inferred from a character model. */
export function q2PlayerShape(): TraceShape { return { kind: "box", bounds: Q2_PLAYER_BOUNDS }; }

/** ClientThink calls this after committing/linking the body and running trigger touches.
 * Pass the state returned by triggers; a removed result is returned without callbacks. */
export function applyQ2MovementContacts(input: Q2MovementInput, services: MovementServices, result: Q2MovementResult): Q2MovementResult;
export function applyQ2MovementContacts(input: Q2RereleaseMovementInput, services: MovementServices, result: Q2RereleaseMovementResult): Q2RereleaseMovementResult;
export function applyQ2MovementContacts(input: Q2MovementInput | Q2RereleaseMovementInput, services: MovementServices, result: Q2MovementResult | Q2RereleaseMovementResult): Q2MovementResult | Q2RereleaseMovementResult {
  if (input.kind !== result.kind || !sameActor(input.actor.id, result.actor)) throw new Error("Q2 contact result does not belong to this movement input");
  if (result.status === "actor-removed") return result;
  const effects = [...result.effects];
  const next = touchContacts(input, services, result.state, result.contacts, effects);
  if (next.kind === "actor-removed") return { status: "actor-removed", kind: result.kind, actor: result.actor, commandSequence: result.commandSequence, effects };
  if (result.kind === "q2-classic" && next.state.kind === "q2-classic") return { ...result, state: next.state, effects };
  if (result.kind === "q2-rerelease" && next.state.kind === "q2-rerelease") return { ...result, state: next.state, effects };
  throw new Error("Q2 contacts changed the movement family");
}
