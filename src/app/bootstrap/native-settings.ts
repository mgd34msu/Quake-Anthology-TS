// SPDX-License-Identifier: GPL-2.0-or-later
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import type { ContentId } from "../../contracts/content.ts";
import { NativeConfig, nativeConfigLayout } from "../../settings/native-config.ts";

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
