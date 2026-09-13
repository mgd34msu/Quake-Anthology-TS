import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressKey } from "../../src/network/common/endpoint.ts";
import { Application } from "../../src/app/bootstrap/application.ts";
import { RemoteApplication } from "../../src/app/bootstrap/remote-application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { decodePng } from "../../src/formats/images/png.ts";
import { decodeTga } from "../../src/formats/images/tga.ts";
import type { ImageLevel } from "../../src/contracts/render.ts";
import type { SeatId } from "../../src/contracts/identity.ts";
import type { SeatInputEvent } from "../../src/contracts/ui.ts";

function submit(application: { input(event: SeatInputEvent): boolean }, seat: SeatId, text: string): void {
  const key = (code: number): void => {
    application.input({ kind: "key", seat, timeMilliseconds: performance.now(), code, down: true, repeat: false });
    application.input({ kind: "key", seat, timeMilliseconds: performance.now(), code, down: false, repeat: false });
  };
  key(96);
  application.input({ kind: "text", seat, timeMilliseconds: performance.now(), text: `/${text}` });
  key(13); key(96);
}
function nonblank(image: ImageLevel): void {
  expect(image.width).toBe(320); expect(image.height).toBe(240);
  const colors = new Set<number>();
  for (let index = image.pixels.length / 2; index < image.pixels.length; index += 4) {
    colors.add((image.pixels[index] ?? 0) * 65536 + (image.pixels[index + 1] ?? 0) * 256 + (image.pixels[index + 2] ?? 0));
  }
  expect(colors.size).toBeGreaterThan(16);
}

for (const renderer of ["cpu", "gl"]) test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")(`local ${renderer} console saves actual frames and snapshots settings before later commands`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-console-capture-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
    "--renderer", renderer, "--width", "320", "--height", "240", "--hidden", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("No application launch");
  const output: string[] = [], application = await Application.open(parsed.options, { print: text => { output.push(text); return undefined; } });
  try {
    await application.step(100);
    const player = application.localPlayers[0]; if (player === undefined) throw new Error("No local seat");
    submit(application, player.seat.id, "screenshotPNG actual; screenshot silent; screenshot levelshot; seta capture_setting before; bind x +jump; writeconfig capture; seta capture_setting after; condump capture; writeconfig ordered; seta capture_setting final; writeconfig ordered");
    await application.step(100);
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/actual.png")).arrayBuffer())));
    nonblank(decodeTga(new Uint8Array(await Bun.file(join(root, "console/screenshots/shot0000.tga")).arrayBuffer())));
    const level = decodeTga(new Uint8Array(await Bun.file(join(root, "console/levelshots/base1.tga")).arrayBuffer()));
    expect(level.width).toBe(128); expect(level.height).toBe(128);
    const cfg = await Bun.file(join(root, "console/settings/seat-0/capture.cfg")).text();
    expect(cfg).toContain('seta capture_setting "before"'); expect(cfg).not.toContain('capture_setting "after"');
    expect(cfg).toContain('bind "x" "+jump"');
    expect(await Bun.file(join(root, "console/settings/seat-0/ordered.cfg")).text()).toContain('capture_setting "final"');
    expect(await Bun.file(join(root, "console/settings/seat-0/capture.txt")).text()).toContain("capture_setting");
    expect(output.some(text => text.includes("Console output failed"))).toBe(false);
    submit(application, player.seat.id, "screenshotPNG before-travel; map base1");
    await application.step(100);
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/before-travel.png")).arrayBuffer())));
  } finally { await application.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

for (const renderer of ["cpu", "gl"]) test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")(`remote ${renderer} console saves a real native Q2 server frame`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-remote-capture-"));
  const launch = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
    "--mode", "coop", "--dedicated", "--listen-q2", "0", "--bind", "127.0.0.1", "--user-content-root", root]);
  if (launch.kind !== "run") throw new Error("No server launch");
  const server = await Application.open(launch.options, { print: () => undefined });
  let remote: RemoteApplication | null = null;
  try {
    const address = server.networkAddress; if (address === null) throw new Error("Server did not bind");
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
      "--renderer", renderer, "--width", "320", "--height", "240", "--hidden", "--connect-q2", addressKey(address), "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("No remote launch");
    remote = await RemoteApplication.open(parsed.options, { print: () => undefined });
    for (let step = 0; step < 80 && remote.localPlayers.length === 0; step++) {
      await server.step(100); await remote.step(100); await Bun.sleep(1);
    }
    expect(remote.networkPhase).toBe("active");
    const player = remote.localPlayers[0]; if (player === undefined) throw new Error("No remote local seat");
    submit(remote, player.seat.id, "screenshotPNG remote");
    await server.step(100); await remote.step(100);
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/remote.png")).arrayBuffer())));
  } finally { await remote?.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")("cancelled native readbacks do not wait for a future frame or survive renderer close", async () => {
  const identity = createIdentityOwner("cancelled-captures"), owner = { identity: Symbol("capture"), session: identity.session, generation: 0 };
  const renderer = NativeRenderer.open({ renderer: "cpu", width: 8, height: 8, hidden: true, gamma: 1 }, owner);
  try {
    for (let index = 0; index < 32; index++) {
      const controller = new AbortController(), capture = renderer.captureNextFrame(controller.signal);
      controller.abort(new Error("travel")); await expect(capture).rejects.toThrow("travel");
    }
    const aborted = new AbortController(); aborted.abort(new Error("already cancelled"));
    await expect(renderer.captureNextFrame(aborted.signal)).rejects.toThrow("already cancelled");
    const live = renderer.captureNextFrame();
    renderer.execute({ owner, sequence: 0, commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, { kind: "swap-buffers" }] });
    expect((await live).length).toBe(8 * 8 * 4);
    const closing = renderer.captureNextFrame(); renderer.close();
    await expect(closing).rejects.toThrow("Renderer closed");
  } finally { renderer.close(); }
});
