import type { ProviderReference } from "../../../contracts/content.ts";
import type { Q2PlayerState, Q2UserCommand } from "../../../contracts/protocol.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import type { Q2WeaponDefinition } from "../../../content/q2/foundation/weapons/types.ts";
import { Q2_BASE_WEAPONS } from "../../../content/q2/foundation/weapons/definitions.ts";
import { readElement } from "../../../network/q2/state.ts";
import { q2ApplicationLayout } from "../network/q2-layout.ts";
import { q2WeaponStatus } from "./arsenal/weapon-status.ts";
import type { PlayerUi, PlayerView } from "./types.ts";

const layout = q2ApplicationLayout({ kind: "q2-classic", version: 34 });

/** API 3 exposes the same player state as a native client, independently of private gclient fields. */
export function classicGuestPlayerView(state: Q2PlayerState): PlayerView {
  const origin = state.movement.originEighths;
  return {
    origin: { x: origin[0] / 8 + state.viewOffset.x, y: origin[1] / 8 + state.viewOffset.y, z: origin[2] / 8 },
    viewHeight: state.viewOffset.z, angles: state.viewAngles, kickAngles: state.kickAngles, fieldOfView: state.fov, blend: state.blend,
  };
}

/** Only the selected weapon's ammo is public here; full inventory comes from svc_inventory. */
export function classicGuestPlayerUi(state: Q2PlayerState, configstrings: ReadonlyMap<number, string>, source: ProviderReference,
  definitions: readonly Q2WeaponDefinition[] = Q2_BASE_WEAPONS): PlayerUi {
  const model = state.gunIndex === 0 ? undefined : configstrings.get(layout.models + state.gunIndex);
  const weapon = model === undefined ? null : definitions.find(definition => definition.viewModel === model) ?? null;
  const armor = readElement(state.stats, 5), ammo = readElement(state.stats, 3);
  return {
    powerups: [], health: readElement(state.stats, 1),
    armor: { powered: { kind: "none" }, regular: armor === 0 ? { kind: "none" } : { kind: "q2", points: armor, normalProtection: 0, energyProtection: 0,
      item: "q2:remote-armor" } },
    weaponStatus: q2WeaponStatus(weapon, () => ammo, source), arsenalWarning: "none",
    activeWeapon: weapon?.item ?? null,
    ammo: weapon === null || weapon.ammo === null ? null : { item: weapon.ammo, count: ammo },
    inventory: [], items: [],
  };
}

/** Local input contains absolute aim; native ClientThink adds pmove.delta_angles to its command. */
export function classicGuestLocalCommand(input: ActorCommand, state: Q2PlayerState): Q2UserCommand {
  if (input.source.kind === "remote-client") throw new Error("Native remote commands must enter ClientThink through their wire endpoint");
  const command = input.command;
  if (command.kind !== "q2-classic") throw new Error("An API 3 native player requires classic Quake II movement commands");
  const angles = command.angleShorts, delta = state.movement.deltaAngleShorts;
  return { ...command, angleShorts: [(angles[0] - delta[0]) & 65535, (angles[1] - delta[1]) & 65535, (angles[2] - delta[2]) & 65535] };
}
