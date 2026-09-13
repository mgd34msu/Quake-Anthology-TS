import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { RemoteApplication } from "../../../src/app/bootstrap/remote-application.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { encodePng } from "../../../src/formats/images/png.ts";

test("remote Q2 Display brightness changes actual pixels without reconnecting", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-remote-display-"));
  const common = ["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--mode", "coop", "--user-content-root", root];
  const selected = parseApplicationCommand([...common, "--dedicated", "--listen", "0", "--bind", "127.0.0.1"]);
  if (selected.kind !== "run") throw new Error("Missing server options");
  let server: Application | null = null, client: RemoteApplication | null = null;
  try {
    server = await Application.open(selected.options, { print: () => undefined });
    const address = server.networkAddress; if (address === null) throw new Error("Missing server address");
    const parsed = parseApplicationCommand([...common, "--connect-q2", `127.0.0.1:${address.port}`, "--renderer", "cpu", "--width", "640", "--height", "480", "--hidden"]);
    if (parsed.kind !== "run") throw new Error("Missing client options");
    client = await RemoteApplication.open(parsed.options, { print: () => undefined });
    const remote = client, authoritative = server;
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await authoritative.step(50); await Bun.sleep(1); await remote.step(50); };
    for (let attempt = 0; attempt < 100 && remote.networkPhase !== "active"; attempt++) await exchange();
    expect(remote.networkPhase).toBe("active");
    for (let attempt = 0; attempt < 20 && !(remote.localPlayers[0]?.seat.presentation instanceof WorldSeatPresentation); attempt++) await exchange();
    const local = remote.localPlayers[0], peer = server.networkClients[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing remote presentation");
    const controller = local.seat.presentation.ui.controller;
    const key = (code: number): void => { for (const down of [true, false]) remote.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const focus = (id: string): void => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const state = controller.state().focus; if (state.kind === "menu" && state.control === id) return;
        key(KeyCode.Tab);
      }
      throw new Error(`Missing remote setting ${id}`);
    };
    key(KeyCode.Escape); await exchange(); focus("ui:application:settings"); key(KeyCode.Enter); await exchange();
    focus("ui:settings:category:display"); key(KeyCode.Enter); await exchange();
    expect(controller.activeMenu).toBe("menu:settings:display:0");
    const dark = remote.readPixels(); focus("ui:video:brightness"); for (let index = 0; index < 20; index++) key(KeyCode.Right);
    await exchange(); await exchange();
    const bright = remote.readPixels(), sum = (pixels: Uint8Array): number => pixels.reduce((total, value, index) => total + (index % 4 === 3 ? 0 : value), 0);
    expect(sum(bright)).toBeGreaterThan(sum(dark) * 1.15);
    expect(await Bun.file(join(root, "settings/images.cfg")).text()).toContain('r_gamma "2"');
    expect(remote.networkPhase).toBe("active"); expect(server.networkClients[0]).toBe(peer); expect(remote.localPlayers[0]?.seat).toBe(local.seat);
    await Bun.write("/tmp/video-settings-remote-cpu.png", encodePng(640, 480, bright));
  } finally { await client?.close(); await server?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
