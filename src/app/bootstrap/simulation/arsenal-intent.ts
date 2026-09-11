import type { ArsenalIntent } from "../../../contracts/gameplay.ts";
import type { ArsenalState, MovementCommand } from "../../../contracts/movement.ts";
import { Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
import type { Q3ArsenalControls } from "../../../content/q3/foundation/arsenal.ts";

/** Native movement fields and explicit selected-arsenal commands meet at this boundary. */
export function resolveQ3ArsenalControls(arsenal: ArsenalState, intent: ArsenalIntent | undefined,
  command: MovementCommand, product: "baseq3" | "missionpack"): Q3ArsenalControls {
  if (arsenal.state.kind !== "q3") throw new Error("Q3 controls require the selected Q3 arsenal");
  let requestedWeapon = command.kind === "q3" ? command.weapon : arsenal.state.sourceWeapon;
  if (intent !== undefined) {
    if (intent.provider !== arsenal.provider) throw new Error("Arsenal command belongs to a different provider");
    requestedWeapon = arsenal.state.sourceWeapon;
    if (intent.weapon !== null) {
      const weapon = Q3_WEAPON_ITEMS.find(value => value.item === intent.weapon);
      if (weapon === undefined || product === "baseq3" && weapon.weapon > 10) throw new Error("Weapon does not belong to the selected Q3 product");
      requestedWeapon = weapon.weapon;
    }
  }
  return { attack: (command.buttons & 1) !== 0,
    useHoldable: intent?.useHoldable ?? (command.kind === "q3" && (command.buttons & 4) !== 0), requestedWeapon };
}
