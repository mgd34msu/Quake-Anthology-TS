import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { Q2MoverModule } from "../../foundation/movers.ts";
import type { Q2Ballistics } from "../../foundation/weapons/ballistics.ts";
import type { Q2MissionPackProjectiles } from "../projectiles/index.ts";

export type Q2MissionPackEntityEvent =
  | { readonly kind: "steam"; readonly id: number; readonly origin: Vec3; readonly direction: Vec3; readonly count: number; readonly color: number; readonly speed: number; readonly milliseconds: number }
  | { readonly kind: "force-wall"; readonly start: Vec3; readonly end: Vec3; readonly color: number };

export interface Q2MissionPackEntityHooks {
  readonly movers: Q2MoverModule;
  readonly weapons: Q2Ballistics;
  readonly projectiles: Pick<Q2MissionPackProjectiles, "spawnBadArea">;
  teleportPlayer(actor: ActorId, origin: Vec3, angles: Vec3): undefined;
  targetAnger(monster: Q2Entity, target: Q2Entity, game: Q2GameServices): undefined;
  emit(event: Q2MissionPackEntityEvent): undefined;
}
