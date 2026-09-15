import type { ClientMedia } from "./media.ts";

/** CG_RegisterSounds character media, shared by cgame and mixed character playback. */
export const Q3_CHARACTER_SOUNDS = {
  selectSound: "sound/weapons/change.wav", gibSound: "sound/player/gibsplt1.wav",
  teleInSound: "sound/world/telein.wav", teleOutSound: "sound/world/teleout.wav", respawnSound: "sound/items/respawn1.wav",
  landSound: "sound/player/land1.wav", watrInSound: "sound/player/watr_in.wav", watrOutSound: "sound/player/watr_out.wav",
  watrUnSound: "sound/player/watr_un.wav", jumpPadSound: "sound/world/jumppad.wav",
};
export const Q3_FOOTSTEP_PATHS: readonly (readonly [keyof ClientMedia["footsteps"], string])[] = [
  ["normal", "step"], ["boot", "boot"], ["flesh", "flesh"], ["mech", "mech"], ["energy", "energy"], ["splash", "splash"], ["metal", "clank"],
];
