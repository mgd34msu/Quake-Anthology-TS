import type { ArsenalAmmoWarning } from "../../../contracts/ui.ts";
import type { WireUserCommand } from "../../../network/q3/message.ts";

export interface Q3EquipmentPresentation {
  readonly primaryWeapon: number;
  readonly warning: ArsenalAmmoWarning;
}

/** Keep the original predicted held weapon while the selected arsenal owns attack input. */
export function q3EquipmentCommand(command: WireUserCommand, equipment: Q3EquipmentPresentation | null): WireUserCommand {
  return equipment === null ? command : { ...command, weapon: equipment.primaryWeapon, buttons: command.buttons & ~1 };
}
