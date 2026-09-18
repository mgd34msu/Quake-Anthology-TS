import type { RereleaseImportCall } from "../../../compat/q2/rerelease/module.ts";
import type { GuestCallResult } from "../../../contracts/execution.ts";
import type { RereleaseSemanticBindings } from "../../../compat/q2/rerelease/host.ts";
import type { RereleaseDebugShapesEvent } from "../../../compat/q2/rerelease/debug-shapes.ts";
import type { RereleaseWorldTextEvent } from "../../../compat/q2/rerelease/world-text.ts";
import type { Q2FoundationHost } from "../../../content/q2/foundation/host.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q2RereleaseEntityState, Q2RereleasePlayerState } from "../../../contracts/protocol.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import type { RereleaseCoreServices } from "../../../compat/q2/rerelease/imports.ts";
import type { RereleaseQ2GuestHost, RereleaseQ2HostOptions } from "../../../compat/q2/rerelease/host.ts";
import type { ClassicGuestServicesOptions, ClassicGuestMapServices, ClassicGuestMessage } from "./classic-guest-services.ts";

export interface RereleaseGuestServicesOptions extends ClassicGuestServicesOptions {
  readonly frameMilliseconds: number;
  readonly engine: ClassicGuestServicesOptions["engine"] & Pick<Q2FoundationHost, "worldActor">;
  readonly localize: (key: string, arguments_: readonly string[]) => string;
  readonly clipboard: { readonly kind: "dedicated" } | { readonly kind: "client"; write(text: string): void };
  readonly debugShapes: (event: RereleaseDebugShapesEvent) => void;
  readonly worldText: (event: RereleaseWorldTextEvent) => void;
  readonly navigation?: (call: RereleaseImportCall, host: RereleaseQ2GuestHost) => GuestCallResult;
  readonly semanticBindings?: RereleaseSemanticBindings;
}
export type RereleaseGuestMapServices = Omit<ClassicGuestMapServices, "engine"> & Pick<RereleaseGuestServicesOptions, "engine" | "localize" | "debugShapes" | "worldText">;
export interface RereleaseGuestMessage extends ClassicGuestMessage {
  readonly sourceDialect: "q2-multicast-float";
  readonly dupeKey: number;
}
export interface RereleaseGuestServicesPort {
  readonly options: RereleaseGuestServicesOptions;
  readonly hostOptions: Pick<RereleaseQ2HostOptions, "engine" | "spatial" | "semantics" | "messages" | "debugDrawing" | "debugShapes" | "worldText" | "sound" | "frameMilliseconds">;
  bindMemory(memory: MappedGuestMemory): RereleaseCoreServices;
  bindHost(host: RereleaseQ2GuestHost): void;
  completeSpawn(): void;
  validateMap(binding: RereleaseGuestMapServices): void;
  publishEntities(): void;
  playerPing(slot: number): number;
  setPlayerPing(slot: number, ping: number): void;
  beginFrame(frame: number): void;
  rebindWorld(binding: RereleaseGuestMapServices): void;
  entityState(slot: number): Q2RereleaseEntityState;
  playerState(slot: number): Q2RereleasePlayerState;
  modelAppearance(slot: number): { readonly path: string; readonly skin: number; readonly skinPath: string | null; readonly attachedModels: readonly string[] };
  entityInfo(slot: number): { readonly actor: ActorId | null; readonly active: boolean; readonly serverFlags: number; readonly areas: readonly [number, number]; readonly clusters: readonly number[] | null; readonly firstCluster: number; readonly headnode: number; readonly ownerSlot: number | null };
  drainMessages(): readonly RereleaseGuestMessage[];
  configstrings(): ReadonlyMap<number, string>;
  setConfigstring(index: number, value: string): undefined;
  restoreConfigstrings(values: ReadonlyMap<number, string>): void;
}
