import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import type { QvmPrimaryWeaponProfile } from "../../../compat/qvm/game-weapons.ts";
import type { Q3GuestWeapon } from "../guest-items.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "./threewave-grapple-profile.ts";

/** Threewave PM_Weapon's attack decision runs after its original cooldown and change traversal. */
export function q3PrimaryWeaponProfile(artifact: QvmModuleOptions["artifact"], weapons: readonly Q3GuestWeapon[]): QvmPrimaryWeaponProfile | null {
  if (artifact.module.digest !== THREEWAVE_GRAPPLE_DIGEST) return null;
  const field = (offset: number) => ({ record: "client", offset });
  return { module: artifact.module, abiProfile: "q3-modern", entityStride: 876, clientStride: 944, clientPointer: 516, maxHealth: 220, persistentMaxHealth: 548,
    equipmentMovement: { move: 35535, slice: 34707, duck: 32561, movementGlobal: 1091860, locomotion: { entry: 35397, join: 35503 }, mins: 180, maxs: 192 },
    availability: { movementType: 4, excluded: [1, 2, 4, 7, 8], health: 184, team: 260, spectatorTeam: 3, flags: 12, respawnFlag: 512 },
    powerups: { quad: 312, haste: 320, flight: 332 },
    torsoAnimation: { entry: 27646, attack: 7, melee: 8 },
    waterLevel: { entityOffset: 788, movementOffset: 208 },
    drop: { entry: 158347, argument: 0, weapon: 192, ammo: 376, region: { entry: 158571, join: 158674 } },
    give: { entry: 139391, argument: 0, weapons: 139524, ammo: 139574, named: { entry: 139936, join: 139947, name: 24, item: 36 } },
    damageFactor: { entry: 217003, result: 1616724, stop: { entry: 217081, join: 217113 } },
    delay: { entry: 34318, join: 34350, inputs: [12], result: 12 },
    delayPlayer: { movementGlobal: 1091860, playerOffset: 0 },
    teleport: { entry: 118339, region: { entry: 118552, join: 118726, inputs: [], result: null },
      objectives: { entry: 118552, join: 118701, inputs: [], result: null }, spawn: 127849, view: 128463 },
    stage: {
      dispatcher: { entry: 33648, actor: { record: "client", pointer: { kind: "global", address: 1091860, indirections: [0], offset: 0 } } },
      predicates: [{ instruction: 34044, unselected: false }],
      settled: [{ field: field(44), mask: null, comparison: "at-most", value: 0 }, { field: field(148), mask: null, comparison: "equals", value: 0 }],
      selection: { field: field(144), values: weapons.map(weapon => ({ value: weapon.weapon, item: weapon.item })) },
      request: { entry: 33226, argument: 0, accepted: [{ field: field(148), mask: null, comparison: "equals", value: 2 }] },
    },
  };
}
