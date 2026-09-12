import type { NativeAbi, Q2CgameApiIdentity, Q2GameApiIdentity, Q3ApiIdentity, QuakeCApiIdentity } from "./execution.ts";
import type { ProviderId } from "./identity.ts";
import type { NumericProfile } from "./numeric.ts";
import type { ClockProfile, FrameOrdering } from "./time.ts";

export type GameFamily = "q1" | "q2" | "q3";
export type ContentId = `${GameFamily}:${string}:${string}:${string}`;
export type RecipeId = `recipe:${string}:${string}`;
export type ResourceId = `resource:${string}`;
export type MountId = `mount:${string}:${string}`;
export type MountPlanId = `mount-plan:${string}:${string}`;
export type ContentDigest = `sha256:${string}`;

export interface ContentIdentity {
  readonly family: GameFamily;
  readonly edition: string;
  readonly package: string;
  readonly revision: string;
}

function identityPart(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(value)) {
    throw new RangeError(`Invalid content identity component: ${value}`);
  }
  return value;
}

export function createContentId(identity: ContentIdentity): ContentId {
  return `${identity.family}:${identityPart(identity.edition)}:${identityPart(identity.package)}:${identityPart(identity.revision)}`;
}

export function isContentId(value: unknown): value is ContentId {
  return typeof value === "string" && /^(q1|q2|q3)(:[a-zA-Z0-9][a-zA-Z0-9._+-]*){3}$/.test(value);
}

export function createRecipeId(namespace: string, revision: string): RecipeId {
  return `recipe:${identityPart(namespace)}:${identityPart(revision)}`;
}

export function createMountId(namespace: string, name: string): MountId {
  return `mount:${identityPart(namespace)}:${identityPart(name)}`;
}

export function createMountPlanId(namespace: string, revision: string): MountPlanId {
  return `mount-plan:${identityPart(namespace)}:${identityPart(revision)}`;
}

export function createContentDigest(hex: string): ContentDigest {
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) throw new RangeError("Expected a SHA-256 digest with 64 hexadecimal digits");
  return `sha256:${hex.toLowerCase()}`;
}

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

/** A new generation identifies replacement bytes or a remounted root. */
export interface MountIdentity {
  readonly id: MountId;
  readonly content: ContentId;
  readonly generation: number;
}

export function createMountIdentity(id: MountId, content: ContentId, generation: number): MountIdentity {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError("Mount generation must be a nonnegative safe integer");
  return Object.freeze({ id, content, generation });
}

export type ArchiveFormat = "pak" | "pk3" | "kpf" | "zip";

export interface ArchiveMount {
  readonly kind: "archive";
  readonly identity: MountIdentity;
  readonly format: ArchiveFormat;
  readonly archivePath: string;
  readonly archiveDigest: ContentDigest;
}

export interface LooseMount {
  readonly kind: "loose";
  readonly identity: MountIdentity;
  readonly rootPath: string;
}

export type ContentMount = ArchiveMount | LooseMount;

export type ResourceProvenance =
  | { readonly kind: "archive"; readonly mount: ArchiveMount; readonly memberPath: string; readonly memberIndex: number }
  | { readonly kind: "loose"; readonly mount: LooseMount; readonly memberPath: string };

export interface PrefixMountOrder {
  readonly prefix: string;
  /** Highest priority first; misses continue through this complete order. */
  readonly mounts: readonly MountId[];
}

/** Q2 rerelease assets use defaultOrder while maps/ can prefer classic mounts. */
export interface ResolvedMountPlan {
  readonly id: MountPlanId;
  readonly mounts: readonly ContentMount[];
  readonly defaultOrder: readonly MountId[];
  /** First matching prefix wins. Each order includes its fallback mounts. */
  readonly prefixOrders: readonly PrefixMountOrder[];
}

export type ResourceResolution =
  | { readonly kind: "default-order"; readonly plan: MountPlanId; readonly rank: number }
  | { readonly kind: "prefix-order"; readonly plan: MountPlanId; readonly prefix: string; readonly rank: number }
  | { readonly kind: "link"; readonly plan: MountPlanId; readonly sourcePrefix: string; readonly targetPath: string };

/** Records the selected byte identity and mount generation across remounts. */
export interface ResolvedResourceReference {
  readonly id: ResourceId;
  readonly requestedPath: string;
  readonly provenance: ResourceProvenance;
  readonly digest: ContentDigest;
  readonly byteLength: number;
  readonly resolution: ResourceResolution;
}

function resourcePath(value: string): string {
  if (value.length === 0 || value.includes("\0") || value.startsWith("/") || value.includes("\\")
    || value.split("/").some(part => part === "" || part === "." || part === "..")) {
    throw new RangeError(`Expected a relative resource path: ${value}`);
  }
  return value;
}

function resolutionKey(resolution: ResourceResolution): string {
  switch (resolution.kind) {
    case "default-order": return `${resolution.plan}:default:${resolution.rank}`;
    case "prefix-order": return `${resolution.plan}:prefix:${encodeURIComponent(resolution.prefix)}:${resolution.rank}`;
    case "link": return `${resolution.plan}:link:${encodeURIComponent(resolution.sourcePrefix)}:${encodeURIComponent(resolution.targetPath)}`;
  }
}

/** Identity includes the chosen archive/root, member, bytes and precedence decision. */
export function createResourceId(resource: Omit<ResolvedResourceReference, "id">): ResourceId {
  const { provenance, resolution } = resource;
  const { identity } = provenance.mount;
  resourcePath(resource.requestedPath);
  resourcePath(provenance.memberPath);
  if (!Number.isSafeInteger(resource.byteLength) || resource.byteLength < 0) throw new RangeError("Resource byte length must be a nonnegative safe integer");
  if (resolution.kind !== "link" && (!Number.isSafeInteger(resolution.rank) || resolution.rank < 0)) {
    throw new RangeError("Resource precedence rank must be a nonnegative safe integer");
  }
  if (provenance.kind === "archive" && (!Number.isSafeInteger(provenance.memberIndex) || provenance.memberIndex < 0)) {
    throw new RangeError("Archive member index must be a nonnegative safe integer");
  }
  const source = provenance.kind === "archive"
    ? `${encodeURIComponent(provenance.mount.archivePath)}:${provenance.mount.archiveDigest}:${provenance.memberIndex}`
    : encodeURIComponent(provenance.mount.rootPath);
  return `resource:${identity.content}:${identity.id}:${identity.generation}:${source}:${encodeURIComponent(provenance.memberPath)}:${resource.digest}:${resolutionKey(resolution)}`;
}

export interface ProviderReference {
  readonly provider: ProviderId;
  readonly content: ContentId;
}

export interface ResourceRequest {
  readonly content: ContentId;
  readonly path: string;
}

export type LaunchSelection<T> =
  | { readonly kind: "preset" }
  | { readonly kind: "selected"; readonly value: T };

export interface MapSelection {
  readonly geometry: ResourceRequest;
  readonly entities: ProviderReference;
}

/** Campaign gamecode is independently chosen, including Q1's campaign progs.dat. */
export type CampaignSelection =
  | { readonly kind: "none" }
  | { readonly kind: "campaign"; readonly mission: ProviderReference; readonly gamecode: ProviderReference };

export interface CharacterSelection {
  readonly definition: ProviderReference;
  readonly appearance: ProviderReference;
}

export interface MonsterDefinitionReference {
  readonly source: ProviderReference;
  readonly classname: string;
}

export type MonsterSelectionTarget = MonsterDefinitionReference | { readonly kind: "map-defined" };

export type EnemySelection =
  | { readonly kind: "map-defined" }
  | { readonly kind: "replace"; readonly default: MonsterSelectionTarget;
      readonly byClassname: Readonly<Record<string, MonsterSelectionTarget>> };

export type GrappleSelection =
  | { readonly kind: "disabled" }
  | ({ readonly kind: "enabled"; readonly source: ProviderReference; readonly binding: "slot" | "offhand" } & (
    | { readonly mechanic: "q1-threewave"; readonly edition: "rerelease" }
    | { readonly mechanic: "q2-ctf"; readonly edition: "classic" | "rerelease" }
    | { readonly mechanic: "q2-lmctf"; readonly edition: "classic" }
  ));

export type HandGrenadeSelection =
  | { readonly kind: "disabled" }
  | { readonly kind: "enabled"; readonly source: ProviderReference; readonly edition: "classic" | "rerelease";
      readonly binding: "offhand"; readonly initialAmmo: number; readonly capacity: number };

/** Equipment selection never changes map mechanisms, campaign gamecode or the primary arsenal. */
export interface EquipmentSelection {
  readonly grapple: GrappleSelection;
  readonly handGrenades: HandGrenadeSelection;
}

export type EnvironmentSelection =
  | { readonly kind: "audio-content" }
  | { readonly kind: "disabled" }
  | { readonly kind: "selected"; readonly resource: ResourceRequest };

export interface PresentationSelection {
  readonly environment: EnvironmentSelection;
  readonly assets: ContentId;
  readonly hud: ProviderReference;
  readonly effects: ProviderReference;
  readonly audio: ProviderReference;
}

type Q3ModuleApi =
  | { readonly role: "server-game"; readonly api: Extract<Q3ApiIdentity, { readonly kind: "q3-qagame" }> }
  | { readonly role: "client-game"; readonly api: Extract<Q3ApiIdentity, { readonly kind: "q3-cgame" }> }
  | { readonly role: "ui"; readonly api: Extract<Q3ApiIdentity, { readonly kind: "q3-ui" }> };

type NativeModuleApi = Q3ModuleApi
  | { readonly role: "server-game"; readonly api: Q2GameApiIdentity }
  | { readonly role: "client-game"; readonly api: Q2CgameApiIdentity };

type SourceModuleApi = NativeModuleApi
  | { readonly role: "server-game"; readonly api: QuakeCApiIdentity };

export type ModuleRole = SourceModuleApi["role"];
export type NativeModuleProfile = NativeAbi;

/** Execution form does not choose engine behavior, combat rules or wire format. */
export type ExecutionModule<TArtifact> =
  | ({ readonly kind: "typescript"; readonly owner: ProviderReference; readonly implementation: ProviderId } & SourceModuleApi)
  | { readonly kind: "quakec"; readonly owner: ProviderReference; readonly role: "server-game"; readonly artifact: TArtifact; readonly api: QuakeCApiIdentity }
  | ({ readonly kind: "qvm"; readonly owner: ProviderReference; readonly artifact: TArtifact } & Q3ModuleApi)
  | ({ readonly kind: "native"; readonly owner: ProviderReference; readonly artifact: TArtifact; readonly profile: NativeModuleProfile } & NativeModuleApi);

export type ExecutionSelection = ExecutionModule<ResourceRequest>;
export type ResolvedExecutionModule = ExecutionModule<ResolvedResourceReference>;

/** Only explicit selections replace their named preset decisions. */
export interface LaunchChoice {
  readonly preset: RecipeId;
  readonly map: LaunchSelection<MapSelection>;
  readonly campaign: LaunchSelection<CampaignSelection>;
  readonly movement: LaunchSelection<ProviderReference>;
  readonly character: LaunchSelection<CharacterSelection>;
  readonly weapons: LaunchSelection<readonly ProviderReference[]>;
  readonly equipment: LaunchSelection<EquipmentSelection>;
  readonly enemies: LaunchSelection<EnemySelection>;
  readonly presentation: LaunchSelection<PresentationSelection>;
  readonly engineBehavior: LaunchSelection<ProviderReference>;
  readonly combat: LaunchSelection<ProviderReference>;
  readonly inventory: LaunchSelection<ProviderReference>;
  readonly match: LaunchSelection<ProviderReference>;
  readonly transition: LaunchSelection<ProviderReference>;
  readonly execution: LaunchSelection<readonly ExecutionSelection[]>;
}

export interface ResolvedMap {
  /** Selected map product, retained when geometry resolves from its base content. */
  readonly geometryContent: ContentId;
  readonly geometry: ResolvedResourceReference;
  readonly entities: ProviderReference;
}

export interface ProviderTiming {
  readonly provider: ProviderId;
  readonly clock: ClockProfile;
  readonly numeric: NumericProfile;
}

/** Resolved before session construction; renderer and window settings live elsewhere. */
export interface ExecutableRecipe {
  readonly schemaVersion: 3;
  readonly id: RecipeId;
  readonly preset: RecipeId;
  readonly map: ResolvedMap;
  readonly campaign: CampaignSelection;
  readonly movement: ProviderReference;
  readonly character: CharacterSelection;
  readonly weapons: readonly ProviderReference[];
  readonly equipment: EquipmentSelection;
  readonly enemies: EnemySelection;
  readonly presentation: PresentationSelection;
  readonly engineBehavior: ProviderReference;
  readonly combat: ProviderReference;
  readonly inventory: ProviderReference;
  readonly match: ProviderReference;
  readonly transition: ProviderReference;
  readonly execution: readonly ResolvedExecutionModule[];
  readonly mounts: ResolvedMountPlan;
  readonly resources: readonly ResolvedResourceReference[];
  readonly timing: readonly ProviderTiming[];
  readonly ordering: FrameOrdering;
}
