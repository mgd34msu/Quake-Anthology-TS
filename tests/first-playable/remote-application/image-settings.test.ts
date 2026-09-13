import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { RemoteApplication } from "../../../src/app/bootstrap/remote-application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { Q3RemotePresentation } from "../../../src/app/bootstrap/network/remote-q3.ts";
import { QvmCgame } from "../../../src/compat/qvm/cgame.ts";
import { Q3ServerConnection } from "../../../src/network/q3/server.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { SeatConsole } from "../../../src/console/session.ts";

function pinkPixels(bytes: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 4)
    if ((bytes[offset] ?? 0) > 220 && (bytes[offset + 1] ?? 255) < 40 && (bytes[offset + 2] ?? 0) > 220) count++;
  return count;
}

test("remote image console refresh preserves the active Q3 cgame and connection", async () => {
  const users = await mkdtemp(join(tmpdir(), "quake-remote-images-"));
  const imagePath = join(users, "q3a/baseq3/gfx/2d/bigchars.png");
  await mkdir(join(users, "q3a/baseq3/gfx/2d"), { recursive: true });
  const pixels = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([255, 0, 255, 255], offset);
  await Bun.write(imagePath, encodePng(256, 256, pixels));
  await mkdir(join(users, "settings"), { recursive: true });
  await Bun.write(join(users, "settings/images.cfg"), 'seta r_override_textures "0"\nseta r_texture_formats "source"\n');
  const common = ["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch"];
  const selected = parseApplicationCommand([...common, "--dedicated", "--listen", "0", "--bind", "127.0.0.1"]);
  if (selected.kind !== "run") throw new Error("Missing server options");
  const prints: string[] = [], host = { print: (text: string): undefined => { prints.push(text); return undefined; } };
  let server: Application | null = null, client: RemoteApplication | null = null;
  const init = spyOn(QvmCgame.prototype, "init"), shutdown = spyOn(QvmCgame.prototype, "shutdown"), pure = spyOn(Q3ServerConnection.prototype, "verifyPure");
  const consolePrint = spyOn(SeatConsole.prototype, "print");
  try {
    server = await Application.open({ ...selected.options, userContentRoot: users }, host);
    server.simulation.q3Source()?.host.cvars.set("sv_pure", "0", true);
    const address = server.networkAddress; if (address === null) throw new Error("Missing server address");
    const parsed = parseApplicationCommand([...common, "--connect-q3", `127.0.0.1:${address.port}`, "--renderer", "cpu", "--width", "320", "--height", "240", "--hidden"]);
    if (parsed.kind !== "run") throw new Error("Missing client options");
    client = await RemoteApplication.open({ ...parsed.options, userContentRoot: users }, host);
    const remote = client, authoritative = server;
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await authoritative.step(50); await Bun.sleep(1); await remote.step(50); };
    for (let index = 0; index < 100 && remote.networkPhase !== "active"; index++) await exchange();
    expect(remote.networkPhase).toBe("active");
    const local = remote.localPlayers[0], peer = authoritative.networkClients[0];
    if (local === undefined || peer === undefined || !(remote.remote instanceof Q3RemotePresentation)) throw new Error(`Missing active player: ${prints.join("")}`);
    const source = remote.remote.cgameSource, seat = local.seat, actor = local.actor, window = remote.window;
    const key = (code: number): void => { for (const down of [true, false]) remote.input({ seat: seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    key(96);
    for (let index = 0; index < 4; index++) await exchange();
    const before = pinkPixels(remote.readPixels()), initializations = init.mock.calls.length, shutdowns = shutdown.mock.calls.length, pureChecks = pure.mock.calls.length, elapsed = remote.timeMilliseconds;
    remote.input({ seat: seat.id, kind: "text", text: '/r_override_textures 2;r_texture_formats "png tga jpg"', timeMilliseconds: performance.now() });
    key(13);
    for (let index = 0; index < 4; index++) await exchange();
    await Bun.write("/tmp/remote-image-settings.png", encodePng(320, 240, remote.readPixels()));
    expect(pinkPixels(remote.readPixels())).toBeGreaterThan(before + 100);
    expect(await Bun.file(join(users, "settings/images.cfg")).text()).toContain('"png tga jpg"');
    remote.input({ seat: seat.id, kind: "text", text: "/r_override_textures 0;r_texture_formats source", timeMilliseconds: performance.now() });
    key(13);
    for (let index = 0; index < 4; index++) await exchange();
    expect(pinkPixels(remote.readPixels())).toBeLessThanOrEqual(before);
    const consoleLines = consolePrint.mock.calls.length;
    remote.input({ seat: seat.id, kind: "text", text: "/r_texture_formats", timeMilliseconds: performance.now() });
    key(13);
    await exchange();
    expect(consolePrint.mock.calls.slice(consoleLines).some(([text]) => text.includes("r_texture_formats") && text.includes("source"))).toBe(true);
    await Bun.write(imagePath, "invalid PNG diagnostic");
    const rejectedLines = consolePrint.mock.calls.length;
    remote.input({ seat: seat.id, kind: "text", text: '/r_override_textures 2;r_texture_formats "png tga jpg"', timeMilliseconds: performance.now() });
    key(13);
    await exchange();
    expect(consolePrint.mock.calls.slice(rejectedLines).some(([text]) => text.startsWith("Image settings rejected:"))).toBe(true);
    expect(pinkPixels(remote.readPixels())).toBeLessThanOrEqual(before);
    expect(remote.networkPhase).toBe("active");
    expect(remote.remote.cgameSource).toBe(source);
    expect(remote.localPlayers[0]?.seat).toBe(seat);
    expect(remote.localPlayers[0]?.actor).toBe(actor);
    expect(remote.window).toBe(window);
    expect(authoritative.networkClients[0]).toBe(peer);
    expect(remote.session.world).toBeNull();
    expect(remote.timeMilliseconds).toBeGreaterThan(elapsed);
    expect(init.mock.calls.length).toBe(initializations);
    expect(shutdown.mock.calls.length).toBe(shutdowns);
    expect(pure.mock.calls.length).toBe(pureChecks);
    expect(await Bun.file(join(users, "settings/images.cfg")).text()).toContain('"source"');
  } finally {
    await client?.close(); await server?.close(); init.mockRestore(); shutdown.mockRestore(); pure.mockRestore(); consolePrint.mockRestore(); await rm(users, { recursive: true, force: true });
  }
}, 60000);
