import { expect, test } from "bun:test";
import { createContentId } from "../../src/contracts/content.ts";
import { InstalledCatalog, expectedProducts, type CatalogProduct } from "../../src/content/catalog/index.ts";
import { applicationPreset } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";

function installed(): InstalledCatalog {
  const products: CatalogProduct[] = expectedProducts.map(expectation => ({
    id: createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: "installed" }),
    expectation, availability: { kind: "installed" }, archives: [], looseRoot: "/unused", userContent: null, maps: [], diagnostics: [],
  }));
  const base = products.find(product => product.expectation.id === "q2-rerelease-baseq2");
  if (base === undefined) throw new Error("Missing rerelease base expectation");
  products.push({ ...base, id: createContentId({ family: "q2", edition: "rerelease", package: "native-test", revision: "installed" }),
    expectation: { ...base.expectation, id: "q2-rerelease-native-test", campaign: "native-test", baseProduct: base.expectation.id,
      contentDirectory: "q2r/native-test", requiredPrograms: ["game_x64.dll"] } });
  return new InstalledCatalog("/unused", products, [], 0);
}
function options(product: string, library?: string) {
  const command = parseApplicationCommand(["--game", product, "--movement", "q2", "--character", "q2", ...(library === undefined ? [] : ["--q2-game", library])]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Missing run options");
  return command.options;
}

test("native Q2 selection follows edition and leaves official TypeScript gameplay as the default", () => {
  const catalog = installed();
  expect(applicationPreset(catalog, options("q2-classic-baseq2")).execution[0]?.kind).toBe("typescript");
  expect(applicationPreset(catalog, options("q2-rerelease-baseq2")).execution[0]?.kind).toBe("typescript");
  expect(applicationPreset(catalog, options("q2-classic-baseq2", "gamex86.dll")).execution[0]).toMatchObject({ kind: "native", api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386" } });
  expect(applicationPreset(catalog, options("q2-rerelease-baseq2", "game_x64.dll")).execution[0]).toMatchObject({ kind: "native", api: { kind: "q2-rerelease-game", version: 2023 }, profile: { kind: "windows-x86-64" } });
  expect(applicationPreset(catalog, options("q2-rerelease-native-test")).execution[0]).toMatchObject({ kind: "native", artifact: { path: "game_x64.dll" }, api: { kind: "q2-rerelease-game", version: 2023 } });
});
