import { decodePng } from "../../src/formats/images/png.ts";
import { testCorpusRoot } from "../support/corpus.ts";
import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { KeyCode } from "../../src/input/key-codes.ts";
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
  const corpusRoot = testCorpusRoot(), catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
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
  const nativeLaunches: { readonly id: string; readonly skill: number }[] = [];
  const menu = new StartupMenu({ seat, model, art, font: typography.body, titleFont: typography.title, now: () => 0,
    playPreset: (id, skill) => { nativeLaunches.push({ id, skill }); },
    play: () => undefined, load: () => undefined, saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined,
    quit: () => undefined });
  const renderer = new SoftwareRenderer(640, 480, owner), target = new CpuRenderTarget(renderer);
  const click = (x: number, y: number): void => {
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x, y }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
  };
  const wheel = (down: boolean): void => {
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x: 100, y: 200 }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-wheel", delta: { x: 0, y: down ? -1 : 1 } });
  };
  // Scroll a 33px-row scroll menu so `index` is visible; returns the new scroll offset in px.
  const scrollRowsTo = (index: number, total: number, current: number): number => {
    const maximum = Math.max(0, total * 33 - 297);
    let scroll = current;
    while (index * 33 - scroll > 297 - 33 && scroll < maximum) { wheel(true); scroll = Math.min(maximum, scroll + 84); }
    while (index * 33 - scroll < 0 && scroll > 0) { wheel(false); scroll = Math.max(0, scroll - 84); }
    return scroll;
  };
  let rosterScroll = 0;
  const source = async (id: string, screenshot?: string): Promise<void> => {
    click(100, 90); expect(menu.controller.activeMenu).toBe("menu:startup:select");
    if (screenshot !== undefined) await capture(screenshot);
    const index = model.monsterSourceRow().choices.findIndex(choice => choice.id === id);
    if (index < 0) throw new Error("Missing source choice");
    click(100, 128 + index * 33); expect(menu.controller.activeMenu).toBe("menu:startup:roster");
  };
  const select = (classname: string, choiceId: string): void => {
    const rows = model.monsterRosterRows(), index = rows.findIndex(row => row.classname === classname), row = rows[index];
    if (index < 0 || row === undefined) throw new Error("Missing campaign slot");
    rosterScroll = scrollRowsTo(index, rows.length, rosterScroll);
    click(100, 114 + index * 33 - rosterScroll + 12);
    const choiceIndex = row.choices.findIndex(choice => choice.id === choiceId);
    if (choiceIndex < 0) throw new Error("Missing creature choice");
    const choiceScroll = scrollRowsTo(choiceIndex, row.choices.length, 0);
    click(100, 114 + choiceIndex * 33 - choiceScroll + 12); expect(menu.controller.activeMenu).toBe("menu:startup:roster");
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
    const customDraft = model.options;
    const key = (code: number): void => {
      for (const down of [true, false]) menu.input({ seat, timeMilliseconds: 0, kind: "key", code, down, repeat: false });
    };
    const focusControl = (id: string): void => {
      for (let i = 0; i < 80; i++) {
        const current = menu.controller.state().focus;
        if (current.kind === "menu" && current.control === id) return;
        key(KeyCode.Tab);
      }
      throw new Error(`Unreachable control ${id}`);
    };
    for (const [familyIndex, family] of ["q1", "q2", "q3"].entries()) {
      for (const edition of family === "q3" ? ["classic"] : ["classic", "rerelease"]) {
        const presets = model.presets().filter(preset => preset.family === family && preset.edition === edition);
        if (presets.length === 0) continue;
        click(100, 130); expect(menu.controller.activeMenu).toBe("menu:startup:native-family");
        await capture("native-game-choices");
        click(100, 130 + familyIndex * 34);
        expect(menu.controller.activeMenu).toBe("menu:startup:native-campaign");
        // Unified title list; the toggle row selects the edition variant.
        if (family !== "q3") click(edition === "classic" ? 188 : 452, 130);
        const campaignRowOffset = family === "q3" ? 0 : 1;
        await capture(`native-${family}-${edition}-campaigns`);
        for (const [index, preset] of presets.entries()) {
          const before = nativeLaunches.length;
          click(100, 130 + (campaignRowOffset + index) * 34);
          if (preset.unavailable !== null) {
            expect(menu.controller.activeMenu).toBe("menu:startup:native-campaign"); expect(nativeLaunches).toHaveLength(before); continue;
          }
          if (preset.id === "q3-baseq3") {
            for (let attempt = 0; attempt < 100 && menu.controller.activeMenu !== "menu:library:arena-selection"; attempt++) await Bun.sleep(1);
            expect(menu.controller.activeMenu).toBe("menu:library:arena-selection");
            focusControl("ui:arena-select:play"); key(KeyCode.Enter);
          }
          expect(menu.controller.activeMenu).toBe("menu:startup:native-difficulty");
          if (index === 0) await capture(`native-${family}-${edition}-difficulty`);
          click(100, 368);
          expect(nativeLaunches.at(-1)).toEqual({ id: preset.id, skill: Number(preset.defaultSkill) });
          click(100, 130); click(100, 368);
          expect(nativeLaunches.at(-1)).toEqual({ id: preset.id, skill: Number(preset.difficulties[0]?.id) });
          key(KeyCode.Escape);
          if (preset.id === "q3-baseq3") key(KeyCode.Escape);
          expect(menu.controller.activeMenu).toBe("menu:startup:native-campaign");
        }
        key(KeyCode.Escape); key(KeyCode.Escape);
        expect(menu.controller.activeMenu).toBe("menu:startup:main");
        expect(model.options).toEqual(customDraft);
      }
    }
    expect(nativeLaunches.length).toBeGreaterThan(0);
    key(KeyCode.Enter); expect(menu.controller.activeMenu).toBe("menu:startup:native-family");
    key(KeyCode.Enter); expect(menu.controller.activeMenu).toBe("menu:startup:native-campaign");
    key(KeyCode.Enter); expect(menu.controller.activeMenu).toBe("menu:startup:native-difficulty");
    for (let index = 0; index < 3; index++) key(KeyCode.Escape);
    await capture("native-main-menu");
    click(100, 130); click(100, 232);
    expect(menu.controller.activeMenu).toBe("menu:startup:session");
    key(KeyCode.Escape);
    expect(menu.controller.activeMenu).toBe("menu:startup:native-family");
    key(KeyCode.Enter);
    expect(menu.controller.activeMenu).toBe("menu:startup:session");
    focusControl("ui:startup:back"); key(KeyCode.Enter);
    expect(menu.controller.activeMenu).toBe("menu:startup:native-family");
    key(KeyCode.Escape);
    expect(menu.controller.activeMenu).toBe("menu:startup:main");
    click(100, 130); click(100, 232);
    const dropdownPick = (choiceId: string): void => {
      const row = model.rows().find(candidate => candidate.id === "enemies");
      const choices = row?.choices ?? [], target = choices.find(option => option.id === choiceId);
      if (row === undefined || target === undefined) throw new Error(`Missing enemies choice ${choiceId}`);
      const current = choices.find(option => option.id === row.value);
      const editions = new Set(choices.flatMap(option => option.edition === undefined ? [] : [option.edition]));
      let edition: "classic" | "rerelease" | null = editions.size > 1 ? current?.edition ?? "classic" : null;
      const visible = edition === null ? 8 : 7, itemsTop = edition === null ? 138 : 164;
      const collapsed = new Set(choices.flatMap(option => option.group === undefined || option.group === current?.group ? [] : [option.group]));
      const entriesOf = (): ({ readonly kind: "header"; readonly group: string } | { readonly kind: "choice"; readonly id: string })[] => {
        // The picker shows one unified list: edition variants of a title collapse to one entry.
        const shown: (typeof choices)[number][] = [], seen = new Map<string, (typeof choices)[number]>();
        for (const option of choices) {
          if (option.edition === undefined) { shown.push(option); continue; }
          const key = `${option.group ?? ""}|${option.label}`, existing = seen.get(key);
          if (existing === undefined) { seen.set(key, option); shown.push(option); }
          else if (edition !== null && option.edition === edition) { shown[shown.indexOf(existing)] = option; seen.set(key, option); }
        }
        const entries: ({ kind: "header"; group: string } | { kind: "choice"; id: string })[] = shown.filter(option => option.group === undefined).map(option => ({ kind: "choice", id: option.id }));
        for (const group of [...new Set(shown.flatMap(option => option.group === undefined ? [] : [option.group]))]) {
          entries.push({ kind: "header", group });
          if (!collapsed.has(group)) for (const option of shown) if (option.group === group) entries.push({ kind: "choice", id: option.id });
        }
        return entries;
      };
      let entries = entriesOf();
      const selectedIndex = Math.max(0, entries.findIndex(entry => entry.kind === "choice" && entry.id === row.value));
      // The picker opens at the selection's category header when the selection fits below it.
      let headerIndex = -1;
      for (let index = selectedIndex - 1; index >= 0; index--) if (entries[index]?.kind === "header") { headerIndex = index; break; }
      const anchored = headerIndex >= 0 && selectedIndex - headerIndex < visible ? headerIndex : selectedIndex;
      let scroll = Math.max(0, Math.min(anchored, Math.max(0, entries.length - visible)));
      const scrollTo = (index: number): void => {
        while (index - scroll > visible - 1) { wheel(true); scroll++; }
        while (index - scroll < 0) { wheel(false); scroll--; }
      };
      const clickEntry = (index: number): void => { scrollTo(index); click(360, itemsTop + (index - scroll) * 27 + 12); };
      if (target.edition !== undefined && edition !== null && target.edition !== edition) {
        click(target.edition === "classic" ? 388 : 516, 147);
        edition = target.edition; scroll = 0; entries = entriesOf();
      }
      if (target.group !== undefined && collapsed.has(target.group)) {
        clickEntry(entries.findIndex(entry => entry.kind === "header" && entry.group === target.group));
        collapsed.delete(target.group); entries = entriesOf();
      }
      clickEntry(entries.findIndex(entry => entry.kind === "choice" && entry.id === choiceId));
    };
    focusControl("ui:startup:enemies"); key(KeyCode.Enter);
    await capture("roster-combat-source-presets");
    dropdownPick("q1:monsters/classic/id1");
    expect(menu.controller.activeMenu).toBe("menu:startup:session");
    expect(model.monsterSourceRow().value).toBe("q1:monsters/classic/id1");
    expect(model.rows().find(row => row.id === "enemies")?.value).toBe("q1:monsters/classic/id1");
    await capture("roster-selected-preset-summary");
    focusControl("ui:startup:enemies"); key(KeyCode.Enter); await capture("roster-selected-preset-choice"); dropdownPick("custom");
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
    const infantry = rows.findIndex(row => row.classname === "monster_infantry"); rosterScroll = scrollRowsTo(infantry, rows.length, rosterScroll); await capture("roster-infantry-page");
    rosterScroll = scrollRowsTo(rows.length - 1, rows.length, rosterScroll); await capture("roster-last-page");
    select("monster_berserk", "q1:monsters/classic/id1/monster_wizard");
    expect(model.monsterRosterRows().find(row => row.classname === "monster_berserk")?.effectiveLabel).toBe("Scrag (Q1 classic) *");
    const monsterRow = model.rows().find(row => row.id === "enemies");
    expect(monsterRow?.value).toBe("custom");
    expect(monsterRow?.choices.find(choice => choice.id === "custom")?.label).toBe("Quake (custom)");
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

test("custom builder stages maps inside Map set and appearance inside Character", async () => {
  const corpusRoot = testCorpusRoot(), catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  const command = parseApplicationCommand(["--content-root", corpusRoot, "--game", "q2-classic-baseq2", "--map", "base1"]);
  if (command.kind !== "run") throw new Error("Expected Q2 base1 options");
  const model = new StartupSelectionModel(catalog, command.options); await model.prepareMaps();
  const identity = createIdentityOwner("staged-builder"), seat = identity.seat(0);
  const owner = { identity: Symbol("staged builder"), session: identity.session, generation: 0 }, images = new SceneImageRegistry(owner);
  const product = catalog.require("q2-classic-baseq2"), mounts = await catalog.mountsFor(product.id);
  using mounted = await openMountPlan({ id: "mount-plan:staged-builder:font", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  const font = await loadMenuFont({ catalog, mounts: mounted, family: "q2", rerelease: false, images });
  const typography = await loadMenuTypography(catalog, images, font.font.classic);
  const art = await loadNativeUiArt("resource:test:staged-font", images, async path => decodePng(await Bun.file(resolve(import.meta.dir, "../..", path)).bytes(), path));
  const menu = new StartupMenu({ seat, model, art, font: typography.body, titleFont: typography.title, now: () => 0,
    play: () => undefined, load: () => undefined, saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined, quit: () => undefined });
  const key = (code: number): void => { for (const down of [true, false]) menu.input({ seat, timeMilliseconds: 0, kind: "key", code, down, repeat: false }); };
  const focused = (): string | null => { const current = menu.controller.state().focus; return current.kind === "menu" ? current.control : null; };
  const focusControl = (id: string): void => {
    for (let i = 0; i < 120; i++) { if (focused() === id) return; key(KeyCode.Tab); }
    throw new Error(`Unreachable control ${id}`);
  };
  const reachable = (id: string): boolean => {
    const seen = new Set<string>();
    for (let i = 0; i < 140; i++) { const current = focused(); if (current === id) return true; if (current !== null) { if (seen.has(current)) break; seen.add(current); } key(KeyCode.Tab); }
    return false;
  };
  const pickFirstChoice = (stageField: string): string => {
    const seen = new Set<string>();
    for (let i = 0; i < 140; i++) {
      const current = focused();
      if (current !== null && current.startsWith("ui:startup:choice:")) { key(KeyCode.Enter); return current.slice("ui:startup:choice:".length); }
      if (current !== null) {
        // A stage whose only entry is the current selection exposes no choice:* control;
        // after a full focus cycle, activate the selected entry itself.
        if (seen.has(current)) {
          const selectedId = value(stageField);
          focusControl(`ui:startup:${stageField}`); key(KeyCode.Enter);
          if (selectedId === undefined) throw new Error(`No value for stage ${stageField}`);
          return selectedId;
        }
        seen.add(current);
      }
      key(KeyCode.Tab);
    }
    throw new Error("No dropdown choice reachable");
  };
  const value = (field: string): string | undefined => model.rows().find(row => row.id === field)?.value;
  // Map stage opens busy while map rules resolve; Escape is ignored until then.
  const escapeUntil = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 200; i++) { if (done()) return; key(KeyCode.Escape); if (done()) return; await Bun.sleep(5); }
    throw new Error("Escape never took effect");
  };
  try {
    focusControl("ui:startup:native"); key(KeyCode.Enter);
    focusControl("ui:startup:custom"); key(KeyCode.Enter);
    expect(menu.controller.activeMenu).toBe("menu:startup:session");
    // The builder has no standalone Map / Model / Skin rows any more.
    expect(reachable("ui:startup:map")).toBe(false);
    expect(reachable("ui:startup:model")).toBe(false);
    expect(reachable("ui:startup:skin")).toBe(false);
    // Map set stage 1 -> Maps stage 2 -> pick closes the panel.
    focusControl("ui:startup:mapProduct"); key(KeyCode.Enter);
    expect(reachable("ui:startup:stage-back")).toBe(false);
    const setId = pickFirstChoice("mapProduct");
    expect(value("mapProduct")).toBe(setId);
    expect(reachable("ui:startup:stage-back")).toBe(true);
    const mapId = pickFirstChoice("map");
    expect(value("map")).toBe(mapId);
    expect(reachable("ui:startup:stage-back")).toBe(false);
    expect(reachable("ui:startup:mapProduct")).toBe(true);
    // Escape retreats one stage at a time.
    focusControl("ui:startup:mapProduct"); key(KeyCode.Enter);
    pickFirstChoice("mapProduct");
    expect(reachable("ui:startup:stage-back")).toBe(true);
    await escapeUntil(() => !reachable("ui:startup:stage-back"));
    expect(reachable("ui:startup:choice:" + setId)).toBe(true);
    key(KeyCode.Escape);
    // Character stage 1 -> Model stage 2 -> Skin/colors stage 3.
    focusControl("ui:startup:character"); key(KeyCode.Enter);
    const characterId = pickFirstChoice("character");
    expect(value("character")).toBe(characterId);
    expect(reachable("ui:startup:stage-back")).toBe(true);
    const modelId = pickFirstChoice("model");
    expect(value("model")).toBe(modelId);
    expect(reachable("ui:startup:stage-back")).toBe(true);
    key(KeyCode.Escape);
    expect(reachable("ui:startup:stage-back")).toBe(true);
    await escapeUntil(() => !reachable("ui:startup:stage-back"));
    key(KeyCode.Escape);
    expect(reachable("ui:startup:character")).toBe(true);
  } finally { menu.close(); art.close(); typography.close(); font.close(); images.close(); }
}, 60000);
