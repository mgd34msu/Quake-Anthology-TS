import type { Bounds } from "../../../contracts/math.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { GameEntity } from "../base/game/state.ts";
import type { UserCommand } from "../base/shared/player-state.ts";

/** The source command phase supplies PMove policy to the selected movement provider. */
export interface ClientMovementOptions {
  readonly traceMask: number;
  readonly fixedMsec: number | null;
  readonly noFootsteps: boolean;
  readonly gauntletHit: boolean;
  readonly debugLevel: number;
}

export interface ClientMovementResult {
  readonly contacts: readonly ActorId[];
  readonly bounds: Bounds;
  readonly waterlevel: number;
  readonly watertype: number;
  readonly xyspeed: number;
}

export interface ClientMovementHost {
  moveClient(entity: GameEntity, command: UserCommand, options: ClientMovementOptions): ClientMovementResult;
}
