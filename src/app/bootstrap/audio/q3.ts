import type { LoopSound, PlaySound } from "../../../audio/types.ts";
import type { ActorId, SeatId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";

export type Q3SeatAudioOperation = { readonly kind: "play"; readonly sound: PlaySound }
  | { readonly kind: "loop"; readonly sound: LoopSound }
  | { readonly kind: "position"; readonly actor: ActorId; readonly origin: Vec3 }
  | { readonly kind: "stop-loop"; readonly actor: ActorId }
  | { readonly kind: "clear-loops"; readonly killAll: boolean };
export interface Q3SeatAudioFrame { readonly seat: SeatId; readonly operations: readonly Q3SeatAudioOperation[]; }
