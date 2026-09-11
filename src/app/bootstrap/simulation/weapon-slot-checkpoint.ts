import type { SavedActorId } from "../../../contracts/session.ts";
import type { GrappleWeaponState } from "../../../content/q2/equipment/grapple-weapon.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { namespaced } from "../../../persistence/value.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import type { WeaponReference, WeaponSlotState } from "./weapon-slot.ts";

function readWeaponReference(reader: SaveReader): WeaponReference {
  return { provider: namespaced(reader.field("provider")), item: namespaced(reader.field("item")) };
}

export function readWeaponSlotState(reader: SaveReader): WeaponSlotState {
  const kind = reader.field("kind").choice("primary", "equipment", "holstering-primary", "holstering-equipment");
  switch (kind) {
    case "primary": case "equipment": return { kind };
    case "holstering-primary": case "holstering-equipment": return { kind, next: readWeaponReference(reader.field("next")) };
  }
}

export function readWeaponSlots(reader: SaveReader): readonly { readonly actor: SavedActorId; readonly state: WeaponSlotState }[] {
  return reader.list(entry => ({ actor: readSavedActor(entry.field("actor")), state: readWeaponSlotState(entry.field("state")) }));
}

export function readGrappleWeaponState(reader: SaveReader): GrappleWeaponState {
  const state = reader.field("animation");
  return { handoff: reader.field("handoff").choice("active", "holstering", "holstered"), animation: {
    phase: state.field("phase").choice("activating", "ready", "firing", "dropping"), frame: state.field("frame").integer(0),
    latchedAttack: state.field("latchedAttack").boolean(), sourceFiring: state.field("sourceFiring").boolean(),
    thinkTime: state.field("thinkTime").finite(), fireFinished: state.field("fireFinished").finite(),
    fireBuffered: state.field("fireBuffered").boolean(), lastFiringTime: state.field("lastFiringTime").finite(),
  } };
}
