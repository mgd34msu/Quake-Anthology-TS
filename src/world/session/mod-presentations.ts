import type { MountedContent } from "../../content/mounts/index.ts";
import type { UserFileStore } from "../../platform/files/writable.ts";
import type { PresentationOwner } from "../../contracts/presentation.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { ModIdentity } from "../../contracts/mods.ts";
import type { QvmPresentationContext } from "../../compat/qvm/mod-presentation.ts";
import type { PreparedMod } from "./mods.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { Q3PlayerState } from "../../contracts/protocol.ts";
import type { QvmEntityStateFields } from "../../compat/qvm/entity-record.ts";
import type { SourceGameStateRecord } from "../../network/q3/game-state.ts";

export interface QvmModScenePublication {
  readonly revision: number;
  readonly serverTime: number;
  readonly gameState: SourceGameStateRecord;
  readonly gameStateRevision: number;
  readonly clients: readonly { readonly actor: ActorId; readonly slot: number; readonly state: Q3PlayerState }[];
  readonly entities: readonly { readonly actor: ActorId; readonly state: QvmEntityStateFields; readonly owned: boolean;
    readonly linked: boolean; readonly serverFlags: number; readonly singleClient: number; readonly bounds: Bounds }[];
  readonly commands: readonly { readonly sequence: number; readonly recipient: ActorId | null; readonly text: string }[];
}

/** Original presentation context and explicitly admitted client services. */
export interface ModQvmPresentationSource {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly generation: number;
  context(viewer: ActorId): Omit<QvmPresentationContext, "frameTimeMilliseconds" | "viewOrigin"> | null;
  scene?(): { readonly current: QvmModScenePublication; readonly baseline: QvmModScenePublication | null };
  files?(): { readonly mounts: MountedContent; readonly writable: UserFileStore | null } | null;
  clientCommand?(viewer: ActorId, arguments_: readonly string[]): void;
  bindings(): readonly { readonly actor: ActorId; readonly slot: number; readonly owned: boolean }[];
  actor(slot: number): ActorId | null;
  live(actor: ActorId): boolean;
  assertCurrent(): void;
}

export interface ActiveModPresentation {
  readonly owner: PresentationOwner;
  readonly identity: ModIdentity;
  readonly prepared: NonNullable<PreparedMod["presentation"]>;
  readonly source: ModQvmPresentationSource;
}
