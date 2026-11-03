// SPDX-License-Identifier: GPL-2.0-or-later
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import type { ContentId, ExecutableRecipe } from "../../contracts/content.ts";
import type { ApplicationOptions } from "./options.ts";
import { nativeSaveLayout } from "../../settings/native-saves.ts";
import { NativeConfig, type NativeConfigLayout, nativeConfigLayout } from "../../settings/native-config.ts";

/**
 * A stock game takes every selected component from one product or mod (the
 * engine-behavior product and the products it extends). Such a game reads and
 * writes the configuration files the original keeps in its own folders; any
 * mixed combination keeps to the user store.
 */
export function stockNativeConfig(
  catalog: InstalledCatalog,
  engineBehavior: ContentId,
  components: readonly ContentId[],
  redirect?: string,
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
    redirect ?? process.env["QTS_TEST_GAME_WRITE_ROOT"],
    redirect !== undefined,
  );
  return layout === null ? null : new NativeConfig(layout);
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
export function nativeSaveFolders(catalog: InstalledCatalog, redirect: string | undefined): readonly { readonly root: string; readonly depth: number }[] {
  const folders = new Map<string, number>();
  for (const product of catalog.products) {
    const native = stockNativeConfig(catalog, product.id, [product.id], redirect);
    if (native === null) continue;
    const layout = nativeSaveLayout(native.layout, product.expectation);
    for (const root of layout.scan) folders.set(root, Math.max(folders.get(root) ?? 0, layout.depth));
  }
  return [...folders].map(([root, depth]) => ({ root, depth }));
}
