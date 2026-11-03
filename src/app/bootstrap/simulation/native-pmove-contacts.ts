import type { ActorId } from "../../../contracts/identity.ts";
import type { Bounds, Plane, Vec3 } from "../../../contracts/math.ts";

/** One contact the selected movement provider reported during a native Pmove slice. */
export interface NativeSliceContact {
  /** The actor that was hit; null for static world geometry. */
  readonly actor: ActorId | null;
  readonly plane: Plane | null;
}

/** A pmove_t touch entry: the guest edict slot and the plane it was hit on. */
export interface NativePmoveTouch { readonly slot: number; readonly plane: Plane; }

/** Quake's walkable-slope threshold (cos of the steepest standable plane). */
export const WALKABLE_NORMAL_Z = 0.7;

/** The most recent reported contact that a player could stand on. */
export function reportedGroundPlane(contacts: readonly NativeSliceContact[]): Plane | null {
  for (let index = contacts.length - 1; index >= 0; index--) {
    const plane = contacts[index]?.plane;
    if (plane !== null && plane !== undefined && plane.normal.z >= WALKABLE_NORMAL_Z) return plane;
  }
  return null;
}

/**
 * Plane of the face of `other` that a player at `origin` with `bounds` is
 * pressed against, from the axis of least penetration. Brush entities trace
 * as world hits, so the sweep cannot name them; they are recovered by
 * overlap and this derives the normal that overlap implies.
 */
export function overlapPlane(origin: Vec3, bounds: Bounds, other: Bounds): Plane {
  const min = { x: origin.x + bounds.min.x, y: origin.y + bounds.min.y, z: origin.z + bounds.min.z };
  const max = { x: origin.x + bounds.max.x, y: origin.y + bounds.max.y, z: origin.z + bounds.max.z };
  const candidates: { readonly depth: number; readonly normal: Vec3; readonly distance: number }[] = [
    { depth: Math.abs(min.x - other.max.x), normal: { x: 1, y: 0, z: 0 }, distance: other.max.x },
    { depth: Math.abs(max.x - other.min.x), normal: { x: -1, y: 0, z: 0 }, distance: -other.min.x },
    { depth: Math.abs(min.y - other.max.y), normal: { x: 0, y: 1, z: 0 }, distance: other.max.y },
    { depth: Math.abs(max.y - other.min.y), normal: { x: 0, y: -1, z: 0 }, distance: -other.min.y },
    { depth: Math.abs(min.z - other.max.z), normal: { x: 0, y: 0, z: 1 }, distance: other.max.z },
    { depth: Math.abs(max.z - other.min.z), normal: { x: 0, y: 0, z: -1 }, distance: -other.min.z },
  ];
  let best = candidates[0];
  for (const candidate of candidates) if (best === undefined || candidate.depth < best.depth) best = candidate;
  if (best === undefined) throw new Error("No contact plane candidates");
  return { normal: best.normal, distance: best.distance };
}

/**
 * Builds the Pmove touch list. Provider-reported actor contacts come first
 * with their real planes, in report order and without repeats (as
 * ClientThink de-duplicates); solids the player ended against that the
 * sweep did not name follow with overlap-derived planes. Actors without a
 * guest slot cannot be named in the struct and are dropped.
 */
export function pmoveTouchList(reported: readonly NativeSliceContact[], overlapped: readonly { readonly actor: ActorId; readonly plane: Plane }[],
  slotOf: (actor: ActorId) => number | undefined): readonly NativePmoveTouch[] {
  const seen = new Set<number>(), touches: NativePmoveTouch[] = [];
  const add = (actor: ActorId, plane: Plane): void => {
    const slot = slotOf(actor);
    if (slot === undefined || seen.has(slot)) return;
    seen.add(slot); touches.push({ slot, plane });
  };
  for (const contact of reported) if (contact.actor !== null && contact.plane !== null) add(contact.actor, contact.plane);
  for (const contact of overlapped) add(contact.actor, contact.plane);
  return touches;
}
