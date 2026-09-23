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
  | { readonly kind: "source"; readonly value: "player-state" | "entity-state" | "centity" | "origin" | "snapshot" | "client-number" | "time" | "event" | "parameter" };
export interface QvmPresentationCall {
  readonly entry: number;
  readonly arguments: readonly QvmPresentationArgument[];
}
/** Every offset names the matched original executable's data, not a host event translation. */
export interface QvmModPresentationDeclaration {
  readonly version: 1;
  readonly runtime: "qvm-player-events";
  readonly gameplay: QvmPresentationProgram;
  readonly cgame: QvmPresentationProgram;
  readonly storage: {
    readonly gameState: number;
    readonly playerState: number;
    /** Empty entities/area mask and zero flags/command counts; time, ping and viewer PS are supplied. */
    readonly snapshot: { readonly kind: "synthetic-player-event"; readonly address: number; readonly pointers: readonly number[] };
    readonly centities: { readonly address: number; readonly stride: number; readonly capacity: number; readonly state: number; readonly origin: number };
    readonly time: readonly number[];
    readonly frameTime: readonly number[];
    readonly viewOrigin: readonly number[];
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
