import { expect, test } from "bun:test";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../src/app/bootstrap/presentation.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { encodePng } from "../../src/formats/images/png.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

for (const renderer of ["cpu", "gl"]) test(`${renderer} host settings mouse edits reach the current source and show pending changes`, async () => {
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--mode", "deathmatch", "--renderer", renderer,
    "--width", "640", "--height", "480", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const application = await Application.open(parsed.options, { print: () => undefined });
  const profileName = `ui-${renderer}-${Date.now()}`, profilePath = join(homedir(), ".local", "share", "quake-typescript", "settings", "servers", `${profileName}.json`);
  try {
    const player = application.localPlayers[0]; if (player === undefined) throw new Error("Missing local player");
    const presentation = player.seat.presentation; if (!(presentation instanceof WorldSeatPresentation)) throw new Error("Missing native presentation");
    const controller = presentation.ui.controller;
    const screenshot = async (name: string): Promise<void> => {
      const capture = application.captureNextFrame(); await application.step(25);
      await mkdir(".artifacts", { recursive: true });
      await Bun.write(`.artifacts/server-settings-${renderer}-${name}.png`, encodePng(640, 480, await capture));
    };
    const key = (code: number): void => { application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "key", code, down: true, repeat: false }); };
    const click = (row: number, x = 180): void => {
      application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "mouse-motion", position: { x, y: 106 + row * 28 }, delta: { x: 0, y: 0 } });
      application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "mouse-button", button: 1, down: true });
      application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "mouse-button", button: 1, down: false });
    };
    key(KeyCode.Escape); await application.step(25);
    click(3); click(3); click(0);
    expect(controller.activeMenu).toBe("menu:server:settings");
    click(5); expect(controller.activeMenu).toBe("menu:server:detail");
    click(0, 500); key(KeyCode.Home); key(KeyCode.Delete);
    application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "text", text: "x" }); click(7);
    const source = application.simulation.q2Source(); if (source === null) throw new Error("Missing source");
    expect(source.players.rules.fragLimit).toBe(0);
    click(0, 500); key(KeyCode.Home); key(KeyCode.Delete);
    application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "text", text: "1" });
    expect(source.players.rules.fragLimit).toBe(0); click(7); expect(source.players.rules.fragLimit).toBe(1);
    await screenshot("numeric");
    click(11); click(0); click(0); click(7);
    expect(application.simulation.q2ServerCvars()?.find("dmflags")?.latchedValue).toBe("1");
    expect(source.game.options.deathmatchFlags).toBe(0);
    await screenshot("pending");
    click(11); click(9); click(0, 500); key(KeyCode.Home);
    for (let index = 0; index < 7; index++) key(KeyCode.Delete);
    application.input({ seat: player.seat.id, timeMilliseconds: performance.now(), kind: "text", text: profileName });
    click(3);
    for (let attempt = 0; attempt < 100 && !await Bun.file(profilePath).exists(); attempt++) await Bun.sleep(10);
    expect(await Bun.file(profilePath).exists()).toBe(true);
    source.players.rules.fragLimit = 9; click(4);
    for (let attempt = 0; attempt < 100 && application.simulation.q2ServerCvars()?.variableValue("fraglimit") !== 1; attempt++) await Bun.sleep(10);
    expect(source.players.rules.fragLimit).toBe(1);
    const state = source.players.states.get(player.actor); if (state === undefined) throw new Error("Missing score");
    state.score = 1; source.product.checkRules(); expect(source.players.intermission.kind).toBe("intermission");
  } finally { await application.close(); await rm(profilePath, { force: true }); }
}, 60000);
