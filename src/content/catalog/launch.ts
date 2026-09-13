import type { CampaignSelection, CharacterSelection, ContentId, ContentMount, EnemySelection, EquipmentSelection, ExecutableRecipe, ExecutionSelection, LaunchChoice, LaunchSelection, MapSelection, MountId, PresentationSelection, ProviderReference, RecipeId, ResolvedExecutionModule, ResolvedMountPlan, ResolvedResourceReference, ResourceRequest } from "../../contracts/content.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import { openMountPlan } from "../mounts/index.ts";
import type { MountedContent, OpenMountOptions } from "../mounts/index.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import type { InstalledCatalog } from "./index.ts";
import { EQUIPMENT_PROVIDERS, equipmentProviders, equipmentResources, equipmentTiming, validateEquipment } from "./equipment.ts";
import { selectedMonsterDefinitions, monsterResources, monsterSources, selectedMonsterTiming, validateMonsters } from "./monsters.ts";
import { admitWeaponTiming, canonicalWeaponSource, Q1_HIPNOTIC_WEAPON_PROVIDERS, Q1_WEAPON_PROVIDERS, Q2_WEAPON_PROVIDERS, selectedWeaponResources, selectedWeaponTiming } from "./weapons.ts";

export interface LaunchPreset extends Omit<ExecutableRecipe, "schemaVersion" | "preset" | "map" | "execution" | "mounts" | "resources"> {
  readonly map: MapSelection;
  readonly execution: readonly ExecutionSelection[];
}

export interface SelectedLaunch extends LaunchPreset { readonly preset: RecipeId; }

export interface ResolveLaunchOptions {
  readonly choice: LaunchChoice;
  readonly preset: LaunchPreset;
  readonly catalog: InstalledCatalog;
  readonly id?: RecipeId;
  readonly mounts?: OpenMountOptions;
}

function selection<T>(choice: LaunchSelection<T>, preset: T): T { return choice.kind === "selected" ? choice.value : preset; }

export function presetChoice(preset: RecipeId): LaunchChoice {
  return { preset, map: { kind: "preset" }, campaign: { kind: "preset" }, movement: { kind: "preset" }, character: { kind: "preset" },
    weapons: { kind: "preset" }, equipment: { kind: "preset" }, enemies: { kind: "preset" }, presentation: { kind: "preset" }, engineBehavior: { kind: "preset" },
    combat: { kind: "preset" }, inventory: { kind: "preset" }, match: { kind: "preset" }, transition: { kind: "preset" }, execution: { kind: "preset" } };
}

/** Selecting behavior cannot replace campaign gamecode, movement, character or assets. */
export function selectLaunch(choice: LaunchChoice, preset: LaunchPreset, id: RecipeId = preset.id): SelectedLaunch {
  if (choice.preset !== preset.id) throw new RangeError(`Requested preset ${choice.preset} does not match supplied preset ${preset.id}`);
  return { ...preset, id, preset: preset.id, map: selection<MapSelection>(choice.map, preset.map), campaign: selection<CampaignSelection>(choice.campaign, preset.campaign),
    movement: selection<ProviderReference>(choice.movement, preset.movement), character: selection<CharacterSelection>(choice.character, preset.character),
    weapons: selection<readonly ProviderReference[]>(choice.weapons, preset.weapons), enemies: selection<EnemySelection>(choice.enemies, preset.enemies),
    equipment: selection<EquipmentSelection>(choice.equipment, preset.equipment),
    presentation: selection<PresentationSelection>(choice.presentation, preset.presentation), engineBehavior: selection<ProviderReference>(choice.engineBehavior, preset.engineBehavior),
    combat: selection<ProviderReference>(choice.combat, preset.combat), inventory: selection<ProviderReference>(choice.inventory, preset.inventory),
    match: selection<ProviderReference>(choice.match, preset.match), transition: selection<ProviderReference>(choice.transition, preset.transition),
    execution: selection<readonly ExecutionSelection[]>(choice.execution, preset.execution) };
}

function requiredContent(launch: SelectedLaunch): readonly ContentId[] {
  const references: ProviderReference[] = [launch.map.entities, launch.movement, launch.character.definition, launch.character.appearance,
    ...launch.weapons, ...equipmentProviders(launch.equipment), launch.engineBehavior, launch.combat, launch.inventory, launch.match, launch.transition,
    launch.presentation.hud, launch.presentation.effects, launch.presentation.audio, ...launch.execution.map(module => module.owner)];
  if (launch.campaign.kind === "campaign") references.push(launch.campaign.mission, launch.campaign.gamecode);
  references.push(...selectedMonsterDefinitions(launch.enemies).map(definition => definition.source));
  return [...new Set([launch.map.geometry.content, launch.presentation.assets, ...(launch.presentation.environment.kind === "selected" ? [launch.presentation.environment.resource.content] : []), ...references.map(reference => reference.content),
    ...launch.execution.flatMap(module => module.kind === "typescript" ? [] : [module.artifact.content])])];
}

function mountPath(mount: ContentMount): string { return mount.kind === "archive" ? mount.archivePath : mount.rootPath; }

export async function resolveLaunchResource(catalog: InstalledCatalog, mounted: MountedContent,
  request: ResourceRequest, kind: "map" | "artifact"): Promise<ResolvedResourceReference> {
  const resolved = await mounted.resolve(request.path);
  if (resolved === null) throw new Error(`Required resource is missing: ${request.content}/${request.path}`);
  const allowed = await catalog.mountsFor(request.content);
  if (!allowed.some(mount => mountPath(mount) === mountPath(resolved.provenance.mount))) {
    throw new Error(`Required ${kind} is absent from its selected content and base: ${request.content}/${request.path}`);
  }
  return resolved;
}

async function orderForContent(catalog: InstalledCatalog, plan: ResolvedMountPlan, content: ContentId): Promise<readonly MountId[]> {
  const first = await catalog.mountsFor(content);
  const byPath = new Map(plan.mounts.map(mount => [mountPath(mount), mount.identity.id]));
  const order = new Set<MountId>();
  for (const mount of first) {
    const id = byPath.get(mountPath(mount));
    if (id !== undefined) order.add(id);
  }
  for (const id of plan.defaultOrder) order.add(id);
  return [...order];
}

export async function resolveLaunch(options: ResolveLaunchOptions): Promise<ExecutableRecipe> {
  const choice = selectLaunch(options.choice, options.preset, options.id);
  const selected = { ...choice, weapons: choice.weapons.map(weapon => canonicalWeaponSource(choice.map.entities, weapon, options.catalog)) };
  validateEquipment(selected.equipment, options.catalog);
  validateMonsters(selected.enemies, options.catalog);
  const required = requiredContent(selected);
  for (const content of required) options.catalog.require(content);
  const executionRoles = new Set<string>();
  for (const module of selected.execution) {
    const key = `${module.owner.provider}/${module.role}`;
    if (executionRoles.has(key)) throw new Error(`Conflicting execution modules for ${key}`);
    executionRoles.add(key);
  }
  const basePlan = await options.catalog.createMountPlan({ id: createMountPlanId("launch", Buffer.from(selected.id).toString("hex")),
    assets: selected.presentation.assets, geometry: selected.map.geometry.content, rules: selected.combat.content,
    explicitPresentation: options.choice.presentation.kind === "selected", additional: required });
  const artifacts = new Map<string, ContentId>();
  for (const module of selected.execution) {
    if (module.kind === "typescript") continue;
    const path = normalizeResourcePath(module.artifact.path);
    const previous = artifacts.get(path);
    if (previous !== undefined && previous !== module.artifact.content) throw new Error(`Conflicting artifact sources for ${path}: ${previous} and ${module.artifact.content}`);
    artifacts.set(path, module.artifact.content);
  }
  const artifactOrders: ResolvedMountPlan["prefixOrders"][number][] = [];
  for (const [prefix, content] of artifacts) artifactOrders.push({ prefix, mounts: await orderForContent(options.catalog, basePlan, content) });
  const plan: ResolvedMountPlan = { ...basePlan, prefixOrders: [...artifactOrders, ...basePlan.prefixOrders] };
  using mounted = await openMountPlan(plan, options.mounts);
  const resources = new Map<ResolvedResourceReference["id"], ResolvedResourceReference>();
  const resolveResource = async (request: ResourceRequest, kind: "map" | "artifact"): Promise<ResolvedResourceReference> => {
    const resolved = await resolveLaunchResource(options.catalog, mounted, request, kind);
    resources.set(resolved.id, resolved);
    return resolved;
  };
  const geometry = await resolveResource(selected.map.geometry, "map");
  const sourceResources = [
    { kind: "weapon", requests: selectedWeaponResources(selected.map.entities, selected.weapons, options.catalog) },
    { kind: "equipment", requests: equipmentResources(selected.equipment) },
    { kind: "monster", requests: monsterResources(selected.enemies) },
    { kind: "environment", requests: selected.presentation.environment.kind === "selected" ? [selected.presentation.environment.resource] : [] },
  ];
  for (const group of sourceResources) {
    for (const content of new Set(group.requests.map(request => request.content))) {
      const order = await orderForContent(options.catalog, mounted.plan, content);
      const allowed = await options.catalog.mountsFor(content);
      using sourceMounts = await openMountPlan({ ...mounted.plan, id: createMountPlanId(group.kind, Buffer.from(content).toString("hex")),
        defaultOrder: order, prefixOrders: [] }, options.mounts);
      for (const request of group.requests.filter(request => request.content === content)) {
        const resource = await sourceMounts.resolve(request.path);
        if (resource === null || !allowed.some(mount => mountPath(mount) === mountPath(resource.provenance.mount))) {
          throw new Error(`Required ${group.kind} resource is absent from its selected content and base: ${content}/${request.path}`);
        }
        resources.set(resource.id, resource);
      }
    }
  }
  const execution: ResolvedExecutionModule[] = [];
  for (const module of selected.execution) {
    switch (module.kind) {
      case "typescript": execution.push(module); break;
      case "quakec": execution.push({ ...module, artifact: await resolveResource(module.artifact, "artifact") }); break;
      case "qvm": execution.push({ ...module, artifact: await resolveResource(module.artifact, "artifact") }); break;
      case "native": execution.push({ ...module, artifact: await resolveResource(module.artifact, "artifact") }); break;
    }
  }
  const selectedSourceIds = new Set<string>([...Object.values(EQUIPMENT_PROVIDERS), ...Object.values(Q1_WEAPON_PROVIDERS), ...Object.values(Q1_HIPNOTIC_WEAPON_PROVIDERS), ...Object.values(Q2_WEAPON_PROVIDERS), ...monsterSources.map(source => source.provider)]);
  const monsterProfiles = selectedMonsterTiming(selected.enemies);
  const weaponProfiles = selectedWeaponTiming(selected.map.entities, selected.weapons, options.catalog);
  const timing = [...selected.timing.filter(entry => !selectedSourceIds.has(entry.provider)), ...equipmentTiming(selected.equipment), ...monsterProfiles];
  for (const profile of weaponProfiles) admitWeaponTiming(timing, profile);
  const selectedSourceOrder = [...equipmentProviders(selected.equipment).map(source => source.provider), ...monsterProfiles.map(source => source.provider)];
  const existingOrder = selected.ordering.kind === "mixed" ? [...selected.ordering.providers.filter(provider => !selectedSourceIds.has(provider)), ...selectedSourceOrder] : [];
  const ordering = selected.ordering.kind === "mixed"
    ? { ...selected.ordering, providers: [...existingOrder, ...weaponProfiles.map(profile => profile.provider).filter(provider => !existingOrder.includes(provider))] }
    : weaponProfiles.length === 0 ? selected.ordering : { kind: "mixed", providers: [...new Set([selected.map.entities.provider, ...selected.timing.map(profile => profile.provider), ...selectedSourceOrder, ...weaponProfiles.map(profile => profile.provider)])],
      entityOrder: selected.ordering.traversal, ties: "provider-entity-invocation" } satisfies ExecutableRecipe["ordering"];
  return { ...selected, schemaVersion: 3, map: { geometryContent: selected.map.geometry.content, geometry, entities: selected.map.entities }, execution, timing, ordering,
    mounts: mounted.plan, resources: [...resources.values()] };
}
