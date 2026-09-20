import { defaultUserContentRoot } from "../../src/content/user-data.ts";
import { applicationWeaponBehaviorChoices } from "../../src/app/bootstrap/weapon-behavior-selection.ts";
import { createContentId, type GameFamily, type ProviderTiming } from "../../src/contracts/content.ts";
import { expectedProducts, type CatalogProduct } from "../../src/content/catalog/index.ts";
import { preflightApplicationMatch } from "../../src/app/bootstrap/match-preflight.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent, InstalledCatalog, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { applicationPreset, applicationOptionsForRecipe, resolveApplicationMovement } from "../../src/app/bootstrap/content.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { defaultNetQuakeProfile } from "../../src/network/q1/profile.ts";

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
  model.select("grapple", "offhand"); model.select("grappleStyle", "q2-ctf"); model.select("grenades", "enabled");
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
  expect(applicationOptionsForRecipe(selected.options, { catalog, recipe: selected.recipe })).toMatchObject({ movement: "q2", movementProduct: "q2-rerelease-baseq2" });
  expect(selected.recipe.campaign.kind).toBe("none");
  expect(selected.recipe.equipment.grapple).toMatchObject({ kind: "enabled", mechanic: "q2-ctf", binding: "offhand" });
  expect(selected.recipe.equipment.handGrenades).toMatchObject({ kind: "enabled", binding: "offhand" });
  expect(model.rows().find(row => row.id === "grenades")?.choices.map(choice => choice.label)).toEqual(["Off", "On"]);
  expect(model.rows().find(row => row.id === "grapple")?.choices.map(choice => choice.label)).toEqual(["Off", "Weapon slot", "Offhand"]);
  expect(model.rows().find(row => row.id === "grappleStyle")?.choices.map(choice => choice.label)).toContain("Threewave CTF (Quake 2)");
  expect(model.rows().find(row => row.id === "grappleStyle")?.choices.every(choice => !choice.label.includes("offhand") && !choice.label.includes("weapon slot"))).toBe(true);
  expect(model.bindingCapabilities()).toEqual({ chat: false, scoreCommand: null, offhandGrapple: true, offhandGrenades: true });
  expect(selected.options).toMatchObject({ width: 1280, height: 720, gamma: 1.3, mode: "deathmatch", movement: "q2", character: "q3", characterModel: "sarge" });
  expect(model.summary().some(line => line.includes("Independent pickup replacement is not implemented"))).toBe(true);
  expect(() => model.select("map", "maps/not-installed.bsp")).toThrow("Unknown map");
  expect(() => model.select("product", "q1-rerelease-quake64")).toThrow();
  model.select("product", "q2-classic-baseq2");
  expect(model.options.map).toBe("maps/base1.bsp");
  model.select("rules", "ctf");
  await expect(model.resolve()).rejects.toThrow("CTF map is missing");
  model.select("product", "q2-classic-ctf");
  expect((await model.resolve()).recipe.match.provider).toBe("q2:ctf");
  model.select("product", "q2-classic-baseq2");
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
  expect(model.hosting()).toEqual({ kind: "offline", port: 27910, q1Protocol: null });
  model.setHosting({ kind: "unified-server", port: 28123, q1Protocol: null });
  expect(model.options.mode).toBe("coop");
  expect((await model.resolve()).options.network).toEqual({ kind: "unified-server", host: "0.0.0.0", port: 28123 });
  expect(() => model.setHosting({ kind: "native-server", port: 65536, q1Protocol: null })).toThrow("Port must");
  expect(model.hosting()).toEqual({ kind: "unified-server", port: 28123, q1Protocol: null });
  model.setHosting({ kind: "native-server", port: 27910, q1Protocol: null });
  expect((await model.resolve()).options.network.kind).toBe("native-server");
  model.setHosting({ kind: "offline", port: 27910, q1Protocol: null });
  expect(model.options.network.kind).toBe("offline");
}, 60000);

test("Q1 hosting selects native protocol and removes stale protocol outside NetQuake hosting", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const model = new StartupSelectionModel(catalog, command.options);
  for (const version of [15, 666, 999]) {
    const q1Protocol = defaultNetQuakeProfile(version);
    model.setHosting({ kind: "native-server", port: 26000, q1Protocol });
    expect(model.options.q1Protocol).toEqual(q1Protocol);
    expect(model.hosting().q1Protocol).toEqual(q1Protocol);
  }
  model.setHosting({ ...model.hosting(), kind: "unified-server" }); expect(model.options.q1Protocol).toBeUndefined();
  model.setHosting({ kind: "native-server", port: 26000, q1Protocol: defaultNetQuakeProfile(999) });
  model.setHosting({ ...model.hosting(), kind: "offline" }); expect(model.options.q1Protocol).toBeUndefined();
  for (const product of ["q1-quakeworld", "q2-classic-baseq2", "q3-baseq3"]) {
    const other = new StartupSelectionModel(catalog, { ...command.options, product, q1Protocol: defaultNetQuakeProfile(666), network: { kind: "native-server", host: "0.0.0.0", port: 26000 } });
    expect(other.hosting().q1Protocol).toBeNull(); expect(other.options.q1Protocol).toBeUndefined();
  }
});

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
    saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined, quit: () => undefined });
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
  const { SeatInput } = await import("../../src/input/seat.ts");
  const { CommandBuffer } = await import("../../src/core/commands/index.ts");
  const { sharedBindingActions } = await import("../../src/ui/settings/action-catalog.ts");
  const { defaultBindings } = await import("../../src/input/bindings.ts");
  const context = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } } satisfies ConstructorParameters<typeof CommandBuffer>[0]["context"];
  const input = new SeatInput({ seat, dialect: "q1-netquake", context, commands: new CommandBuffer({ dialect: "q1-netquake", context }), uiEvent: event => menu.input(event) });
  for (const binding of defaultBindings(0, "q1-netquake", model.bindingItems())) input.bind(binding);
  menu.bindInput(input, () => sharedBindingActions("q1-netquake", model.bindingItems(), model.bindingCapabilities()));
  try {
    click(2); click(2);
    expect(menu.controller.activeMenu).toBe("menu:settings:input:0");
    menu.input({ seat, timeMilliseconds: 0, kind: "key", code: 13, down: true, repeat: false });
    menu.input({ seat, timeMilliseconds: 0, kind: "key", code: 13, down: false, repeat: false });
    expect(menu.controller.activeMenu).toBe("menu:bindings:0");
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x: 100, y: 398 }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
    expect(menu.controller.bindingCapture).toBe(true);
    menu.input({ seat, timeMilliseconds: 0, kind: "key", code: 102, down: true, repeat: false });
    menu.input({ seat, timeMilliseconds: 0, kind: "key", code: 102, down: false, repeat: false });
    expect(input.binding({ kind: "key", code: 102 })).toEqual({ kind: "command", text: "+forward" });
    menu.controller.closeAll(); menu.controller.openMenu("menu:startup:main");
    click(2); click(1);
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
    click(0); click(5); click(2); click(1); click(1);
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
  model.select("grapple", "offhand"); model.select("grappleStyle", "q2-ctf");
  model.select("grenades", "enabled");
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
    expect(model.presets().find(preset => preset.id === "q3-missionpack")?.unavailable).toBeNull();
    const teamArena = await model.resolvePreset("q3-missionpack", 4);
    expect(teamArena.options).toMatchObject({ map: "maps/mpteam1.bsp", characterModel: "james", botSkill: 4,
      teamArenaSkirmish: { gameType: 4, maxClients: 6, playerTeam: "Red", playerHeadModel: "*james" } });
    expect(teamArena.recipe.character.appearance.provider).toBe("q3:model/james");
    expect(model.teamArena.choices().some(team => team.id === "stroggs")).toBe(true);
    model.teamArena.write("player", "stroggs"); model.teamArena.write("opponent", "pagans");
    model.selectServerProfile("/private/selected-server-profile.cfg");
    const selectedTeams = await model.resolvePreset("q3-missionpack", 3);
    expect(selectedTeams.options.serverProfilePath).toBe("/private/selected-server-profile.cfg");
    expect(selectedTeams.options.teamArenaSkirmish?.cvars.find(row => row.name === "g_redTeam")?.value).toBe("stroggs");
    expect(selectedTeams.options.teamArenaSkirmish?.bots[0]?.name).toBe("Khan");
    expect(() => model.teamArena.write("player", "missing team")).toThrow("Unknown authored");
    model.selectServerProfile(null); expect(model.options.serverProfilePath).toBeUndefined();
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


test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")))("mixed match eligibility uses source rules on Q3 geometry before launch", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--mode", "deathmatch", "--rules", "deathball"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  model.select("mapProduct", "q3-baseq3");
  await expect(model.resolve()).rejects.toThrow("DeathBall map is missing:");
  model.select("rules", "standard");
  await model.prepareMapChoices(0, 1);
  const map = model.rows().find(row => row.id === "map")?.choices.find(row => row.id === model.options.map);
  expect(map?.unavailable).toBeNull();
}, 30000);


test.skipIf(!existsSync(resolve(corpus, "q3a/missionpack/pak0.pk3")))("configured Team Arena objectives preflight preserves explicit foreign anchors", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q3-missionpack", "--map", "mpteam1", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) });
  const world = { kind: "q2-bsp", entities: '{ "classname" "worldspawn" } { "classname" "item_flag_team1" } { "classname" "item_flag_team2" } { "classname" "info_player_deathmatch" }' } satisfies Parameters<typeof preflightApplicationMatch>[0]["world"];
  const content = { catalog, recipe, world };
  expect(() => preflightApplicationMatch(content, command.options, [{ name: "g_gametype", value: "4" }])).not.toThrow();
  expect(() => preflightApplicationMatch(content, command.options, [{ name: "g_gametype", value: "4" }, { name: "g_gametype", value: "5" }])).toThrow("team_CTF_neutralflag");
  expect(() => preflightApplicationMatch(content, command.options, [{ name: "g_gametype", value: "7" }])).toThrow("team_neutralobelisk");
  expect(() => preflightApplicationMatch({ ...content, world: { ...world, entities: world.entities + ' { "classname" "team_CTF_neutralflag" "origin" "0 0 32" }' } }, command.options, [{ name: "g_gametype", value: "5" }])).not.toThrow();
});


test("exact movement products resolve catalog family and edition independently of world", () => {
  const products: CatalogProduct[] = expectedProducts.map(expectation => ({ expectation,
    id: createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: "movement-test" }),
    availability: { kind: "installed" }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [] }));
  const q2 = products.find(product => product.expectation.id === "q2-rerelease-baseq2");
  if (q2 === undefined) throw new Error("Missing Q2 definition");
  products.push({ ...q2, id: createContentId({ family: "q2", edition: "rerelease", package: "custom", revision: "movement-test" }), expectation: { ...q2.expectation, id: "custom-movement", baseProduct: "q2-rerelease-baseq2" } });
  const catalog = new InstalledCatalog("/unused-movement-fixture", products, [], 1);
  const cases: readonly (readonly [string, GameFamily, ProviderTiming["clock"]["kind"]])[] = [["q1-quakeworld", "q1", "q1-quakeworld"], ["q2-classic-baseq2", "q2", "q2-classic"], ["q2-rerelease-baseq2", "q2", "q2-rerelease"], ["custom-movement", "q2", "q2-rerelease"], ["q3-baseq3", "q3", "q3"]];
  for (const [id, family, clock] of cases) {
    const command = parseApplicationCommand(["--game", "q1-classic-id1", "--movement", id]);
    if (command.kind !== "run") throw new Error("Expected launch");
    const resolved = resolveApplicationMovement(catalog, command.options);
    expect(resolved.movement).toBe(family);
    const preset = applicationPreset(catalog, command.options);
    expect(preset.movement.content).toBe(catalog.require(id).id);
    const timing = preset.timing.find(profile => profile.provider === preset.movement.provider);
    expect(timing?.clock.kind).toBe(clock);
    if (clock === "q1-quakeworld") expect(timing?.clock).toEqual({ kind: "q1-quakeworld", maximumCommandMilliseconds: 255 });
    const menu = new StartupSelectionModel(catalog, command.options);
    expect(menu.options.movement).toBe(family);
    expect(menu.options.movementProduct).toBe(id);
    const row = menu.rows().find(row => row.id === "movement");
    expect(row?.choices.filter(choice => choice.id === id)).toHaveLength(1);
    expect(row?.choices.find(choice => choice.id === id)?.unavailable).toBeNull();
    const menuPreset = applicationPreset(catalog, menu.options);
    expect(menuPreset.movement).toEqual(preset.movement);
    expect(menuPreset.timing).toEqual(preset.timing);
  }
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--movement", "q2"]);
  if (command.kind !== "run") throw new Error("Expected launch");
  expect(applicationPreset(catalog, command.options).movement.content).toBe(catalog.require("q2-classic-baseq2").id);
  expect(() => applicationPreset(catalog, { ...command.options, movementProduct: "unknown" })).toThrow("Unknown requested content");
  const unavailable = new InstalledCatalog(catalog.corpusRoot, products.map(product => product === q2 ? { ...product, availability: { kind: "unresolved", reason: "unsupported fixture" } } : product), [], 1);
  expect(() => applicationPreset(unavailable, { ...command.options, movementProduct: "q2-rerelease-baseq2" })).toThrow("unsupported fixture");
  const native = applicationPreset(catalog, { ...command.options, product: "q1-quakeworld", movement: "q1", character: "q1", dedicated: true, mode: "deathmatch" });
  expect(native.timing.find(profile => profile.provider === native.engineBehavior.provider)?.clock).toEqual({ kind: "q1-quakeworld", maximumCommandMilliseconds: 50 });
  expect(native.timing.find(profile => profile.provider === native.movement.provider)?.clock).toEqual({ kind: "q1-quakeworld", maximumCommandMilliseconds: 50 });
});


test.skipIf(process.env["QTS_TEST_INSTALLED_WEAPON_BEHAVIORS"] !== "1" || !existsSync(corpus))("Mods menu exposes installed components across provider families and retains independent selections", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, userContentRoot: defaultUserContentRoot(), discoverMods: true });
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2"]);
  if (command.kind !== "run") throw new Error("Expected launch options");
  const declared: { product: string; id: string; kind: string }[] = [];
  for (const product of catalog.products) {
    if (product.availability.kind !== "installed") continue;
    for (const entry of await applicationWeaponBehaviorChoices(catalog, product.expectation.id)) {
      if (entry.selection !== null && entry.unavailable === null) declared.push({ product: product.expectation.id, id: entry.id, kind: entry.selection.component?.kind ?? "quakec" });
    }
  }
  expect(new Set(declared.map(entry => entry.kind))).toEqual(new Set(["quakec", "qvm", "rerelease-native"]));
  const model = new StartupSelectionModel(catalog, command.options);
  await model.prepareMaps();
  for (const entry of declared) {
    for (const active of model.mods.rows().filter(row => row.enabled)) model.mods.setEnabled(active.id, false);
    const choice = model.mods.rows().find(choice => choice.id === entry.id);
    expect(choice?.unavailable).toBeNull();
    model.mods.setEnabled(entry.id, true);
    expect(model.mods.rows().find(row => row.id === entry.id)?.enabled).toBe(true);
    expect(model.options.mods?.some(mod => mod.product === entry.product)).toBe(true);
  }
  const selected = model.options.mods;
  model.mods.setEnabled("missing/component", true);
  expect(model.mods.status()).toContain("not installed");
  expect(model.options.mods).toEqual(selected);
  await model.prepareMaps();
  expect(model.options.mods).toEqual(selected);
}, 60000);
