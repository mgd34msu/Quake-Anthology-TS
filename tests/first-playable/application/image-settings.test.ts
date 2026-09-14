import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { SceneImageRegistry } from "../../../src/render/scene/resources.ts";
import type { RendererImage } from "../../../src/contracts/render.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";

function pink(bytes: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const r = bytes[offset] ?? 0, g = bytes[offset + 1] ?? 0, b = bytes[offset + 2] ?? 0;
    if (r > 30 && b > 30 && r > g * 3 && b > g * 3) count++;
  }
  return count;
}
function red(bytes: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const r = bytes[offset] ?? 0, g = bytes[offset + 1] ?? 0, b = bytes[offset + 2] ?? 0;
    if (r > 40 && r > g * 3 && r > b * 3) count++;
  }
  return count;
}

for (const interaction of ["console", "menu"]) for (const backend of ["cpu", "gl"]) test(`local ${backend} image ${interaction} refresh retains the world and retires replaced images`, async () => {
  const users = await mkdtemp(join(tmpdir(), "quake-local-images-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--renderer", backend, "--hidden", "--width", interaction === "menu" ? "640" : "320", "--height", interaction === "menu" ? "480" : "240"]);
  if (parsed.kind !== "run") throw new Error("Missing application options");
  const content = await loadApplicationContent(parsed.options);
  try {
    if (content.world.kind !== "q2-bsp") throw new Error("Missing Q2 map");
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([255, 0, 255, 255], offset);
    for (const name of new Set(content.world.textureInfo.map(info => info.name))) {
      const path = join(users, "q2/baseq2/textures", `${name}.png`);
      await mkdir(dirname(path), { recursive: true }); await Bun.write(path, encodePng(16, 16, pixels));
    }
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([255, 0, 0, 255], offset);
    for (const name of ["models/weapons/v_blast/skin.png", "models/weapons/v_blast/md5/skin.png"]) {
      const path = join(users, "q2/baseq2", name);
      await mkdir(dirname(path), { recursive: true }); await Bun.write(path, encodePng(16, 16, pixels));
    }
    await Bun.write(join(users, "q2/baseq2/models/weapons/v_blast/skin.gif"), "deliberately malformed gun GIF");
    await mkdir(join(users, "q2/baseq2/pics"), { recursive: true });
    await Bun.write(join(users, "q2/baseq2/pics/conchars.gif"), "deliberately malformed GIF");
    await mkdir(join(users, "settings"), { recursive: true });
    await Bun.write(join(users, "settings/images.cfg"), 'seta r_override_textures "0"\nseta r_texture_formats "source"\n');
  } finally { await content.close(); }
  const registered = new Map<SceneImageRegistry, Set<RendererImage>>(), original = SceneImageRegistry.prototype.register;
  const register = spyOn(SceneImageRegistry.prototype, "register").mockImplementation(function(this: SceneImageRegistry, ...args) {
    const image = original.call(this, ...args), values = registered.get(this) ?? new Set<RendererImage>();
    values.add(image); registered.set(this, values); return image;
  });
  const prints: string[] = [];
  let app: Application | null = null;
  try {
    app = await Application.open({ ...parsed.options, userContentRoot: users }, { print: text => { prints.push(text); return undefined; } });
    const application = app, local = application.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    const presentation = local.seat.presentation, assets = presentation.assets, world = assets.world, simulation = application.simulation;
    const window = application.window, input = presentation.local, source = simulation.q2Source();
    if (source === null) throw new Error("Missing Q2 source");
    const key = (code: number): void => { for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const command = async (text: string): Promise<void> => {
      key(96); application.input({ seat: local.seat.id, kind: "text", text, timeMilliseconds: performance.now() }); key(13);
      await application.step(25); key(96); await application.step(25);
    };
    const capture = async (): Promise<Uint8Array> => { const pending = application.captureNextFrame(); await application.step(25); return pending; };
    for (let index = 0; index < 12; index++) await application.step(25);
    const baselinePixels = await capture(), baseline = pink(baselinePixels), elapsed = application.timeMilliseconds;
    if (interaction === "menu") {
      const clickRow = async (row: number, x = 300): Promise<void> => {
        const size = application.window?.drawableSize;
        if (size === undefined) throw new Error("Missing mouse viewport");
        const scale = Math.min(size.width / 640, size.height / 480);
        application.input({ seat: local.seat.id, kind: "mouse-motion", position: { x: (size.width - 640 * scale) / 2 + x * scale,
          y: (size.height - 480 * scale) / 2 + (106 + row * 28) * scale }, delta: { x: 0, y: 0 }, timeMilliseconds: performance.now() });
        for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down, timeMilliseconds: performance.now() });
        await application.step(25);
      };
      const focus = (id: string): void => {
        for (let attempts = 0; attempts < 30; attempts++) {
          const state = presentation.ui.controller.state().focus;
          if (state.kind === "menu" && state.control === id) return;
          key(KeyCode.Tab);
        }
        throw new Error(`Missing setting ${id}`);
      };
      const activate = async (id: string): Promise<void> => { focus(id); key(KeyCode.Enter); await application.step(25); };
      const video = async (): Promise<void> => {
        key(27); await application.step(25);
        expect(presentation.ui.controller.activeMenu).toBe("menu:application:game");
        await activate("ui:application:settings"); expect(presentation.ui.controller.activeMenu).toBe("menu:settings:root");
        await activate("ui:settings:category:video"); expect(presentation.ui.controller.activeMenu).toBe("menu:settings:video:0");
      };
      const resume = async (): Promise<void> => { await clickRow(11); await clickRow(11); await clickRow(1); };
      await video();
      expect(application.window?.drawableSize).toEqual({ width: 640, height: 480 });
      focus("ui:settings:r_texture_formats");
      key(KeyCode.End);
      for (let index = 0; index < 6; index++) key(KeyCode.Backspace);
      application.input({ seat: local.seat.id, kind: "text", text: "png", timeMilliseconds: performance.now() });
      await application.step(25);
      expect(assets.imagePolicy?.formats).toEqual(["png"]);
      await activate("ui:settings:r_override_textures");
      expect(assets.imagePolicy?.overrideLevel).toBe(1);
      const menu = await capture();
      await Bun.write(`/tmp/image-video-menu-${backend}.png`, encodePng(640, 480, menu));
      expect(await Bun.file(join(users, "settings/images.cfg")).text()).toContain('"png"');
      await resume(); expect(presentation.ui.controller.activeMenu).toBeNull();
      expect(pink(await capture())).toBeGreaterThan(baseline + 100);
      await video(); await activate("ui:settings:image-wall");
      expect(assets.imagePolicy?.overrideUsages.includes("wall")).toBe(false);
      const mask = await capture();
      await Bun.write(`/tmp/image-video-menu-${backend}-mask.png`, encodePng(640, 480, mask));
      await resume(); const masked = await capture();
      await Bun.write(`/tmp/image-video-world-${backend}-mask.png`, encodePng(640, 480, masked));
      expect(pink(masked)).toBeLessThanOrEqual(baseline + 20);
      expect(red(masked)).toBeGreaterThan(red(baselinePixels) + 20);
      expect(assets.world).toBe(world); expect(application.simulation).toBe(simulation);
      expect(local.seat.presentation).toBe(presentation); expect(application.window).toBe(window);
      return;
    }
    const inventory = simulation.playerUi(local.actor).items, weapon = simulation.playerUi(local.actor).weaponStatus;
    const gun = simulation.presentations().find(value => value.viewWeapon);
    if (gun === undefined) throw new Error("Missing active source weapon");
    const live = (): number => [...registered.get(assets.images) ?? []].filter(image => assets.images.isResident(image)).length;
    const counts: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await command('r_override_textures 1;r_texture_formats "png"');
      const pixels = await capture();
      expect(pink(pixels)).toBeGreaterThan(baseline + 100);
      if (cycle === 0) await Bun.write(`/tmp/local-image-settings-${backend}.png`, encodePng(320, 240, pixels));
      if (cycle === 0) {
        await command("r_texture_overrides 1");
        const skin = await capture();
        await Bun.write(`/tmp/local-image-settings-${backend}-skin.png`, encodePng(320, 240, skin));
        const provider = await assets.provider(gun.content), texture = await provider.textures.load("models/weapons/v_blast/skin.pcx", { family: "q2", usage: "skin", mipmap: true });
        expect(texture?.image.source.kind === "resource" ? texture.image.source.resource.requestedPath : null).toBe("models/weapons/v_blast/skin.png");
        expect(red(skin)).toBeGreaterThan(red(baselinePixels) + 20);
        expect(pink(skin)).toBeLessThan(pink(pixels));
      }
      await command("r_override_textures 0;r_texture_overrides -1;r_texture_formats source");
      expect(pink(await capture())).toBeLessThanOrEqual(baseline + 20);
      counts.push(live());
    }
    expect(new Set(counts).size).toBe(1);
    await command('r_override_textures 1;r_texture_overrides 8;r_texture_formats "gif"');
    expect(prints.some(text => text.includes("Image settings rejected:"))).toBe(true);
    expect(presentation.local.console.buffer.dump()).toContain("Image settings rejected:");
    expect(pink(await capture())).toBeLessThanOrEqual(baseline + 20);
    expect(counts).toContain(live());
    const rejected = prints.filter(text => text.includes("Image settings rejected:")).length;
    await command('r_override_textures 1;r_texture_overrides 1;r_texture_formats "gif"');
    expect(prints.filter(text => text.includes("Image settings rejected:")).length).toBe(rejected + 1);
    expect(pink(await capture())).toBeLessThanOrEqual(baseline + 20);
    expect(counts).toContain(live());
    expect(application.simulation).toBe(simulation); expect(simulation.q2Source()).toBe(source);
    expect(local.seat.presentation).toBe(presentation); expect(presentation.local).toBe(input);
    expect(assets.world).toBe(world); expect(application.window).toBe(window);
    expect(simulation.playerUi(local.actor).items).toEqual(inventory);
    expect(simulation.playerUi(local.actor).weaponStatus).toEqual(weapon);
    expect(application.timeMilliseconds).toBeGreaterThan(elapsed);
    expect(await Bun.file(join(users, "settings/images.cfg")).text()).toContain('"source"');
    console.log(JSON.stringify({ backend, baseline, liveImages: counts, rejected: prints.filter(text => text.includes("Image settings rejected:")) }));
  } finally { await app?.close(); register.mockRestore(); await rm(users, { recursive: true, force: true }); }
}, 60000);
