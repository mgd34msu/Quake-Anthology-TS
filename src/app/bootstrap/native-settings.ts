// SPDX-License-Identifier: GPL-2.0-or-later
import { gameWriteRedirect, type InstalledCatalog } from "../../content/catalog/index.ts";
import type { ContentId, ExecutableRecipe } from "../../contracts/content.ts";
import type { ApplicationOptions } from "./options.ts";
import { nativeSaveLayout } from "../../settings/native-saves.ts";
import { NativeConfig, type NativeConfigLayout, nativeConfigLayout } from "../../settings/native-config.ts";
import { GameLayers, LayerStore } from "../../settings/layers.ts";
import type { LocalForm } from "../../core/commands/index.ts";
import { namedPhysicalInput, physicalInputName } from "../../input/bindings.ts";
import { consoleConfigRoot } from "./config-scripts.ts";

/**
 * A stock game takes every selected component from one product or mod (the
 * engine-behavior product and the products it extends). Such a game reads and
 * writes the configuration files the original keeps in its own folders; any
 * mixed combination keeps to the user store.
 *
 * `layers` joins the file to the settings layering (the engine's high level above the game's own file); callers that
 * only need the folders leave it out. Its `userContentRoot` is where the engine-wide layer files live.
 */
export function stockNativeConfig(
  catalog: InstalledCatalog,
  engineBehavior: ContentId,
  components: readonly ContentId[],
  redirect?: string,
  layers?: { readonly userContentRoot: string | undefined },
): NativeConfig | null {
  const chain = new Set<ContentId>();
  let product = catalog.product(engineBehavior);
  for (;;) {
    if (chain.has(product.id)) return null;
    chain.add(product.id);
    if (product.expectation.baseProduct === null) break;
    product = catalog.product(product.expectation.baseProduct);
  }
  if (!components.every(component => chain.has(component))) return null;
  const selected = catalog.product(engineBehavior);
  const layout = nativeConfigLayout(
    {
      family: selected.expectation.family,
      edition: selected.expectation.edition,
      contentDirectory: selected.expectation.contentDirectory,
      looseRoot: selected.looseRoot,
    },
    undefined,
    gameWriteRedirect(redirect, catalog.corpusRoot),
    redirect !== undefined,
  );
  if (layout === null) return null;
  if (layers === undefined) return new NativeConfig(layout);
  const { family, edition, contentDirectory } = selected.expectation;
  return new NativeConfig(
    layout,
    new GameLayers(new LayerStore(consoleConfigRoot(layers.userContentRoot)), layout.format, `${family}/${edition}/${contentDirectory}`),
  );
}

/** The layers of a mixed combination, which keeps no native file: the same high level and overrides, keyed by the combination's engine-behavior product. */
export function mixedGameLayers(catalog: InstalledCatalog, reference: ContentId, userContentRoot: string | undefined): GameLayers {
  const { family, edition } = catalog.product(reference).expectation;
  const format =
    family === "q3" ? "quake3" : family === "q1" ? (edition === "rerelease" ? "kex-quake" : "quake") : edition === "rerelease" ? "kex-quake2" : "quake2";
  return new GameLayers(new LayerStore(consoleConfigRoot(userContentRoot)), format, `mixed/${reference}`);
}

/**
 * `bind -local`, `unbind -local` and `set -local` keep the entry to this game; every other bind, unbind and set of a
 * mapped entry reaches the high level and so every game.
 */
export function noteLocalForm(layers: GameLayers | undefined, form: LocalForm): void {
  const name = form.args[0];
  if (layers === undefined || name === undefined) return;
  if (form.command === "set") {
    layers.noteLocalCvar(name);
    return;
  }
  const input = namedPhysicalInput(name);
  layers.noteLocalBind(input === null ? name : physicalInputName(input));
}

/** The components a recipe takes from products; all of them from one product or mod makes a stock game. */
export function recipeComponents(recipe: ExecutableRecipe): readonly ContentId[] {
  return [recipe.map.entities.content, recipe.engineBehavior.content, recipe.match.content, recipe.combat.content, recipe.movement.content];
}

/**
 * Where the original game keeps its demos, screenshots, logs, downloads and saves. A stock game answers with its own
 * folder; any mixed combination keeps to `fallback`, the user store.
 */
export function stockGameFolders(
  catalog: InstalledCatalog,
  recipe: ExecutableRecipe,
  options: Pick<ApplicationOptions, "nativeConfigRoot">,
): NativeConfigLayout | null {
  return stockNativeConfig(catalog, recipe.engineBehavior.content, recipeComponents(recipe), options.nativeConfigRoot)?.layout ?? null;
}

export function stockGameDirectory(
  content: {
    readonly catalog: InstalledCatalog;
    readonly recipe: ExecutableRecipe;
  },
  options: Pick<ApplicationOptions, "nativeConfigRoot">,
  fallback: string,
): string {
  return stockGameFolders(content.catalog, content.recipe, options)?.directory ?? fallback;
}

/** The folders a stock game's demos and saves are read from, writes first. */
export function nativeFolders(native: NativeConfig | null): readonly string[] {
  return native === null ? [] : [native.layout.directory, ...native.layout.fallbacks];
}

/** Every installed stock game's native save folders, for the saved-game lists. */
export function nativeSaveFolders(
  catalog: InstalledCatalog,
  redirect: string | undefined,
): readonly { readonly root: string; readonly depth: number; readonly arrangement: "files" | "folders" }[] {
  const folders = new Map<string, { depth: number; arrangement: "files" | "folders" }>();
  for (const product of catalog.products) {
    const native = stockNativeConfig(catalog, product.id, [product.id], redirect);
    if (native === null) continue;
    const layout = nativeSaveLayout(native.layout, product.expectation);
    for (const root of layout.scan) folders.set(root, { depth: Math.max(folders.get(root)?.depth ?? 0, layout.depth), arrangement: layout.arrangement });
  }
  return [...folders].map(([root, folder]) => ({ root, ...folder }));
}
