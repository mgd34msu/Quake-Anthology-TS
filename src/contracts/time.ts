import type { ActorId, ProviderId } from "./identity.ts";

export type ClockProfile =
  | { readonly kind: "q1-netquake"; readonly minimumFrameSeconds: number; readonly maximumFrameSeconds: number; readonly fixedFrameSeconds: number | null }
  | { readonly kind: "q1-quakeworld"; readonly maximumCommandMilliseconds: number }
  | { readonly kind: "q2-classic"; readonly frameMilliseconds: 100 }
  | { readonly kind: "q2-rerelease"; readonly frameMilliseconds: number; readonly preparation: "before-frame" }
  | { readonly kind: "q3"; readonly serverFrameMilliseconds: number; readonly fixedMovementMilliseconds: number | null; readonly maximumCommandMilliseconds: 200 };

/** Source clocks retain their units; conversion is explicit at a provider boundary. */
export type SourceTime =
  | { readonly kind: "seconds"; readonly value: number }
  | { readonly kind: "milliseconds"; readonly value: number };

export type FramePhase = "frame-entry" | "client-command" | "entity-prethink" | "entity-physics" | "entity-think" | "client-end-frame" | "frame-exit";

export type FrameOrdering =
  | { readonly kind: "native"; readonly traversal: "source-slot-order"; readonly clock: ClockProfile }
  | { readonly kind: "mixed"; readonly providers: readonly ProviderId[]; readonly entityOrder: "source-slot-order"; readonly ties: "provider-entity-invocation" };

export interface FrameContext {
  readonly frame: number;
  readonly time: SourceTime;
  readonly elapsed: SourceTime;
  readonly phase: FramePhase;
}

export interface InvocationOrder {
  readonly provider: ProviderId;
  readonly actor: ActorId;
  readonly sequence: number;
}

export interface ThinkTiming {
  readonly due: SourceTime;
  readonly boundary: "before-physics" | "during-physics" | "after-physics";
  readonly order: InvocationOrder;
}
