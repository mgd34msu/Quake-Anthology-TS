import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import { parseAuthoredStarts } from "../../../src/content/catalog/start-maps.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { StartupSelectionModel } from "../../../src/app/bootstrap/startup-selection.ts";

const corpusRoot = resolve(import.meta.dir, "../../../../qfiles");
const installed = existsSync(resolve(corpusRoot, "q2/rerelease/baseq2/pak0.pak"));
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

test("authored starts preserve order and native launch metadata, reject unsafe BSP paths", () => {
  const starts = parseAuthoredStarts(encode({ episodes: [{ id: "mod", command: "newgame_mod" }], maps: [
    { episode: "other", sp: true, bsp: "other" },
    { episode: "mod", sp: true, bsp: "intro.cin+*zfirst", title: "First", start_items: "weapon_shotgun;ammo_shells 20" },
    { episode: "mod", sp: true, bsp: "asecond" },
    { episode: "mod", dm: true, bsp: "arena" },
  ] }), "mod");
  expect(starts.episode?.command).toBe("newgame_mod");
  expect(starts.starts.map(start => start.path)).toEqual(["maps/zfirst.bsp", "maps/asecond.bsp"]);
  expect(starts.starts[0]).toMatchObject({ bsp: "intro.cin+*zfirst", startItems: "weapon_shotgun;ammo_shells 20", title: "First" });
  expect(() => parseAuthoredStarts(encode({ maps: [{ episode: "mod", sp: true, bsp: "../escape" }] }), "mod")).toThrow();
  expect(() => parseAuthoredStarts(encode({ maps: [{ episode: "mod", sp: "true", bsp: "first" }] }), "mod")).toThrow("flag");
});

test.skipIf(!installed)("six installed rerelease products expose their authored starts and keep arbitrary maps and campaign providers", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  const command = parseApplicationCommand(["--content-root", corpusRoot]);
  if (command.kind !== "menu" && command.kind !== "run") throw new Error("Expected startup options");
  const model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  const cases = [
    { campaign: "baseq2", count: 10, first: "maps/base1.bsp", title: "Unit 1: Base" },
    { campaign: "xatrix", count: 6, first: "maps/xswamp.bsp", title: "Unit 1: Swamps" },
    { campaign: "rogue", count: 5, first: "maps/rmine1.bsp", title: "Unit 1: Mines" },
    { campaign: "n64", count: 6, first: "maps/q64/rtest.bsp", title: "Unit 1: Stroggos" },
    { campaign: "mg2", count: 8, first: "maps/mguhub.bsp", title: "Gateway Station" },
    { campaign: "ctf", count: 8, first: "maps/q2ctf1.bsp", title: "McKinley Revival" },
  ];
  for (const row of cases) {
    const product = catalog.require(`q2-rerelease-${row.campaign}`), authored = await catalog.authoredStartsFor(product.id);
    expect(authored?.starts).toHaveLength(row.count);
    expect(authored?.starts[0]).toMatchObject({ path: row.first, title: row.title, episode: row.campaign === "ctf" ? "baseq2" : row.campaign });
    expect(authored?.resource.provenance.mount.identity.content).toBe(product.id);
    model.select("product", product.expectation.id);
    expect(model.options.map).toBe(row.first);
    const choices = model.rows().find(row => row.id === "map")?.choices;
    expect(choices?.slice(0, row.count).map(choice => choice.id)).toEqual(authored?.starts.map(start => start.path));
    expect(choices?.slice(0, row.count).every(choice => choice.unavailable === null)).toBe(true);
    expect(choices?.[0]?.label).toBe(row.title);
    expect(choices?.some(choice => choice.id === "maps/base2.bsp")).toBe(true);
    model.select("map", "maps/base2.bsp");
    const launch = await model.resolve();
    expect(launch.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
    expect(launch.recipe.campaign).toMatchObject({ kind: "campaign", mission: { content: product.id }, gamecode: { content: product.id } });
  }
}, 60000);

test.skipIf(!installed)("user metadata wins through catalog mounts and missing authored BSPs stay explicit", async () => {
  const userContentRoot = await mkdtemp(resolve(tmpdir(), "quake-start-maps-"));
  try {
    const directory = resolve(userContentRoot, "q2/rerelease/baseq2");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "mapdb.json"), encode({ episodes: [{ id: "mg2", command: "custom_start" }], maps: [
      { episode: "mg2", sp: true, bsp: "*not_installed", title: "Missing first" },
      { episode: "mg2", sp: true, bsp: "*mgu2m1", title: "Custom second" },
    ] }));
    const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, discoverMods: false });
    const authored = await catalog.authoredStartsFor("q2-rerelease-mg2");
    expect(authored?.resource.provenance.mount.kind).toBe("loose");
    expect(authored?.episode?.command).toBe("custom_start");
    expect(authored?.starts.map(start => start.path)).toEqual(["maps/not_installed.bsp", "maps/mgu2m1.bsp"]);
    const command = parseApplicationCommand(["--content-root", corpusRoot]);
    if (command.kind !== "menu" && command.kind !== "run") throw new Error("Expected startup options");
    const model = new StartupSelectionModel(catalog, command.options);
    await model.prepareMaps();
    model.select("product", "q2-rerelease-mg2");
    expect(model.options.map).toBe("maps/not_installed.bsp");
    expect(() => model.select("map", "maps/not_installed.bsp")).toThrow("Missing authored start map");
    model.select("map", "maps/mgu2m1.bsp");
    expect((await model.resolve()).recipe.map.geometry.requestedPath).toBe("maps/mgu2m1.bsp");
  } finally { await rm(userContentRoot, { recursive: true, force: true }); }
}, 60000);
