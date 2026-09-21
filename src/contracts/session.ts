import type { ExecutableRecipe, ResourceId } from "./content.ts";
import type { GuestCheckpoint } from "./execution.ts";
import type { ArsenalIntent, CombatState, DamageOutcome, InventoryEntry, TransitionDecision } from "./gameplay.ts";
import type { ActorId, CallbackId, ClientId, ProviderId, SeatId, SessionId } from "./identity.ts";
import type { Vec3 } from "./math.ts";
import type { RandomState } from "./numeric.ts";
import type { NetworkEvent, UserCommand } from "./protocol.ts";
import type { RendererBackend, RenderFrame } from "./render.ts";
import type { SceneSnapshot } from "./scene.ts";
import type { FrameContext, SourceTime, ThinkTiming } from "./time.ts";
import type { SeatPresentationBinding, SeatUiState } from "./ui.ts";
import type { ActorObservation, BodyAttachment, BodyState } from "./world.ts";

/** Each actor can replace these recipe defaults independently. */
export interface ActorConfiguration extends Pick<ExecutableRecipe, "movement" | "character" | "weapons" | "inventory"> {
  readonly actor: ActorId;
}

export type CommandSource =
  | { readonly kind: "local-seat"; readonly seat: SeatId; readonly client: ClientId }
  | { readonly kind: "remote-client"; readonly client: ClientId }
  | { readonly kind: "bot"; readonly provider: ProviderId };

export interface ActorCommand {
  readonly actor: ActorId;
  readonly source: CommandSource;
  readonly sequence: number;
  readonly command: UserCommand;
  /** Explicit unified aim; absent commands retain their native source convention. */
  readonly angleSpace?: "absolute" | "source-relative";
  /** Absent for native clients whose source command already carries these actions. */
  readonly arsenal?: ArsenalIntent;
}

export interface InputBatch {
  /** Host elapsed time; the simulation advances its own source clocks and frame phases. */
  readonly elapsedMilliseconds: number;
  readonly commands: readonly ActorCommand[];
}

export type EventAudience =
  | { readonly kind: "world" }
  | { readonly kind: "seat"; readonly seat: SeatId }
  | { readonly kind: "client"; readonly client: ClientId };

export type SimulationEventPayload =
  | { readonly kind: "sound"; readonly resource: ResourceId; readonly actor: ActorId | null; readonly origin: Vec3; readonly channel: number; readonly volume: number; readonly attenuation: number }
  | { readonly kind: "damage"; readonly outcome: DamageOutcome }
  | { readonly kind: "transition"; readonly decision: TransitionDecision }
  | { readonly kind: "message"; readonly event: NetworkEvent; readonly sourcePresentationSequence?: number };

export interface SimulationEvent {
  readonly sequence: number;
  readonly time: SourceTime;
  readonly audience: EventAudience;
  readonly payload: SimulationEventPayload;
}

export interface BodySnapshot { readonly actor: ActorId; readonly body: BodyState; }
export interface InventorySnapshot { readonly actor: ActorId; readonly entries: readonly InventoryEntry[]; }

export interface WorldSnapshot {
  readonly session: SessionId;
  readonly frame: FrameContext;
  readonly actors: readonly ActorObservation[];
  readonly bodies: readonly BodySnapshot[];
  readonly inventories: readonly InventorySnapshot[];
  readonly configurations: readonly ActorConfiguration[];
  readonly scene: SceneSnapshot;
}

export interface SimulationOutput {
  readonly snapshot: WorldSnapshot;
  readonly events: readonly SimulationEvent[];
}

/** Serialized references are resolved by the restoring registry into fresh live handles. */
export interface SavedActorId { readonly slot: number; readonly generation: number; }

export interface ActorSlotCheckpoint extends SavedActorId {
  readonly lifetime:
    | { readonly kind: "active"; readonly owner: ProviderId; readonly definition: `${string}:${string}` }
    | { readonly kind: "free"; readonly freedAt: SourceTime | null };
}

export interface SavedBodyState extends Omit<BodyState, "ground"> { readonly ground: SavedActorId | null; }
export interface SavedBodyAttachment extends Omit<BodyAttachment, "anchor"> { readonly anchor: SavedActorId; }
export interface BodyCheckpoint {
  readonly actor: SavedActorId;
  readonly body: SavedBodyState;
  readonly attachment: SavedBodyAttachment | null;
  readonly linkCount: number;
  /** Spatial state may intentionally precede current field writes. */
  readonly linked: { readonly state: SavedBodyState; readonly absoluteBounds: BodyState["bounds"] } | null;
}

export interface CombatCheckpoint { readonly actor: SavedActorId; readonly state: CombatState; }
export interface InventoryCheckpoint { readonly actor: SavedActorId; readonly entries: readonly InventoryEntry[]; }
export interface ActorConfigurationCheckpoint extends Omit<ActorConfiguration, "actor"> { readonly actor: SavedActorId; }

export interface ThinkCheckpoint {
  readonly executionProvider?: ProviderId;
  readonly actor: SavedActorId;
  readonly callback: CallbackId;
  readonly due: SourceTime;
  readonly boundary: ThinkTiming["boundary"];
  readonly provider: ProviderId;
  readonly sequence: number;
}

/** Source-private state uses its provider's versioned codec, including mission and match state. */
export interface ProviderCheckpoint {
  readonly provider: ProviderId;
  readonly schema: `${string}:${string}`;
  readonly version: number;
  readonly bytes: Uint8Array;
}

export interface SaveImage {
  readonly mods?: import("./mods.ts").ModSessionCheckpoint;
  readonly schemaVersion: 3;
  /** Version 2 armor placeholders still need source-owner normalization during restore. */
  readonly legacyArmorLayout?: true;
  readonly recipe: ExecutableRecipe;
  readonly frame: FrameContext;
  readonly nextEventSequence: number;
  readonly clocks: readonly { readonly provider: ProviderId; readonly time: SourceTime }[];
  readonly random: readonly { readonly provider: ProviderId; readonly state: RandomState }[];
  readonly actors: readonly ActorSlotCheckpoint[];
  readonly bodies: readonly BodyCheckpoint[];
  readonly combat: readonly CombatCheckpoint[];
  readonly inventories: readonly InventoryCheckpoint[];
  readonly configurations: readonly ActorConfigurationCheckpoint[];
  readonly thinks: readonly ThinkCheckpoint[];
  readonly providers: readonly ProviderCheckpoint[];
  readonly guests: readonly GuestCheckpoint[];
}

/** Dedicated hosts construct this interface without an SDL device or a render backend. */
export interface Simulation {
  readonly session: SessionId;
  readonly recipe: ExecutableRecipe;
  step(input: InputBatch): SimulationOutput;
  stepAsync?(input: InputBatch): Promise<SimulationOutput>;
  checkpoint(): SaveImage;
  close(): undefined;
}

export type SeatActorBinding =
  | { readonly kind: "spectator" }
  | { readonly kind: "player"; readonly actor: ActorId };

export interface SeatClientState {
  readonly seat: SeatId;
  readonly client: ClientId;
  readonly actor: SeatActorBinding;
  readonly ui: SeatUiState;
  readonly presentation: SeatPresentationBinding;
}

/** A seat receives its own event stream and constructs its own view before backend submission. */
export interface SeatPresentation {
  readonly state: SeatClientState;
  receive(events: readonly SimulationEvent[]): undefined;
  frame(snapshot: WorldSnapshot): RenderFrame;
  render(frame: RenderFrame, backend: RendererBackend): undefined;
}
