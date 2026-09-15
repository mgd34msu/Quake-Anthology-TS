import { decodePng } from "../../../src/formats/images/png.ts";
import { drawWeaponHud } from "../../../src/ui/hud/weapon.ts";
import type { CommonWeaponHud } from "../../../src/ui/hud/weapon.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { CommandContext } from "../../../src/contracts/common.ts";
import type { ResourceId } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { IdentityOwner, SeatId } from "../../../src/contracts/identity.ts";
import type { RendererResourceOwner } from "../../../src/contracts/render.ts";
import type { UiDrawContext } from "../../../src/contracts/ui.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { InputRouter } from "../../../src/input/router.ts";
import { SeatInput } from "../../../src/input/seat.ts";
import { InputCommandBuilder } from "../../../src/input/user-command.ts";
import { NativeUiController, defaultUiSkin, loadNativeUiArt, renderUiCommands, uiSkinFont } from "../../../src/ui/common/index.ts";
import { bindCvarSetting, bindInputSettings, registerSettingsMenus, SeatUiPreferences } from "../../../src/ui/settings/index.ts";
import { drawCommonHud, hudVitalOccupiedRects, emptyHudData, SeatHudMessages, SeatWeaponWheel } from "../../../src/ui/hud/index.ts";
import type { WheelItem } from "../../../src/ui/hud/wheel.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { SdlWindow } from "../../../src/platform/sdl.ts";
import { CpuRenderTarget, SoftwareRenderer } from "../../../src/render/cpu/index.ts";
import { SceneFrameBuilder } from "../../../src/render/commands/frame.ts";
import { SceneImageRegistry } from "../../../src/render/scene/resources.ts";
import { classicCharset, TextFontRegistry } from "../../../src/text/atlas.ts";
import type { TextFontSelection } from "../../../src/text/atlas.ts";
import { UiTextRenderer } from "../../../src/text/ui.ts";
import { encodePng } from "../../../src/formats/images/png.ts";

const fontId: ResourceId = "resource:test:menu-font";
function drawContext(owner: IdentityOwner, seat: SeatId, x = 0): UiDrawContext {
  const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies { readonly provider: "ui:test"; readonly content: "q1:rerelease:id1:retail" };
  return { binding: { seat, client: owner.client(seat.index, 0), viewport: { x, y: 0, width: 640, height: 480 },
    safeArea: { x, y: 0, width: 640, height: 480 }, hudScale: 1,
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 1000 };
}

test("native settings alter real command input and remain isolated per seat", () => {
  const owner = createIdentityOwner("native-ui-input"), context: CommandContext = { session: owner.session, origin: { kind: "local-console" } };
  const commands = new CommandBuffer({ dialect: "q3", context });
  const make = (seat: SeatId) => {
    let ui: NativeUiController | null = null;
    const input = new SeatInput({ seat, dialect: "q3", context: { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(seat.index, 0) } },
      commands, uiEvent: event => ui?.input(event) ?? false });
    const builder = new InputCommandBuilder("q3");
    const controller = new NativeUiController({ seat, skin: () => defaultUiSkin(fontId), bindings: () => input.bindings, now: () => 1000,
      focus: (focus, time) => input.setFocus(focus, time), sound: () => undefined, executeScript: () => undefined });
    ui = controller;
    const menus = registerSettingsMenus(controller, bindInputSettings(input, builder));
    controller.openMenu(menus.root);
    return { input, builder, controller, menus };
  };
  const a = make(owner.seat(0)), b = make(owner.seat(1));
  a.input.input({ seat: owner.seat(0), timeMilliseconds: 1000, kind: "key", code: KeyCode.Enter, down: true, repeat: false });
  a.input.input({ seat: owner.seat(0), timeMilliseconds: 1001, kind: "key", code: KeyCode.Right, down: true, repeat: false });
  expect(a.builder.mouse.tuning.sensitivity).toBeCloseTo(3.1);
  expect(b.builder.mouse.tuning.sensitivity).toBe(3);
  a.controller.closeAll();
  a.input.input({ seat: owner.seat(0), timeMilliseconds: 1002, kind: "mouse-motion", position: { x: 100, y: 100 }, delta: { x: 10, y: 0 } });
  const command = a.builder.build(a.input.sample(1016, 16), { kind: "q3", serverTimeMilliseconds: 16, weapon: 2, sensitivity: 1 });
  expect(command.kind).toBe("q3");
  expect(a.builder.viewAngles.y).toBeCloseTo(-0.682, 4);
  expect(b.controller.activeMenu).toBe("menu:settings:root");
  a.menus.dispose(); b.menus.dispose();
});

test("Unicode fields, list navigation and live cvar callbacks use the focused control", () => {
  const owner = createIdentityOwner("native-ui-fields"), seat = owner.seat(2), context: CommandContext = { session: owner.session, origin: { kind: "local-console" } };
  const cvars = new CvarRegistry({ dialect: "q3", context }); cvars.register("rate", "25000");
  const setting = bindCvarSetting(cvars, { name: "rate", label: "Rate", category: "network", restart: null, kind: "slider", minimum: 1000, maximum: 100000, step: 1000 }, null);
  if (setting.kind !== "slider") throw new Error("Expected numeric binding"); setting.write(30000); expect(cvars.variableValue("rate")).toBe(30000);
  let value = "A😀B", selected = "a";
  const ui = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin(fontId), bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  ui.register("menu:test:field", () => ({ id: "menu:test:field", title: "Fields", fullScreen: false, open: () => undefined, close: () => undefined, controls: [
    { kind: "text-entry", id: "ui:test:name", label: "Name", rect: { x: 40, y: 80, width: 560, height: 28 }, visible: true, enabled: true, text: value,
      maximumLength: 8, change: (_seat, text) => { value = text; return undefined; }, submit: () => undefined },
    { kind: "list", id: "ui:test:list", label: "Items", rect: { x: 40, y: 128, width: 560, height: 60 }, visible: true, enabled: true,
      selected, rows: ["a", "b", "c"].map(id => ({ id, cells: [id], enabled: true, image: null })), select: (_seat, id) => { selected = id; return undefined; } },
  ] }));
  ui.openMenu("menu:test:field");
  const key = (code: number): void => { ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 0 }); };
  key(KeyCode.Left); key(KeyCode.Backspace); ui.input({ kind: "text", seat, timeMilliseconds: 0, text: "Ж" });
  expect(value).toBe("AЖB"); key(KeyCode.Tab); key(KeyCode.Down); expect(selected).toBe("b");
  expect(() => ui.input({ kind: "text", seat: owner.seat(3), timeMilliseconds: 0, text: "wrong" })).toThrow("another seat");
});

test("private HUD messages, keyed POIs and real wheel selection keep source recipients", () => {
  const owner = createIdentityOwner("native-ui-hud"), seat = owner.seat(1), messages = new SeatHudMessages(seat), other = new SeatHudMessages(owner.seat(0));
  messages.notify(seat, "Private objective", false, { kind: "seconds", value: 1 }, { kind: "seconds", value: 3 });
  expect(messages.active(1000).notifications).toHaveLength(1); expect(other.active(1000).notifications).toHaveLength(0);
  messages.addPoint(seat, { id: 5, origin: { x: 1, y: 2, z: 3 }, image: "resource:test:poi", width: 16, height: 16,
    color: { x: 1, y: 1, z: 1, w: 1 }, hideOnAim: false, expiresMilliseconds: 2000 }, 0);
  messages.removePoint(5); expect(messages.active(1000).points).toHaveLength(0);
  const items: readonly WheelItem[] = [0, 1, 2].map(index => ({ id: `weapon:${index}`, sourceOrdinal: index, sortOrder: index,
    label: `Weapon ${index}`, owned: true, hasAmmo: index !== 1, count: 10, warningCount: 2, icon: null, selectedIcon: null }));
  const selected: string[] = [];
  const wheel = new SeatWeaponWheel({ seat, items: () => items, activeItem: () => "weapon:0", now: () => 1000, changed: () => undefined,
    select: (id, _mode, recipient) => { expect(recipient.equals(seat)).toBe(true); selected.push(id); } });
  wheel.cycle(1); expect(wheel.drawState().carousel?.selected).toBe("weapon:2");
  expect(wheel.command(true, 1001)).toEqual({ holster: true, consumeAttack: true }); expect(selected).toEqual(["weapon:2"]);
  wheel.open("weapons"); wheel.input({ kind: "mouse-motion", seat, timeMilliseconds: 1001, delta: { x: 0, y: -170 }, position: { x: 0, y: 0 } });
  wheel.update(1100); expect(wheel.drawState().wheel?.selected).toBe("weapon:0"); wheel.close(true); expect(selected).toEqual(["weapon:2", "weapon:0"]);
  const preferences = new SeatUiPreferences(seat); preferences.values = { ...preferences.values, hudScale: 1.5 };
  const commands = drawCommonHud(drawContext(owner, seat, 640), { ...emptyHudData(seat), vitals: [{ label: "Health", value: 100, warning: false, icon: null }] },
    { skin: defaultUiSkin(fontId), preferences: preferences.values, messages, camera: null, localize: text => text });
  const health = commands.find(command => command.kind === "text" && command.text === "Health 100");
  expect(health?.kind === "text" ? health.origin.y : -1).toBeLessThan(480);
  expect(health?.kind === "text" ? health.origin.x : -1).toBeGreaterThan(640);
});

const archivePath = "/home/buzzkill/Projects/qfiles/q1/rerelease/QuakeEX.kpf";
test.skipIf(!existsSync(archivePath))("real generated menu art and rerelease glyphs render through native CPU commands", async () => {
  const owner = createIdentityOwner("native-ui-pixels"), seat = owner.seat(1), context = drawContext(owner, seat, 640);
  const renderOwner: RendererResourceOwner = { identity: Symbol("ui"), session: owner.session, generation: 0 };
  const images = new SceneImageRegistry(renderOwner), archive = await openArchive(archivePath);
  const fonts = new TextFontRegistry({ async read(path) { const entry = archive.findEntries(path)[0]; return entry === undefined ? null : archive.readEntry(entry); },
    async registerImage(name, content) { return images.register(name, content, { wrap: "clamp", filter: "linear" }); }, releaseImage(image) { images.release(image); } });
  const art = await loadNativeUiArt(fontId, images, async path => decodePng(await Bun.file(new URL(`../../../${path}`, import.meta.url)).bytes(), path));
  const window = process.env["QUAKE_UI_NATIVE_SMOKE"] === "1" ? SdlWindow.open({ title: "Native menu smoke", width: 1280, height: 480, backend: "cpu", hidden: true }) : null;
  const renderer = new SoftwareRenderer(1280, 480, renderOwner), target = new CpuRenderTarget(renderer, window);
  try {
    const font = await fonts.loadKfont("fonts/confont.kfont"); if (font === null) throw new Error("Missing retail font");
    const selection: TextFontSelection = { kind: "atlas", font, classic: classicCharset(font.picture.image, "conchars", "tinted") };
    const text = new UiTextRenderer(seat); text.bind(fontId, selection);
    const ui = new NativeUiController({ seat, now: () => 1000, bindings: () => [], skin: () => uiSkinFont(art.skin, selection), focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    ui.register("menu:test:native", () => ({ id: "menu:test:native", title: "QUAKE", fullScreen: true, open: () => undefined, close: () => undefined,
      controls: [{ id: "ui:test:continue", kind: "button", label: "Continue", rect: { x: 64, y: 92, width: 512, height: 28 }, visible: true, enabled: true, activate: () => ui.closeMenu() }] }));
    ui.openMenu("menu:test:native");
    const frame = new SceneFrameBuilder(images); frame.begin("back", false);
    renderUiCommands(context, ui.draw(context), { text, white: art.white, picture: resource => art.picture(resource), emit: command => frame.command(command),
      material: () => { throw new Error("Image menu unexpectedly requested material draw"); } });
    target.execute(frame.finish(window !== null));
    let firstSeat = 0, secondSeat = 0;
    for (let y = 0; y < 480; y++) for (let x = 0; x < 1280; x++) {
      const offset = (y * 1280 + x) * 4;
      const lit = (renderer.pixels[offset] ?? 0) + (renderer.pixels[offset + 1] ?? 0) + (renderer.pixels[offset + 2] ?? 0);
      if (x < 640) firstSeat += lit; else secondSeat += lit;
    }
    expect(firstSeat).toBe(0); expect(secondSeat).toBeGreaterThan(100000);
    if (process.env["QUAKE_UI_NATIVE_SMOKE"] === "1") await Bun.write(".artifacts/w59-native-menu.png", encodePng(1280, 480, renderer.pixels));
  } finally { art.close(); fonts.close(); archive.close(); target.close(); window?.close(); images.close(); }
}, 20000);


test.skipIf(process.env["QUAKE_UI_NATIVE_SMOKE"] !== "1")("SDL menu clicks use their own coordinates and native motion drags sliders", () => {
  const owner = createIdentityOwner("native-menu-mouse"), seat = owner.seat(0), context = drawContext(owner, seat);
  const commandContext: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q3", context: commandContext });
  let clicked = 0, value = 0;
  const ui = new NativeUiController({ seat, skin: () => defaultUiSkin(fontId), bindings: () => [], now: () => 1000,
    focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  ui.register("menu:test:mouse", () => ({ id: "menu:test:mouse", title: "Mouse", fullScreen: false, open: () => undefined, close: () => undefined,
    controls: [
      { id: "ui:test:click", kind: "button", label: "Click", rect: { x: 40, y: 80, width: 160, height: 30 }, enabled: true, visible: true, activate: () => { clicked++; return undefined; } },
      { id: "ui:test:drag", kind: "slider", label: "Drag", rect: { x: 40, y: 140, width: 400, height: 30 }, enabled: true, visible: true,
        value, minimum: 0, maximum: 100, step: 1, change: (_seat, next) => { value = next; return undefined; } },
    ] }));
  ui.openMenu("menu:test:mouse"); ui.draw(context);
  const input = new SeatInput({ seat, dialect: "q3", context: commandContext, commands, uiEvent: event => ui.input(event) });
  input.setFocus({ kind: "menu", menu: "menu:test:mouse", control: null }, 1000);
  const window = SdlWindow.open({ title: "Menu mouse test", width: 640, height: 480, backend: "cpu", hidden: true });
  const router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }], keyboardSeat: seat, controllers: null,
    now: () => 1000, ticks: () => window.ticks, subframe: false, unhandled: () => undefined });
  try {
    router.attachWindow(window);
    const pump = (): void => { for (const event of window.pollEvents()) router.handlePlatform(event); };
    pump();
    window.pushEvent({ kind: "window", timestamp: 0, event: 12, data1: 0, data2: 0 }); pump();
    const button = (x: number, y: number, down: boolean): void => {
      window.pushEvent({ kind: "mouse-button", timestamp: 0, down, button: 1, clicks: 1, x, y }); pump();
    };
    expect(window.relativeMouse).toBe(false);
    button(80, 90, true); button(80, 90, false);
    expect(clicked).toBe(1);
    button(280, 150, true);
    window.pushEvent({ kind: "mouse-motion", timestamp: 0, buttons: 1, x: 408, y: 150, dx: 128, dy: 0 }); pump();
    button(408, 150, false);
    expect(value).toBe(100);
    window.pushEvent({ kind: "window", timestamp: 0, event: 13, data1: 0, data2: 0 }); pump();
    button(80, 90, true); button(80, 90, false); expect(clicked).toBe(1);
    window.pushEvent({ kind: "window", timestamp: 0, event: 12, data1: 0, data2: 0 }); pump();
    window.setSize(1280, 960);
    const viewport = { x: 0, y: 0, ...window.drawableSize };
    ui.draw({ ...context, binding: { ...context.binding, viewport, safeArea: viewport } });
    button(160, 180, true); button(160, 180, false); expect(clicked).toBe(2);
  } finally { router.close(); ui.closeAll(); window.close(); }
});

test("weapon occlusion follows the actual HUD vital fills at each seat safe area and scale", () => {
  const owner = createIdentityOwner("hud-weapon-area"), seat = owner.seat(1), base = drawContext(owner, seat, 640);
  const preferences = new SeatUiPreferences(seat), messages = new SeatHudMessages(seat);
  for (const scale of [0.75, 1, 1.5]) {
    const context: UiDrawContext = { ...base, binding: { ...base.binding,
      safeArea: { x: 672, y: 24, width: 576, height: 432 }, hudScale: 1.25 } };
    const settings = { ...preferences.values, hudScale: scale, crosshair: false };
    const vitals = [{ label: "Health", value: 100, warning: false, icon: null }, { label: "Armor", value: 50, warning: false, icon: null }];
    const commands = drawCommonHud(context, { ...emptyHudData(seat), vitals },
      { skin: defaultUiSkin(fontId), preferences: settings, messages, camera: null, localize: text => text });
    const occupied = hudVitalOccupiedRects(context, vitals.length, scale);
    const fills = commands.flatMap(command => command.kind === "fill" ? [command.rect] : []);
    expect(occupied).toHaveLength(2);
    expect(fills).toHaveLength(2);
    for (const [index, rect] of occupied.entries()) {
      const fill = fills[index];
      if (fill === undefined) throw new Error("Missing actual vital background");
      expect(rect.x).toBeCloseTo(fill.x, 10); expect(rect.y).toBeCloseTo(fill.y, 10);
      expect(rect.width).toBeCloseTo(fill.width, 10); expect(rect.height).toBeCloseTo(fill.height, 10);
      expect(rect.x).toBeGreaterThan(context.binding.safeArea.x);
    }
  }
});

test("common weapon HUD distinguishes finite zero, source one-shell fallback, unmetered and aggregate warning", () => {
  const base: CommonWeaponHud = { status: { source: { provider: "q1:weapons/rerelease/id1", content: "q1:rerelease:id1:retail" },
    item: "q1:weapon/supershotgun", label: "supershotgun", ammo: { kind: "finite", item: "q1:ammo/shells", count: 1, hasAmmoToStart: true, low: false } },
    warning: "none", weaponIcon: null, ammoIcon: null, nativeStatus: false };
  const draw = (data: CommonWeaponHud) => drawWeaponHud(data, { x: 400, y: 434, width: 156, height: 42 }, defaultUiSkin(fontId), 1)
    .flatMap(command => command.kind === "text" ? [command.text] : []);
  expect(draw(base)).toEqual(["1", "supershotgun"]);
  expect(draw({ ...base, status: { ...base.status, ammo: { kind: "finite", item: "q1:ammo/shells", count: 0, hasAmmoToStart: false, low: false } } })).toEqual(["0", "NO AMMO"]);
  expect(draw({ ...base, status: { ...base.status, ammo: { kind: "unmetered" } } })).toEqual(["supershotgun"]);
  expect(draw({ ...base, warning: "empty" })).toEqual(["1", "OUT OF AMMO"]);
  expect(draw({ ...base, warning: "low" })).toEqual(["1", "LOW AMMO WARNING"]);
  const measureText = (text: string, scale: number) => text.length * 10 * scale;
  const warning = drawWeaponHud({ ...base, warning: "low", measureText }, { x: 8, y: 434, width: 152, height: 42 }, defaultUiSkin(fontId), 3)
    .find(command => command.kind === "text" && command.text === "LOW AMMO WARNING");
  if (warning?.kind !== "text") throw new Error("Missing aggregate warning");
  expect(warning.origin.x + measureText(warning.text, warning.scale)).toBeLessThanOrEqual(156);
});

test("gyro menu calibrates the assigned controller and restores only its seat tuning", async () => {
  const { registerGyroSettingsMenu } = await import("../../../src/ui/settings/gyro.ts");
  const { ControllerSettings } = await import("../../../src/app/bootstrap/controller-settings.ts");
  const { ConfigStore } = await import("../../../src/settings/config.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const directory = await mkdtemp("/tmp/gyro-menu-");
  const owner = createIdentityOwner("gyro-menu"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q3", context });
  const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => false });
  input.gamepad.tuning = { ...input.gamepad.tuning, gyro: { ...input.gamepad.tuning.gyro, pitchSensitivity: 0.7 } };
  const otherSeat = owner.seat(1), otherContext: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat: otherSeat, client: owner.client(1, 0) } };
  const otherInput = new SeatInput({ seat: otherSeat, dialect: "q3", context: otherContext, commands, uiEvent: () => false });
  otherInput.gamepad.tuning = { ...otherInput.gamepad.tuning, gyro: { ...otherInput.gamepad.tuning.gyro, yawSensitivity: 6 } };
  const otherTuning = structuredClone(otherInput.gamepad.tuning);
  const router = new InputRouter({ seats: [{ input, controller: { kind: "automatic" } }, { input: otherInput, controller: { kind: "none" } }], keyboardSeat: seat,
    now: () => 1000, ticks: () => 1000, subframe: false, unhandled: () => undefined,
    controllers: { setAssignments: () => undefined, assignments: [7], pollEvents: () => [], snapshot: () => null,
      setSensorEnabled: () => ({ kind: "accepted" }) } });
  const device: import("../../../src/platform/controller.ts").ControllerDevice = { instance: 7, name: "Test gyro controller", guid: "a".repeat(32), serial: "pad-A", ordinal: 0, virtual: true,
    capabilities: { axes: [], buttons: [], rumble: false, triggerRumble: false, led: false, touchpads: 0, sensors: [{ kind: "gyro", enabled: false, rateHz: 50 }] } };
  let devices: readonly import("../../../src/platform/controller.ts").ControllerDevice[] = [device];
  const store = new ConfigStore(directory), settings = new ControllerSettings(router, [seat, otherSeat], () => devices, store);
  const ui = new NativeUiController({ seat, now: () => 1000, skin: () => defaultUiSkin(fontId), bindings: () => [],
    focus: focus => input.setFocus(focus, 1000), sound: () => undefined, executeScript: () => undefined });
  const menu = registerGyroSettingsMenu(ui, settings.ui(seat));
  const click = (row: number): void => {
    ui.input({ seat, timeMilliseconds: 1000, kind: "mouse-motion", position: { x: 200, y: 106 + row * 28 }, delta: { x: 0, y: 0 } });
    ui.input({ seat, timeMilliseconds: 1000, kind: "mouse-button", button: 1, down: true });
    ui.input({ seat, timeMilliseconds: 1000, kind: "mouse-button", button: 1, down: false });
  };
  const loaded = async (): Promise<void> => { for (let attempt = 0; attempt < 100 && settings.busy(seat); attempt++) await Bun.sleep(1); expect(settings.busy(seat)).toBe(false); };
  try {
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: null, instance: 7 }); settings.update(); await loaded();
    expect(input.gamepad.tuning.gyro.pitchSensitivity).toBe(0.7);
    input.gamepad.tuning = { ...input.gamepad.tuning, gyro: { ...input.gamepad.tuning.gyro, yawSensitivity: 2 } };
    ui.openMenu(menu.root); click(1); await loaded(); expect(input.gamepad.tuning.gyro.enabled).toBe(true);
    click(2); expect(router.gyroCalibration(seat).kind).toBe("calibrating");
    for (let index = 0; index <= 100; index++) router.handleController({ kind: "sensor", timestamp: 0, instance: 7, slot: 0, sensor: "gyro", timestampUs: BigInt((1000 + index * 20) * 1000), x: 0.01, y: -0.02, z: 0.03 });
    expect(router.gyroCalibration(seat).kind).toBe("ready");
    click(5); expect(router.gyroCalibration(seat).kind).toBe("idle");
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 7, instance: null }); settings.update();
    devices = [{ ...device, instance: 8, serial: "pad-B" }];
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: null, instance: 8 }); settings.update(); await loaded();
    expect(router.gyroCalibration(seat).kind).toBe("idle");
    expect(input.gamepad.tuning.gyro.enabled).toBe(false);
    expect(input.gamepad.tuning.gyro.yawSensitivity).toBe(1);
    expect(input.gamepad.tuning.gyro.pitchSensitivity).toBe(0.7);
    input.gamepad.tuning = { ...input.gamepad.tuning, gyro: { ...input.gamepad.tuning.gyro, yawSensitivity: 3 } };
    await settings.save(seat);
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 8, instance: null }); settings.update();
    devices = [{ ...device, instance: 9 }];
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: null, instance: 9 }); settings.update(); await loaded();
    expect(input.gamepad.tuning.gyro.enabled).toBe(true);
    expect(input.gamepad.tuning.gyro.yawSensitivity).toBe(2);
    expect(router.gyroCalibration(seat).kind).toBe("idle");
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 9, instance: null }); settings.update();
    devices = [{ ...device, instance: 10, serial: "pad-B" }];
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: null, instance: 10 }); settings.update(); await loaded();
    expect(input.gamepad.tuning.gyro.enabled).toBe(false);
    expect(input.gamepad.tuning.gyro.yawSensitivity).toBe(3);
    await store.saveGyro("controllers/seat-1/seat.json", { version: 1, identity: { kind: "seat" }, tuning: { ...input.gamepad.tuning.gyro, yawSensitivity: 4 } });
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 10, instance: null }); settings.update();
    devices = [{ ...device, instance: 11, serial: null }];
    router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: null, instance: 11 }); settings.update(); await loaded();
    expect(input.gamepad.tuning.gyro.yawSensitivity).toBe(4);
    expect(otherInput.gamepad.tuning).toEqual(otherTuning);
  } finally { ui.closeAll(); menu.dispose(); settings.close(); router.close(); await rm(directory, { recursive: true, force: true }); }
});

test("bindings show keys, replace one assignment, add another, cancel conflicts and remove directly", async () => {
  const { registerBindingMenus } = await import("../../../src/ui/settings/bindings.ts");
  const owner = createIdentityOwner("binding-table"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const commands = new CommandBuffer({ dialect: "q3", context });
  const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => false });
  const ui = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin(fontId), bindings: () => input.bindings,
    focus: focus => input.setFocus(focus, 0), sound: () => undefined, executeScript: () => undefined });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+forward" } });
  input.bind({ input: { kind: "key", code: 115 }, target: { kind: "command", text: "+back" } });
  const menus = registerBindingMenus(ui, input, [
    { id: "forward", label: "Move forward", target: { kind: "command", text: "+forward" } },
    { id: "back", label: "Move back", target: { kind: "command", text: "+back" } },
  ]);
  const key = (code: number): void => { ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 0 }); };
  const click = (x: number, y: number): void => {
    ui.input({ kind: "mouse-motion", seat, timeMilliseconds: 0, position: { x, y }, delta: { x: 0, y: 0 } });
    ui.input({ kind: "mouse-button", seat, timeMilliseconds: 0, button: 1, down: true });
    ui.input({ kind: "mouse-button", seat, timeMilliseconds: 0, button: 1, down: false });
  };
  const labels = (): string[] => ui.draw(drawContext(owner, seat)).flatMap(command => command.kind === "text" ? [command.text] : []);
  ui.openMenu(menus.root);
  expect(labels()).toContain("w"); expect(labels()).toContain("s");
  click(400, 148); expect(ui.bindingCapture).toBe(true); key(122);
  expect(input.binding({ kind: "key", code: 119 })).toBeNull();
  expect(input.binding({ kind: "key", code: 122 })).toEqual({ kind: "command", text: "+forward" });
  click(100, 398); key(120);
  expect(labels()).toContain("z"); expect(labels()).toContain("x");
  click(400, 148); key(115);
  expect(ui.activeMenu).toBe("menu:bindings:conflict");
  expect(input.binding({ kind: "key", code: 122 })).not.toBeNull();
  key(KeyCode.Enter);
  expect(ui.activeMenu).toBe(menus.root);
  expect(input.binding({ kind: "key", code: 115 })).toEqual({ kind: "command", text: "+back" });
  click(400, 148); key(115); click(200, 246);
  expect(input.binding({ kind: "key", code: 122 })).toBeNull();
  expect(input.binding({ kind: "key", code: 115 })).toEqual({ kind: "command", text: "+forward" });
  click(578, 148);
  expect(input.binding({ kind: "key", code: 115 })).toBeNull();
  expect(input.binding({ kind: "key", code: 120 })).toEqual({ kind: "command", text: "+forward" });
  expect(ui.bindingCapture).toBe(false);
  click(100, 398);
  ui.input({ kind: "mouse-wheel", seat, timeMilliseconds: 0, delta: { x: 0, y: 1 } });
  expect(input.binding({ kind: "key", code: KeyCode.MouseWheelUp })).toEqual({ kind: "command", text: "+forward" });
  expect(labels()).toContain("MWHEELUP");
  click(100, 398);
  ui.input({ kind: "mouse-button", seat, timeMilliseconds: 0, button: 3, down: true });
  expect(input.binding({ kind: "mouse-button", button: 3 })).toEqual({ kind: "command", text: "+forward" });
  expect(labels()).toContain("MOUSE2");
  click(100, 398);
  ui.input({ kind: "controller-axis", seat, timeMilliseconds: 0, device: 2, axis: "right-trigger", value: 0.9 });
  expect(input.binding({ kind: "controller-axis", device: 2, axis: "right-trigger", direction: "positive" })).toEqual({ kind: "command", text: "+forward" });
  click(100, 398);
  ui.input({ kind: "controller-button", seat, timeMilliseconds: 0, device: 2, button: 4, down: true });
  expect(input.binding({ kind: "controller-button", device: 2, button: 4 })).toEqual({ kind: "command", text: "+forward" });
  const otherSeat = owner.seat(1);
  const otherInput = new SeatInput({ seat: otherSeat, dialect: "q3", context: { session: owner.session,
    origin: { kind: "local-seat", seat: otherSeat, client: owner.client(1, 0) } }, commands, uiEvent: () => false });
  expect(otherInput.bindings).toHaveLength(0);
  expect(() => registerBindingMenus(ui, otherInput, [])).toThrow("another input seat");
  menus.dispose();
});

test("binding table search, wheel, scrollbar and keyboard reach every row without capture", async () => {
  const { registerBindingMenus } = await import("../../../src/ui/settings/bindings.ts");
  const owner = createIdentityOwner("binding-table-scroll"), seat = owner.seat(0);
  const context: CommandContext = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } };
  const input = new SeatInput({ seat, dialect: "q3", context, commands: new CommandBuffer({ dialect: "q3", context }), uiEvent: () => false });
  const ui = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin(fontId), bindings: () => input.bindings,
    focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
  const menus = registerBindingMenus(ui, input, Array.from({ length: 50 }, (_, i) => ({ id: `action-${i}`, label: `Action ${i}`,
    target: { kind: "command", text: `action${i}` } })));
  const key = (code: number): void => { ui.input({ kind: "key", seat, code, down: true, repeat: false, timeMilliseconds: 0 }); };
  const pointer = (x: number, y: number): void => { ui.input({ kind: "mouse-motion", seat, timeMilliseconds: 0, position: { x, y }, delta: { x: 0, y: 0 } }); };
  const button = (down: boolean): void => { ui.input({ kind: "mouse-button", seat, timeMilliseconds: 0, button: 1, down }); };
  const labels = (): string[] => ui.draw(drawContext(owner, seat)).flatMap(command => command.kind === "text" ? [command.text] : []);
  ui.openMenu(menus.root); labels();
  pointer(400, 150);
  const focusedCommands = ui.draw(drawContext(owner, seat));
  const listBackground = focusedCommands.find(command => command.kind === "fill" && command.rect.x === 48 && command.rect.y === 136 && command.rect.height === 238);
  const selectedBackground = focusedCommands.find(command => command.kind === "fill" && command.rect.x === 48 && command.rect.y === 136 && command.rect.height === 24);
  expect(listBackground?.kind === "fill" ? listBackground.color : null).toEqual(defaultUiSkin(fontId).colors.control);
  expect(selectedBackground?.kind === "fill" ? selectedBackground.color : null).toEqual(defaultUiSkin(fontId).colors.focused);
  ui.input({ kind: "mouse-wheel", seat, timeMilliseconds: 0, delta: { x: 0, y: -1 } });
  expect(labels()).toContain("Action 3"); expect(labels()).not.toContain("Action 0"); expect(ui.bindingCapture).toBe(false);
  pointer(582, 170); button(true); pointer(582, 374); button(false);
  expect(labels()).toContain("Action 49"); expect(ui.bindingCapture).toBe(false);
  key(KeyCode.Home); expect(labels()).toContain("Action 0"); key(KeyCode.End); expect(labels()).toContain("Action 49");
  expect(ui.bindingCapture).toBe(false);
  pointer(400, 92); button(true); button(false);
  ui.input({ kind: "text", seat, timeMilliseconds: 0, text: "Action 49" });
  expect(labels()).toContain("Action 49"); expect(labels()).not.toContain("Action 48");
  key(KeyCode.Tab); key(KeyCode.Enter); expect(ui.bindingCapture).toBe(true); key(KeyCode.Escape);
  expect(ui.activeMenu).toBe(menus.root);
  pointer(400, 92); button(true); button(false); key(KeyCode.End);
  ui.input({ kind: "text", seat, timeMilliseconds: 0, text: " missing" });
  expect(labels()).toContain("No matching actions");
  menus.dispose();
});
