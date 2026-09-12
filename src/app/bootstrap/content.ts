import { prepareQuakeCSource, type PreparedQuakeCSource } from "./simulation/quakec-source.ts";
import { resolveLaunchResource } from "../../content/catalog/launch.ts";
import { nativeProviderTiming } from "../../content/catalog/timing.ts";
import type { ContentId, ExecutableRecipe, ExecutionSelection, GameFamily, ProviderReference } from "../../contracts/content.ts";
import { createMountPlanId, createRecipeId } from "../../contracts/content.ts";
import type { Q3WorldGeometry } from "../../contracts/scene.ts";
import { discoverInstalledContent, nativeEquipment, presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import type { InstalledCatalog, LaunchPreset } from "../../content/catalog/index.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { readQ1Bsp } from "../../formats/q1-map/index.ts";
import type { Q1Map } from "../../formats/q1-map/index.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../formats/q2-map/index.ts";
import type { Q2DecodedMap } from "../../formats/q2-map/index.ts";
import { decodeQ3World } from "../../formats/q3-map/index.ts";
import type { ApplicationOptions } from "./options.ts";

export type ApplicationWorld = Q1Map | Q2DecodedMap | Q3WorldGeometry;

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

export function applicationPreset(catalog: InstalledCatalog, options: ApplicationOptions): LaunchPreset {
  const product = catalog.require(options.product), family = product.expectation.family;
  const provider: ProviderReference = { provider: `${family}:official`, content: product.id };
  const movement: ProviderReference = { provider: `${options.movement}:movement`, content: catalog.require(baseProduct(options.movement)).id };
  const character: ProviderReference = { provider: `${options.character}:character`, content: catalog.require(baseProduct(options.character)).id };
  const appearance: ProviderReference = { provider: `${options.character}:model/${options.characterModel}`, content: character.content };
  const rerelease = product.expectation.edition === "rerelease";
  const providerTiming = nativeProviderTiming(provider, family, rerelease);
  const rules = options.rules ?? (family === "q2" && !rerelease && (product.expectation.campaign === "ctf" || product.expectation.campaign === "lmctf") ? product.expectation.campaign : "standard");
  if (rules !== "standard" && (family !== "q2" || rerelease)) throw new Error(`${rules} requires a classic Quake II game provider`);
  const match: ProviderReference = rules === "standard" ? provider : { provider: `q2:${rules}`, content: catalog.require(`q2-classic-${rules}`).id };
  return { id: createRecipeId("mixed", `${options.product}-${options.movement}-${options.character}-${options.characterModel}${rules === "standard" ? "" : `-${rules}`}`),
    map: { geometry: { content: product.id, path: options.map }, entities: provider },
    campaign: options.mode === "deathmatch" ? { kind: "none" } : { kind: "campaign", mission: provider, gamecode: provider }, movement,
    character: { definition: character, appearance }, weapons: [provider], equipment: nativeEquipment(catalog, provider, match), enemies: { kind: "map-defined" },
    presentation: { assets: product.id, hud: provider, effects: provider, audio: provider },
    engineBehavior: provider, combat: provider, inventory: provider, match, transition: provider,
    execution: [execution(provider, family, rerelease)],
    timing: [providerTiming, nativeProviderTiming(movement, options.movement, false), nativeProviderTiming(character, options.character, false)],
    ordering: { kind: "mixed", providers: [provider.provider, movement.provider, character.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" } };
}

/** A map and every resolved reference retain their original archive identity. */
export class LoadedApplicationContent {
  private readonly scoped = new Map<ContentId, Promise<MountedContent>>();
  private closed = false;
  private readonly opened = new Set<MountedContent>();

  constructor(readonly catalog: InstalledCatalog, readonly recipe: ExecutableRecipe,
    readonly world: ApplicationWorld, readonly mounts: MountedContent, readonly preparedQuakeC: PreparedQuakeCSource | null = null) {}

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
      const opened = await openMountPlan({ id: createMountPlanId("provider", Buffer.from(content).toString("hex")),
        mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
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

export async function loadApplicationContent(options: ApplicationOptions, restoredRecipe?: ExecutableRecipe): Promise<LoadedApplicationContent> {
  const catalog = await discoverInstalledContent({ corpusRoot: options.corpusRoot, discoverMods: false });
  const resolveRecipe = async (): Promise<ExecutableRecipe> => {
    const preset = applicationPreset(catalog, options);
    return resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) });
  };
  const recipe = restoredRecipe ?? await resolveRecipe();
  for (const module of recipe.execution) {
    if (module.kind === "quakec") {
      if (!options.dedicated || options.network.kind !== "offline" || catalog.product(recipe.map.entities.content).expectation.id !== "q1-classic-id1"
        || recipe.map.geometryContent !== recipe.map.entities.content || module.owner.provider !== recipe.map.entities.provider
        || module.owner.content !== recipe.map.entities.content || recipe.execution.length !== 1)
        throw new Error("QuakeC application execution currently requires an explicit dedicated native classic id1 map and one known id1 server artifact; clients and saves are unsupported");
      continue;
    }
    if (module.kind !== "typescript") throw new Error(`Application cannot execute ${module.kind} ${module.role} module ${module.owner.provider} (${module.artifact.requestedPath}): this executor is not joined to the shared simulation. Select a supported TypeScript execution module.`);
  }
  const mounts = await openMountPlan(recipe.mounts);
  try {
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
    const prepared = execution?.kind === "quakec" ? await prepareQuakeCSource(execution, mounts) : null;
    return new LoadedApplicationContent(catalog, recipe, world, mounts, prepared);
  } catch (error) {
    mounts.close();
    throw error;
  }
}
