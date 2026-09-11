import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { CommandContext } from "../../../../src/contracts/common.ts";
import type { RenderCommand } from "../../../../src/contracts/render.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { CommandBuffer } from "../../../../src/core/commands/index.ts";
import { decodeTga } from "../../../../src/formats/images/q3-tga.ts";
import { Draw2D, TextCommandSink, type PictureAsset } from "../../../../src/text/draw2d.ts";
import { readFontData, type RegisteredFont, type RegisteredGlyph } from "../../../../src/text/q3-font.ts";
import { SceneImageRegistry, rgbaImage } from "../../../../src/render/scene/resources.ts";
import { defaultUiMenuPlan, loadMenuDefinitions, UiWindowFlag, type UiMenuResolver } from "../../../../src/ui/common/legacy/menu.ts";
import { LegacyUiSeat } from "../../../../src/ui/common/legacy/input.ts";
import { UiRuntime, type UiRuntimeResources } from "../../../../src/ui/common/legacy/runtime.ts";
import { TeamArenaUiMemory } from "../../../../src/ui/common/legacy/team-arena/memory.ts";

const archivePath = join(homedir(), "Projects/qfiles/q3a/missionpack/pak0.pk3");

test.skipIf(!existsSync(archivePath))("retail Team Arena menus render and execute restart through their seat", async () => {
  const archive = await openArchive(archivePath);
  const identity = createIdentityOwner("retail-ui");
  const seat = identity.seat(1);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(1, 0) } };
  const images = new SceneImageRegistry({ identity: Symbol("retail-ui-images"), session: identity.session, generation: 0 });
  const sources = new Map<string, string>();
  const pictures = new Map<string, PictureAsset>();
  const fail = (): never => { throw new Error("Retail restart menu unexpectedly requested another host operation"); };
  let runtime: UiRuntime | undefined;
  try {
    for (const entry of archive.entries) {
      if (entry.path.startsWith("ui/") && /\.(menu|h|txt)$/.test(entry.path)) {
        const bytes = await archive.readEntry(entry);
        sources.set(entry.path, Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
      }
    }
    const source = (path: string) => {
      const text = sources.get(path);
      return text === undefined ? undefined : { path, text };
    };
    const resolver: UiMenuResolver = {
      resolveRoot: source,
      resolve: request => source(posix.join(posix.dirname(request.fromPath), request.requestedPath)) ?? source(request.requestedPath),
    };
    const host = { resolver, random: { nextInt: () => 7 } };
    const allMenus = await loadMenuDefinitions(host, defaultUiMenuPlan(), {}, {
      memory: { kind: "qvm32", memory: new TeamArenaUiMemory("qvm32", fail) },
    });
    expect(allMenus.diagnostics).toEqual([]);
    expect(allMenus.menus).toHaveLength(45);
    expect(allMenus.menus.reduce((total, menu) => total + menu.items.length, 0)).toBe(1462);
    expect(allMenus.registration.events).toHaveLength(743);

    sources.set("ui/restart-smoke.txt", '{ loadMenu { "ui/ingame_leave.menu" } }');
    const definitions = await loadMenuDefinitions(host, { kind: "ui", setPaths: ["ui/restart-smoke.txt"] }, {}, {
      memory: { kind: "qvm32", memory: new TeamArenaUiMemory("qvm32", fail) },
    });
    const read = async (path: string): Promise<Uint8Array> => {
      const entry = archive.findEntries(path, "ascii-insensitive")[0];
      if (entry === undefined) throw new Error(`Missing retail asset ${path}`);
      return archive.readEntry(entry);
    };
    const picture = async (path: string): Promise<PictureAsset> => {
      const cached = pictures.get(path);
      if (cached !== undefined) return cached;
      const content = decodeTga(await read(path), path);
      const value: PictureAsset = { kind: "image", name: path, image: images.register(path, rgbaImage(content), { wrap: "clamp", filter: "linear" }) };
      pictures.set(path, value);
      return value;
    };
    const font = async (size: number): Promise<RegisteredFont> => {
      const path = `fonts/fontImage_${size}.dat`;
      const data = readFontData(await read(path), path);
      const glyphs: RegisteredGlyph[] = [];
      for (const glyph of data.glyphs) glyphs.push({ ...glyph,
        picture: glyph.shaderName.length === 0 ? null : await picture(glyph.shaderName),
      });
      return { ...data, glyphs };
    };
    const white: PictureAsset = { kind: "image", name: "*white", image: images.register("*white", rgbaImage({ width: 1, height: 1,
      pixels: Uint8Array.of(255, 255, 255, 255) }), { wrap: "repeat", filter: "nearest" }) };
    const resources: UiRuntimeResources = {
      handles: { kind: "diagnostic" },
      registerPicture: async path => path === null ? fail() : picture(path),
      registeredPicture: path => path === null ? undefined : pictures.get(path),
      registerFont: fail, registerSound: fail, registeredSound: fail,
      registerModel: fail, registeredModel: fail, prepareCinematic: fail,
    };
    const cvars = new CvarRegistry({ dialect: "q3", context });
    const commands = new CommandBuffer({ dialect: "q3", context, cvars });
    const executed: CommandContext[] = [];
    commands.register("map_restart", command => { executed.push(command.source); return undefined; });
    runtime = await UiRuntime.create({ definitions, cvars, commands, commandContext: context, resources,
      fonts: { small: await font(12), normal: await font(16), big: await font(20), profile: "ui", smallThreshold: 0.25, bigThreshold: 0.4 },
      widgetAssets: {
        whiteShader: white, gradientBar: await picture("ui/assets/gradientbar2.tga"),
        scrollBar: await picture("ui/assets/scrollbar.tga"), scrollBarArrowDown: await picture("ui/assets/scrollbar_arrow_dwn_a.tga"),
        scrollBarArrowUp: await picture("ui/assets/scrollbar_arrow_up_a.tga"), scrollBarArrowLeft: await picture("ui/assets/scrollbar_arrow_left.tga"),
        scrollBarArrowRight: await picture("ui/assets/scrollbar_arrow_right.tga"), scrollBarThumb: await picture("ui/assets/scrollbar_thumb.tga"),
        sliderBar: await picture("ui/assets/slider2.tga"), sliderThumb: await picture("ui/assets/sliderbutt_1.tga"),
      }, zeroPicture: white,
      audio: { playLocal: sound => { expect(sound).toBeUndefined(); }, startBackground: fail, stopBackground: fail },
      cinematics: { play: fail, run: fail, draw: fail, stop: fail }, paintModel: fail,
      context: { kind: "ui", bindings: { keyName: fail, getBinding: () => "", setBinding: fail, getOverstrike: () => false, setOverstrike: fail }, pause: fail },
      feeder: { count: fail, item: fail, image: fail, select: fail },
      ownerDraw: { visible: fail, width: fail, value: fail, handleKey: fail, paint: fail, closeCinematic: fail },
      externalScript: { run: fail }, getTeamColor: fail,
    });
    const input = new LegacyUiSeat(seat, runtime);
    const rendered: RenderCommand[] = [];
    const draw = new Draw2D(new TextCommandSink(seat, { x: 640, y: 0, width: 640, height: 480 }, command => rendered.push(command), fail), "team-ui-640");
    await runtime.activate("ingame_leave");
    await runtime.frame({ time: 1000, frameTime: 16, draw });
    expect(rendered.filter(command => command.kind === "stretch-pic").length).toBeGreaterThan(20);
    expect(rendered.filter(command => command.kind === "stretch-pic").every(command => command.rect.x >= 640)).toBe(true);

    const click = async (x: number, y: number) => {
      input.route({ kind: "mouse-motion", seat, timeMilliseconds: 1000, position: { x: x + 640, y }, delta: { x: 0, y: 0 } });
      input.route({ kind: "mouse-button", seat, timeMilliseconds: 1000, button: 1, down: true });
      input.route({ kind: "mouse-button", seat, timeMilliseconds: 1000, button: 1, down: false });
      await input.drain(draw);
    };
    await click(575, 90);
    const confirmation = runtime.snapshot().menus[0];
    expect(confirmation?.items.filter(item => item.name === "restartConfirm").every(item => (item.flags & UiWindowFlag.Visible) !== 0)).toBe(true);
    expect(confirmation?.items.filter(item => item.group === "grpMenu").every(item => (item.flags & UiWindowFlag.Visible) === 0)).toBe(true);
    expect(await input.input({ kind: "key", seat: identity.seat(0), timeMilliseconds: 1000, code: 13, down: true, repeat: false }, draw)).toBe(false);
    expect(commands.execute()).toBe(0);
    await click(549, 120);
    expect(commands.execute()).toBe(1);
    expect(executed).toEqual([context]);
    expect((runtime.snapshot().menus[0]?.flags ?? 0) & UiWindowFlag.Visible).toBe(0);
    input.close();
    expect(() => runtime?.snapshot()).toThrow("disposed");
  } finally {
    runtime?.retire();
    images.close();
    archive.close();
  }
});
