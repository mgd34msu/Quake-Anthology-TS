import type { ActorId, ClientId, SeatId, SessionId } from '../../../contracts/identity.ts';
import type { ResourceId } from '../../../contracts/content.ts';
import type { SimulationOutput } from '../../../contracts/session.ts';
import type { Q3CharacterView } from '../../../content/q3/foundation/presentation.ts';
import type { WorldText } from '../../../text/world.ts';
import type { PlayerUi, PlayerView, SimulationPresentation } from '../simulation/types.ts';
import type { UnifiedPredictionProjection } from './unified-prediction.ts';

/** The retained client resolves each wire reference through its own identity ledger. */
export interface UnifiedIdentityDecoder {
  readonly session: SessionId;
  actor(slot: number, generation: number): ActorId;
  client(slot: number, generation: number): ClientId;
  seat(index: number): SeatId;
  resourceId(id: ResourceId): ResourceId;
}

import type { UnifiedComponentFrames } from "./unified-components.ts";

/** Public state projected for one authenticated player, after audience filtering. */
export interface UnifiedPresentationFrame {
  readonly epoch: number;
  readonly components?: UnifiedComponentFrames;
  readonly acknowledgedInput: number;
  readonly prediction: UnifiedPredictionProjection;
  readonly output: SimulationOutput;
  readonly models: readonly SimulationPresentation[];
  readonly characters: readonly Q3CharacterView[];
  readonly worldText: readonly WorldText[];
  readonly player: {
    readonly actor: ActorId;
    readonly view: PlayerView;
    readonly ui: PlayerUi;
  };
}
