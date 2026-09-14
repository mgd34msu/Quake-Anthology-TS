import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ContentId, ExecutionSelection, ProviderReference } from "../../../src/contracts/content.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, expectedProducts, presetChoice, resolveLaunch, selectLaunch } from "../../../src/content/catalog/index.ts";
import type { LaunchPreset } from "../../../src/content/catalog/index.ts";

const corpusRoot = resolve(import.meta.dir, "../../../../qfiles");

function preset(content: ContentId): LaunchPreset {
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const clock: LaunchPreset["ordering"] = { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } };
  return { id: "recipe:campaign:1", map: { geometry: { content, path: "maps/start.bsp" }, entities: provider("entities") },
    campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("gamecode") }, movement: provider("movement"),
    character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("rerelease"),
    combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "quakec", owner: provider("gamecode"), role: "server-game", artifact: { content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    timing: [], ordering: clock };
}

describe("installed content catalog", () => {
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

  test.skipIf(!existsSync(corpusRoot))("application rejects resolved guest artifacts instead of substituting TypeScript execution", async () => {
    const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
    const cases: readonly { readonly game: string; readonly map: string; readonly module: (owner: ProviderReference) => ExecutionSelection }[] = [
      { game: "q1-classic-id1", map: "start", module: owner => ({ kind: "quakec", owner, role: "server-game", artifact: { content: owner.content, path: "progs.dat" }, api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }) },
      { game: "q2-classic-xatrix", map: "xswamp", module: owner => ({ kind: "native", owner, role: "server-game", artifact: { content: owner.content, path: "gamex86.dll" }, api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" } }) },
      { game: "q3-baseq3", map: "q3dm1", module: owner => ({ kind: "qvm", owner, role: "server-game", artifact: { content: owner.content, path: "vm/qagame.qvm" }, api: { kind: "q3-qagame", version: 8 } }) },
    ];
    for (const entry of cases) {
      const command = parseApplicationCommand(["--content-root", corpusRoot, "--game", entry.game, "--map", entry.map]);
      if (command.kind !== "run") throw new Error("Expected application launch");
      const native = applicationPreset(catalog, command.options);
      const module = entry.module(native.map.entities);
      const recipe = await resolveLaunch({ catalog, preset: native, choice: { ...presetChoice(native.id), execution: { kind: "selected", value: [module] } } });
      const resolved = recipe.execution[0];
      if (resolved === undefined || resolved.kind === "typescript") throw new Error("Expected resolved guest artifact");
      expect(resolved.artifact.byteLength).toBeGreaterThan(0);
      expect(resolved.artifact.provenance.mount.identity.content).toBe(native.map.entities.content);
      await expect(loadApplicationContent(command.options, recipe)).rejects.toThrow(`Application cannot execute ${resolved.kind} server-game module ${resolved.owner.provider} (${resolved.artifact.requestedPath})`);
      const supported = await loadApplicationContent(command.options);
      try { expect(supported.recipe.execution.every(value => value.kind === "typescript")).toBe(true); }
      finally { await supported.close(); }
    }
  }, 30000);

  test("retains all expected rows when installation is missing, and rejects unknown mods", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-catalog-"));
    try {
      const catalog = await discoverInstalledContent({ corpusRoot: root });
      expect(expectedProducts).toHaveLength(25);
      expect(catalog.products).toHaveLength(25);
      expect(catalog.products.filter(product => product.availability.kind === "missing")).toHaveLength(24);
      expect(catalog.product("q1-rerelease-quake64").availability.kind).toBe("unresolved");
      expect(() => catalog.require("q1-classic-id1")).toThrow("requires");
      expect(() => catalog.product("unknown-mod")).toThrow("Unknown requested content or mod");
      await mkdir(resolve(root, "q1/custom/maps"), { recursive: true });
      await writeFile(resolve(root, "q1/custom/maps/example.bsp"), new Uint8Array([1, 2, 3]));
      const withMod = await discoverInstalledContent({ corpusRoot: root });
      expect(withMod.product("q1-classic-custom").maps).toHaveLength(1);
      expect(withMod.product("q1-classic-custom").availability.kind).toBe("missing");
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

  test.skipIf(!existsSync(corpusRoot))("discovers the supplied 24 products and reads campaign progs under selected classic behavior", async () => {
    const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
    expect(catalog.products).toHaveLength(25);
    expect(catalog.products.filter(product => product.availability.kind === "installed")).toHaveLength(24);
    expect(catalog.product("q1-rerelease-quake64").availability.kind).toBe("unresolved");
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
