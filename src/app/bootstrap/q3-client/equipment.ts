import { WeaponState } from "../../../content/q3/base/shared/definitions.ts";
import type { Snapshot } from "../../../network/q3/server-message.ts";
import { PlayerStateRecord } from "../../../network/q3/state/player.ts";

export interface Q3EquipmentPresentation {
  readonly primaryWeapon: number;
}

/** Copies presentation state for cgame; source gameplay and prediction collision stay intact. */
export function q3PresentationSnapshot(snapshot: Snapshot, equipment: Q3EquipmentPresentation | null): Snapshot {
  if (equipment === null) return snapshot;
  const source = snapshot.playerState, player = new PlayerStateRecord(source.product, source.pmType, source.weapon, source.weaponState);
  player.copyFrom(source);
  if (equipment !== null) {
    player.weapon = 0; player.weaponState = WeaponState.WEAPON_READY; player.weaponTime = 0;
    player.ammo.set(0, -1);
  }
  return { ...snapshot, playerState: player };
}
