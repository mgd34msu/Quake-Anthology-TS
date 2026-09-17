import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstalledContent, expectedProducts, presetChoice, InstalledCatalog } from "../../src/content/catalog/index.ts";
import type { CatalogProduct } from "../../src/content/catalog/index.ts";
import { sourceProgramProduct, selectedSourceProgram } from "../../src/content/catalog/source-program.ts";
import { applicationPreset, openApplicationConfigurationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";

test("map-only add-ons retain package identity and scripts while inheriting their actual base program", async () => {
  const root = await mkdtemp(join(tmpdir(), "source-program-inheritance-"));
  try {
    const products = ["q1-classic-id1", "q1-rerelease-id1", "q2-classic-baseq2", "q3-baseq3"].map(id => {
      const product = expectedProducts.find(product => product.id === id);
      if (product === undefined) throw new Error("Missing base product");
      return { ...product, requiredPrograms: [], requiredContentArchives: [], mapWitness: null };
    });
    for (const product of products) {
      await mkdir(join(root, product.contentDirectory), { recursive: true });
      const parent = product.contentDirectory.slice(0, product.contentDirectory.lastIndexOf("/"));
      for (const name of ["map-only", "custom-code"]) {
        const directory = join(root, parent, name);
        await mkdir(join(directory, "maps"), { recursive: true });
        await writeFile(join(directory, "config.cfg"), `echo ${name}\n`);
        if (name === "custom-code") {
          const program = product.family === "q1" ? "progs.dat" : product.family === "q2" ? "gamex86.dll" : "vm/qagame.qvm";
          if (product.family === "q3") await mkdir(join(directory, "vm"));
          await writeFile(join(directory, program), "artifact admission occurs during loading");
        }
      }
    }
    const catalog = await discoverInstalledContent({ corpusRoot: root, products, discoverMods: true });
    for (const base of products) {
      const child = catalog.require(`${base.family}-${base.edition}-map-only`), parent = catalog.require(`${base.family}-${base.edition}-custom-code`);
      const inherited = new InstalledCatalog(root, catalog.products.map(product => product.id === child.id
        ? { ...product, expectation: { ...product.expectation, baseProduct: parent.expectation.id } } : product), catalog.rootArchives, catalog.generation);
      const inheritedCommand = parseApplicationCommand(["--game", child.expectation.id, "--map", "start", "--movement", base.family, "--character", base.family, "--mode", "deathmatch"]);
      if (inheritedCommand.kind !== "run") throw new Error("Missing inherited launch");
      const inheritedPreset = applicationPreset(inherited, inheritedCommand.options);
      expect(inheritedPreset.map.entities.content).toBe(child.id);
      expect(inheritedPreset.execution[0]?.kind).toBe(base.family === "q1" ? "quakec" : base.family === "q2" ? "native" : "qvm");
      for (const name of ["map-only", "custom-code"]) {
        const id = `${base.family}-${base.edition}-${name}`;
        const command = parseApplicationCommand(["--game", id, "--map", "start", "--movement", base.family, "--character", base.family, "--mode", "deathmatch"]);
        if (command.kind !== "run") throw new Error("Missing application options");
        const product = catalog.require(id), preset = applicationPreset(catalog, command.options);
        expect(preset.map.entities.content).toBe(product.id);
        expect(preset.map.geometry.content).toBe(product.id);
        expect(preset.presentation.assets).toBe(product.id);
        expect(preset.execution[0]?.owner.content).toBe(product.id);
        if (name === "map-only") {
          expect(sourceProgramProduct(catalog, product.id).expectation.id).toBe(base.id);
          expect(preset.execution[0]?.kind).toBe("typescript");
          expect(selectedSourceProgram(preset)).toBe(base.campaign);
          if (base.family === "q1") {
            const configuration = await openApplicationConfigurationContent(catalog, { kind: "launch", preset, choice: presetChoice(preset.id) });
            try {
              expect(configuration.selection.source.content).toBe(product.id);
              expect(new TextDecoder().decode((await configuration.mounts.open("config.cfg"))?.bytes)).toBe("echo map-only\n");
            } finally { await configuration.close(); }
          }
        } else {
          expect(sourceProgramProduct(catalog, product.id).id).toBe(product.id);
          expect(preset.execution[0]?.kind).toBe(base.family === "q1" ? "quakec" : base.family === "q2" ? "native" : "qvm");
        }
      }
    }
    const arena = catalog.require("q3-baseq3"), child = catalog.require("q3-classic-map-only");
    const teamExpectation = expectedProducts.find(product => product.id === "q3-missionpack");
    if (teamExpectation === undefined) throw new Error("Missing Team Arena product");
    const team = { ...arena, id: "q3:classic:missionpack:installed", expectation: teamExpectation } satisfies typeof arena;
    const teamCatalog = new InstalledCatalog(root, [...catalog.products.map(product => product.id === child.id
      ? { ...product, expectation: { ...product.expectation, baseProduct: teamExpectation.id } } : product), team], catalog.rootArchives, catalog.generation);
    const teamCommand = parseApplicationCommand(["--game", child.expectation.id, "--map", "start", "--movement", "q3", "--character", "q3", "--mode", "deathmatch"]);
    if (teamCommand.kind !== "run") throw new Error("Missing Team Arena launch");
    expect(selectedSourceProgram(applicationPreset(teamCatalog, teamCommand.options))).toBe("missionpack");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("inherited program rules and equipment retain the selected package owner", () => {
  const products = expectedProducts.map<CatalogProduct>(expectation => ({
    id: `${expectation.family}:${expectation.edition}:${expectation.campaign}:installed`, expectation,
    availability: { kind: "installed" }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [],
  }));
  const cases: readonly { readonly base: string; readonly rules: "tag" | "deathball" | "horde" | "standard" }[] = [
    { base: "q2-classic-rogue", rules: "tag" }, { base: "q2-classic-rogue", rules: "deathball" },
    { base: "q1-rerelease-mg1", rules: "horde" }, { base: "q1-rerelease-ctf", rules: "standard" },
  ];
  for (const scenario of cases) {
    const base = products.find(product => product.expectation.id === scenario.base);
    if (base === undefined) throw new Error("Missing source program fixture");
    const child = { ...base, id: `${base.expectation.family}:${base.expectation.edition}:map-only:installed`,
      expectation: { ...base.expectation, id: "custom-map-only", campaign: "map-only", baseProduct: scenario.base, requiredPrograms: [] } } satisfies typeof base;
    const catalog = new InstalledCatalog("/fixture", [...products, child], [], 1);
    const command = parseApplicationCommand(["--game", child.expectation.id, "--map", "start", "--movement", base.expectation.family, "--character", base.expectation.family]);
    if (command.kind !== "run") throw new Error("Missing source rule options");
    const preset = applicationPreset(catalog, { ...command.options, rules: scenario.rules });
    expect(preset.map.entities.content).toBe(child.id);
    expect(selectedSourceProgram(preset)).toBe(base.expectation.campaign);
    if (scenario.rules === "standard") {
      expect(preset.equipment.grapple.kind).toBe("enabled");
      if (preset.equipment.grapple.kind === "enabled") expect(preset.equipment.grapple.source.content).toBe(base.id);
    } else expect(preset.match.provider).toBe(`${base.expectation.family}:${scenario.rules}`);
  }
});
