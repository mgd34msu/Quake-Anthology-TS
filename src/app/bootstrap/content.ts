import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { findContentPath } from "../../content/mounts/paths.ts";
import { userProductDirectory } from "../../content/user-data.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { prepareQuakeCSource, type PreparedQuakeCSource } from "./simulation/quakec-source.ts";
import { assertQ3GuestRecipe, prepareQ3Game } from "./simulation/q3/guest-artifact.ts";
import type { PreparedQ3Game } from "./simulation/q3/guest-artifact.ts";
import { resolveLaunchResource } from "../../content/catalog/launch.ts";
import { nativeProviderTiming } from "../../content/catalog/timing.ts";
import type { ContentId, ExecutableRecipe, ExecutionSelection, GameFamily, ProviderReference } from "../../contracts/content.ts";
import { createMountPlanId, createRecipeId } from "../../contracts/content.ts";
import type { Q3WorldGeometry } from "../../contracts/scene.ts";
import { discoverInstalledContent, remoteContentProduct, remoteContentSelection, expectedProducts, nativeEquipment, presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import type { InstalledCatalog, LaunchPreset, CatalogProduct, RemoteContentSelection } from "../../content/catalog/index.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import type { MountedContent, PureMountPolicy } from "../../content/mounts/index.ts";
import { readQ1Bsp } from "../../formats/q1-map/index.ts";
import type { Q1Map } from "../../formats/q1-map/index.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../formats/q2-map/index.ts";
import type { Q2DecodedMap } from "../../formats/q2-map/index.ts";
import { decodeQ3World } from "../../formats/q3-map/index.ts";
import type { ApplicationOptions } from "./options.ts";

export type ApplicationWorld = Q1Map | Q2DecodedMap | Q3WorldGeometry;

export interface RemoteContentMounts {
  readonly selection: RemoteContentSelection;
  readonly catalog: InstalledCatalog;
  readonly product: CatalogProduct;
  readonly mounts: MountedContent;
  readonly writeRoot: string;
  readonly baseWriteRoot: string;
}

export async function openRemoteContent(roots: Pick<ApplicationOptions, "corpusRoot" | "userContentRoot">,
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
  const catalog = await discoverInstalledContent({ ...roots, userContentRoot: userRoot, discoverMods: false, remoteContent: selection, generation });
  assertCurrent();
  catalog.require(selection.base);
  const product = catalog.require(remoteContentProduct(selection));
  if ((product.userContent?.root ?? product.looseRoot) !== writeRoot) throw new Error("Remote download directory does not match its content owner");
  const mounts = await catalog.mountsFor(product.id); assertCurrent();
  const opened = await openMountPlan({ id: createMountPlanId("remote-server", String(generation)), mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  try { assertCurrent(); }
  catch (error) { opened.close(); throw error; }
  return { selection, catalog, product, mounts: opened, writeRoot, baseWriteRoot };
}

export type MountedApplicationContent = Pick<LoadedApplicationContent, "catalog" | "mounts" | "close">;

export async function openRemoteApplicationContent(options: ApplicationOptions): Promise<MountedApplicationContent> {
  const selection = options.remoteContent ?? (options.network.kind === "qw-client" ? remoteContentSelection("q1-quakeworld", "qw")
    : options.network.kind === "q3-client" ? remoteContentSelection("q3-baseq3", "baseq3")
    : options.network.kind === "q2-client" ? remoteContentSelection("q2-classic-baseq2", "baseq2") : undefined);
  if (selection !== undefined) {
    const content = await openRemoteContent(options, selection, () => {});
    return { catalog: content.catalog, mounts: content.mounts, close: async () => { content.mounts.close(); } };
  }
  const catalog = await discoverInstalledContent({ corpusRoot: options.corpusRoot,
    userContentRoot: options.userContentRoot ?? defaultUserContentRoot(), discoverMods: false });
  const product = catalog.require(options.product), mounts = await catalog.mountsFor(product.id);
  const opened = await openMountPlan({ id: createMountPlanId("remote-connection", options.product), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  return { catalog, mounts: opened, close: async () => { opened.close(); } };
}

function baseProduct(family: GameFamily): string {
  switch (family) {
    case "q1": return "q1-classic-id1";
    case "q2": return "q2-classic-baseq2";
    case "q3": return "q3-baseq3";
  }
}


function execution(provider: ProviderReference, family: GameFamily, rerelease: boolean): ExecutionSelection {
  const common = { kind: "typescript", owner: provider, implementation: provider.provider, role: "server-game" } satisfies Pick<ExecutionSelection, "kind" | "owner" | "role"> & { readonly implementation: ProviderReference["provider"] };
  switch (family) {
    case "q1": return { ...common, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } };
    case "q2": return rerelease ? { ...common, api: { kind: "q2-rerelease-game", version: 2023 } } : { ...common, api: { kind: "q2-classic-game", version: 3 } };
    case "q3": return { ...common, api: { kind: "q3-qagame", version: 8 } };
  }
}

export function applicationPreset(catalog: InstalledCatalog, options: ApplicationOptions, nativeSources?: { readonly movement: ProviderReference; readonly character: ProviderReference }): LaunchPreset {
  const product = catalog.require(options.product), family = product.expectation.family;
  const q3Guest = family === "q3" && options.network.kind !== "q3-client" && !expectedProducts.some(builtin => builtin.id === product.expectation.id);
  if (q3Guest && (!options.dedicated && options.network.kind !== "offline" || options.network.kind !== "native-server" && options.network.kind !== "offline" || options.mode !== "deathmatch"
    || options.movement !== "q3" || options.character !== "q3" || options.botSkill !== undefined))
    throw new Error("Selected Q3 mods require an offline local or dedicated server with native Q3 movement and character, deathmatch and bots disabled");
  const quakeworld = product.expectation.id === "q1-quakeworld" && options.network.kind !== "qw-client";
  const nativeProgram = options.quakeCProgram;
  if (nativeProgram !== undefined && (!(product.expectation.id === "q1-classic-id1" || product.expectation.id === "q1-classic-hipnotic")
    || !options.dedicated || options.network.kind !== "offline" || options.movement !== "q1" || options.character !== "q1"))
    throw new Error("--progs requires dedicated offline classic id1 or Hipnotic with Q1 movement and character");
  if (quakeworld && (!options.dedicated || options.mode !== "deathmatch" || options.movement !== "q1" || options.character !== "q1"
    || options.q1Protocol !== undefined || options.network.kind !== "offline" && options.network.kind !== "native-server"))
    throw new Error("Native QuakeWorld currently requires dedicated deathmatch with Q1 movement and character; NetQuake protocol overrides and mixed roles are unsupported");
  const provider: ProviderReference = { provider: `${family}:official`, content: product.id };
  const movement: ProviderReference = nativeSources?.movement ?? { provider: `${options.movement}:movement`, content: quakeworld || q3Guest ? product.id : catalog.require(baseProduct(options.movement)).id };
  const character: ProviderReference = nativeSources?.character ?? { provider: `${options.character}:character`, content: quakeworld || q3Guest ? product.id : catalog.require(baseProduct(options.character)).id };
  const appearance: ProviderReference = { provider: `${options.character}:model/${options.characterModel}`, content: character.content };
  const rerelease = product.expectation.edition === "rerelease";
  const timing = (reference: ProviderReference, source: GameFamily, edition: boolean) => {
    const native = nativeProviderTiming(reference, source, edition);
    return quakeworld ? { ...native, clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 } satisfies typeof native.clock } : native;
  };
  const providerTiming = timing(provider, family, rerelease);
  const rules = options.rules ?? (family === "q2" && !rerelease && (product.expectation.campaign === "ctf" || product.expectation.campaign === "lmctf") ? product.expectation.campaign : "standard");
  if (rules !== "standard" && (family !== "q2" || rerelease)) throw new Error(`${rules} requires a classic Quake II game provider`);
  const match: ProviderReference = rules === "standard" ? provider : { provider: `q2:${rules}`, content: catalog.require(`q2-classic-${rules}`).id };
  return { id: createRecipeId("mixed", `${options.product}-${options.movement}-${options.character}-${options.characterModel}${rules === "standard" ? "" : `-${rules}`}`),
    map: { geometry: { content: product.id, path: options.map }, entities: provider },
    campaign: options.mode === "deathmatch" ? { kind: "none" } : { kind: "campaign", mission: provider, gamecode: provider }, movement,
    character: { definition: character, appearance }, weapons: [provider], equipment: nativeEquipment(catalog, provider, match), enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider },
    engineBehavior: provider, combat: provider, inventory: provider, match, transition: provider,
    execution: [q3Guest ? { kind: "qvm", owner: provider, role: "server-game", artifact: { content: product.id, path: "vm/qagame.qvm" },
      api: { kind: "q3-qagame", version: 8 } } : quakeworld ? { kind: "quakec", owner: provider, role: "server-game", artifact: { content: product.id, path: "qwprogs.dat" },
      api: { kind: "q1-quakeworld", programVersion: 6, systemCrc: 54730 } } : nativeProgram !== undefined
        ? { kind: "quakec", owner: provider, role: "server-game", artifact: { content: product.id, path: nativeProgram },
          api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } } : execution(provider, family, rerelease)],
    timing: [providerTiming, timing(movement, options.movement, catalog.product(movement.content).expectation.edition === "rerelease"), timing(character, options.character, catalog.product(character.content).expectation.edition === "rerelease")],
    ordering: { kind: "mixed", providers: [provider.provider, movement.provider, character.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" } };
}

/** A map and every resolved reference retain their original archive identity. */
export class LoadedApplicationContent {
  private readonly scoped = new Map<ContentId, Promise<MountedContent>>();
  private closed = false;
  private readonly opened = new Set<MountedContent>();

  constructor(readonly catalog: InstalledCatalog, readonly recipe: ExecutableRecipe,
    readonly world: ApplicationWorld, readonly mounts: MountedContent, readonly preparedQuakeC: PreparedQuakeCSource | null = null,
    private readonly pure?: PureMountPolicy, readonly preparedQ3Game: PreparedQ3Game | null = null) {}

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
      const options = pure === undefined ? {} : { pure };
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
    this.closed = true;
    this.mounts.close();
    for (const pending of this.scoped.values()) {
      const result = await pending.catch(() => null);
      result?.close();
    }
    this.scoped.clear();
    this.opened.clear();
  }
}

export function applicationOptionsForRecipe(options: ApplicationOptions, content: LoadedApplicationContent): ApplicationOptions {
  const recipe = content.recipe;
  const family = (provider: ProviderReference): GameFamily => {
    const prefix = provider.provider.split(":")[0];
    if (prefix === "q1" || prefix === "q2" || prefix === "q3") return prefix;
    throw new Error(`Application input has no adapter for ${provider.provider}`);
  };
  const character = family(recipe.character.definition), prefix = `${character}:model/`;
  if (!recipe.character.appearance.provider.startsWith(prefix)) throw new Error(`Application character has no model selection for ${recipe.character.appearance.provider}`);
  return { ...options, product: content.catalog.product(recipe.map.entities.content).expectation.id,
    map: recipe.map.geometry.requestedPath, movement: family(recipe.movement), character,
    characterModel: recipe.character.appearance.provider.slice(prefix.length),
    rules: recipe.match.provider === "q2:ctf" ? "ctf" : recipe.match.provider === "q2:lmctf" ? "lmctf" : "standard" };
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

async function openMapContent(catalog: InstalledCatalog, recipe: ExecutableRecipe): Promise<MountedContent> {
  const mounts = await catalog.mountsFor(recipe.map.geometryContent);
  return openMountPlan({ id: createMountPlanId("map-sidecars", Buffer.from(recipe.map.geometryContent).toString("hex")),
    mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
}

export async function loadApplicationContent(options: ApplicationOptions, restoredRecipe?: ExecutableRecipe, pure?: PureMountPolicy): Promise<LoadedApplicationContent> {
  const remote = options.remoteContent;
  if (remote !== undefined) {
    const network = remote.base === "q1-quakeworld" ? "qw-client" : remote.base === "q2-classic-baseq2" ? "q2-client" : "q3-client";
    if (options.network.kind !== network || options.product !== remoteContentProduct(remote))
      throw new Error("Remote content context requires its matching remote client product");
  }
  const catalog = await discoverInstalledContent({ corpusRoot: options.corpusRoot, userContentRoot: options.userContentRoot ?? defaultUserContentRoot(), discoverMods: options.dedicated || options.network.kind === "offline" && (options.movement === "q3" && options.character === "q3"
      || restoredRecipe?.execution.some(module => module.kind === "qvm" && module.role === "server-game") === true),
    ...(remote === undefined ? {} : { remoteContent: remote }) });
  const resolveRecipe = async (): Promise<ExecutableRecipe> => {
    const preset = applicationPreset(catalog, options);
    return resolveLaunch({ catalog, preset, choice: presetChoice(preset.id), ...(pure === undefined ? {} : { mounts: { pure } }) });
  };
  let recipe = restoredRecipe ?? await resolveRecipe();
  for (const module of recipe.execution) {
    if (module.kind === "qvm" && module.role === "server-game") {
      if (!options.dedicated && options.network.kind !== "offline" || options.network.kind !== "native-server" && options.network.kind !== "offline" || options.mode !== "deathmatch" || options.botSkill !== undefined
        || catalog.product(recipe.map.geometryContent).expectation.family !== "q3")
        throw new Error("Q3 bytecode requires offline local or dedicated Q3 server operation with bots disabled");
      assertQ3GuestRecipe(recipe, module);
      continue;
    }
    if (module.kind === "quakec") {
      const product = catalog.product(recipe.map.entities.content).expectation.id;
      const nativeQw = product === "q1-quakeworld" && module.api.kind === "q1-quakeworld" && options.mode === "deathmatch"
        && (options.network.kind === "offline" || options.network.kind === "native-server") && options.q1Protocol === undefined;
      const nativeNq = (product === "q1-classic-id1" || product === "q1-classic-hipnotic") && module.api.kind === "q1-netquake" && options.network.kind === "offline";
      if (!options.dedicated || !nativeQw && !nativeNq
        || recipe.map.geometryContent !== recipe.map.entities.content || module.owner.provider !== recipe.map.entities.provider
        || module.owner.content !== recipe.map.entities.content || recipe.execution.length !== 1)
        throw new Error("QuakeC application execution requires a dedicated native classic id1, Hipnotic or QuakeWorld map and its validated server artifact; mixed roles and saves are unsupported");
      continue;
    }
    if (module.kind !== "typescript") throw new Error(`Application cannot execute ${module.kind} ${module.role} module ${module.owner.provider} (${module.artifact.requestedPath}): this executor is not joined to the shared simulation. Select a supported TypeScript execution module.`);
  }
  const mounts = await openMountPlan(recipe.mounts, pure === undefined ? {} : { pure });
  try {
    if (pure !== undefined) {
      const geometry = await resolveLaunchResource(catalog, mounts, { content: recipe.map.geometryContent, path: recipe.map.geometry.requestedPath }, "map");
      const oldGeometry = recipe.map.geometry;
      recipe = { ...recipe, mounts: mounts.plan, map: { ...recipe.map, geometry },
        resources: recipe.resources.map(resource => resource.id === oldGeometry.id ? geometry : resource) };
    }
    const bytes = await mounts.read(recipe.map.geometry);
    const family = catalog.product(recipe.map.geometry.provenance.mount.identity.content).expectation.family;
    const map = recipe.map.geometry.requestedPath;
    let world: ApplicationWorld;
    if (family === "q1") {
      using mapContent = await openMapContent(catalog, recipe);
      const [entities, lit] = await Promise.all([mapContent.open(map.replace(/\.bsp$/, ".ent")), mapContent.open(map.replace(/\.bsp$/, ".lit"))]);
      world = readQ1Bsp(bytes, { source: map, ...(entities === null ? {} : { entities: entities.bytes }), ...(lit === null ? {} : { lit: lit.bytes }) });
    } else if (family === "q2") {
      using mapContent = await openMapContent(catalog, recipe);
      const raw = readQ2Bsp(bytes, map);
      const materials = new Map<string, Uint8Array>();
      await Promise.all([...new Set(raw.textureInfo.map(texture => `textures/${texture.name}.mat`))].map(async path => {
        const asset = await mapContent.open(path);
        if (asset !== null) materials.set(path, asset.bytes);
      }));
      world = toQ2WorldGeometry(raw, { readMaterial: path => materials.get(path) ?? null });
    } else world = decodeQ3World(bytes, map);
    const execution = recipe.execution.find(module => module.kind === "quakec");
    const prepared = execution?.kind === "quakec" ? await prepareQuakeCSource(execution, mounts, world.entities) : null;
    const q3Execution = recipe.execution.find(module => module.kind === "qvm" && module.role === "server-game");
    const q3Prepared = q3Execution?.kind === "qvm" && q3Execution.role === "server-game" ? await prepareQ3Game(q3Execution, mounts) : null;
    if (q3Prepared !== null && world.kind !== "q3-bsp") throw new Error("Q3 bytecode requires native Q3 geometry");
    return new LoadedApplicationContent(catalog, recipe, world, mounts, prepared, pure, q3Prepared);
  } catch (error) {
    mounts.close();
    throw error;
  }
}
