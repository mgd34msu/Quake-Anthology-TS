import type { ContentDigest, ResolvedResourceReference } from "../../contracts/content.ts";
import type { NativePrimaryWeaponProfile } from "./native-primary-weapons.ts";
import type { NativePrimaryPlayerProfile } from "./native-primary-player.ts";
import type { NativePrimaryCommandProfile } from "./native-primary-commands.ts";
import type { NativePrimaryInventoryProfile } from "./native-primary-inventory.ts";
import type { NativePrimaryDropProfile } from "./native-primary-drop.ts";
import type { NativePickupProfile } from "./native-pickups.ts";
import { nativePrimaryWeaponProfile } from "./native-primary-weapon-profile.ts";
import { nativePrimaryPlayerProfile } from "./native-primary-player-profile.ts";
import { nativePrimaryCommandProfile } from "./native-primary-command-profile.ts";
import { nativePrimaryInventoryProfile } from "./native-primary-inventory-profile.ts";
import { nativePrimaryDropProfile } from "./native-primary-drop-profile.ts";
import { classicPickupProfile } from "./classic/pickup-profile.ts";
import { rereleasePickupProfile } from "./rerelease/pickup-profile.ts";
import { classicPrimaryWorldProfile, type ClassicPrimaryWorldProfile } from "./classic/world-profile.ts";
import { rereleasePrimaryWorldProfile, type RereleasePrimaryWorldProfile } from "./rerelease/world-profile.ts";

interface NativePrimaryServices {
  readonly weapons: NativePrimaryWeaponProfile; readonly player: NativePrimaryPlayerProfile;
  readonly commands: NativePrimaryCommandProfile; readonly inventory: NativePrimaryInventoryProfile;
  readonly drop: NativePrimaryDropProfile; readonly pickups: NativePickupProfile;
}
export type NativePrimaryProfile = NativePrimaryServices & (
  | { readonly edition: "classic"; readonly world: ClassicPrimaryWorldProfile }
  | { readonly edition: "rerelease"; readonly world: RereleasePrimaryWorldProfile }
);
export interface NativePrimaryDeclaration<P extends NativePrimaryProfile = NativePrimaryProfile> { readonly declaration: ResolvedResourceReference; readonly profile: P; }
export function builtinNativePrimary(digest: ContentDigest, edition: NativePrimaryProfile["edition"]): NativePrimaryProfile | null {
  const weapons = nativePrimaryWeaponProfile(digest), player = nativePrimaryPlayerProfile(digest), commands = nativePrimaryCommandProfile(digest),
    inventory = nativePrimaryInventoryProfile(digest), drop = nativePrimaryDropProfile(digest), pickups = edition === "classic" ? classicPickupProfile(digest) : rereleasePickupProfile(digest);
  if (weapons === null || player === null || commands === null || inventory === null || drop === null || pickups === null) return null;
  const common = { weapons, player, commands, inventory, drop, pickups };
  if (edition === "classic") { const world = classicPrimaryWorldProfile(digest); return world === null ? null : { ...common, edition, world }; }
  const world = rereleasePrimaryWorldProfile(digest); return world === null ? null : { ...common, edition, world };
}
