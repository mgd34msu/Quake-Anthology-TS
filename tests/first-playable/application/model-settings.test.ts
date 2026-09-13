import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { SceneModelRenderer } from "../../../src/render/scene/models/renderer.ts";
import type { ActorId, SeatId } from "../../../src/contracts/identity.ts";
import { add3, anglesToAxis, scale3 } from "../../../src/core/math.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { encodePng } from "../../../src/formats/images/png.ts";

for (const backend of ["cpu", "gl"]) test(`local ${backend} model controls retain native assets and select independently for two seats`, async () => {
  const users = await mkdtemp(join(tmpdir(), "quake-model-settings-"));
  const parsed = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--seats", "2",
    "--renderer", backend, "--hidden", "--width", "640", "--height", "480", "--gamma", "1"]);
  if (parsed.kind !== "run") throw new Error("Missing application options");
  const actorTextures = new Map<string, Set<string>>();
  let witness: ActorId | null = null;
  const textures = new Map<SeatId, Set<string>>(), original = SceneModelRenderer.prototype.prepare;
  const prepare = spyOn(SceneModelRenderer.prototype, "prepare").mockImplementation(function(this: SceneModelRenderer, ...args) {
    const batches = original.call(this, ...args), target = args[1].target;
    if (target.kind === "seat") {
      const selected = textures.get(target.seat) ?? new Set<string>();
      for (const batch of batches) if (batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "resource") selected.add(batch.texture.image.source.resource.requestedPath);
      textures.set(target.seat, selected);
      const actor = witness;
      if (actor !== null && args[0].some(entity => entity.actor?.equals(actor))) {
        expect(args[0]).toHaveLength(1);
        const names = new Set<string>();
        for (const batch of batches) if (batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "resource") names.add(batch.texture.image.source.resource.requestedPath);
        actorTextures.set(target.seat.index + ":" + actor.slot, names);
      }
    }
    return batches;
  });
  const prints: string[] = [];
  let app: Application | null = null;
  try {
    app = await Application.open({ ...parsed.options, userContentRoot: users }, { print: text => { prints.push(text); return undefined; } });
    const application = app, first = application.localPlayers[0], second = application.localPlayers[1];
    if (first === undefined || second === undefined || !(first.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local seats");
    const presentation = first.seat.presentation, assets = presentation.assets, simulation = application.simulation, world = assets.world, window = application.window;
    const source = simulation.q2Source();
    if (source === null) throw new Error("Missing native Q2 source");
    const gun = await assets.model(assets.content.recipe.map.entities.content, "models/weapons/v_blast/tris.md2");
    if (gun.model.kind !== "q2-md2") throw new Error("Missing native gun");
    const native = gun.model;
    const key = (code: number): void => { for (const down of [true, false]) application.input({ seat: first.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const command = async (text: string): Promise<void> => {
      key(96); application.input({ seat: first.seat.id, kind: "text", text, timeMilliseconds: performance.now() }); key(13);
      await application.step(1); key(96); await application.step(1);
    };
    const capture = async (label: string): Promise<void> => {
      textures.clear(); actorTextures.clear(); const pending = application.captureNextFrame(); await application.step(1);
      const pixels = await pending; expect(pixels.length).toBe(640 * 480 * 4);
      await Bun.write(`/tmp/model-settings-${backend}-${label}.png`, encodePng(640, 480, pixels));
    };
    for (let i = 0; i < 12; i++) await application.step(100);
    await capture("enhanced");
    expect(textures.get(first.seat.id)?.has("models/weapons/v_blast/md5/skin.png")).toBe(true);
    const loader = (await assets.provider(assets.content.recipe.map.entities.content)).textures;
    await command("gl_md5_use 0"); await capture("original");
    expect(assets.modelPolicy.q2Use).toBe(false);
    expect((await assets.provider(assets.content.recipe.map.entities.content)).textures).toBe(loader);
    expect(textures.get(first.seat.id)?.has("models/weapons/v_blast/skin.pcx")).toBe(true);
    expect(native.replacement?.model.kind).toBe("md5");
    await command("gl_md5_use 1; r_model_distance 128");
    const player2 = [...source.game.entities.values()].find(entity => entity.actor.id.equals(second.actor));
    const soldier = [...source.game.entities.values()].find(entity => entity.classname.startsWith("monster_soldier"));
    if (player2 === undefined || soldier === undefined) throw new Error("Missing distance fixture actors");
    witness = soldier.actor.id;
    const view = simulation.playerView(first.actor), forward = anglesToAxis(view.angles)[0];
    source.game.move(player2, { origin: add3(view.origin, scale3(forward, -240)) });
    source.game.move(soldier, { origin: add3(view.origin, scale3(forward, 64)), angles: { x: 0, y: view.angles.y + 180, z: 0 } });
    await capture("distance");
    expect([...actorTextures.get(first.seat.id.index + ":" + soldier.actor.id.slot) ?? []].some(path => path.includes("soldier/md5/"))).toBe(true);
    expect([...actorTextures.get(second.seat.id.index + ":" + soldier.actor.id.slot) ?? []].some(path => path.includes("soldier/skin"))).toBe(true);
    await command("gl_md5_load 0");
    expect(native.replacement).toBeNull();
    await command("gl_md5_load 1; r_model_distance source"); await capture("restored");
    expect(native.replacement?.model.kind).toBe("md5");
    expect((await assets.model(assets.content.recipe.map.entities.content, "models/weapons/v_blast/tris.md2")).model).toBe(native);
    expect(application.simulation).toBe(simulation); expect(assets.world).toBe(world); expect(application.window).toBe(window);
    expect(first.seat.presentation).toBe(presentation); expect(application.timeMilliseconds).toBeGreaterThan(100);
    expect(await Bun.file(join(users, "settings/images.cfg")).text()).toContain('r_model_distance "source"');
    expect(prints.some(text => text.includes("settings rejected"))).toBe(false);
  } finally { await app?.close(); prepare.mockRestore(); await rm(users, { recursive: true, force: true }); }
}, 180000);

for (const backend of ["cpu", "gl"]) test(`local ${backend} Q1 model menu accepts source on Enter and discards Escape drafts`, async () => {
  const users = await mkdtemp(join(tmpdir(), "quake-model-menu-"));
  const parsed = parseApplicationCommand(["--game", "q1-rerelease-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1",
    "--renderer", backend, "--hidden", "--width", "640", "--height", "480", "--gamma", "1"]);
  if (parsed.kind !== "run") throw new Error("Missing application options");
  const gunImages = new Set<string>(), original = SceneModelRenderer.prototype.prepare;
  const prepare = spyOn(SceneModelRenderer.prototype, "prepare").mockImplementation(function(this: SceneModelRenderer, ...args) {
    const batches = original.call(this, ...args);
    if (args[0].some(entity => entity.resource.requestedPath === "progs/v_shot.mdl")) for (const batch of batches) {
      if (batch.texture.kind === "bind-image") gunImages.add(batch.texture.image.source.kind === "resource" ? batch.texture.image.source.resource.requestedPath : "indexed-native");
    }
    return batches;
  });
  const prints: string[] = [];
  let app: Application | null = null;
  try {
    app = await Application.open({ ...parsed.options, userContentRoot: users }, { print: text => { prints.push(text); return undefined; } });
    const application = app, local = application.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local UI");
    const presentation = local.seat.presentation, assets = presentation.assets, simulation = application.simulation;
    const gun = await assets.model(assets.content.recipe.map.entities.content, "progs/v_shot.mdl");
    if (gun.model.kind !== "q1-mdl") throw new Error("Native MDL was discarded");
    const native = gun.model;
    const key = (code: number): void => { for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const text = (value: string): void => { application.input({ seat: local.seat.id, kind: "text", text: value, timeMilliseconds: performance.now() }); };
    const command = async (value: string): Promise<void> => { key(96); text(value); key(13); await application.step(1); key(96); await application.step(1); };
    const capture = async (label: string): Promise<void> => {
      gunImages.clear(); const pending = application.captureNextFrame(); await application.step(1);
      await Bun.write(`/tmp/model-menu-${backend}-${label}.png`, encodePng(640, 480, await pending));
    };
    const click = async (row: number, x = 300): Promise<void> => {
      application.input({ seat: local.seat.id, kind: "mouse-motion", position: { x, y: 106 + row * 28 }, delta: { x: 0, y: 0 }, timeMilliseconds: performance.now() });
      for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down, timeMilliseconds: performance.now() });
      await application.step(1);
    };
    for (let i = 0; i < 4; i++) await application.step(25);
    await capture("enhanced"); expect(native.replacement?.model.kind).toBe("md5");
    expect([...gunImages].some(name => name.includes("v_shot") && name.endsWith(".lmp"))).toBe(true);
    await command("r_model_distance 1"); await capture("distance-original"); expect(gunImages.has("indexed-native")).toBe(true);
    key(27); await application.step(1); await click(3); await click(0); await click(10, 450);
    expect(presentation.ui.controller.activeMenu).toBe("menu:settings:video:1");
    await click(2, 540); key(KeyCode.End); key(KeyCode.Backspace);
    for (const character of "source") { text(character); await application.step(1); expect(assets.modelPolicy.distance).toBe(1); }
    key(13); await application.step(1); expect(assets.modelPolicy.distance).toBe("source");
    await capture("page2");
    key(KeyCode.End); for (let i = 0; i < 6; i++) key(KeyCode.Backspace); text("12"); await application.step(1);
    key(27); await application.step(1); expect(assets.modelPolicy.distance).toBe("source");
    await click(0); await click(10, 450); await capture("cancelled");
    await click(10, 150); await click(8); expect(assets.modelPolicy.q1Enhanced).toBe(false); expect(native.replacement).toBeNull();
    await capture("page1");
    await click(8); expect(native.replacement?.model.kind).toBe("md5");
    await click(11); await click(11); await click(1); await capture("restored");
    expect([...gunImages].some(name => name.includes("v_shot") && name.endsWith(".lmp"))).toBe(true);
    expect(application.simulation).toBe(simulation); expect(local.seat.presentation).toBe(presentation);
    expect(prints.some(value => value.includes("settings rejected"))).toBe(false);
    expect(await Bun.file(join(users, "settings/images.cfg")).text()).toContain('r_model_distance "source"');
  } finally { await app?.close(); prepare.mockRestore(); await rm(users, { recursive: true, force: true }); }
}, 180000);

test("enabling a previously unloaded MD5 pair rejects a malformed skin before changing the live scene", async () => {
  const users = await mkdtemp(join(tmpdir(), "quake-model-reject-"));
  const parsed = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing application options");
  const skin = join(users, "q2/rerelease/baseq2/models/weapons/v_blast/md5/skin.png");
  await mkdir(dirname(skin), { recursive: true }); await Bun.write(skin, "malformed replacement skin");
  await mkdir(join(users, "settings"), { recursive: true }); await Bun.write(join(users, "settings/images.cfg"), 'set gl_md5_load "0"\n');
  const prints: string[] = [];
  let app: Application | null = null;
  try {
    app = await Application.open({ ...parsed.options, userContentRoot: users }, { print: text => { prints.push(text); return undefined; } });
    const application = app, local = application.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    const assets = local.seat.presentation.assets, world = assets.world, simulation = application.simulation;
    const gun = await assets.model(assets.content.recipe.map.entities.content, "models/weapons/v_blast/tris.md2");
    if (gun.model.kind !== "q2-md2") throw new Error("Missing retained MD2");
    const native = gun.model, provider = await assets.provider(assets.content.recipe.map.entities.content), textures = provider.textures;
    const key = (code: number): void => { for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const enable = async (): Promise<void> => {
      key(96); application.input({ seat: local.seat.id, kind: "text", text: "gl_md5_load 1", timeMilliseconds: performance.now() }); key(13);
      await application.step(1); key(96); await application.step(1);
    };
    for (let i = 0; i < 2; i++) await application.step(100);
    expect(native.replacement).toBeNull(); await enable();
    expect(native.replacement).toBeNull(); expect(assets.modelPolicy.q2Load).toBe(false); expect(provider.textures).toBe(textures);
    expect(prints.filter(text => text.includes("settings rejected"))).toHaveLength(1);
    await application.step(1); expect(prints.filter(text => text.includes("settings rejected"))).toHaveLength(1);
    const pixels = new Uint8Array(16 * 16 * 4).fill(255); await Bun.write(skin, encodePng(16, 16, pixels));
    await enable(); expect(assets.modelPolicy.q2Load).toBe(true); expect(native.replacement?.model.kind).toBe("md5");
    expect(assets.world).toBe(world); expect(application.simulation).toBe(simulation);
    expect((await assets.model(assets.content.recipe.map.entities.content, "models/weapons/v_blast/tris.md2")).model).toBe(native);
    const pending = application.captureNextFrame(); await application.step(1); expect((await pending).length).toBe(320 * 240 * 4);
  } finally { await app?.close(); await rm(users, { recursive: true, force: true }); }
}, 120000);
