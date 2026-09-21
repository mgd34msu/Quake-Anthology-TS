// Quake II rerelease API2023 public player presentation. GPL-2.0-or-later.
import type { ProviderReference } from "../../../contracts/content.ts";
import type { Vec4 } from "../../../contracts/math.ts";
import type { Q2RereleasePlayerState, Q2RereleaseUserCommand } from "../../../contracts/protocol.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { Q2WeaponDefinition } from "../../../content/q2/foundation/weapons/types.ts";
import { Q2_BASE_WEAPONS } from "../../../content/q2/foundation/weapons/definitions.ts";
import { readElement } from "../../../network/q2/state.ts";
import { q2ApplicationLayout } from "../network/q2-layout.ts";
import { q2WeaponStatus } from "./arsenal/weapon-status.ts";
import type { PlayerUi, PlayerView } from "./types.ts";

const layout = q2ApplicationLayout({ kind: "q2-rerelease", version: 1038 });

/** Rerelease keeps stance height in pmove, separately from camera bob and damage kick. */
export function rereleaseGuestPlayerView(state: Q2RereleasePlayerState): PlayerView & { readonly damageBlend: Vec4 } {
  const origin = state.movement.origin, offset = state.viewOffset;
  return { origin: { x: Math.fround(origin.x + offset.x), y: Math.fround(origin.y + offset.y), z: Math.fround(origin.z + offset.z) },
    viewHeight: state.movement.viewHeight, angles: state.viewAngles, kickAngles: state.kickAngles,
    fieldOfView: state.fov, blend: state.screenBlend, damageBlend: state.damageBlend };
}

/** Weapon identity comes from the selected provider and public gun-model configstring. */
export function rereleaseGuestPlayerUi(state: Q2RereleasePlayerState, configstrings: ReadonlyMap<number, string>, source: ProviderReference,
  definitions: readonly Q2WeaponDefinition[] = Q2_BASE_WEAPONS): PlayerUi {
  const model = state.gunIndex === 0 ? undefined : configstrings.get(layout.models + state.gunIndex);
  const weapon = model === undefined ? null : definitions.find(definition => definition.viewModel === model) ?? null;
  const armor = readElement(state.stats, 5), ammo = readElement(state.stats, 3);
  return { powerups: [], health: readElement(state.stats, 1),
    armor: { powered: { kind: "none" }, regular: armor === 0 ? { kind: "none" } : { kind: "q2", points: armor, normalProtection: 0, energyProtection: 0,
      item: "q2:remote-armor" } },
    weaponStatus: q2WeaponStatus(weapon, () => ammo, source), arsenalWarning: "none", activeWeapon: weapon?.item ?? null,
    ammo: weapon === null || weapon.ammo === null ? null : { item: weapon.ammo, count: ammo }, inventory: [], items: [] };
}

/** Native rerelease ClientThink adds float delta angles; local input already contains absolute aim. */
export function rereleaseGuestLocalCommand(input: ActorCommand, state: Q2RereleasePlayerState): Q2RereleaseUserCommand {
  if (input.source.kind === "remote-client") throw new Error("Native remote commands must enter ClientThink through their wire endpoint");
  const command = input.command;
  if (command.kind !== "q2-rerelease") throw new Error("An API2023 native player requires rerelease Quake II movement commands");
  const angles = command.angles, delta = state.movement.deltaAngles;
  return { ...command, angles: { x: Math.fround(angles.x - delta.x), y: Math.fround(angles.y - delta.y), z: Math.fround(angles.z - delta.z) } };
}
