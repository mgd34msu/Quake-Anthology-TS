import type { ClassicGuestWorld } from "./classic-guest-world.ts";
import type { RereleaseGuestWorld } from "./rerelease-guest-world.ts";
import type { PreparedClassicGuest } from "./classic-guest-source.ts";
import type { PreparedRereleaseGuest } from "./rerelease-guest-source.ts";

export type Q2NativeWorld = ClassicGuestWorld | RereleaseGuestWorld;
export type PreparedQ2NativeGuest = PreparedClassicGuest | PreparedRereleaseGuest;
