import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StartupApplication } from "../../src/app/bootstrap/startup.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { NativeUiController } from "../../src/ui/common/controller.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { encodePng } from "../../src/formats/images/png.ts";

test("startup Display keeps renderer and Apply visible on one normal-sized page", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-display-layout-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--renderer", "gl", "--hidden", "--width", "640", "--height", "480", "--gamma", "1.3", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing startup options");
  const observed: { controller: NativeUiController | null } = { controller: null }, draw = NativeUiController.prototype.draw;
  const captureController = spyOn(NativeUiController.prototype, "draw").mockImplementation(function(this: NativeUiController, ...args) {
    observed.controller = this; return draw.call(this, ...args);
  });
  let app: StartupApplication | null = null;
  try {
    app = await StartupApplication.open(parsed.options, { print: () => undefined }, join(root, "saves"));
    const startup = app, seat = startup.inputSeat; if (seat === null) throw new Error("Missing startup seat");
    const key = (code: number): void => { for (const down of [true, false]) startup.input({ seat, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    for (let index = 0; index < 3; index++) key(KeyCode.Down);
    key(KeyCode.Enter); key(KeyCode.Enter); await startup.step();
    const controller = observed.controller; if (controller === null) throw new Error("Missing rendered menu controller");
    for (let index = 0; index < 12; index++) {
      const focus = controller.state().focus; if (focus.kind === "menu" && focus.control === "ui:startup:apply-display") break;
      key(KeyCode.Tab);
    }
    expect(controller.state().focus).toMatchObject({ menu: "menu:settings:display:0", control: "ui:startup:apply-display" });
    const pixels = startup.captureNextFrame(); await startup.step();
    await Bun.write("/tmp/video-settings-gl-startup-complete-page.png", encodePng(640, 480, await pixels));
    key(KeyCode.Tab); expect(controller.state().focus).toMatchObject({ control: "ui:settings:back" });
    key(KeyCode.Tab); expect(controller.state().focus).toMatchObject({ control: "ui:video:brightness" });
  } finally { await app?.close(); captureController.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);
