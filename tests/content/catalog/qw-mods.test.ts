import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstalledContent, expectedProducts } from "../../../src/content/catalog/index.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

function programPak(): Uint8Array {
  const bytes = new Uint8Array(77), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setUint32(4, 13, true); view.setUint32(8, 64, true);
  bytes[12] = 6;
  bytes.set(new TextEncoder().encode("qwprogs.dat"), 13);
  view.setUint32(69, 12, true); view.setUint32(73, 1, true);
  return bytes;
}

test("loose and packaged QW mods retain their execution dialect and base dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "qw-mod-catalog-"));
  try {
    for (const path of ["q1/id1", "q1/qw", "q1/Loose", "q1/Packed", "q1/Broken"])
      await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, "q1/Loose/qwprogs.dat"), new Uint8Array([6]));
    await writeFile(join(root, "q1/Packed/pak0.pak"), programPak());
    await writeFile(join(root, "q1/Broken/pak0.pak"), "broken");
    const products = expectedProducts.filter(product => product.id === "q1-classic-id1" || product.id === "q1-quakeworld")
      .map(product => ({ ...product, requiredContentArchives: [], requiredPrograms: [], mapWitness: null }));
    const catalog = await discoverInstalledContent({ corpusRoot: root, products });
    for (const name of ["Loose", "Packed"]) {
      const product = catalog.require(`q1-quakeworld-${name}`);
      expect(product.expectation.baseProduct).toBe("q1-quakeworld");
      expect(product.expectation.edition).toBe("quakeworld");
      expect(product.expectation.requiredPrograms).toEqual(["qwprogs.dat"]);
      expect((await catalog.mountsFor(product.id)).map(mount => mount.identity.content)).toContain(catalog.require("q1-classic-id1").id);
      const command = parseApplicationCommand(["--game", product.expectation.id, "--map", "e1m1", "--dedicated", "--mode", "deathmatch", "--movement", "q1", "--character", "q1"]);
      if (command.kind !== "run") throw new Error("Expected launch options");
      const preset = applicationPreset(catalog, command.options);
      expect(preset.execution).toMatchObject([{ kind: "quakec", artifact: { path: "qwprogs.dat", content: product.id }, api: { kind: "q1-quakeworld" } }]);
      expect(preset.timing.find(profile => profile.provider === preset.map.entities.provider)?.clock.kind).toBe("q1-quakeworld");
      expect(() => applicationPreset(catalog, { ...command.options, dedicated: false })).toThrow("Native QuakeWorld");
      expect(catalog.require(`q1-classic-${name}`).expectation.edition).toBe("classic");
    }
    expect(catalog.product("q1-classic-Broken").availability.kind).toBe("missing");
    expect(catalog.product("q1-classic-Broken").diagnostics.length).toBeGreaterThan(0);
    expect(() => catalog.product("q1-quakeworld-Broken")).toThrow("Unknown");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a user QW program adds a dialect variant to an existing corpus classic mod", async () => {
  const root = await mkdtemp(join(tmpdir(), "qw-mod-overlay-"));
  const corpus = join(root, "corpus"), users = join(root, "users");
  try {
    for (const path of ["q1/id1", "q1/qw", "q1/Shared"])
      await mkdir(join(corpus, path), { recursive: true });
    await mkdir(join(users, "q1/Shared"), { recursive: true });
    await writeFile(join(corpus, "q1/Shared/progs.dat"), new Uint8Array([1]));
    await writeFile(join(users, "q1/Shared/qwprogs.dat"), new Uint8Array([6]));
    const products = expectedProducts.filter(product => product.id === "q1-classic-id1" || product.id === "q1-quakeworld")
      .map(product => ({ ...product, requiredContentArchives: [], requiredPrograms: [], mapWitness: null }));
    const catalog = await discoverInstalledContent({ corpusRoot: corpus, userContentRoot: users, products });
    const classic = catalog.require("q1-classic-Shared"), qw = catalog.require("q1-quakeworld-Shared");
    expect(classic.expectation.edition).toBe("classic");
    expect(qw.expectation.edition).toBe("quakeworld");
    expect(qw.userContent?.root).toBe(join(users, "q1/Shared"));
    expect(qw.looseRoot).toBe(join(corpus, "q1/Shared"));
    expect(qw.availability.kind).toBe("installed");
    const command = parseApplicationCommand(["--game", qw.expectation.id, "--map", "e1m1", "--dedicated", "--mode", "deathmatch", "--movement", "q1", "--character", "q1"]);
    if (command.kind !== "run") throw new Error("Expected launch options");
    expect(applicationPreset(catalog, command.options).execution).toMatchObject([
      { kind: "quakec", artifact: { path: "qwprogs.dat", content: qw.id }, api: { kind: "q1-quakeworld" } }
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
