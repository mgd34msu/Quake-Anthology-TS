import { decodePng } from "../../src/formats/images/png.ts";
import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { StartupMenu } from "../../src/app/bootstrap/startup-menu.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadMenuFont, loadMenuTypography } from "../../src/app/bootstrap/menu-font.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { campaignMonsterSlots } from "../../src/content/catalog/monsters.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ProviderReference } from "../../src/contracts/content.ts";
import type { UiDrawContext } from "../../src/contracts/ui.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { CpuRenderTarget, SoftwareRenderer } from "../../src/render/cpu/index.ts";
import { encodePng } from "../../src/formats/images/png.ts";
import { loadNativeUiArt } from "../../src/ui/common/index.ts";

test("Q2 base1 menu edits every campaign monster slot with Q1 source defaults and retained overrides", async () => {
  const corpusRoot = resolve(import.meta.dir, "../../../qfiles"), catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  const command = parseApplicationCommand(["--content-root", corpusRoot, "--game", "q2-classic-baseq2", "--map", "base1"]);
  if (command.kind !== "run") throw new Error("Expected Q2 base1 options");
  const model = new StartupSelectionModel(catalog, command.options); await model.prepareMaps();
  const identity = createIdentityOwner("full-monster-roster"), seat = identity.seat(0);
  const owner = { identity: Symbol("roster screenshot"), session: identity.session, generation: 0 }, images = new SceneImageRegistry(owner);
  const product = catalog.require("q2-classic-baseq2"), mounts = await catalog.mountsFor(product.id);
  using mounted = await openMountPlan({ id: "mount-plan:full-roster:font", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  const font = await loadMenuFont({ catalog, mounts: mounted, family: "q2", rerelease: false, images });
  const typography = await loadMenuTypography(catalog, images, font.font.classic);
  const art = await loadNativeUiArt("resource:test:roster-font", images, async path => decodePng(await Bun.file(resolve(import.meta.dir, "../..", path)).bytes(), path));
  const menu = new StartupMenu({ seat, model, art, font: typography.body, titleFont: typography.title, now: () => 0,
    play: () => undefined, load: () => undefined, saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined,
    quit: () => undefined, applyDisplay: () => undefined });
  const renderer = new SoftwareRenderer(640, 480, owner), target = new CpuRenderTarget(renderer);
  const click = (x: number, y: number): void => {
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x, y }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
  };
  let rosterPage = 0;
  const page = (wanted: number): void => {
    const pages = Math.max(1, Math.ceil(model.monsterRosterRows().length / 7));
    while (rosterPage !== wanted) { click(100, 402); rosterPage = (rosterPage + 1) % pages; }
  };
  const source = async (id: string, screenshot?: string): Promise<void> => {
    click(100, 90); expect(menu.controller.activeMenu).toBe("menu:startup:select");
    if (screenshot !== undefined) await capture(screenshot);
    const index = model.monsterSourceRow().choices.findIndex(choice => choice.id === id);
    if (index < 0) throw new Error("Missing source choice");
    click(100, 130 + index * 34); expect(menu.controller.activeMenu).toBe("menu:startup:roster");
  };
  const select = (classname: string, choiceId: string): void => {
    const rows = model.monsterRosterRows(), index = rows.findIndex(row => row.classname === classname), row = rows[index];
    if (index < 0 || row === undefined) throw new Error("Missing campaign slot");
    page(Math.floor(index / 7)); click(100, 130 + index % 7 * 34);
    const choiceIndex = row.choices.findIndex(choice => choice.id === choiceId);
    if (choiceIndex < 0) throw new Error("Missing creature choice");
    for (let page = 0; page < Math.floor(choiceIndex / 7); page++) click(100, 402);
    click(100, 130 + choiceIndex % 7 * 34); expect(menu.controller.activeMenu).toBe("menu:startup:roster");
  };
  const captureRoot = process.env["QUAKE_ROSTER_CAPTURE_DIR"];
  const capture = async (name: string): Promise<void> => {
    if (captureRoot === undefined) return;
    const provider: ProviderReference = { provider: "q2:official", content: product.id };
    const context: UiDrawContext = { binding: { seat, client: identity.client(0, 0), viewport: { x: 0, y: 0, width: 640, height: 480 }, safeArea: { x: 0, y: 0, width: 640, height: 480 }, hudScale: 1,
      presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 0 };
    const frame = new SceneFrameBuilder(images); frame.begin("back", false);
    menu.draw(context, draw => frame.command(draw), () => { throw new Error("Image roster requested material text"); });
    target.execute(frame.finish(false)); await mkdir(captureRoot, { recursive: true });
    await Bun.write(resolve(captureRoot, `${name}.png`), encodePng(640, 480, renderer.pixels));
  };
  try {
    click(100, 130); click(100, 198); click(100, 164);
    await capture("roster-combat-source-presets");
    const preset = model.rows().find(row => row.id === "enemies")?.choices.findIndex(option => option.id === "q1:monsters/classic/id1") ?? -1;
    expect(preset).toBeGreaterThanOrEqual(0); click(100, 130 + preset * 34);
    expect(model.monsterSourceRow().value).toBe("q1:monsters/classic/id1");
    expect(model.rows().find(row => row.id === "enemies")?.value).toBe("q1:monsters/classic/id1");
    await capture("roster-selected-preset-summary");
    click(100, 164); await capture("roster-selected-preset-choice"); click(100, 164);
    for (let attempt = 0; attempt < 100 && menu.controller.activeMenu !== "menu:startup:roster"; attempt++) await Bun.sleep(1);
    expect(menu.controller.activeMenu).toBe("menu:startup:roster");
    await source("q1:monsters/classic/id1", "roster-source-choice");
    const rows = model.monsterRosterRows();
    expect(rows.length).toBe(campaignMonsterSlots("q2").length + 1);
    expect(rows.slice(1, 4).map(row => row.classname)).toEqual(["monster_infantry", "monster_soldier", "monster_soldier_light"]);
    expect(rows.find(row => row.classname === "monster_berserk")).toMatchObject({ label: "Berserk (0)", effectiveLabel: "Fiend (Q1 classic)" });
    expect(rows.find(row => row.classname === "monster_infantry")?.effectiveLabel).toBe("Enforcer (Q1 classic)");
    expect(rows.find(row => row.classname === "monster_soldier")?.effectiveLabel).toBe("Grunt (Q1 classic)");
    expect(rows.find(row => row.classname === "monster_gunner")?.effectiveLabel).toBe("Ogre (Q1 classic)");
    await capture("roster-first-page");
    const infantry = rows.findIndex(row => row.classname === "monster_infantry"); page(Math.floor(infantry / 7)); await capture("roster-infantry-page");
    page(Math.ceil(rows.length / 7) - 1); await capture("roster-last-page");
    select("monster_berserk", "q1:monsters/classic/id1/monster_wizard");
    expect(model.monsterRosterRows().find(row => row.classname === "monster_berserk")?.effectiveLabel).toBe("Scrag (Q1 classic) *");
    const monsterRow = model.rows().find(row => row.id === "enemies");
    expect(monsterRow?.value).toBe("custom");
    expect(monsterRow?.choices.find(choice => choice.id === "custom")?.label).toBe("Quake (classic) (custom)");
    const recipe = (await model.resolve()).recipe;
    expect(recipe.enemies).toMatchObject({ kind: "replace", byClassname: { monster_berserk: { classname: "monster_wizard" }, monster_infantry: { classname: "monster_enforcer" }, monster_gunner: { classname: "monster_ogre" } } });
    await source("q1:monsters/rerelease/id1");
    expect(model.monsterRosterRows().find(row => row.classname === "monster_berserk")?.value).toBe("q1:monsters/classic/id1/monster_wizard");
    model.select("map", "maps/base2.bsp"); await model.prepareMonsterRoster();
    expect(model.monsterRosterRows().length).toBe(rows.length);
    expect((await model.resolve()).recipe.enemies).toMatchObject({ byClassname: { monster_berserk: { source: { provider: "q1:monsters/classic/id1" }, classname: "monster_wizard" }, monster_infantry: { source: { provider: "q1:monsters/rerelease/id1" }, classname: "monster_enforcer" } } });
    select("monster_berserk", "default");
    expect(model.monsterRosterRows().find(row => row.classname === "monster_berserk")?.effectiveLabel).toBe("Fiend (Q1 rerelease)");
    expect(model.rows().find(row => row.id === "enemies")?.value).toBe("q1:monsters/rerelease/id1");
  } finally { menu.close(); art.close(); typography.close(); font.close(); target.close(); images.close(); }
}, 60000);
