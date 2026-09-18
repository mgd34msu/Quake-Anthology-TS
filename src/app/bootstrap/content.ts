import { prepareNativeQ2Map } from "./simulation/native-q2-map.ts";
import { prepareApplicationWeaponBehavior, prepareConfiguredApplicationRecipe, type PreparedWeaponBehavior } from "./weapon-behavior-selection.ts";
import { prepareRereleaseGuest, type PreparedRereleaseGuest } from "./simulation/rerelease-guest-source.ts";
import { sourceProgramImplementation, sourceProgramProduct } from "../../content/catalog/source-program.ts";
import { prepareClassicGuest, type PreparedClassicGuest } from "./simulation/classic-guest-source.ts";
import type { DemoFamily } from "./demo-playback.ts";
export interface ApplicationContentSource { readonly kind: "recorded" | "unified"; readonly family: DemoFamily; }
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { findContentPath } from "../../content/mounts/paths.ts";
import { userProductDirectory } from "../../content/user-data.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { prepareQuakeCSource, type PreparedQuakeCSource } from "./simulation/quakec-source.ts";
import { assertQ3GuestRecipe, prepareQ3Game } from "./simulation/q3/guest-artifact.ts";
import type { PreparedQ3Game } from "./simulation/q3/guest-artifact.ts";
import { resolveLaunchResource, prepareLaunchMountPlan } from "../../content/catalog/launch.ts";
import { nativeProviderTiming } from "../../content/catalog/timing.ts";
import type { ContentId, ResolvedResourceReference, ExecutableRecipe, ExecutionSelection, GameFamily, ProviderReference, LaunchChoice, ProviderTiming } from "../../contracts/content.ts";
import { createMountPlanId, createRecipeId } from "../../contracts/content.ts";
import type { Q3WorldGeometry } from "../../contracts/scene.ts";
import { discoverInstalledContent, remoteContentProduct, remoteContentSelection, expectedProducts, nativeEquipment, presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import type { InstalledCatalog, LaunchPreset, CatalogProduct, RemoteContentSelection } from "../../content/catalog/index.ts";
import { prepareQ3ApplicationProduct } from "./q3-product.ts";
import type { Q3ApplicationProduct } from "../../core/q3-product-policy.ts";
import { openMountPlan, type OpenMountOptions } from "../../content/mounts/index.ts";
import type { MountedContent, PureMountPolicy } from "../../content/mounts/index.ts";
import { readQ1Bsp } from "../../formats/q1-map/index.ts";
import type { Q1Map } from "../../formats/q1-map/index.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../formats/q2-map/index.ts";
import type { Q2DecodedMap } from "../../formats/q2-map/index.ts";
import { decodeQ3World } from "../../formats/q3-map/index.ts";
import { classifyBsp } from "../../formats/bsp-kind.ts";
import type { ApplicationOptions } from "./options.ts";

export type ApplicationWorld = Q1Map | Q2DecodedMap | Q3WorldGeometry;
export interface ApplicationMapSidecar { readonly content: ContentId; readonly path: string; readonly resource: ResolvedResourceReference | null; }

export interface RemoteContentMounts {
  readonly selection: RemoteContentSelection;
  readonly catalog: InstalledCatalog;
  readonly product: CatalogProduct;
  readonly mounts: MountedContent;
  readonly writeRoot: string;
  readonly baseWriteRoot: string;
  readonly q3Product: Q3ApplicationProduct | null;
}

export async function openRemoteContent(roots: Pick<ApplicationOptions, "corpusRoot" | "userContentRoot" | "q3Product" | "startupCommands">,
  requested: RemoteContentSelection, assertCurrent: () => void, generation = 0): Promise<RemoteContentMounts> {
  assertCurrent();
  const selection = remoteContentSelection(requested.base, requested.directory);
  const base = expectedProducts.find(product => product.id === selection.base);
  if (base === undefined) throw new Error(`Missing remote base product ${selection.base}`);
  const userRoot = roots.userContentRoot ?? defaultUserContentRoot();
  const familyRoot = await findContentPath(userRoot, dirname(base.contentDirectory)) ?? userProductDirectory(userRoot, dirname(base.contentDirectory));
  assertCurrent();
  const baseWriteRoot = await findContentPath(familyRoot, basename(base.contentDirectory)) ?? join(familyRoot, basename(base.contentDirectory));
  assertCurrent();
  const writeRoot = selection.directory === basename(base.contentDirectory).toLowerCase() ? baseWriteRoot
    : await findContentPath(familyRoot, selection.directory) ?? join(familyRoot, selection.directory);
  assertCurrent();
  await mkdir(writeRoot, { recursive: true }); assertCurrent();
  await mkdir(baseWriteRoot, { recursive: true }); assertCurrent();
  let catalog = await discoverInstalledContent({ ...roots, userContentRoot: userRoot, discoverMods: false, remoteContent: selection, generation });
  assertCurrent();
  catalog.require(selection.base);
  let product = catalog.require(remoteContentProduct(selection));
  if ((product.userContent?.root ?? product.looseRoot) !== writeRoot) throw new Error("Remote download directory does not match its content owner");
  const policy = await prepareQ3ApplicationProduct(catalog, product.id, roots); assertCurrent();
  catalog = policy.catalog; product = catalog.require(remoteContentProduct(selection));
  const mounts = await catalog.mountsFor(product.id); assertCurrent();
  const opened = await openMountPlan({ id: createMountPlanId("remote-server", String(generation)), mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] }, policy.q3Product?.restriction.kind === "demo" ? { q3Restriction: "demo" } : {});
  try { assertCurrent(); }
  catch (error) { opened.close(); throw error; }
  return { selection, catalog, product, mounts: opened, writeRoot, baseWriteRoot, q3Product: policy.q3Product };
}

export type MountedApplicationContent = Pick<LoadedApplicationContent, "catalog" | "mounts" | "close" | "q3Product">;

export async function openRemoteApplicationContent(options: ApplicationOptions): Promise<MountedApplicationContent> {
  const selection = options.remoteContent ?? (options.network.kind === "qw-client" ? remoteContentSelection("q1-quakeworld", "qw")
    : options.network.kind === "q3-client" ? remoteContentSelection("q3-baseq3", "baseq3")
    : options.network.kind === "q2-client" ? remoteContentSelection("q2-classic-baseq2", "baseq2") : undefined);
  if (selection !== undefined) {
    const content = await openRemoteContent(options, selection, () => {});
    return { catalog: content.catalog, mounts: content.mounts, q3Product: content.q3Product, close: async () => { content.mounts.close(); } };
  }
  const discovered = await discoverInstalledContent({ corpusRoot: options.corpusRoot,
    userContentRoot: options.userContentRoot ?? defaultUserContentRoot(), discoverMods: false });
  const policy = await prepareQ3ApplicationProduct(discovered, options.product, options), catalog = policy.catalog;
  const product = catalog.require(options.product), mounts = await catalog.mountsFor(product.id);
  const opened = await openMountPlan({ id: createMountPlanId("remote-connection", options.product), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] }, policy.q3Product?.restriction.kind === "demo" ? { q3Restriction: "demo" } : {});
  return { catalog, mounts: opened, q3Product: policy.q3Product, close: async () => { opened.close(); } };
}

export function remoteConfigurationContent(options: ApplicationOptions, content: MountedApplicationContent): ApplicationConfigurationContent {
  const preset = applicationConfigurationPreset(content.catalog, options);
  return { catalog: content.catalog, mounts: content.mounts, ...(content.q3Product === null ? {} : { q3Product: content.q3Product }), close: () => content.close(),
    selection: { source: preset.map.entities, engineBehavior: preset.engineBehavior,
    match: preset.match, combat: preset.combat, movement: preset.movement, timing: preset.timing } };
}

function baseProduct(family: GameFamily): string {
  switch (family) {
    case "q1": return "q1-classic-id1";
    case "q2": return "q2-classic-baseq2";
    case "q3": return "q3-baseq3";
  }
}


function execution(provider: ProviderReference, family: GameFamily, rerelease: boolean, implementation = provider.provider): ExecutionSelection {
  const common = { kind: "typescript", owner: provider, implementation, role: "server-game" } satisfies Pick<ExecutionSelection, "kind" | "owner" | "role"> & { readonly implementation: ProviderReference["provider"] };
  switch (family) {
    case "q1": return { ...common, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } };
    case "q2": return rerelease ? { ...common, api: { kind: "q2-rerelease-game", version: 2023 } } : { ...common, api: { kind: "q2-classic-game", version: 3 } };
    case "q3": return { ...common, api: { kind: "q3-qagame", version: 8 } };
  }
}

export interface ApplicationSourceSelection {
  readonly source: ProviderReference;
  readonly match: ProviderReference;
  readonly rules: NonNullable<ApplicationOptions["rules"]>;
}

export function applicationSourceSelection(catalog: InstalledCatalog, options: Pick<ApplicationOptions, "product" | "rules">): ApplicationSourceSelection {
  const product = catalog.require(options.product), family = product.expectation.family;
  const source: ProviderReference = { provider: `${family}:official`, content: product.id };
  const program = sourceProgramProduct(catalog, product.id).expectation;
  const rerelease = program.edition === "rerelease";
  const rules = options.rules ?? (family === "q2" && !rerelease && (program.campaign === "ctf" || program.campaign === "lmctf") ? program.campaign : "standard");
  if ((rules === "ctf" || rules === "lmctf") && (family !== "q2" || rerelease)) throw new Error(`${rules} requires a classic Quake II game provider`);
  if ((rules === "tag" || rules === "deathball") && (family !== "q2" || !rerelease && program.campaign !== "rogue")) throw new Error("Tag and DeathBall require Ground Zero or Quake II rerelease");
  if (rules === "horde" && (family !== "q1" || !rerelease || program.campaign !== "mg1" && program.campaign !== "dopa")) throw new Error("Horde requires Quake rerelease MG1 or DOPA");
  const match: ProviderReference = rules === "standard" ? source : rules === "ctf" || rules === "lmctf" ? { provider: `q2:${rules}`, content: catalog.require(`q2-classic-${rules}`).id } : { provider: `${family}:${rules}`, content: product.id };
  return { source, match, rules };
}

export function applicationDiscoversMods(options: ApplicationOptions, recipe?: ExecutableRecipe): boolean {
  const product = expectedProducts.find(product => product.id === options.product);
  return options.weaponBehavior !== undefined || options.dedicated || options.network.kind === "offline"
    && (recipe !== undefined || product === undefined || product.family === "q3");
}

function selectedQ2GameLibrary(catalog: InstalledCatalog, options: Pick<ApplicationOptions, "product" | "q2GameLibrary">): string | undefined {
  if (options.q2GameLibrary !== undefined) return options.q2GameLibrary;
  const product = sourceProgramProduct(catalog, options.product);
  const library = product.expectation.edition === "rerelease" ? "game_x64.dll" : "gamex86.dll";
  return product.expectation.family === "q2" && !expectedProducts.some(builtin => builtin.id === product.expectation.id)
    && product.expectation.requiredPrograms.includes(library) ? library : undefined;
}

function selectedQuakeCProgram(catalog: InstalledCatalog, options: Pick<ApplicationOptions, "product" | "quakeCProgram">): string | undefined {
  if (options.quakeCProgram !== undefined) return options.quakeCProgram;
  const product = sourceProgramProduct(catalog, options.product);
  return product.expectation.family === "q1" && product.expectation.edition !== "quakeworld"
    && !expectedProducts.some(builtin => builtin.id === product.expectation.id)
    && product.expectation.requiredPrograms.includes("progs.dat") ? "progs.dat" : undefined;
}

export function applicationPreset(catalog: InstalledCatalog, options: ApplicationOptions, nativeSources?: { readonly movement: ProviderReference; readonly character: ProviderReference }, presentationSource?: ApplicationContentSource): LaunchPreset {
  const product = catalog.require(options.product), family = product.expectation.family;
  const q3Guest = family === "q3" && presentationSource?.family !== "q3" && options.network.kind !== "q3-client" && !expectedProducts.some(builtin => builtin.id === sourceProgramProduct(catalog, product.id).expectation.id);
  if (q3Guest && (!options.dedicated && options.network.kind !== "offline" || options.network.kind !== "native-server" && options.network.kind !== "offline" || options.mode !== "deathmatch"
    || options.movement !== "q3" || options.character !== "q3"))
    throw new Error("Selected Q3 mods require an offline local or dedicated server with native Q3 movement and character and deathmatch");
  const quakeworld = product.expectation.edition === "quakeworld" && presentationSource?.family !== "qw" && options.network.kind !== "qw-client";
  const nativeProgram = selectedQuakeCProgram(catalog, options);
  if (selectedQ2GameLibrary(catalog, options) !== undefined && (family !== "q2" || options.movement !== "q2" || options.character !== "q2"
    || options.quakeCProgram !== undefined || options.botSkill !== undefined
    || options.network.kind !== "offline" && options.network.kind !== "native-server" && options.network.kind !== "q2-server"))
    throw new Error("--q2-game requires Quake II source, movement and character with native offline/server operation");
  if (nativeProgram !== undefined && (family !== "q1" || product.expectation.edition === "quakeworld"
    || options.network.kind !== "offline" && options.network.kind !== "native-server"
    || options.network.kind === "native-server" && options.character !== "q1"))
    throw new Error("--progs requires an offline/server NetQuake source world; native wire servers require Q1 character presentation");
  if (quakeworld && (!options.dedicated || options.mode !== "deathmatch" || options.character !== "q1"
    || options.q1Protocol !== undefined || options.network.kind !== "offline" && options.network.kind !== "native-server"))
    throw new Error("Native QuakeWorld requires dedicated deathmatch with Q1 character presentation and its native protocol");
  return selectedApplicationPreset(catalog, options, nativeSources, { quakeworld, q3Guest });
}

export function applicationConfigurationPreset(catalog: InstalledCatalog, options: ApplicationOptions, nativeSources?: { readonly movement: ProviderReference; readonly character: ProviderReference }): LaunchPreset {
  const product = catalog.require(options.product), family = product.expectation.family;
  const q3Guest = family === "q3" && !expectedProducts.some(builtin => builtin.id === sourceProgramProduct(catalog, product.id).expectation.id);
  const quakeworld = product.expectation.edition === "quakeworld";
  return selectedApplicationPreset(catalog, options, nativeSources, { quakeworld, q3Guest });
}

function selectedApplicationPreset(catalog: InstalledCatalog, options: ApplicationOptions,
  nativeSources: { readonly movement: ProviderReference; readonly character: ProviderReference } | undefined,
  source: { readonly quakeworld: boolean; readonly q3Guest: boolean }): LaunchPreset {
  const product = catalog.require(options.product), family = product.expectation.family;
  const { quakeworld, q3Guest } = source;
  const nativeProgram = selectedQuakeCProgram(catalog, options);
  const q2GameLibrary = selectedQ2GameLibrary(catalog, options);
  const { source: provider, match, rules } = applicationSourceSelection(catalog, options);
  const programProduct = sourceProgramProduct(catalog, product.id);
  const equipmentSource = nativeProgram === undefined && q2GameLibrary === undefined && !q3Guest && !quakeworld
    ? { ...provider, content: programProduct.id } : provider;
  const movement: ProviderReference = nativeSources?.movement ?? { provider: `${options.movement}:movement`, content: (quakeworld || q3Guest) && options.movement === family ? product.id : catalog.require(baseProduct(options.movement)).id };
  const character: ProviderReference = nativeSources?.character ?? { provider: `${options.character}:character`, content: (quakeworld || q3Guest) && options.character === family ? product.id : catalog.require(baseProduct(options.character)).id };
  const appearance: ProviderReference = { provider: `${options.character}:model/${options.characterModel}`, content: character.content };
  const rerelease = product.expectation.edition === "rerelease";
  const timing = (reference: ProviderReference, source: GameFamily, edition: boolean) => {
    const native = nativeProviderTiming(reference, source, edition);
    return quakeworld && source === "q1" && catalog.product(reference.content).expectation.edition === "quakeworld" ? { ...native, clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 } satisfies typeof native.clock } : native;
  };
  const providerTiming = timing(provider, family, rerelease);
  return { id: createRecipeId("mixed", `${options.product}-${options.movement}-${options.character}-${options.characterModel}${rules === "standard" ? "" : `-${rules}`}`),
    map: { geometry: { content: options.mapProduct === undefined ? product.id : catalog.require(options.mapProduct).id, path: options.map }, entities: provider },
    campaign: options.mode === "deathmatch" ? { kind: "none" } : { kind: "campaign", mission: provider, gamecode: provider }, movement,
    character: { definition: character, appearance }, weapons: [provider], equipment: nativeEquipment(catalog, equipmentSource, match), enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider },
    engineBehavior: provider, combat: provider, inventory: provider, match, transition: provider,
    execution: [q2GameLibrary !== undefined ? { kind: "native", owner: provider, role: "server-game", artifact: { content: product.id, path: q2GameLibrary },
      ...(rerelease ? { api: { kind: "q2-rerelease-game", version: 2023 }, profile: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" } } : { api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" } }) } : q3Guest ? { kind: "qvm", owner: provider, role: "server-game", artifact: { content: product.id, path: "vm/qagame.qvm" },
      api: { kind: "q3-qagame", version: 8 } } : quakeworld ? { kind: "quakec", owner: provider, role: "server-game", artifact: { content: product.id, path: "qwprogs.dat" },
      api: { kind: "q1-quakeworld", programVersion: 6, systemCrc: 54730 } } : nativeProgram !== undefined
        ? { kind: "quakec", owner: provider, role: "server-game", artifact: { content: product.id, path: nativeProgram },
          api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } } : execution(provider, family, rerelease, programProduct.id === product.id ? provider.provider : sourceProgramImplementation(programProduct.expectation))],
    timing: [providerTiming, timing(movement, options.movement, catalog.product(movement.content).expectation.edition === "rerelease"), timing(character, options.character, catalog.product(character.content).expectation.edition === "rerelease")],
    ordering: { kind: "mixed", providers: [provider.provider, movement.provider, character.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" } };
}

export interface ApplicationConfigurationSelection {
  readonly source: ProviderReference;
  readonly engineBehavior: ProviderReference;
  readonly match: ProviderReference;
  readonly combat: ProviderReference;
  readonly movement: ProviderReference;
  readonly timing: readonly ProviderTiming[];
}

export interface ApplicationConfigurationContent {
  readonly q3Product?: Q3ApplicationProduct;
  readonly catalog: InstalledCatalog;
  readonly selection: ApplicationConfigurationSelection;
  readonly mounts: MountedContent;
  close(): Promise<void>;
}

export type ApplicationConfigurationRequest = { readonly kind: "launch"; readonly preset: LaunchPreset; readonly choice: LaunchChoice }
  | { readonly kind: "recipe"; readonly recipe: ExecutableRecipe };

/** Owns configuration mounts independently of any loaded world. */
export async function openApplicationConfigurationContent(catalog: InstalledCatalog, request: ApplicationConfigurationRequest, q3Product?: Q3ApplicationProduct): Promise<ApplicationConfigurationContent> {
  const product = await prepareQ3ApplicationProduct(catalog, request.kind === "recipe" ? request.recipe.map.entities.content : request.preset.map.entities.content, q3Product === undefined ? {} : { q3Product });
  catalog = product.catalog;
  const prepared = request.kind === "recipe" ? { selected: request.recipe, plan: request.recipe.mounts }
    : await prepareLaunchMountPlan({ catalog, preset: request.preset, choice: request.choice });
  const selected = prepared.selected;
  const selection: ApplicationConfigurationSelection = { source: selected.map.entities, engineBehavior: selected.engineBehavior,
    match: selected.match, combat: selected.combat, movement: selected.movement, timing: selected.timing };
  const mounts = await openMountPlan(prepared.plan, product.q3Product?.restriction.kind === "demo" ? { q3Restriction: "demo" } : {});
  return { catalog, selection, mounts, ...(product.q3Product === null ? {} : { q3Product: product.q3Product }), close: async () => { mounts.close(); } };
}

/** A map and every resolved reference retain their original archive identity. */
export class LoadedApplicationContent {
  private readonly weaponBehaviorOwners: PreparedWeaponBehavior[] = [];
  get preparedWeaponBehaviors(): readonly PreparedWeaponBehavior[] { return this.weaponBehaviorOwners; }
  async prepareWeaponBehaviors(): Promise<void> {
    const selections = this.recipe.weaponBehaviors ?? [];
    if (selections.length !== 0 && this.recipe.execution.some(module => module.role === "server-game" && module.kind !== "typescript"))
      throw new Error("Selected native or bytecode game has no shared projectile behavior hook");
    if (new Set(selections.map(value => value.definition.role)).size !== selections.length) throw new Error("Conflicting trajectory behaviors for one projectile role");
    for (const selection of selections) this.weaponBehaviorOwners.push(await prepareApplicationWeaponBehavior(this.catalog, selection, id => this.forContent(id)));
  }
  private readonly scoped = new Map<ContentId, Promise<MountedContent>>();
  private readonly lifecycle = { closed: false, mainMountLeases: 0 };
  private get closed(): boolean { return this.lifecycle.closed; }
  private readonly opened = new Set<MountedContent>();

  constructor(readonly catalog: InstalledCatalog, readonly recipe: ExecutableRecipe,
    readonly world: ApplicationWorld, readonly mounts: MountedContent, readonly preparedQuakeC: PreparedQuakeCSource | null = null,
    private readonly pure?: PureMountPolicy, readonly preparedQ3Game: PreparedQ3Game | null = null, readonly preparedQ2Game: PreparedClassicGuest | PreparedRereleaseGuest | null = null, readonly q3Product: Q3ApplicationProduct | null = null, readonly mapSidecars: readonly ApplicationMapSidecar[] = []) {}

  retainMainMounts(): () => void {
    if (this.closed) throw new Error("Application content is closed");
    const lifecycle = this.lifecycle, mounts = this.mounts;
    lifecycle.mainMountLeases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      lifecycle.mainMountLeases--;
      if (lifecycle.closed && lifecycle.mainMountLeases === 0) mounts.close();
    };
  }

  openedMounts(): readonly MountedContent[] { return this.closed ? [] : [this.mounts, ...this.opened]; }

  forContent(content: ContentId): Promise<MountedContent> {
    if (this.closed) throw new Error("Application content is closed");
    const existing = this.scoped.get(content);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<MountedContent> => {
      const primary = await this.catalog.mountsFor(content);
      const rules = content === this.recipe.map.entities.content && this.recipe.match.content !== content
        ? await this.catalog.mountsFor(this.recipe.match.content) : [];
      const mounts = [...new Map([...primary, ...rules].map(mount => [mount.identity.id, mount])).values()];
      const digests = new Set(mounts.flatMap(mount => mount.kind === "archive" ? [mount.archiveDigest] : []));
      const pure = this.pure === undefined ? undefined : { archives: this.pure.archives.filter(digest => digests.has(digest)) };
      if (this.pure !== undefined && this.pure.archives.length > 0 && pure?.archives.length === 0)
        throw new Error(`No server-approved archives provide ${content}`);
      const plan = { id: createMountPlanId("provider", Buffer.from(content).toString("hex")),
        mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] };
      const options: OpenMountOptions = { ...(pure === undefined ? {} : { pure }), ...(this.q3Product?.restriction.kind === "demo" ? { q3Restriction: "demo" } : {}) };
      const opened = this.mounts.borrowMountPlan(plan, options) ?? await openMountPlan(plan, options);
      if (this.closed) { opened.close(); throw new Error("Application content closed during mount"); }
      this.opened.add(opened);
      return opened;
    })();
    this.scoped.set(content, pending);
    return pending;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.lifecycle.closed = true;
    if (this.lifecycle.mainMountLeases === 0) this.mounts.close();
    for (const pending of this.scoped.values()) {
      const result = await pending.catch(() => null);
      result?.close();
    }
    this.scoped.clear();
    this.opened.clear();
  }
}

export function applicationOptionsForRecipe(options: ApplicationOptions, content: Pick<LoadedApplicationContent, "catalog" | "recipe">): ApplicationOptions {
  const recipe = content.recipe;
  const family = (provider: ProviderReference): GameFamily => {
    const prefix = provider.provider.split(":")[0];
    if (prefix === "q1" || prefix === "q2" || prefix === "q3") return prefix;
    throw new Error(`Application input has no adapter for ${provider.provider}`);
  };
  const character = family(recipe.character.definition), prefix = `${character}:model/`;
  if (!recipe.character.appearance.provider.startsWith(prefix)) throw new Error(`Application character has no model selection for ${recipe.character.appearance.provider}`);
  return { ...options, product: content.catalog.product(recipe.map.entities.content).expectation.id,
    map: recipe.map.geometry.requestedPath, mapProduct: content.catalog.product(recipe.map.geometryContent).expectation.id, movement: family(recipe.movement), character,
    characterModel: recipe.character.appearance.provider.slice(prefix.length),
    rules: recipe.match.provider === "q2:ctf" ? "ctf" : recipe.match.provider === "q2:lmctf" ? "lmctf" : recipe.match.provider === "q2:tag" ? "tag" : recipe.match.provider === "q2:deathball" ? "deathball" : recipe.match.provider === "q1:horde" ? "horde" : "standard" };
}

export async function resolveApplicationTravel(content: LoadedApplicationContent, path: string): Promise<ExecutableRecipe> {
  const recipe = content.recipe;
  const geometry = await resolveLaunchResource(content.catalog, content.mounts, { content: recipe.map.geometryContent, path }, "map");
  const resources = new Map(recipe.resources.map(resource => {
    const current = resource.id === recipe.map.geometry.id ? geometry : resource;
    return [current.id, current];
  }));
  return { ...recipe, map: { ...recipe.map, geometry }, resources: [...resources.values()] };
}

async function openMapContent(catalog: InstalledCatalog, recipe: ExecutableRecipe, q3Product: Q3ApplicationProduct | null): Promise<MountedContent> {
  const mounts = await catalog.mountsFor(recipe.map.geometryContent);
  return openMountPlan({ id: createMountPlanId("map-sidecars", Buffer.from(recipe.map.geometryContent).toString("hex")),
    mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] }, q3Product?.restriction.kind === "demo" ? { q3Restriction: "demo" } : {});
}

export async function loadApplicationContent(options: ApplicationOptions, restoredRecipe?: ExecutableRecipe, pure?: PureMountPolicy, installedCatalog?: InstalledCatalog, presentationSource?: ApplicationContentSource): Promise<LoadedApplicationContent> {
  const remote = options.remoteContent;
  if (remote !== undefined) {
    const network = remote.base === "q1-quakeworld" ? "qw-client" : remote.base === "q2-classic-baseq2" ? "q2-client" : "q3-client";
    const recordedFamily = remote.base === "q1-quakeworld" ? "qw" : remote.base === "q2-classic-baseq2" ? "q2" : "q3";
    if ((presentationSource === undefined ? options.network.kind !== network : presentationSource.family !== recordedFamily) || options.product !== remoteContentProduct(remote))
      throw new Error("Remote content context requires its matching remote client product");
  }
  let catalog = installedCatalog ?? await discoverInstalledContent({ corpusRoot: options.corpusRoot, userContentRoot: options.userContentRoot ?? defaultUserContentRoot(), discoverMods: applicationDiscoversMods(options, restoredRecipe),
    ...(remote === undefined ? {} : { remoteContent: remote }) });
  const product = await prepareQ3ApplicationProduct(catalog, restoredRecipe?.map.entities.content ?? options.product, options);
  catalog = product.catalog;
  if (product.q3Product !== null) options = { ...options, q3Product: product.q3Product };
  const mountOptions: OpenMountOptions = { ...(pure === undefined ? {} : { pure }), ...(product.q3Product?.restriction.kind === "demo" ? { q3Restriction: "demo" } : {}) };
  if (presentationSource !== undefined && catalog.require(options.product).expectation.family !== (presentationSource.family === "qw" ? "q1" : presentationSource.family))
    throw new Error("Recorded content family differs from the selected product");
  const resolveRecipe = async (): Promise<ExecutableRecipe> => {
    const preset = applicationPreset(catalog, options, undefined, presentationSource);
    return resolveLaunch({ catalog, preset, choice: presetChoice(preset.id), mounts: mountOptions });
  };
  let recipe = restoredRecipe ?? await resolveRecipe();
  if (restoredRecipe === undefined && presentationSource === undefined) {
    const configured = await prepareConfiguredApplicationRecipe(catalog, options, recipe);
    catalog = configured.catalog; recipe = configured.recipe;
  }
  for (const module of recipe.execution) {
    if (presentationSource?.kind === "unified") continue;
    if (module.kind === "qvm" && module.role === "server-game") {
      if (!options.dedicated && options.network.kind !== "offline" || options.network.kind !== "native-server" && options.network.kind !== "offline" || options.mode !== "deathmatch")
        throw new Error("Q3 bytecode requires offline local or dedicated Q3 server operation");
      assertQ3GuestRecipe(recipe, module);
      continue;
    }
    if (module.kind === "quakec") {
      const product = catalog.product(recipe.map.entities.content).expectation;
      const nativeQw = product.edition === "quakeworld" && module.api.kind === "q1-quakeworld" && options.mode === "deathmatch"
        && (options.network.kind === "offline" || options.network.kind === "native-server") && options.q1Protocol === undefined;
      const nativeNq = catalog.product(recipe.map.entities.content).expectation.family === "q1" && module.api.kind === "q1-netquake" && (options.network.kind === "offline" || options.network.kind === "native-server");
      if (nativeQw && !options.dedicated || !nativeQw && !nativeNq
        || options.network.kind !== "offline" && recipe.map.geometryContent !== recipe.map.entities.content || module.owner.provider !== recipe.map.entities.provider
        || module.owner.content !== recipe.map.entities.content || recipe.execution.length !== 1)
        throw new Error("QuakeC requires matching source actors and validated artifact; native network maps must belong to the source content and QuakeWorld requires dedicated operation");
      continue;
    }
    if (module.kind === "native" && module.role === "server-game" && (module.api.kind === "q2-classic-game" && module.profile.kind === "windows-i386" || module.api.kind === "q2-rerelease-game" && module.profile.kind === "windows-x86-64")) {
      const product = catalog.product(recipe.map.entities.content);
      if (product.expectation.family !== "q2" || (module.api.kind === "q2-rerelease-game" ? product.expectation.edition !== "rerelease" : product.expectation.edition !== "classic") || recipe.execution.length !== 1
        || module.owner.provider !== recipe.map.entities.provider || module.owner.content !== recipe.map.entities.content
        || recipe.movement.provider !== "q2:movement" || recipe.character.definition.provider !== "q2:character" || recipe.enemies.kind !== "map-defined"
        || recipe.weapons.some(weapon => weapon.provider !== recipe.map.entities.provider || weapon.content !== recipe.map.entities.content))
        throw new Error("Native Quake II requires edition-matching actors, movement, character and arsenal");
      continue;
    }
    if (module.kind !== "typescript") throw new Error(`Application cannot execute ${module.kind} ${module.role} module ${module.owner.provider} (${module.artifact.requestedPath}): this executor is not joined to the shared simulation. Select a supported TypeScript execution module.`);
  }
  const mounts = await openMountPlan(recipe.mounts, mountOptions);
  try {
    if (pure !== undefined) {
      const geometry = await resolveLaunchResource(catalog, mounts, { content: recipe.map.geometryContent, path: recipe.map.geometry.requestedPath }, "map");
      const oldGeometry = recipe.map.geometry;
      recipe = { ...recipe, mounts: mounts.plan, map: { ...recipe.map, geometry },
        resources: recipe.resources.map(resource => resource.id === oldGeometry.id ? geometry : resource) };
    }
    const bytes = await mounts.read(recipe.map.geometry);
    const map = recipe.map.geometry.requestedPath;
    const family = classifyBsp(bytes, map);
    let world: ApplicationWorld;
    const mapSidecars: ApplicationMapSidecar[] = [];
    if (family === "q1") {
      using mapContent = await openMapContent(catalog, recipe, product.q3Product);
      const [entities, lit] = await Promise.all([mapContent.open(map.replace(/\.bsp$/, ".ent")), mapContent.open(map.replace(/\.bsp$/, ".lit"))]);
      mapSidecars.push({ content: recipe.map.geometryContent, path: map.replace(/\.bsp$/, ".ent"), resource: entities?.reference ?? null },
        { content: recipe.map.geometryContent, path: map.replace(/\.bsp$/, ".lit"), resource: lit?.reference ?? null });
      world = readQ1Bsp(bytes, { source: map, ...(entities === null ? {} : { entities: entities.bytes }), ...(lit === null ? {} : { lit: lit.bytes }) });
    } else if (family === "q2") {
      using mapContent = await openMapContent(catalog, recipe, product.q3Product);
      const raw = readQ2Bsp(bytes, map);
      const materials = new Map<string, Uint8Array>();
      await Promise.all([...new Set(raw.textureInfo.map(texture => `textures/${texture.name}.mat`))].map(async path => {
        const asset = await mapContent.open(path);
        mapSidecars.push({ content: recipe.map.geometryContent, path, resource: asset?.reference ?? null });
        if (asset !== null) materials.set(path, asset.bytes);
      }));
      world = toQ2WorldGeometry(raw, { readMaterial: path => materials.get(path) ?? null });
    } else world = decodeQ3World(bytes, map);
    const execution = recipe.execution.find(module => module.kind === "quakec");
    if (execution?.kind === "quakec" && options.network.kind === "native-server" && world.kind !== "q1-bsp")
      throw new Error("Native Quake clients require Quake BSP geometry");
    let prepared: PreparedQuakeCSource | null = null;
    if (presentationSource?.kind !== "unified" && execution?.kind === "quakec" && recipe.map.geometryContent !== execution.owner.content) {
      const sourceMounts = await catalog.mountsFor(execution.owner.content);
      const plan = { id: createMountPlanId("quakec-source", Buffer.from(execution.owner.content).toString("hex")),
        mounts: sourceMounts, defaultOrder: sourceMounts.map(mount => mount.identity.id), prefixOrders: [] };
      using sourceContent = mounts.borrowMountPlan(plan) ?? await openMountPlan(plan);
      prepared = await prepareQuakeCSource(execution, mounts, world.entities, sourceContent);
    } else if (presentationSource?.kind !== "unified" && execution?.kind === "quakec") prepared = await prepareQuakeCSource(execution, mounts, world.entities);
    const q3Execution = recipe.execution.find(module => module.kind === "qvm" && module.role === "server-game");
    const q3Prepared = presentationSource?.kind !== "unified" && q3Execution?.kind === "qvm" && q3Execution.role === "server-game" ? await prepareQ3Game(q3Execution, mounts) : null;
    const q2Execution = recipe.execution.find(module => module.kind === "native" && module.role === "server-game");
    const q2Prepared = presentationSource?.kind !== "unified" && q2Execution?.kind === "native" ? q2Execution.api.kind === "q2-rerelease-game" ? await prepareRereleaseGuest(q2Execution, mounts) : await prepareClassicGuest(q2Execution, mounts) : null;
    if (q2Prepared !== null) prepareNativeQ2Map(world, q2Prepared.execution.api.kind === "q2-rerelease-game" ? "rerelease" : "classic", options.mode);
    const loaded = new LoadedApplicationContent(catalog, recipe, world, mounts, prepared, pure, q3Prepared, q2Prepared, product.q3Product, mapSidecars.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    try { if (presentationSource === undefined) await loaded.prepareWeaponBehaviors(); return loaded; }
    catch (error) { await loaded.close(); throw error; }
  } catch (error) {
    mounts.close();
    throw error;
  }
}
