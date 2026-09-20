import { createMountPlanId, type ExecutableRecipe } from "../../contracts/content.ts";
import { modSelectionKey, readModSelection, type ModDescription, type ModSelection, type ResolvedGameplayMod } from "../../contracts/mods.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { ModSelectionSet } from "../../content/mods/selection.ts";
import { MountPreparationScope } from "../../content/mounts/index.ts";
import { applicationWeaponBehaviorChoices } from "./weapon-behavior-selection.ts";
import { discoverGameplayMods } from "../../content/mods/catalog.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { PreparedMod } from "../../world/session/mods.ts";
import { prepareMountedQuakeCMod } from "./simulation/quakec-mod.ts";
import { prepareMountedQvmMod } from "./simulation/qvm-mod.ts";
import { prepareMountedNativeMod } from "./simulation/native-mod.ts";

export interface ApplicationModChoice {
  readonly description: ModDescription;
  readonly implementation: { readonly kind: "unavailable" } | { readonly kind: "gameplay"; readonly selection: ResolvedGameplayMod } | {
    readonly kind: "weapon-behavior";
    readonly selection: NonNullable<ExecutableRecipe["weaponBehaviors"]>[number];
  };
}

export async function applicationModChoices(catalog: InstalledCatalog): Promise<readonly ApplicationModChoice[]> {
  await using mounts = new MountPreparationScope();
  const choices: ApplicationModChoice[] = [];
  for (const product of catalog.products) {
    if (product.availability.kind !== "installed") continue;
    const sourceTitle = `${product.expectation.family === "q1" ? "Quake" : product.expectation.family === "q2" ? "Quake II" : "Quake III"}${product.expectation.edition === "rerelease" ? " rerelease" : ""}`;
    try {
      const contentMounts = await catalog.mountsFor(product.id);
      using opened = await mounts.open({ id: createMountPlanId("gameplay-mods", Buffer.from(product.id).toString("hex")),
        mounts: contentMounts, defaultOrder: contentMounts.map(mount => mount.identity.id), prefixOrders: [] });
      for (const entry of await discoverGameplayMods(product, opened)) choices.push(entry.kind === "available" ? {
        description: { ...entry.mod, purpose: "addition", availability: { kind: "available" } },
        implementation: { kind: "gameplay", selection: entry.mod },
      } : { description: entry.description, implementation: { kind: "unavailable" } });
    } catch (error) {
      choices.push({ description: {
        selection: { product: product.expectation.id, id: "unavailable" },
        source: { provider: `${product.expectation.family}:official`, content: product.id },
        title: product.expectation.title, sourceTitle, purpose: "addition", requires: [], conflicts: [],
        availability: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) },
      }, implementation: { kind: "unavailable" } });
    }
    try {
      for (const entry of await applicationWeaponBehaviorChoices(catalog, product.expectation.id, mounts.open)) {
        if (entry.selection === null) continue;
        choices.push({ description: {
          selection: readModSelection(entry.id), source: entry.selection.source,
          title: entry.title, sourceTitle, purpose: "addition", requires: [], conflicts: [],
          availability: entry.unavailable === null ? { kind: "available" } : { kind: "unavailable", reason: entry.unavailable },
        }, implementation: { kind: "weapon-behavior", selection: entry.selection } });
      }
    } catch (error) {
      let id = "unavailable-weapon-behaviors";
      while (choices.some(choice => choice.description.selection.product === product.expectation.id && choice.description.selection.id === id)) id += "+";
      choices.push({ description: {
        selection: { product: product.expectation.id, id },
        source: { provider: `${product.expectation.family}:official`, content: product.id },
        title: `${product.expectation.title} weapon behaviors`, sourceTitle, purpose: "addition", requires: [], conflicts: [],
        availability: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) },
      }, implementation: { kind: "unavailable" } });
    }
  }
  // Each trajectory adapter owns that launcher's path. Other gameplay registrations
  // compose independently through SessionMods rather than competing for this owner.
  return choices.map(choice => ({ ...choice, description: { ...choice.description,
    conflicts: [...choice.description.conflicts, ...choices.filter(other => other !== choice && other.implementation.kind === "weapon-behavior" && choice.implementation.kind === "weapon-behavior" &&
      (other.implementation.selection.definition.role === choice.implementation.selection.definition.role
        || other.implementation.selection.definition.id === choice.implementation.selection.definition.id))
      .map(other => other.description.selection)],
  } }));
}

export function applyApplicationMods(recipe: ExecutableRecipe, choices: readonly ApplicationModChoice[], enabled: readonly ModSelection[]): ExecutableRecipe {
  const selection = new ModSelectionSet(choices.map(choice => choice.description), enabled);
  const selected = selection.enabled().map(mod => {
    const choice = choices.find(choice => modSelectionKey(choice.description.selection) === modSelectionKey(mod));
    if (choice === undefined) throw new Error(`Selected mod is unavailable: ${modSelectionKey(mod)}`);
    return choice;
  });
  if (selected.length === 0) return recipe;
  if (selected.some(choice => choice.implementation.kind === "weapon-behavior") && recipe.execution.some(module => module.role === "server-game" && module.kind !== "typescript"))
    throw new Error("Selected projectile components require a shared weapon provider");
  return { ...recipe, mods: selected.flatMap(choice => choice.implementation.kind === "gameplay" ? [choice.implementation.selection] : []), weaponBehaviors: selected.flatMap(choice => {
    if (choice.implementation.kind === "unavailable") throw new Error(`Selected mod is unavailable: ${modSelectionKey(choice.description.selection)}`);
    return choice.implementation.kind === "weapon-behavior" ? [choice.implementation.selection] : [];
  }) };
}

export async function prepareApplicationMods(catalog: InstalledCatalog, recipe: ExecutableRecipe,
  forContent: (content: ContentId) => Promise<MountedContent>): Promise<readonly PreparedMod[]> {
  const prepared: PreparedMod[] = [], selections = recipe.mods ?? [];
  const dependencies = new Set(selections.map(selection => modSelectionKey(selection.selection)));
  const enabled = new Set([...dependencies, ...(recipe.weaponBehaviors ?? []).map(selection => modSelectionKey({
    product: catalog.product(selection.source.content).expectation.id, id: selection.definition.id,
  }))]);
  for (const selection of selections) {
    const product = catalog.require(selection.selection.product), mounted = await forContent(product.id);
    const declarations = await discoverGameplayMods(product, mounted);
    const entry = declarations.find(entry => modSelectionKey(entry.kind === "available" ? entry.mod.selection : entry.description.selection) === modSelectionKey(selection.selection));
    if (entry?.kind === "unavailable") {
      throw new Error(`${entry.description.title}: ${entry.description.availability.reason}`);
    }
    const current = entry?.mod;
    if (current === undefined || current.source.content !== selection.source.content || current.source.provider !== selection.source.provider
      || current.declarationDigest !== selection.declarationDigest || JSON.stringify(current.declaration) !== JSON.stringify(selection.declaration))
      throw new Error(`Selected mod differs from its installed declaration: ${modSelectionKey(selection.selection)}`);
    for (const dependency of current.requires) if (!enabled.has(modSelectionKey(dependency)))
      throw new Error(`${current.title} requires ${modSelectionKey(dependency)}`);
    for (const conflict of current.conflicts) if (enabled.has(modSelectionKey(conflict)))
      throw new Error(`${current.title} conflicts with ${modSelectionKey(conflict)}`);
    const description: ModDescription = { ...current, purpose: "addition", availability: { kind: "available" },
      // Projectile components initialize before the general operation registrations.
      requires: current.requires.filter(dependency => dependencies.has(modSelectionKey(dependency))) };
    switch (current.declaration.runtime) {
      case "quakec": prepared.push(await prepareMountedQuakeCMod({ description,
        declaration: current.declaration, declarationDigest: current.declarationDigest, mounts: mounted })); break;
      case "qvm": prepared.push(await prepareMountedQvmMod({ description,
        declaration: current.declaration, declarationDigest: current.declarationDigest, mounts: mounted })); break;
      case "native": prepared.push(await prepareMountedNativeMod({ description,
        declaration: current.declaration, declarationDigest: current.declarationDigest, mounts: mounted })); break;
    }
  }
  return prepared;
}
