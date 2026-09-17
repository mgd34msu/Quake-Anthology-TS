import type { ContentId, ExecutableRecipe, ExecutionModule } from "../../contracts/content.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import type { CatalogProduct, InstalledCatalog } from "./index.ts";
import { expectedProducts, type ProductExpectation } from "./products.ts";

export function sourceProgramProduct(catalog: InstalledCatalog, content: ContentId | string): CatalogProduct {
  let product = catalog.require(content);
  const visited = new Set<ContentId>();
  while (!expectedProducts.some(builtin => builtin.id === product.expectation.id)
    && product.expectation.requiredPrograms.length === 0 && product.expectation.baseProduct !== null) {
    if (visited.has(product.id)) throw new Error("Cyclic source program dependency");
    visited.add(product.id);
    const base = catalog.require(product.expectation.baseProduct);
    if (base.expectation.family !== product.expectation.family || base.expectation.edition !== product.expectation.edition)
      throw new Error("Source program dependency changes game family or edition");
    product = base;
  }
  return product;
}

export function sourceProgramImplementation(product: ProductExpectation): ProviderId {
  return `${product.family}:source/${product.edition}/${product.campaign}`;
}

export function selectedSourceProgram(recipe: { readonly execution: readonly ExecutionModule<unknown>[]; readonly map: Pick<ExecutableRecipe["map"], "entities"> }): string | undefined {
  const owner = recipe.map.entities;
  const module = recipe.execution.find(module => module.role === "server-game" && module.owner.provider === owner.provider && module.owner.content === owner.content);
  if (module?.kind !== "typescript" || module.implementation === owner.provider) return owner.content.split(":")[2];
  const [family, edition] = owner.content.split(":");
  const product = expectedProducts.find(product => product.family === family && product.edition === edition
    && sourceProgramImplementation(product) === module.implementation);
  if (product === undefined) throw new Error(`Unsupported source implementation ${module.implementation}`);
  return product.campaign;
}
