import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { InputRouter } from "../../../src/input/router.ts";

for (const family of ["q2", "q3"]) test(`actual ${family} SDL console toggle and unprefixed command output`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-console-input-"));
  const parsed = parseApplicationCommand(["--game", family === "q2" ? "q2-classic-baseq2" : "q3-baseq3", "--map", family === "q2" ? "base1" : "q3dm1", "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined });
  let router: InputRouter | null = null;
  try {
    await app.step(1);
    const player = app.localPlayers[0]; if (player === undefined || !(player.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local UI");
    const local = player.seat.presentation.ui.local, console = local.console;
    const route = router = new InputRouter({ seats: [{ input: local.input, controller: { kind: "none" } }], keyboardSeat: player.seat.id, controllers: null, now: () => performance.now(), ticks: () => 0, subframe: false, unhandled: () => undefined });
    const key = (code: number, down = true, repeat = false): void => route.handlePlatform({ kind: "key", timestamp: 0, scancode: code, keycode: code, modifiers: 0, down, repeat });
    const text = (value: string): void => route.handlePlatform({ kind: "text", timestamp: 0, text: value });
    const submit = async (value: string): Promise<void> => { text(value); key(13); key(13, false); await app.step(1); await app.step(1); };
    key(96); key(96, false); text("`"); expect(local.input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    key(96, true, true); text("`"); expect(local.input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    await submit("echo console_plain_probe"); expect(console.buffer.dump()).toContain("\nconsole_plain_probe");
    await submit("/echo console_slash_probe"); expect(console.buffer.dump()).toContain("\nconsole_slash_probe");
    await submit("set console_probe 17"); await submit("console_probe"); expect(console.buffer.dump()).toContain('"console_probe" is');
    if (family === "q2") { await submit("god"); expect(console.buffer.dump()).toContain("godmode ON"); }
    else {
      await submit("/unknown_console_probe"); await app.step(100); await app.step(100);
      expect(console.buffer.dump()).toContain("unknown cmd unknown_console_probe");
      await submit("console chat probe"); await app.step(100); await app.step(100);
      expect(console.buffer.dump().split("\n").some(line => !line.startsWith("]") && line.includes("console chat probe"))).toBe(true);
    }
    if (family === "q2") {
      console.field.setText("ec"); key(9); key(9, false);
      expect(console.field.text).toBe("/echo"); expect(console.selectedCompletionEntry?.name).toBe("echo");
      const image = app.captureNextFrame(); await app.step(100);
      await Bun.write("/tmp/quake-console-selected-help640.png", encodePng(640, 480, await image));
      console.field.clear();
    }
    const history = console.history.lines.length; await submit(""); expect(console.history.lines.length).toBe(history);
    key(96); key(96, false); text("`"); expect(local.input.focus.kind).toBe("game"); expect(console.field.text).toBe("");
    key(96); key(96, false); text("echo first_character_kept"); expect(console.field.text).toBe("echo first_character_kept");
  } finally { router?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
