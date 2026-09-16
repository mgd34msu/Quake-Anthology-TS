import { encodePng } from "../../../src/formats/images/png-encoder.ts";
import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StartupApplication } from "../../../src/app/bootstrap/startup.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { NativeUiController } from "../../../src/ui/common/controller.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";


async function captureArtifact(name: string, width: number, height: number, pixels: Uint8Array): Promise<void> {
  const directory = process.env["TEAM_ARENA_ARTIFACTS"];
  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, name), encodePng(width, height, pixels));
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");
async function until(read: () => boolean, label: string, step: () => Promise<void>): Promise<void> {
  const deadline = performance.now() + 90000;
  while (!read()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await step();
    await Bun.sleep(10);
  }
}

test.skipIf(!existsSync(join(corpus, "q3a/missionpack/pak0.pk3")))("Team Arena native preset returns to the existing startup main menu through public input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ta-main-menu-"));
  const parsed = parseApplicationCommand(["--content-root", corpus, "--game", "q3-missionpack", "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", directory]);
  if (parsed.kind !== "run" && parsed.kind !== "menu") throw new Error("Missing startup options");
  const observed: { controller: NativeUiController | null } = { controller: null };
  const draw = NativeUiController.prototype.draw;
  const observer = spyOn(NativeUiController.prototype, "draw").mockImplementation(function(this: NativeUiController, ...args) {
    observed.controller = this; return draw.call(this, ...args);
  });
  const messages: string[] = [];
  let startup: StartupApplication | null = null;
  try {
    startup = await StartupApplication.open(parsed.options, { print: text => { messages.push(text); } }, join(directory, "saves"));
    const owner = startup;
    await owner.step();
    const retainedSeat = owner.inputSeat;
    if (retainedSeat === null) throw new Error("Missing retained frontend seat");
    const chooseStartup = async (control: string, dispatch = true): Promise<void> => {
      const seat = owner.inputSeat, controller = observed.controller;
      if (seat === null || controller === null) throw new Error("Missing startup input owner");
      const key = (code: number): void => { for (const down of [true, false]) owner.input({ seat, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
      for (let count = 0; count < 32; count++) {
        const focus = controller.state().focus;
        if (focus.kind === "menu" && focus.control === control) break;
        key(KeyCode.Tab);
      }
      expect(controller.state().focus).toMatchObject({ control });
      key(KeyCode.Enter);
      if (dispatch) await owner.step();
    };
    await chooseStartup("ui:startup:native");
    await chooseStartup("ui:startup:game:q3:classic");
    await chooseStartup("ui:startup:preset:q3-missionpack");
    await chooseStartup("ui:startup:play-preset", false);
    await owner.step();
    await until(() => owner.activeGame !== null && owner.inputSeat === null && (owner.activeGame.simulation.q3Source()?.level.time ?? 0) > 0, "native preset launch", () => owner.step());
    const game = owner.activeGame;
    if (game === null) throw new Error(`Native preset did not stay active: ${messages.join("\n")}`);
    expect(game.session.session).toBe(retainedSeat.session);
    expect(game.localPlayers[0]?.seat.id).toBe(retainedSeat);
    expect(game.options.product).toBe("q3-missionpack");
    expect(game.options.map).toBe("maps/mpteam1.bsp");
    const source = game.simulation.q3Source(), setup = game.options.teamArenaSkirmish;
    if (source === null || setup === undefined) throw new Error("Native preset lost its authored setup");
    expect(source.gameType).toBe(setup.gameType);
    expect(source.pool.maxClients).toBe(setup.maxClients);
    console.log(`Startup launched native Team Arena ${game.options.map}, GT${source.gameType}, capacity ${source.pool.maxClients}`);
    source.match.beginIntermission();
    await until(() => {
      const presentation = game.localPlayers[0]?.seat.presentation;
      return presentation instanceof WorldSeatPresentation && presentation.ui.controller.activeMenu === "menu:application:team-arena-results";
    }, "shared Team Arena result menu", () => owner.step());
    const local = game.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing current game controller");
    const controller = local.seat.presentation.ui.controller;
    const key = (code: number): void => { for (const down of [true, false]) game.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    for (let count = 0; count < 4; count++) {
      const focus = controller.state().focus;
      if (focus.kind === "menu" && focus.control === "ui:team-arena:main-menu") break;
      key(KeyCode.Tab);
    }
    expect(controller.state().focus).toMatchObject({ control: "ui:team-arena:main-menu" });
    key(KeyCode.Enter);
    await until(() => owner.activeGame === null, "startup owner to retire the game", () => owner.step());
    expect(owner.activeGame).toBeNull();
    expect(owner.inputSeat).not.toBeNull();
    expect(owner.inputSeat).toBe(retainedSeat);
    await owner.step();
    expect(observed.controller?.activeMenu).toBe("menu:startup:main");
    expect(new Set(owner.readPixels()).size).toBeGreaterThan(16);
    await captureArtifact("main-menu.png", 640, 480, owner.readPixels());
    await chooseStartup("ui:startup:options");
    expect(observed.controller?.activeMenu).toBe("menu:startup:options");
    console.log("Team Arena Main menu returned to the existing startup renderer and accepted Options input");
  } catch (error) {
    console.error(messages.join("\n")); throw error;
  } finally {
    startup?.requestQuit();
    await startup?.close(); observer.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
}, 240000);
