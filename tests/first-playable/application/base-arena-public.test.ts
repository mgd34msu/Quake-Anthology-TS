import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StartupApplication } from "../../../src/app/bootstrap/startup.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { NativeUiController } from "../../../src/ui/common/controller.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { ConnectionState } from "../../../src/content/q3/base/game/state.ts";
import { encodePng } from "../../../src/formats/images/png-encoder.ts";
import { infoValueForKey } from "../../../src/core/info-string.ts";

const enabled = process.env["QUAKE_ARENA_PUBLIC_TEST"] === "1";
const corpus = process.env["QUAKE_CONTENT_ROOT"] ?? resolve(import.meta.dir, "../../../../qfiles");

test.skipIf(!enabled)("public Q3 training selection launches skill four Crash and accepts live controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "q3-arena-public-"));
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", directory]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Missing startup options");
  const observed: { controller: NativeUiController | null } = { controller: null };
  const original = NativeUiController.prototype.draw;
  const observer = spyOn(NativeUiController.prototype, "draw").mockImplementation(function(this: NativeUiController, ...args) {
    observed.controller = this; return original.call(this, ...args);
  });
  const messages: string[] = [];
  let startup: StartupApplication | null = null;
  try {
    startup = await StartupApplication.open(command.options, { print: text => { messages.push(text); } }, join(directory, "saves"));
    const owner = startup;
    const until = async (ready: () => boolean, label: string): Promise<void> => {
      const deadline = performance.now() + 90000;
      while (!ready()) { if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`); await owner.step(); await Bun.sleep(10); }
    };
    await owner.step();
    const retained = owner.inputSeat;
    if (retained === null) throw new Error("Missing startup seat");
    const key = (code: number, down: boolean): void => { owner.input({ seat: retained, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const tap = (code: number): void => { key(code, true); key(code, false); };
    const choose = async (id: string): Promise<void> => {
      const presentation = owner.activeGame?.localPlayers[0]?.seat.presentation;
      const controller = presentation instanceof WorldSeatPresentation ? presentation.ui.controller : observed.controller;
      if (controller === null) throw new Error("Missing public controller");
      for (let n = 0; n < 48; n++) { const focus = controller.state().focus; if (focus.kind === "menu" && focus.control === id) break; tap(KeyCode.Tab); }
      expect(controller.state().focus).toMatchObject({ control: id }); tap(KeyCode.Enter); await owner.step();
    };
    await choose("ui:startup:native");
    await choose("ui:startup:game:q3:classic");
    await choose("ui:startup:preset:q3-baseq3");
    await until(() => observed.controller?.activeMenu === "menu:library:arena-selection", "authored arena picker");
    await choose("ui:arena-select:play");
    await choose("ui:startup:difficulty:4");
    await choose("ui:startup:play-preset");
    await until(() => owner.activeGame !== null && owner.inputSeat === null, "training world");
    const game = owner.activeGame;
    if (game === null) throw new Error("Training world was not retained");
    expect(game.options.map).toBe("maps/q3dm0.bsp");
    expect(game.options.botSkill).toBe(4);
    expect(game.localPlayers[0]?.seat.id).toBe(retained);
    const source = game.simulation.q3Source();
    if (source === null) throw new Error("Missing authoritative Q3 source");
    expect(source.gameType).toBe(2);
    expect(source.host.cvars.variableValue("g_spSkill")).toBe(4);
    const roster = () => source.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED);
    await until(() => roster().some(client => client.pers.netname.toLowerCase() === "crash"), "authored delayed Crash admission");
    expect(roster()).toHaveLength(2);
    const bot = game.botClients[0];
    if (bot === undefined) throw new Error("Authored opponent lacks shared bot owner");
    expect(Number(infoValueForKey(source.host.engine.getUserinfo(bot.client.id.slot), "skill"))).toBe(4);
    const human = source.pool.clients[retained.index];
    if (human === undefined) throw new Error("Missing source player");
    console.log(`Q3 training admitted ${JSON.stringify(roster().map(client => client.pers.netname))}, skill 4, source ${source.level.time}ms`);
    const before = { ...human.ps.origin }, initialAmmo = human.ps.ammo.get(2) ?? 0;
    let minimumAmmo = initialAmmo, maximumDistance = 0, frames = 0;
    const started = performance.now(), sourceStarted = source.level.time;
    key(119, true);
    owner.input({ seat: retained, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    while (performance.now() - started < 30000) {
      await owner.step(); await Bun.sleep(5); frames++;
      maximumDistance = Math.max(maximumDistance, Math.hypot(human.ps.origin.x - before.x, human.ps.origin.y - before.y, human.ps.origin.z - before.z));
      minimumAmmo = Math.min(minimumAmmo, human.ps.ammo.get(2) ?? initialAmmo);
      if (frames % 120 === 0) console.log(`Q3 live input: wall ${Math.round(performance.now() - started)}ms source ${source.level.time}ms distance ${maximumDistance.toFixed(1)} ammo ${minimumAmmo}`);
    }
    key(119, false);
    owner.input({ seat: retained, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    expect(owner.activeGame).toBe(game);
    expect(source.level.time).toBeGreaterThan(sourceStarted);
    expect(maximumDistance).toBeGreaterThan(8);
    expect(minimumAmmo).toBeLessThan(initialAmmo);
    console.log(`Q3 30-second controls complete: ${frames} frames, ${source.level.time - sourceStarted} source ms, movement ${maximumDistance}, ammo ${initialAmmo}->${minimumAmmo}; no match completion asserted`);
    const artifacts = process.env["Q3_ARENA_ARTIFACTS"];
    if (artifacts !== undefined) { await mkdir(artifacts, { recursive: true }); await Bun.write(join(artifacts, "training-gameplay.png"), encodePng(320, 240, owner.readPixels())); }
    tap(KeyCode.Escape); await owner.step();
    await choose("ui:application:quit");
    await until(() => owner.activeGame === null && owner.inputSeat !== null, "public End game return");
    await owner.step();
    for (let attempt = 0; attempt < 8 && observed.controller?.activeMenu !== "menu:startup:main"; attempt++) { tap(KeyCode.Escape); await owner.step(); }
    expect(observed.controller?.activeMenu).toBe("menu:startup:main");
    expect(owner.inputSeat).toBe(retained);
    await choose("ui:startup:quit");
    console.log("Q3 training End game returned to retained Main menu; public Quit accepted");
  } catch (error) { console.error(messages.join("\n")); throw error; }
  finally { startup?.requestQuit(); await startup?.close(); observer.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}, 240000);
