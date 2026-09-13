import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../src/app/bootstrap/presentation.ts";
import { NativeUiController } from "../../src/ui/common/index.ts";
import { menuSkin } from "../../src/ui/common/menu-theme.ts";
import { SeatGamePrompt, gamePromptMenu } from "../../src/app/bootstrap/game-prompt.ts";
import { encodePng } from "../../src/formats/images/png.ts";

test("actual CTF prompts use seat-owned native controls and impulses without pausing other seats", async () => {
  const parsed = parseApplicationCommand(["--game", "q1-rerelease-ctf", "--map", "ctf1", "--movement", "q1", "--character", "q1",
    "--mode", "deathmatch", "--seats", "2", "--renderer", "cpu", "--width", "640", "--height", "960", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("No CTF launch");
  const application = await Application.open(parsed.options, { print: () => undefined });
  try {
    const first = application.localPlayers[0], second = application.localPlayers[1];
    if (first === undefined || second === undefined) throw new Error("Missing split seats");
    const one = first.seat.presentation, two = second.seat.presentation;
    if (!(one instanceof WorldSeatPresentation) || !(two instanceof WorldSeatPresentation)) throw new Error("Missing shared presentation");
    one.local.input.setImpulse(100); two.local.input.setImpulse(100);
    for (let i = 0; i < 25 && one.ui.controller.activeMenu !== gamePromptMenu; i++) await application.step(100);
    expect(one.ui.controller.activeMenu).toBe(gamePromptMenu);
    expect(two.ui.controller.activeMenu).toBe(gamePromptMenu);
    expect(one.ui.controller.state().focus.kind).toBe("menu");
    application.input({ seat: first.seat.id, kind: "key", code: 27, down: true, repeat: false, timeMilliseconds: performance.now() });
    expect(one.ui.controller.activeMenu).toBe("menu:application:game");
    application.input({ seat: first.seat.id, kind: "key", code: 13, down: true, repeat: false, timeMilliseconds: performance.now() });
    await application.step(100);
    expect(one.ui.controller.activeMenu).toBe(gamePromptMenu);
    await mkdir(".artifacts/tmp/game-prompts", { recursive: true });
    await Bun.write(".artifacts/tmp/game-prompts/local-two-seat.png", encodePng(640, 960, application.readPixels()));
    application.input({ seat: first.seat.id, kind: "key", code: 50, down: true, repeat: false, timeMilliseconds: performance.now() });
    expect(one.ui.controller.activeMenu).toBeNull();
    expect(two.ui.controller.activeMenu).toBe(gamePromptMenu);
    const frame = application.frameCount;
    await application.step(100);
    expect(application.frameCount).toBe(frame + 1);
    expect(application.simulation.q1Source()?.composition.clients.get(first.actor)?.observer).toBe(false);
    expect(application.simulation.q1Source()?.composition.clients.get(first.actor)?.team).toBe(5);
    expect(application.presentationEvents.some(source => source.kind === "q1-composition" && source.event.kind === "clear-prompt" && source.event.actor.equals(first.actor))).toBe(true);
    expect(application.simulation.q1Source()?.composition.clients.get(second.actor)?.observer).toBe(true);
    application.input({ seat: second.seat.id, kind: "mouse-motion", position: { x: 200, y: 480 + 220 + 2 * 44 + 22 }, delta: { x: 0, y: 0 }, timeMilliseconds: performance.now() });
    application.input({ seat: second.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    expect(two.ui.controller.activeMenu).toBeNull();
    await application.step(100);
    expect(application.simulation.q1Source()?.composition.clients.get(second.actor)?.observer).toBe(false);
    expect(application.simulation.q1Source()?.composition.clients.get(second.actor)?.team).toBe(14);
    one.local.input.setImpulse(100); await application.step(100);
    expect(one.ui.controller.activeMenu).toBe(gamePromptMenu);
    application.input({ seat: first.seat.id, kind: "key", code: 27, down: true, repeat: false, timeMilliseconds: performance.now() });
    one.local.input.setImpulse(101); await application.step(100);
    expect(one.ui.controller.activeMenu).toBe("menu:application:game");
    application.input({ seat: first.seat.id, kind: "key", code: 27, down: true, repeat: false, timeMilliseconds: performance.now() });
    await application.step(100);
    expect(one.ui.controller.activeMenu).toBeNull();
    one.ui.receive([{ kind: "q1-composition", content: application.content.recipe.map.entities.content, seconds: 0, sequence: 0,
      event: { kind: "prompt", actor: first.actor, title: "All source choices remain reachable",
        choices: Array.from({ length: 12 }, (_, index) => ({ label: `Choice ${index + 1}`, impulse: index === 11 ? 102 : 101 })) } }]);
    await application.step(100);
    const click = (x: number, y: number): void => {
      application.input({ seat: first.seat.id, kind: "mouse-motion", position: { x, y }, delta: { x: 0, y: 0 }, timeMilliseconds: performance.now() });
      application.input({ seat: first.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
      application.input({ seat: first.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    };
    click(450, 422); click(450, 422); click(200, 374);
    expect(one.ui.controller.activeMenu).toBeNull();
    await application.step(100);
    expect(application.simulation.q1Source()?.composition.clients.get(first.actor)?.team).toBe(14);
    one.local.input.setImpulse(100); await application.step(100);
    expect(one.ui.controller.activeMenu).toBe(gamePromptMenu);
    let target = first.actor, resume = (): void => undefined;
    const ready = new Promise<void>(resolve => { resume = resolve; }), selected: number[] = [];
    const delayedController = new NativeUiController({ seat: first.seat.id, skin: () => menuSkin(one.ui.art.skin.font), now: () => 0,
      bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    const delayed = new SeatGamePrompt(first.seat.id, () => target, delayedController, impulse => { selected.push(impulse); });
    delayed.receive([{ kind: "q1-composition", content: application.content.recipe.map.entities.content, seconds: 0, sequence: 0,
      event: { kind: "prompt", actor: first.actor, title: "$qc_ctf_intro", choices: [{ label: "$qc_ctf_intro_red", impulse: 101 }] } }]);
    const preparing = delayed.prepare({ provider: async content => { await ready; return one.assets.provider(content); } }, () => ({ kind: "game" }));
    target = second.actor; resume(); await preparing;
    expect(delayedController.activeMenu).toBeNull(); expect(selected).toEqual([]); delayed.close();
    const beforeTravel = first.actor;
    application.queueCommand("map", ["ctf2"], first.seat.id);
    for (let i = 0; i < 4 && application.localPlayers[0]?.actor.equals(beforeTravel); i++) await application.step(100);
    expect(one.ui.controller.activeMenu).toBeNull();
    expect(application.localPlayers[0]?.actor.equals(beforeTravel)).toBe(false);
  } finally { await application.close(); }
}, 60000);
