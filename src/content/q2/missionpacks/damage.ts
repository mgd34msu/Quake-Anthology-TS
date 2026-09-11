import type { Q2NativeCause } from "../../../contracts/gameplay.ts";

export type Q2NativeCauseProfile =
  | { readonly edition: "classic"; readonly game: "base" | "xatrix" | "rogue" | "ctf" }
  | { readonly edition: "rerelease"; readonly noPointLoss?: boolean };

export const q2CanonicalCause = { grapple: 56, telefragSpawn: 57, blueBlaster: 58 };
const friendlyFire = 0x8000000;

function validClassic(game: "base" | "xatrix" | "rogue" | "ctf", id: number): boolean {
  return id <= 33 || game === "xatrix" && id <= 39 || game === "rogue" && id >= 40 && id <= 55 || game === "ctf" && id === 34;
}

/** Source game modules have different ordinal spaces; unknown guest causes remain unclassified. */
export function canonicalCauseFromNative(native: Q2NativeCause): number | null {
  if (native.edition === "classic") {
    if (!Number.isSafeInteger(native.value) || native.value < 0 || native.value > friendlyFire + 55) return null;
    const friendly = (native.value & friendlyFire) !== 0, id = native.value & ~friendlyFire;
    if (!validClassic(native.game, id)) return null;
    return (native.game === "ctf" && id === 34 ? q2CanonicalCause.grapple : id) + (friendly ? friendlyFire : 0);
  }
  if (!Number.isInteger(native.id) || native.id < 0 || native.id > 58) return null;
  const id = native.id < 22 ? native.id : native.id === 22 ? q2CanonicalCause.telefragSpawn
    : native.id <= 56 ? native.id - 1 : native.id === 57 ? q2CanonicalCause.grapple : q2CanonicalCause.blueBlaster;
  return id + (native.friendlyFire ? friendlyFire : 0);
}

export function nativeCauseFromCanonical(profile: Q2NativeCauseProfile, canonical: number): Q2NativeCause | null {
  if (!Number.isSafeInteger(canonical) || canonical < 0 || canonical > friendlyFire + 58) return null;
  const friendly = (canonical & friendlyFire) !== 0, id = canonical & ~friendlyFire;
  if (profile.edition === "classic") {
    const raw = profile.game === "ctf" && id === q2CanonicalCause.grapple ? 34 : id;
    if (profile.game === "ctf" && id === 34 || !validClassic(profile.game, raw)) return null;
    return { edition: "classic", game: profile.game, value: raw + (friendly ? friendlyFire : 0) };
  }
  if (id > 58) return null;
  const raw = id < 22 ? id : id <= 55 ? id + 1 : id === q2CanonicalCause.grapple ? 57 : id === q2CanonicalCause.telefragSpawn ? 22 : 58;
  return { edition: "rerelease", id: raw, friendlyFire: friendly, noPointLoss: profile.noPointLoss ?? false };
}
