import type { ActorId } from "../../contracts/identity.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { ModIdentity } from "../../contracts/mods.ts";
import type { QvmPresentationContext } from "../../compat/qvm/mod-presentation.ts";
import type { PreparedMod } from "./mods.ts";

/** Read-only original source context; presentation never changes gameplay state. */
export interface ModQvmPresentationSource {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly generation: number;
  context(viewer: ActorId): Omit<QvmPresentationContext, "frameTimeMilliseconds" | "viewOrigin"> | null;
  actor(slot: number): ActorId | null;
  live(actor: ActorId): boolean;
  assertCurrent(): void;
}

export interface ActiveModPresentation {
  readonly identity: ModIdentity;
  readonly prepared: NonNullable<PreparedMod["presentation"]>;
  readonly source: ModQvmPresentationSource;
}
