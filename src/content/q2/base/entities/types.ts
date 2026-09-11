import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { Q2MoverModule } from "../../foundation/movers.ts";
import type { MonsterContext } from "../../foundation/monsters/types.ts";
import type { Q2Ballistics } from "../../foundation/weapons/ballistics.ts";

/** Integrations owned by the existing movement, player, monster and presentation providers. */
export interface Q2BaseEntityHooks {
  readonly movers: Q2MoverModule;
  readonly weapons: Pick<Q2Ballistics, "fireBlaster" | "fireRocket">;
  teleportPlayer(player: ActorId, origin: Vec3, angles: Vec3): undefined;
  playerPush(player: ActorId, velocity: Vec3): undefined;
  setActorGravity(actor: ActorId, gravity: number): undefined;
  localTime(): { readonly hour: number; readonly minute: number; readonly second: number };
  /** Admits the turret driver's infantry state to the permanent monster runner. */
  turretDriver(entity: Q2Entity, game: Q2GameServices): MonsterContext;
  /** Looks up an already restored monster; must not admit or spawn one. */
  monsterContext(actor: ActorId): MonsterContext | null;
  resumeMonster(entity: Q2Entity, game: Q2GameServices): undefined;
}
