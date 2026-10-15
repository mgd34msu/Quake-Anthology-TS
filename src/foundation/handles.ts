/*
 * Packed integer actor keys for hot storage and comparison, following the
 * shared C foundation's value handles (include/qa/actors.h, qa_actor_id):
 * identity travels as integers that live in typed arrays and number-keyed
 * maps, instead of frozen class instances compared by method call. Keys are
 * meaningful within one registry/session; authoritative handles remain the
 * contract ActorId objects at API boundaries. GPL-2.0-or-later.
 */

/** The invalid packed actor key, mirroring the C zero-registry handle. */
export const INVALID_ACTOR_KEY = -1;

/** Slot bits in the default packing: 1,048,576 slots, generations to 2^33. */
export const ACTOR_SLOT_BITS = 20;
const SLOT_SPAN = 2 ** ACTOR_SLOT_BITS;

export function packActorKey(slot: number, generation: number): number {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= SLOT_SPAN) throw new RangeError(`Actor slot is outside the packed range: ${slot}`);
  if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError(`Actor generation must be a nonnegative safe integer: ${generation}`);
  const key = generation * SLOT_SPAN + slot;
  if (!Number.isSafeInteger(key)) throw new RangeError("Actor generation exceeds the packed key range");
  return key;
}

export function actorKeySlot(key: number): number {
  if (key === INVALID_ACTOR_KEY) return -1;
  return key % SLOT_SPAN;
}

export function actorKeyGeneration(key: number): number {
  if (key === INVALID_ACTOR_KEY) return -1;
  return Math.floor(key / SLOT_SPAN);
}

/** Packs any slot/generation-shaped identity, e.g. a contract ActorId. */
export function actorKeyOf(id: { readonly slot: number; readonly generation: number }): number {
  return packActorKey(id.slot, id.generation);
}

export function isValidActorKey(key: number): boolean {
  return Number.isSafeInteger(key) && key >= 0;
}
