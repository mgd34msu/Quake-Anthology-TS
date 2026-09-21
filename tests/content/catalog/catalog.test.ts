import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ContentId, ExecutionSelection, ProviderReference } from "../../../src/contracts/content.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, expectedProducts, presetChoice, resolveLaunch, selectLaunch } from "../../../src/content/catalog/index.ts";
import type { LaunchPreset } from "../../../src/content/catalog/index.ts";
import { openMountPlan } from "../../../src/content/mounts/index.ts";

const corpusRoot = resolve(import.meta.dir, "../../../../qfiles");

function preset(content: ContentId): LaunchPreset {
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const clock: LaunchPreset["ordering"] = { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } };
  return { id: "recipe:campaign:1", map: { geometry: { content, path: "maps/start.bsp" }, entities: provider("entities") },
    campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("gamecode") }, movement: provider("movement"),
    character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [{ provider: "q1:official", content }], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("rerelease"),
    combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "quakec", owner: provider("gamecode"), role: "server-game", artifact: { content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    timing: [], ordering: clock };
}

describe("installed content catalog", () => {
  test("independent modules retain different artifacts with the same mounted path", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-mod-artifacts-"));
    try {
      const original = expectedProducts.find(product => product.id === "q1-classic-id1");
      if (original === undefined) throw new Error("Missing Quake fixture expectation");
      const base = { ...original, requiredContentArchives: [], requiredPrograms: [], mapWitness: null };
      const products = [base, ...["first", "second"].map(name => ({ ...base,
        id: `q1-classic-${name}`, title: name, campaign: name,
        contentDirectory: `q1/${name}`, baseProduct: base.id,
      }))];
      await mkdir(resolve(root, "q1/id1/maps"), { recursive: true });
      await writeFile(resolve(root, "q1/id1/maps/start.bsp"), "map");
      for (const name of ["first", "second"]) {
        await mkdir(resolve(root, `q1/${name}`), { recursive: true });
        await writeFile(resolve(root, `q1/${name}/progs.dat`), `${name} authored program`);
      }
      const catalog = await discoverInstalledContent({ corpusRoot: root, products, discoverMods: false });
      const native = { ...preset(catalog.require(base.id).id), weapons: [] };
      const execution: ExecutionSelection[] = ["first", "second"].map(name => {
        const content = catalog.require(`q1-classic-${name}`).id;
        return { kind: "quakec", owner: { provider: `q1:${name}`, content }, role: "server-game",
          artifact: { content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } };
      });
      const choice = { ...presetChoice(native.id), execution: { kind: "selected", value: execution } } satisfies Parameters<typeof resolveLaunch>[0]["choice"];
      const recipe = await resolveLaunch({ catalog, preset: native, choice });
      using mounted = await openMountPlan(recipe.mounts);
      expect(recipe.execution).toHaveLength(2);
      const contents: string[] = [];
      for (const module of recipe.execution) {
        if (module.kind !== "quakec") throw new Error("Expected QuakeC fixture");
        expect(module.artifact.provenance.mount.identity.content).toBe(module.owner.content);
        contents.push(new TextDecoder().decode(await mounted.read(module.artifact)));
      }
      expect(contents).toEqual(["first authored program", "second authored program"]);
      expect(new Set(recipe.resources.map(resource => resource.id)).size).toBe(3);
      await unlink(resolve(root, "q1/first/progs.dat"));
      await expect(resolveLaunch({ catalog, preset: native, choice })).rejects.toThrow("Required resource is missing");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("catalog read retains mounted content until asynchronous reads finish", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-catalog-read-"));
    try {
      await mkdir(resolve(root, "q3a/baseq3"), { recursive: true });
      await writeFile(resolve(root, "q3a/baseq3/game.cfg"), "set g_gametype 4\n");
      const base = expectedProducts.find(product => product.id === "q3-baseq3");
      if (base === undefined) throw new Error("Missing base fixture expectation");
      const catalog = await discoverInstalledContent({ corpusRoot: root, discoverMods: false,
        products: [{ ...base, requiredContentArchives: [], requiredPrograms: [], mapWitness: null }] });
      const product = catalog.require(base.id);
      expect(new TextDecoder().decode(await catalog.read(product.id, "game.cfg"))).toBe("set g_gametype 4\n");
      await expect(catalog.read(product.id, "missing.cfg")).rejects.toThrow();
      expect(new TextDecoder().decode(await catalog.read(product.id, "game.cfg"))).toBe("set g_gametype 4\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test.skipIf(!existsSync(corpusRoot))("application prepares resolved guest artifacts without substituting TypeScript execution", async () => {
    const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
    const cases: readonly { readonly game: string; readonly map: string; readonly module: (owner: ProviderReference) => ExecutionSelection }[] = [
      { game: "q1-classic-id1", map: "start", module: owner => ({ kind: "quakec", owner, role: "server-game", artifact: { content: owner.content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }) },
      { game: "q2-classic-xatrix", map: "xswamp", module: owner => ({ kind: "native", owner, role: "server-game", artifact: { content: owner.content, path: "gamex86.dll" }, api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" } }) },
      { game: "q3-baseq3", map: "q3dm1", module: owner => ({ kind: "qvm", owner, role: "server-game", artifact: { content: owner.content, path: "vm/qagame.qvm" }, api: { kind: "q3-qagame", version: 8 } }) },
    ];
    for (const entry of cases) {
      const family = catalog.require(entry.game).expectation.family;
      const command = parseApplicationCommand(["--content-root", corpusRoot, "--game", entry.game, "--map", entry.map,
        "--movement", family, "--character", family, "--mode", family === "q3" ? "deathmatch" : "singleplayer"]);
      if (command.kind !== "run") throw new Error("Expected application launch");
      const native = applicationPreset(catalog, command.options);
      const module = entry.module(native.map.entities);
      const recipe = await resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), execution: { kind: "selected", value: [module] } } });
      const resolved = recipe.execution[0];
      if (resolved === undefined || resolved.kind === "typescript") throw new Error("Expected resolved guest artifact");
      expect(resolved.artifact.byteLength).toBeGreaterThan(0);
      expect(resolved.artifact.provenance.mount.identity.content).toBe(native.map.entities.content);
      const selected = await loadApplicationContent(command.options, recipe);
      try {
        expect(selected.recipe.execution).toEqual(recipe.execution);
        expect(resolved.kind === "quakec" ? selected.preparedQuakeC
          : resolved.kind === "native" ? selected.preparedQ2Game : selected.preparedQ3Game).not.toBeNull();
      } finally { await selected.close(); }
      const supported = await loadApplicationContent(command.options);
      try { expect(supported.recipe.execution.every(value => value.kind === "typescript")).toBe(true); }
      finally { await supported.close(); }
    }
  }, 30000);

  test("retains all expected rows when installation is missing, and rejects unknown mods", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-catalog-"));
    try {
      const catalog = await discoverInstalledContent({ corpusRoot: root });
      expect(expectedProducts).toHaveLength(27);
      expect(catalog.products).toHaveLength(27);
      expect(catalog.products.filter(product => product.availability.kind === "missing")).toHaveLength(27);
      expect(catalog.product("q1-rerelease-quake64").availability.kind).toBe("missing");
      expect(catalog.product("q1-rerelease-quake64").expectation).toMatchObject({ contentDirectory: "q1/rerelease/q64", mapWitness: "maps/start.bsp", baseProduct: "q1-rerelease-id1" });
      expect(catalog.product("q3-demota").expectation.baseProduct).toBeNull();
      expect(catalog.product("q3-demota").availability.kind).toBe("missing");
      expect(() => catalog.require("q1-classic-id1")).toThrow("requires");
      expect(() => catalog.product("unknown-mod")).toThrow("Unknown requested content or mod");
      await mkdir(resolve(root, "q1/custom/maps"), { recursive: true });
      await writeFile(resolve(root, "q1/custom/maps/example.bsp"), new Uint8Array([1, 2, 3]));
      const withMod = await discoverInstalledContent({ corpusRoot: root });
      expect(withMod.product("q1-classic-custom").maps).toHaveLength(1);
      expect(withMod.product("q1-classic-custom").availability.kind).toBe("missing");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("Q3 mod descriptions preserve source bytes, root precedence and directory identity", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-mod-descriptions-"));
    const corpus = resolve(root, "corpus"), user = resolve(root, "user");
    try {
      for (const name of ["named", "long", "missing", "empty"]) await mkdir(resolve(corpus, `q3a/${name}/vm`), { recursive: true });
      await mkdir(resolve(user, "q3a/named"), { recursive: true });
      await mkdir(resolve(user, "q3a/empty"), { recursive: true });
      await writeFile(resolve(corpus, "q3a/named/description.txt"), "Installed description");
      await writeFile(resolve(user, "q3a/named/description.txt"), Buffer.from("User \xe9dition\0ignored", "latin1"));
      await writeFile(resolve(corpus, "q3a/long/description.txt"), "x".repeat(60));
      await writeFile(resolve(corpus, "q3a/empty/description.txt"), "Lower priority");
      await writeFile(resolve(user, "q3a/empty/description.txt"), "");
      const catalog = await discoverInstalledContent({ corpusRoot: corpus, userContentRoot: user });
      expect(catalog.product("q3-classic-named").expectation.title).toBe("User \xe9dition");
      expect(catalog.product("q3-classic-named").expectation.contentDirectory).toBe("q3a/named");
      expect(catalog.product("q3-classic-named").expectation.baseProduct).toBe("q3-baseq3");
      expect(catalog.product("q3-classic-long").expectation.title).toBe("x".repeat(48));
      expect(catalog.product("q3-classic-missing").expectation.title).toBe("missing");
      expect(catalog.product("q3-classic-empty").expectation.title).toBe("empty");
      expect(catalog.product("q3-baseq3").expectation.title).toBe("Quake III Arena");
      await writeFile(resolve(root, "outside.txt"), "Outside");
      await symlink(resolve(root, "outside.txt"), resolve(corpus, "q3a/missing/description.txt"));
      await expect(discoverInstalledContent({ corpusRoot: corpus, userContentRoot: user })).rejects.toThrow("Content symlink escapes root");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("behavior, movement and character selections leave campaign code and presentation independent", () => {
    const native = preset("q1:rerelease:mg1:installed");
    const classic: ProviderReference = { provider: "q1:classic", content: "q1:classic:id1:installed" };
    const q3: ProviderReference = { provider: "q3:movement", content: "q3:classic:baseq3:installed" };
    const resolved = selectLaunch({ ...presetChoice(native.id), engineBehavior: { kind: "selected", value: classic }, movement: { kind: "selected", value: q3 },
      character: { kind: "selected", value: { definition: q3, appearance: classic } } }, native);
    expect(resolved.engineBehavior).toEqual(classic);
    expect(resolved.movement).toEqual(q3);
    expect(resolved.character.appearance).toEqual(classic);
    expect(resolved.campaign).toEqual(native.campaign);
    expect(resolved.execution).toEqual(native.execution);
    expect(resolved.presentation).toEqual(native.presentation);
  });

  test.skipIf(!existsSync(corpusRoot))("discovers the supplied 25 products and reads campaign progs under selected classic behavior", async () => {
    const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
    expect(catalog.products).toHaveLength(27);
    expect(catalog.products.filter(product => product.availability.kind === "installed")).toHaveLength(25);
    expect(catalog.product("q1-rerelease-quake64").availability.kind).toBe("missing");
    expect(catalog.mapsFor("q1-quakeworld").some(map => map.path === "maps/start.bsp")).toBe(true);
    const native = preset(catalog.product("q1-rerelease-mg1").id);
    const classic: ProviderReference = { provider: "q1:classic", content: catalog.product("q1-classic-id1").id };
    const recipe = await resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), engineBehavior: { kind: "selected", value: classic } } });
    expect(recipe.engineBehavior).toEqual(classic);
    const gamecode = recipe.execution.find(module => module.kind === "quakec");
    if (gamecode?.kind !== "quakec") throw new Error("Campaign gamecode was not resolved");
    expect(gamecode.artifact.provenance.mount.identity.content).toBe(native.map.geometry.content);
    expect(gamecode.artifact.byteLength).toBeGreaterThan(0);
    expect(recipe.map.geometry.provenance.mount.identity.content).toBe(native.map.geometry.content);
  });
});


test("remote QW content context cannot select local execution or a different product", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const remoteContent = { base: "q1-quakeworld", directory: "example" } satisfies import("../../../src/content/catalog/index.ts").RemoteContentSelection;
  await expect(loadApplicationContent({ ...command.options, product: "q1-quakeworld-mod-example", remoteContent })).rejects.toThrow("matching remote client product");
  await expect(loadApplicationContent({ ...command.options, network: { kind: "qw-client", remote: "127.0.0.1:27500" }, remoteContent })).rejects.toThrow("matching remote client product");
});
