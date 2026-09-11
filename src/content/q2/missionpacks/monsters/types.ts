import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { Q2MoverModule } from "../../foundation/movers.ts";

export type Q2MonsterMissionPack = "xatrix" | "rogue";

export interface Q2MissionPackMonsterServices {
  readonly movers: Q2MoverModule;
  gravity(): number;
  badArea(actor: ActorId): boolean;
  badAreaEntity(actor: ActorId, origin?: Vec3): Q2Entity | null;
  markTeslaArea(self: Q2Entity, tesla: Q2Entity): boolean;
  powerups(actor: ActorId): { readonly quadUntil: number; readonly doubleUntil: number; readonly invulnerabilityUntil: number };
}

/** Projectile implementations belong to the selected mission pack's weapon provider. */
export interface Q2MissionPackMonsterWeapons {
  fireIonRipper(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number): Q2Entity;
  fireBlueBlaster(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number): Q2Entity;
  fireHeatRocket(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, radius: number, radiusDamage: number, turnFraction?: number): Q2Entity;
  firePlasma(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, radius: number, radiusDamage: number): Q2Entity;
  fireBlaster2(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number): Q2Entity;
  fireTracker(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, enemy: ActorId | null): Q2Entity;
  fireFlechette(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, kick: number): Q2Entity;
  fireHeatBeam(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, offset: Vec3, damage: number, kick: number): undefined;
}
