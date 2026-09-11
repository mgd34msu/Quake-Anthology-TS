import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2Ballistics } from "../foundation/weapons/ballistics.ts";
import type { MonsterContext } from "../foundation/monsters/types.ts";

export type Q2MissionPack = "xatrix" | "rogue";

export type Q2MissionPackPlayerEffect =
  | { readonly kind: "tracker-pain"; readonly actor: ActorId; readonly until: number }
  | { readonly kind: "nuke-blind"; readonly actor: ActorId; readonly until: number }
  | { readonly kind: "ir"; readonly actor: ActorId; readonly until: number }
  | { readonly kind: "sphere-camera"; readonly actor: ActorId; readonly sphere: ActorId | null; readonly origin: Vec3; readonly angles: Vec3 };

export interface Q2MissionPackProjectileHooks {
  readonly base: Q2Ballistics;
  readonly strongMines?: boolean;
  readonly gravity?: () => number;
  monster(actor: ActorId): MonsterContext | null;
  playerEffect(effect: Q2MissionPackPlayerEffect): undefined;
}

/** Internal Q2 combat identities; guest APIs translate their edition's raw MOD ordinals separately. */
export const q2MissionPackDamage = {
  ripper: 34, phalanx: 35, brainTentacle: 36, blastoff: 37, gekk: 38, trap: 39,
  chainfist: 40, disintegrator: 41, flechette: 42, blaster2: 43, heatbeam: 44, tesla: 45, prox: 46,
  nuke: 47, vengeanceSphere: 48, hunterSphere: 49, defenderSphere: 50, tracker: 51,
  deathballCrush: 52, doppleExplode: 53, doppleVengeance: 54, doppleHunter: 55,
};
