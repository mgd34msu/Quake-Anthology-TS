import type { OwnedActor } from "../../../contracts/identity.ts";
import { q3SourceAnimation, q3SourceTorso } from "../../../movement/q3/animation.ts";
import { CommandButtons, MoveFlags, PlayerAnimation, Weapon, WeaponState } from "../../../movement/q3/constants.ts";
import type { Q3HookContext, Q3MovementHooks } from "../../../movement/q3/types.ts";
import { q3WeaponItem, stepQ3Arsenal } from "./arsenal.ts";
import type { Q3ArsenalControls, Q3ArsenalRuntimeState } from "./arsenal.ts";

export interface Q3ArsenalRuntimeAccess {
  read(actor: OwnedActor, execution: "authoritative" | "prediction"): Q3ArsenalRuntimeState;
  write(actor: OwnedActor, execution: "authoritative" | "prediction", state: Q3ArsenalRuntimeState): undefined;
  gauntletHit(context: Q3HookContext): boolean;
}

export function q3SourceArsenalControls(context: Q3HookContext): Q3ArsenalControls {
  return { attack: (context.command.buttons & CommandButtons.ATTACK) !== 0,
    useHoldable: (context.command.buttons & CommandButtons.USE_HOLDABLE) !== 0, requestedWeapon: context.command.weapon };
}

/** Source Q3 locomotion calls these at PM_Firing, PM_Animate, PM_Weapon and PM_TorsoAnimation. */
export function createQ3SourceMovementHooks(runtime: Q3ArsenalRuntimeAccess): Q3MovementHooks {
  return {
    firing(context) {
      const weapon = context.arsenal.state;
      if (weapon.kind !== "q3") throw new TypeError("Q3 source hooks require the selected Q3 arsenal");
      const item = q3WeaponItem(weapon.sourceWeapon);
      return item !== null && (item.ammo === null || (context.arsenal.ammo.find(entry => entry.item === item.ammo)?.count ?? 0) !== 0);
    },
    animation: q3SourceAnimation,
    weapon(context) {
      const previous = runtime.read(context.input.actor, context.input.execution);
      const state = { ...previous, respawned: (context.motion.pmFlags & MoveFlags.RESPAWNED) !== 0,
        useItemHeld: (context.motion.pmFlags & MoveFlags.USE_ITEM_HELD) !== 0, eventSequence: context.motion.eventSequence };
      const result = stepQ3Arsenal({ actor: context.input.actor, command: context.input.command, frame: context.frame,
        arsenal: context.arsenal, animation: context.animation, environment: context.input.environment,
        gauntletHit: runtime.gauntletHit(context) }, state, q3SourceArsenalControls(context));
      runtime.write(context.input.actor, context.input.execution, result.runtime);
      const movementFlags = (context.motion.pmFlags & ~(MoveFlags.RESPAWNED | MoveFlags.USE_ITEM_HELD))
        | (result.runtime.respawned ? MoveFlags.RESPAWNED : 0) | (result.runtime.useItemHeld ? MoveFlags.USE_ITEM_HELD : 0);
      return { arsenal: result.arsenal, animation: result.animation, effects: result.effects, movementFlags };
    },
    torso(context) {
      const weapon = context.arsenal.state;
      if (weapon.kind !== "q3") throw new TypeError("Q3 source torso hooks require a Q3 arsenal");
      if (weapon.state !== WeaponState.WEAPON_READY) return { animation: context.animation, effects: [] };
      return q3SourceTorso(weapon.sourceWeapon === Weapon.WP_GAUNTLET ? PlayerAnimation.TORSO_STAND2 : PlayerAnimation.TORSO_STAND, context, true);
    },
  };
}
