import type { SavedActorId } from "../../../contracts/session.ts";
import type { GrappleWeaponState } from "../../../content/q2/equipment/grapple-weapon.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { namespaced } from "../../../persistence/value.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import type { WeaponReference, WeaponSlotRestoreState } from "./weapon-slot.ts";

function readWeaponReference(reader: SaveReader): WeaponReference {
  return { provider: namespaced(reader.field("provider")), item: namespaced(reader.field("item")) };
}

export function readWeaponSlotState(reader: SaveReader): WeaponSlotRestoreState {
  const kind = reader.field("kind").choice("active", "switching", "activating", "primary", "equipment", "holstering-primary", "holstering-equipment");
  switch (kind) {
    case "active": return { kind, provider: namespaced(reader.field("provider")) };
    case "switching": return { kind, from: namespaced(reader.field("from")), next: readWeaponReference(reader.field("next")) };
    case "activating": return { kind, from: namespaced(reader.field("from")), next: readWeaponReference(reader.field("next")), request: reader.field("request").integer(1) };
    case "primary": case "equipment": return { kind };
    case "holstering-primary": case "holstering-equipment": return { kind, next: readWeaponReference(reader.field("next")) };
  }
}

export function readWeaponSlots(reader: SaveReader): readonly { readonly actor: SavedActorId; readonly state: WeaponSlotRestoreState }[] {
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
