import type { ClientId } from "../../../contracts/identity.ts";
import type { ClassicOriginalSaveFiles, Q2ClassicVisitedLevel } from "../../../persistence/q2-classic-guest.ts";
import type { ClassicGuestWorld } from "./classic-guest-world.ts";

/** Transferred only after the application commits to retiring the current source world. */
export interface NativeQ2Travel {
  readonly world: ClassicGuestWorld;
  readonly files: ClassicOriginalSaveFiles;
  readonly clients: readonly { readonly client: ClientId; readonly phase: "connected" | "active" }[];
  readonly visited: ReadonlyMap<string, Q2ClassicVisitedLevel>;
  readonly spawnPoint: string;
}
