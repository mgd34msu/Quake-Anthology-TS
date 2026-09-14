import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent, InstalledCatalog, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { applicationPreset } from "../../src/app/bootstrap/content.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";

const corpus = resolve(import.meta.dir, "../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")) || !existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("startup choices resolve independent installed source selections without starting a world", async () => {
  const command = parseApplicationCommand(["--content-root", corpus]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  expect(model.rows().find(row => row.id === "model")?.choices.some(choice => choice.id === "sarge")).toBe(true);
  expect(model.rows().find(row => row.id === "product")?.choices.find(choice => choice.id === "q1-rerelease-quake64")?.unavailable).not.toBeNull();
  const original = await model.resolve();
  expect(original.recipe.weapons).toEqual([{ provider: "q2:official", content: catalog.require("q2-classic-baseq2").id }]);
  model.select("weapons", "q3-baseq3"); model.select("movement", "q2-rerelease-baseq2");
  model.select("grapple", "q2-classic-ctf/offhand"); model.select("grenades", "q2-classic-baseq2");
  model.select("product", "q1-rerelease-id1");
  expect(model.options.map).toBe("maps/start.bsp");
  expect(model.rows().find(row => row.id === "map")?.choices.some(map => map.id === "maps/b_bh10.bsp")).toBe(false);
  expect(() => model.select("map", "maps/b_bh10.bsp")).toThrow("Unknown map");
  model.select("map", "maps/dm4.bsp");
  model.select("mode", "deathmatch"); model.setDisplay({ width: 1280, height: 720, gamma: 1.3 });
  const selected = await model.resolve();
  expect(selected.recipe.map.geometryContent).toBe(catalog.require("q1-rerelease-id1").id);
  expect(selected.recipe.map.geometry.requestedPath).toBe("maps/dm4.bsp");
  expect(selected.options.map).toBe("maps/dm4.bsp");
  expect(selected.recipe.weapons).toEqual([{ provider: "q3:official", content: catalog.require("q3-baseq3").id }]);
  expect(selected.recipe.timing.find(profile => profile.provider === selected.recipe.movement.provider)?.clock.kind).toBe("q2-rerelease");
  expect(selected.recipe.campaign.kind).toBe("none");
  expect(selected.recipe.equipment.grapple).toMatchObject({ kind: "enabled", mechanic: "q2-ctf", binding: "offhand" });
  expect(selected.recipe.equipment.handGrenades).toMatchObject({ kind: "enabled", edition: "classic", binding: "offhand" });
  expect(selected.options).toMatchObject({ width: 1280, height: 720, gamma: 1.3, mode: "deathmatch", movement: "q2", character: "q3", characterModel: "sarge" });
  expect(model.summary().some(line => line.includes("Independent pickup replacement is not implemented"))).toBe(true);
  expect(() => model.select("map", "maps/not-installed.bsp")).toThrow("Unknown map");
  expect(() => model.select("product", "q1-rerelease-quake64")).toThrow();
  model.select("product", "q2-classic-baseq2");
  expect(model.options.map).toBe("maps/base1.bsp");
  model.select("rules", "ctf");
  expect((await model.resolve()).recipe.match.provider).toBe("q2:ctf");
  model.select("mode", "singleplayer");
  expect(model.options.rules).toBe("standard");
  expect((await model.resolve()).recipe.match.provider).toBe("q2:official");
  expect(model.rows().find(row => row.id === "weapons")?.value).toBe("q3-baseq3");
  for (const [product, appearance] of [["q1-classic-id1", "player"], ["q2-classic-baseq2", "male"], ["q3-baseq3", "sarge"]]) {
    if (product === undefined || appearance === undefined) throw new Error("Incomplete character case");
    model.select("character", product);
    expect(model.options.characterModel).toBe(appearance);
    expect(model.rows().find(row => row.id === "model")?.choices.some(choice => choice.id === appearance && choice.unavailable === null)).toBe(true);
  }
  const inferred = new StartupSelectionModel(catalog, { ...command.options, product: "q2-classic-ctf", mode: "deathmatch" });
  expect(inferred.options.rules).toBe("ctf");
}, 60000);

test.skipIf(!existsSync(resolve(corpus, "q1/id1/PAK0.PAK")))("mouse startup roster edits actual map classes with native defaults and exceptions", async () => {
  const { StartupMenu } = await import("../../src/app/bootstrap/startup-menu.ts");
  const { createIdentityOwner } = await import("../../src/contracts/identity.ts");
  const { createMountPlanId } = await import("../../src/contracts/content.ts");
  const { SceneImageRegistry } = await import("../../src/render/scene/resources.ts");
  const { loadMenuFont } = await import("../../src/app/bootstrap/menu-font.ts");
  const { loadNativeUiArt } = await import("../../src/ui/common/index.ts");
  const { loadMenuArtImage } = await import("../../src/app/bootstrap/menu-art.ts");
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m2"]);
  if (command.kind !== "run") throw new Error("Expected Q1 options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  const identity = createIdentityOwner("startup-roster-mouse"), seat = identity.seat(0), images = new SceneImageRegistry({ identity: Symbol("roster-ui"), session: identity.session, generation: 0 });
  const mounts = await catalog.mountsFor(catalog.require("q1-classic-id1").id), mounted = await openMountPlan({ id: createMountPlanId("roster", "menu"), mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  const font = await loadMenuFont({ catalog, mounts: mounted, family: "q1", rerelease: false, images });
  const fontSource = font.font.classic.picture.image.source;
  if (fontSource.kind !== "resource") throw new Error("Missing actual font resource");
  const art = await loadNativeUiArt(fontSource.resource.id, images, loadMenuArtImage);
  const menu = new StartupMenu({ seat, model, art, font: font.font, titleFont: font.font, now: () => 0, play: () => undefined, load: () => undefined,
    saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined, quit: () => undefined, applyDisplay: () => undefined });
  const click = (row: number) => {
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x: 100, y: 130 + row * 34 }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
  };
  let currentRosterPage = 0;
  const choose = (classname: string | null, id: string) => {
    const rows = model.monsterRosterRows(), rowIndex = rows.findIndex(row => row.classname === classname);
    if (rowIndex < 0) throw new Error("Missing authored roster row");
    const pages = Math.max(1, Math.ceil(rows.length / 7)), wantedPage = Math.floor(rowIndex / 7);
    while (currentRosterPage !== wantedPage) { click(8); currentRosterPage = (currentRosterPage + 1) % pages; }
    click(rowIndex % 7);
    const row = rows[rowIndex], index = row?.choices.findIndex(choice => choice.id === id) ?? -1;
    if (index < 0) throw new Error("Missing replacement choice");
    for (let page = 0; page < Math.floor(index / 7); page++) click(8);
    click(index % 7);
    expect(menu.controller.activeMenu).toBe("menu:startup:roster");
  };
  try {
    click(3); click(1);
    expect(menu.controller.activeMenu).toBe("menu:startup:sound");
    click(0); click(2);
    expect(menu.controller.activeMenu).toBe("menu:startup:sound");
    expect(model.rows().find(row => row.id === "environment")?.value).toBe("q2-rerelease-baseq2");
    const soundRecipe = (await model.resolve()).recipe;
    expect(soundRecipe.presentation.audio.content).toBe(catalog.require("q1-classic-id1").id);
    expect(soundRecipe.presentation.environment).toEqual({ kind: "selected", resource: { content: catalog.require("q2-rerelease-baseq2").id, path: "sound/default.environments" } });
    click(0); click(0);
    expect((await model.resolve()).recipe.presentation.environment).toEqual({ kind: "disabled" });
    click(0); click(1);
    expect((await model.resolve()).recipe.presentation.environment).toEqual({ kind: "audio-content" });
    click(1); click(1);
    expect((await model.resolve()).recipe.presentation.doppler).toEqual({ kind: "disabled" });
    expect(menu.controller.activeMenu).toBe("menu:startup:sound");
    click(1); click(0);
    expect((await model.resolve()).recipe.presentation.doppler).toEqual({ kind: "source" });
    menu.controller.closeMenu(); menu.controller.closeMenu();
    click(1); click(2); click(1); click(1);
    await model.prepareMonsterRoster();
    expect(menu.controller.activeMenu).toBe("menu:startup:roster");
    expect(model.monsterRosterRows()[0]?.value).toBe("native");
    expect(model.monsterRosterRows().some(row => row.classname === "monster_ogre" && /\([1-9][0-9]*\)/.test(row.label))).toBe(true);
    choose("monster_ogre", "q2:monsters/classic/baseq2/monster_berserk");
    let selected = await model.resolve();
    expect(selected.recipe.enemies).toMatchObject({ kind: "replace", default: { kind: "map-defined" }, byClassname: { monster_ogre: { classname: "monster_berserk" } } });
    expect(selected.recipe.map.geometry.requestedPath).toBe("maps/e1m2.bsp");
    choose(null, "q1:monsters/classic/id1/monster_army");
    choose("monster_ogre", "native");
    selected = await model.resolve();
    expect(selected.recipe.enemies).toMatchObject({ kind: "replace", default: { classname: "monster_army" }, byClassname: { monster_ogre: { kind: "map-defined" } } });
    choose("monster_ogre", "default");
    expect((await model.resolve()).recipe.enemies).toMatchObject({ byClassname: {} });
    choose("monster_ogre", "native");
    model.select("map", "maps/e1m1.bsp"); await model.prepareMonsterRoster();
    expect((await model.resolve()).recipe.enemies).toMatchObject({ byClassname: { monster_ogre: { kind: "map-defined" } } });
    expect(model.monsterRosterRows()[0]?.value).toBe("q1:monsters/classic/id1/monster_army");
    model.select("product", "q2-classic-baseq2"); await model.prepareMonsterRoster();
    expect(model.monsterRosterRows()[0]?.value).toBe("native");
    expect(model.monsterRosterRows().some(row => row.classname === "monster_soldier_light")).toBe(true);
    model.select("product", "q1-classic-id1"); await model.prepareMonsterRoster();
    expect(model.monsterRosterRows()[0]?.value).toBe("q1:monsters/classic/id1/monster_army");
    model.select("map", "maps/e1m2.bsp"); await model.prepareMonsterRoster();
    expect(model.monsterRosterRows().find(row => row.classname === "monster_ogre")?.value).toBe("native");
    model.select("map", "maps/e2m6.bsp"); await model.prepareMonsterRoster();
    const finalClass = model.monsterRosterRows()[7];
    if (finalClass === undefined || finalClass.classname === null) throw new Error("Missing actual second page class");
    choose(finalClass.classname, "native");
    expect(model.monsterRosterRows()[7]?.value).toBe("native");
    model.select("product", "q3-baseq3");
    expect(() => model.select("enemies", "custom")).toThrow("authored monster roster");
    expect(model.rows().find(row => row.id === "enemies")?.value).toBe("native");
  } finally { menu.close(); art.close(); font.close(); mounted.close(); }
}, 60000);


test.skipIf(!existsSync(corpus))("environment resources retain native sound selection and reject missing selected data", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const environmentContent = catalog.require("q2-rerelease-baseq2").id;
  for (const [game, map] of [["q1-classic-id1", "e1m1"], ["q3-baseq3", "q3dm1"]]) {
    if (game === undefined || map === undefined) throw new Error("Missing actual map pair");
    const command = parseApplicationCommand(["--content-root", corpus, "--game", game, "--map", map]);
    if (command.kind !== "run") throw new Error("Expected actual map command");
    const preset = applicationPreset(catalog, command.options);
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), presentation: { kind: "selected", value: { ...preset.presentation,
      environment: { kind: "selected", resource: { content: environmentContent, path: "sound/default.environments" } } } } } });
    expect(recipe.presentation.audio).toEqual(preset.presentation.audio);
    const baseline = await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) });
    using nativeMounts = await openMountPlan(baseline.mounts);
    using selectedMounts = await openMountPlan(recipe.mounts);
    const entries = catalog.require(game).archives.flatMap(archive => archive.entries);
    const patterns = game === "q1-classic-id1" ? [/^progs\/.*\.mdl$/i, /^gfx\.wad$/i, /^sound\/.*\.wav$/i]
      : [/^models\/.*\.md3$/i, /^textures\/.*\.(tga|jpg)$/i, /^sound\/.*\.wav$/i];
    for (const pattern of patterns) {
      const path = entries.find(entry => pattern.test(entry.path))?.path;
      if (path === undefined) throw new Error("Missing actual native media category");
      const original = await nativeMounts.resolve(path), selected = await selectedMounts.resolve(path);
      if (original === null || selected === null) throw new Error(`Missing native media ${path}`);
      expect(original.provenance.mount.identity.content).toBe(preset.presentation.audio.content);
      expect(selected.provenance).toEqual(original.provenance);
      expect(selected.digest).toEqual(original.digest);
    }
    expect(recipe.resources.find(resource => resource.requestedPath === "sound/default.environments")?.provenance.mount.identity.content).toBe(environmentContent);
    await expect(resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), presentation: { kind: "selected", value: { ...preset.presentation, effects: { provider: "q2:official", content: environmentContent },
      environment: { kind: "selected", resource: { content: preset.presentation.audio.content, path: "sound/default.environments" } } } } } })).rejects.toThrow("Required environment resource is absent from its selected content and base");
  }
}, 30000);

for (const profile of [{ family: "q1", product: "q1-classic-id1", map: "e1m1" }, { family: "q2", product: "q2-classic-baseq2", map: "base1" }, { family: "q3", product: "q3-baseq3", map: "q3dm1" }]) test(`startup browser queries a real local ${profile.family} host and preserves favorites`, async () => {
  const { Application } = await import("../../src/app/bootstrap/application.ts");
  const { StartupServerBrowser, browserAddress } = await import("../../src/app/bootstrap/server-browser.ts");
  const { ConfigStore } = await import("../../src/settings/config.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(`${tmpdir()}/quake-browser-`), config = new ConfigStore(directory);
  const command = parseApplicationCommand(["--game", profile.product, "--map", profile.map, "--character", profile.family, "--movement", profile.family, "--dedicated", "--listen", "0", "--bind", "127.0.0.1"]);
  if (command.kind !== "run") throw new Error("Missing host options");
  const app = await Application.open(command.options, { print: () => undefined });
  const browser = await StartupServerBrowser.open(config);
  try {
    const address = app.networkAddress; if (address === null) throw new Error("Missing local host address");
    browser.choose(profile.family); browser.address = `localhost:${address.port}`; await browser.query();
    for (let index = 0; index < 30 && browser.rows()[0]?.status == null; index++) { await app.step(16); await Bun.sleep(2); browser.poll(); }
    const row = browser.rows()[0];
    expect(row?.status?.map).toBe(profile.map); expect(row?.pingMilliseconds).not.toBeNull();
    expect(row?.status?.wire).toEqual({ kind: "source", protocol: profile.family === "q1" ? { kind: "q1-netquake", version: 15 }
      : profile.family === "q2" ? { kind: "q2-classic", version: 34 } : { kind: "q3", version: 68 } });
    browser.filter = "absent-name"; expect(browser.rows()).toHaveLength(0); browser.filter = "";
    await browser.favorite();
    browser.address = "[::1]:26000"; await expect(browser.query()).rejects.toThrow("Address family");
    browser.address = browserAddress(address);
    const restored = await StartupServerBrowser.open(config);
    try { restored.choose(profile.family); expect(restored.rows()[0]?.sources).toContain("favorite"); expect(restored.rows()[0]?.address).toEqual(address); }
    finally { restored.close(); }
    if (profile.family === "q1") {
      await config.dump("servers-q1", '[{"kind":"loopback","id":"invalid-favorite"}]');
      await expect(StartupServerBrowser.open(config)).rejects.toThrow("requires an IP address");
    }
  } finally { browser.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

test.skipIf(!existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("native campaign presets replace gameplay choices without changing the custom draft", async () => {
  const command = parseApplicationCommand(["--content-root", corpus]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const model = new StartupSelectionModel(catalog, { ...command.options, botSkill: 5, serverProfilePath: "/custom-match.json", quakeCProgram: "progs.dat" });
  await model.prepareMaps();
  model.select("weapons", "q3-baseq3");
  model.select("grapple", "q2-classic-ctf/offhand");
  model.select("grenades", "q2-classic-baseq2");
  model.select("mode", "deathmatch");
  model.select("enemies", "custom");
  model.select("environment", "disabled");
  model.select("doppler", "disabled");
  model.setDisplay({ width: 1280, height: 720, gamma: 1.3 });
  const draft = model.options, rows = model.rows();
  const launch = await model.resolvePreset("q1-rerelease-id1", 3);
  const native = catalog.require("q1-rerelease-id1").id;
  expect(launch.options).toMatchObject({ product: "q1-rerelease-id1", map: "maps/start.bsp", movement: "q1", character: "q1", characterModel: "player", skill: 3, mode: "singleplayer", seats: 1, width: 1280, height: 720, gamma: 1.3 });
  expect(launch.options.botSkill).toBeUndefined();
  expect(launch.options.serverProfilePath).toBeUndefined();
  expect(launch.options.quakeCProgram).toBeUndefined();
  expect(launch.recipe.movement.content).toBe(native);
  expect(launch.recipe.character.definition.content).toBe(native);
  expect(launch.recipe.character.appearance.content).toBe(native);
  expect(launch.recipe.timing.find(timing => timing.provider === "q1:movement")?.clock.kind).toBe("q1-netquake");
  expect(launch.recipe.campaign).toMatchObject({ kind: "campaign", mission: { content: native }, gamecode: { content: native } });
  expect(launch.recipe.weapons).toEqual([{ provider: "q1:official", content: native }]);
  expect(launch.recipe.enemies).toEqual({ kind: "map-defined" });
  expect(launch.recipe.equipment.grapple.kind).toBe("disabled");
  expect(launch.recipe.equipment.handGrenades.kind).toBe("disabled");
  expect(launch.recipe.presentation).toMatchObject({ assets: native, environment: { kind: "audio-content" }, doppler: { kind: "source" } });
  expect(model.options).toEqual(draft);
  expect(model.rows()).toEqual(rows);
  await expect(model.resolvePreset("q2-classic-lmctf")).rejects.toThrow("official campaign preset unavailable");
  await expect(model.resolvePreset("q1-rerelease-id1", 5)).rejects.toThrow("Invalid preset difficulty");
}, 60000);

test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")))("native Q3 preset uses the authored training arena and bot difficulty", async () => {
  const command = parseApplicationCommand(["--content-root", corpus]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  const launch = await model.resolvePreset("q3-baseq3", 5);
  expect(launch.options).toMatchObject({ map: "maps/q3dm0.bsp", mode: "singleplayer", botSkill: 5, character: "q3", characterModel: "sarge", movement: "q3" });
  expect(launch.recipe.campaign.kind).toBe("campaign");
  expect(model.presets().find(preset => preset.id === "q3-baseq3")?.difficulties).toHaveLength(5);
  if (catalog.product("q3-missionpack").availability.kind === "installed") {
    expect(model.presets().find(preset => preset.id === "q3-missionpack")?.unavailable).toContain("team setup");
    await expect(model.resolvePreset("q3-missionpack")).rejects.toThrow("team setup");
  }
}, 60000);


test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")))("native rerelease presets do not depend on installed classic providers", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--movement", "q2", "--character", "q2"]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected launch options");
  const installed = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const catalog = new InstalledCatalog(corpus, installed.products.filter(product => product.expectation.family === "q2" && product.expectation.edition === "rerelease"), installed.rootArchives, installed.generation);
  const model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  for (const preset of model.presets()) {
    const launch = await model.resolvePreset(preset.id);
    const content = catalog.require(preset.id).id;
    expect(launch.recipe.movement.content).toBe(content);
    expect(launch.recipe.character.definition.content).toBe(content);
    expect(launch.recipe.timing.find(timing => timing.provider === "q2:movement")?.clock.kind).toBe("q2-rerelease");
    expect(launch.recipe.presentation.assets).toBe(content);
    expect(launch.recipe.map.geometryContent).toBe(content);
  }
}, 60000);
