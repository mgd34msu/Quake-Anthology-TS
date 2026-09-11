/* Quake II rerelease g_phys.cpp SV_FlyMove. GPL-2.0-or-later.
 * Movement clipping is shared with the existing p_move.cpp implementation. */
import { sameActor } from "../../../contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";
import type { BspPlane, TraceResult } from "../../../contracts/scene.ts";
import { createRereleaseMovement } from "../../../movement/q2/rerelease.ts";
import type { Q2RereleaseMovementContext } from "../../../movement/q2/rerelease.ts";
import { plane } from "../../../movement/q2/types.ts";
import type { CplaneT, KexTouchListT, MovementEntity, TraceT, Vec3 as SourceVector } from "../../../movement/q2/types.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";

export interface Q2RereleaseFlyMoveServices {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  /** The caller supplies its source clipmask and ignored mover. */
  trace(start: Vec3, end: Vec3, bounds: Bounds): TraceResult;
  hitActor(trace: TraceResult): ActorId | null;
  impact(trace: TraceResult): undefined;
  /** Reads and clears only FL_KILL_VELOCITY on the current live source actor. */
  takeKillVelocity(): boolean;
}

const vector = (value: SourceVector): Vec3 => ({ x: value[0], y: value[1], z: value[2] });
const sourceVector = (value: Vec3): SourceVector => [value.x, value.y, value.z];
const sourcePlane = (value: BspPlane): CplaneT => ({ normal: sourceVector(value.normal), dist: value.distance, type: value.type, signbits: value.signbits });
const scenePlane = (value: CplaneT): BspPlane => ({ normal: vector(value.normal), distance: value.dist, type: value.type, signbits: value.signbits });
const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** Creates the source movement routines once per physics owner. Impacts occur
 * after all bumps, in first-contact order, with the final body already visible. */
export function createQ2RereleaseFlyMove(numeric: NumericOperations, context: Q2RereleaseMovementContext): (actor: OwnedActor, elapsed: number, host: Q2RereleaseFlyMoveServices) => undefined {
  const movement = createRereleaseMovement(numeric, context);
  return (actor, elapsed, host) => {
    const body = host.bodies.read(actor.id);
    if (body === null || !host.actors.isLive(actor.id)) return undefined;
    host.bodies.write(actor, { ...body, ground: null });
    const origin = sourceVector(body.origin), velocity = sourceVector(body.velocity);
    const touch: KexTouchListT = { num: 0, traces: [] };
    const entities: MovementEntity[] = [];
    const canonical = (hit: TraceResult["hit"]): MovementEntity | null => {
      if (hit.kind === "none") return null;
      const existing = entities.find(candidate => candidate.kind === "world" && hit.kind === "world" ? candidate.model === hit.model
        : candidate.kind === "actor" && hit.kind === "actor" && sameActor(candidate.actor, hit.actor));
      if (existing !== undefined) return existing;
      entities.push(hit);
      return hit;
    };
    const trace = (start: SourceVector, mins: SourceVector, maxs: SourceVector, end: SourceVector): TraceT => {
      // Generic source movement mutates the entity origin/velocity by reference.
      // Queries observe those writes without changing the last linked bounds.
      const current = host.bodies.read(actor.id);
      if (current !== null) host.bodies.write(actor, { ...current, origin: vector(origin), velocity: vector(velocity) });
      const result = host.trace(vector(start), vector(end), { min: vector(mins), max: vector(maxs) });
      if (result.kind !== "q2") throw new Error("Rerelease sliding requires Q2 trace fields");
      return { allsolid: result.allSolid, startsolid: result.startSolid, fraction: result.fraction, endpos: sourceVector(result.end),
        plane: sourcePlane(result.sourcePlane), surface: result.surface === null ? null : { ...result.surface },
        plane2: result.secondary === null ? plane() : sourcePlane(result.secondary.plane),
        surface2: result.secondary?.surface === null || result.secondary === null ? null : { ...result.secondary.surface },
        contents: result.contents, ent: canonical(result.hit), source: result };
    };
    movement.PM_StepSlideMove_Generic(origin, velocity, numeric.store(elapsed), sourceVector(body.bounds.min), sourceVector(body.bounds.max), touch, false, trace);
    const moved = host.bodies.read(actor.id);
    if (moved === null || !host.actors.isLive(actor.id)) return undefined;
    host.bodies.write(actor, { ...moved, origin: vector(origin), velocity: vector(velocity) });
    for (const contact of touch.traces) {
      if (!host.actors.isLive(actor.id)) return undefined;
      const original = contact.source;
      if (original.kind !== "q2") throw new Error("Rerelease contact lost its source trace");
      const selectedPlane = scenePlane(contact.plane);
      const result: TraceResult = { ...original, sourcePlane: selectedPlane, surface: contact.surface,
        contact: original.contact.kind === "none" ? original.contact : { kind: "plane", plane: selectedPlane } };
      const other = host.hitActor(result);
      if (other === null || !host.actors.isLive(other)) continue;
      const current = host.bodies.read(actor.id);
      if (current === null) return undefined;
      if (selectedPlane.normal.z > numeric.store(0.7)) host.bodies.write(actor, { ...current, ground: other });
      host.impact(result);
      if (!host.actors.isLive(actor.id)) return undefined;
      if (host.takeKillVelocity()) {
        const afterImpact = host.bodies.read(actor.id);
        if (afterImpact === null) return undefined;
        host.bodies.write(actor, { ...afterImpact, velocity: zero });
      }
    }
    return undefined;
  };
}
