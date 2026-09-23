import type { ContentDigest } from "./content.ts";
import type { QvmAbiProfile } from "./execution.ts";

export interface QvmPresentationProgram {
  readonly path: string;
  readonly digest: ContentDigest;
  readonly abiProfile: QvmAbiProfile;
}
/** Original C arguments, with pointers supplied by the declared caller storage. */
export type QvmPresentationArgument =
  | { readonly kind: "int32" | "float32" | "address"; readonly value: number }
  | { readonly kind: "source"; readonly value: "player-state" | "entity-state" | "centity" | "origin" | "snapshot" | "client-number" | "time" | "event" | "parameter" | "snapshot-number" | "server-command-sequence" };
export interface QvmPresentationCall {
  readonly entry: number;
  readonly when?: "weapon-presented";
  readonly arguments: readonly QvmPresentationArgument[];
}
/** Every offset names the matched original executable's data, not a host event translation. */
interface QvmPresentationBase {
  readonly version: 1;
  readonly gameplay: QvmPresentationProgram;
  readonly cgame: QvmPresentationProgram;
  readonly initialize: readonly QvmPresentationCall[];
  readonly refresh: readonly QvmPresentationCall[];
  readonly frame: readonly QvmPresentationCall[];
}
export interface QvmPlayerEventPresentation extends QvmPresentationBase {
  readonly runtime: "qvm-player-events";
  readonly storage: {
    readonly gameState: number;
    readonly playerState: number;
    /** Empty entities/area mask and zero flags/command counts; time, ping and viewer PS are supplied. */
    readonly snapshot: { readonly kind: "synthetic-player-event"; readonly address: number; readonly pointers: readonly number[] };
    readonly centities: { readonly address: number; readonly stride: number; readonly capacity: number; readonly state: number; readonly origin: number };
    readonly time: readonly number[];
    readonly frameTime: readonly number[];
    readonly viewOrigin: readonly number[];
    readonly viewAngles?: readonly number[];
    readonly viewAxis?: readonly number[];
  };
  /** Run full original context/media initialization; never pre-register selected event sounds. */
  readonly initialize: readonly QvmPresentationCall[];
  /** Run once after a source gameState revision changes, using original configuration/media code. */
  readonly refresh: readonly QvmPresentationCall[];
  /** Original transient pool/mark updates and their scene submissions, once per caller frame. */
  readonly frame: readonly QvmPresentationCall[];
  /** Original playerState-to-entity conversion and other declared caller work. */
  readonly project: readonly QvmPresentationCall[];
  readonly event: QvmPresentationCall;
}

/** The original cgame owns snapshot transitions and all player/entity events together. */
export interface QvmScenePresentation extends QvmPresentationBase {
  readonly runtime: "qvm-scene";
  readonly cvars: readonly { readonly name: string; readonly value: string }[];
  readonly storage: {
    readonly gameState: number;
    readonly serverCommandSequence: number;
    readonly time: readonly number[];
    readonly frameTime: readonly number[];
    readonly viewOrigin: readonly number[];
    readonly viewAngles?: readonly number[];
    readonly viewAxis?: readonly number[];
    readonly centities: { readonly address: number; readonly stride: number; readonly capacity: number;
      readonly state: number; readonly previousEvent: number; readonly snapshotTime: number };
  };
  /** Original CG_ProcessSnapshots or the artifact's equivalent caller. */
  readonly snapshots: readonly QvmPresentationCall[];
  /** Source enum boundary used only for seeding original one-shot event cursors after restore. */
  readonly eventEntityType: number;
  readonly eventCheck: { readonly entry: number; readonly centityArgument: number };
  /** Qualified original player mesh submission; effects continue through its original helper. */
  readonly body: {
    readonly player: { readonly entry: number; readonly centityArgument: number };
    readonly mesh: { readonly entry: number; readonly entityArgument: number; readonly stateArgument: number; readonly shaderOffset: number };
  };
}
export type QvmModPresentationDeclaration = QvmPlayerEventPresentation | QvmScenePresentation;
