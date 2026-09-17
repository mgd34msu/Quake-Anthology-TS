import { InstalledCatalog, type CatalogProduct } from "../../content/catalog/index.ts";
import type { ContentId } from "../../contracts/content.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../core/cvars/index.ts";
import { registerQ3ProductPolicy, type Q3ApplicationProduct } from "../../core/q3-product-policy.ts";
import { resolveQ3MountRestriction } from "../../content/q3/product-restriction.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import { startupCommandPhases } from "./startup-commands.ts";
import type { ApplicationOptions } from "./options.ts";

/** Product build policy stays independent from the filesystem's restricted media directory. */
export async function prepareQ3ApplicationProduct(catalog: InstalledCatalog, content: ContentId | string,
  options: Pick<ApplicationOptions, "startupCommands" | "q3Product"> = {}): Promise<{ readonly catalog: InstalledCatalog; readonly q3Product: Q3ApplicationProduct | null }> {
  const selected = catalog.product(content);
  if (selected.expectation.family !== "q3") return { catalog, q3Product: null };
  let product = options.q3Product;
  if (product === undefined) {
    const identity = createIdentityOwner("q3-product-policy");
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "server-console" } } });
    for (const variable of startupCommandPhases(options.startupCommands ?? [], "q3").variables)
      if (["com_prereleasedemo", "com_prereleaseteamarenademo", "fs_restrict"].includes(variable.name.toLowerCase())) cvars.set(variable.name, variable.value, true);
    const policy = registerQ3ProductPolicy(cvars);
    const forced = (cvars.register("fs_restrict", "0", CvarFlag.Init)?.integerValue ?? 0) !== 0;
    const restriction = await resolveQ3MountRestriction(policy, forced, async () => {
      const mounts = await catalog.mountsFor(selected.id);
      using mounted = await openMountPlan({ id: createMountPlanId("q3-product-identification", Buffer.from(selected.id).toString("hex")), mounts,
        defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
      return (await mounted.open("productid.txt"))?.bytes ?? null;
    });
    product = { policy, restriction };
  }
  if (product.restriction.kind === "none") return { catalog, q3Product: product };
  const media = catalog.require("q3-demota");
  const restricted = new InstalledCatalog(catalog.corpusRoot, catalog.products.map((source): CatalogProduct => source.expectation.family !== "q3" ? source : {
    ...source, expectation: { ...source.expectation, baseProduct: null }, availability: media.availability,
    archives: media.archives, looseRoot: media.looseRoot, userContent: media.userContent, maps: media.maps,
  }), catalog.rootArchives, catalog.generation, catalog.userContentRoot);
  const mounts = await restricted.mountsFor(selected.id);
  const verified = await openMountPlan({ id: createMountPlanId("q3-restricted-product", Buffer.from(selected.id).toString("hex")), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] }, { q3Restriction: "demo" });
  verified.close();
  return { catalog: restricted, q3Product: product };
}
