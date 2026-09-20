import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applicationModChoices } from "../../../src/app/bootstrap/mod-selection.ts";
import { discoverInstalledContent, expectedProducts } from "../../../src/content/catalog/index.ts";
import { discoverGameplayMods } from "../../../src/content/mods/catalog.ts";
import { ModSelectionSet } from "../../../src/content/mods/selection.ts";
import { digestBytes, openMountPlan } from "../../../src/content/mounts/index.ts";

test("broken independent components keep their identities without hiding healthy components", async () => {
  const root = await mkdtemp(join(tmpdir(), "gameplay-mod-discovery-"));
  try {
    const directory = join(root, "q1/id1"), bytes = Uint8Array.of(1, 2, 3);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "progs.dat"), bytes);
    const declaration = { version: 1, runtime: "quakec", program: { path: "progs.dat", digest: digestBytes(bytes) }, actorFields: [], callbacks: [] };
    await writeFile(join(directory, "healthy.json"), JSON.stringify(declaration));
    await writeFile(join(directory, "stale.json"), JSON.stringify({ ...declaration,
      program: { ...declaration.program, digest: digestBytes(Uint8Array.of(4)) } }));
    const addition = (id: string, callbacks: string) => ({ id, title: id, purpose: "addition", callbacks, requires: [], conflicts: [] });
    const components = [
      { id: "rules", title: "Whole game rules", purpose: "game-type" },
      addition("missing", "absent.json"), addition("healthy", "healthy.json"), addition("stale", "stale.json"),
    ];
    await writeFile(join(directory, "gameplay-mods.json"), JSON.stringify({ version: 1, components }));
    const products = expectedProducts.filter(product => product.id === "q1-classic-id1")
      .map(product => ({ ...product, requiredContentArchives: [], requiredPrograms: [], mapWitness: null }));
    const catalog = await discoverInstalledContent({ corpusRoot: root, products });
    const product = catalog.require("q1-classic-id1"), mounts = await catalog.mountsFor(product.id);
    using mounted = await openMountPlan({ id: "mount-plan:test:gameplay-mods", mounts,
      defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    const discovered = await discoverGameplayMods(product, mounted);
    expect(discovered).toHaveLength(3);
    expect(discovered[0]).toMatchObject({ kind: "unavailable", description: { selection: { id: "missing" },
      availability: { kind: "unavailable", reason: "Missing callback declaration absent.json" } } });
    expect(discovered[1]).toMatchObject({ kind: "available", mod: { selection: { id: "healthy" } } });
    expect(discovered[2]).toMatchObject({ kind: "unavailable", description: { selection: { id: "stale" },
      availability: { kind: "unavailable", reason: "Executable differs from its callback declaration" } } });
    const choices = await applicationModChoices(catalog);
    const selection = new ModSelectionSet(choices.map(choice => choice.description));
    selection.setEnabled({ product: product.expectation.id, id: "healthy" }, true);
    expect(selection.enabled()).toEqual([{ product: product.expectation.id, id: "healthy" }]);
    expect(() => selection.setEnabled({ product: product.expectation.id, id: "missing" }, true)).toThrow("absent.json");
    expect(choices.some(choice => choice.description.selection.id === "rules")).toBe(false);
    await writeFile(join(directory, "gameplay-mods.json"), JSON.stringify({ version: 1, components: [...components, addition("healthy", "healthy.json")] }));
    await expect(discoverGameplayMods(product, mounted)).rejects.toThrow("Duplicate mod component");
  } finally { await rm(root, { recursive: true, force: true }); }
});
