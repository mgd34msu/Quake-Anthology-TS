import type { SimulationTravel } from "./types.ts";
import type { HandGrenadeTravel } from "./equipment-runtime.ts";
import type { WeaponReference } from "./weapon-slot.ts";
import type { ClientId } from "../../../contracts/identity.ts";
import type { ClassicOriginalSaveFiles, Q2ClassicVisitedLevel } from "../../../persistence/q2-classic-guest.ts";
import type { ClassicGuestWorld } from "./classic-guest-world.ts";
import type { DroppedPickupLevels } from "./dropped-pickups.ts";

/** Transferred only after the application commits to retiring the current source world. */
interface NativeQ2TravelClients {
  readonly droppedPickups?: DroppedPickupLevels;
  readonly clients: readonly { readonly client: ClientId; readonly phase: "connected" | "active"; readonly handGrenades?: HandGrenadeTravel; readonly weaponSlot?: WeaponReference; readonly nativeInventorySelection?: import("../../../contracts/gameplay.ts").ItemId | null; readonly selectedArsenal?: SimulationTravel["players"][number]["selectedArsenal"] }[];
  readonly spawnPoint: string;
}

export interface ClassicNativeQ2Travel extends NativeQ2TravelClients {
  readonly edition: "classic";
  readonly world: ClassicGuestWorld;
  readonly files: ClassicOriginalSaveFiles;
  readonly visited: ReadonlyMap<string, Q2ClassicVisitedLevel>;
}

export interface RereleaseNativeQ2Travel extends NativeQ2TravelClients {
  readonly edition: "rerelease";
  readonly world: import("./rerelease-guest-world.ts").RereleaseGuestWorld;
  readonly visited: ReadonlyMap<string, import("./native-q2-rerelease-save.ts").Q2RereleaseVisitedLevel>;
}
export type NativeQ2Travel = ClassicNativeQ2Travel | RereleaseNativeQ2Travel;
