import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { RemoteApplication } from "../../../src/app/bootstrap/remote-application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { Q2PeerDownload } from "../../../src/app/bootstrap/network/q2-downloads.ts";
import { DownloadSink } from "../../../src/network/services/downloads.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { SeatConsole } from "../../../src/console/session.ts";

for (const mode of ["disabled", "http-off"] satisfies readonly ("disabled" | "http-off")[]) test(`Q2 remote applies saved ${mode} download permission before signon`, async () => {
  const root = await mkdtemp(join(tmpdir(), "q2-remote-policy-")), serverUsers = join(root, "server"), clientUsers = join(root, "client");
  const destination = join(clientUsers, "q2/baseq2/sound/permission-fixture.wav"), cfg = join(clientUsers, "q2/baseq2/settings/client.cfg");
  await mkdir(join(clientUsers, "q2/baseq2/settings"), { recursive: true });
  await Bun.write(cfg, `set allow_download ${mode === "disabled" ? 0 : 1}\nset cl_http_downloads ${mode === "http-off" ? 0 : 1}\n`);
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak");
  const entry = archive.findEntries("sound/berserk/attack.wav")[0]; if (entry === undefined) throw new Error("Missing fixture sound");
  const sound = await archive.readEntry(entry); archive.close();
  await mkdir(join(serverUsers, "q2/baseq2/sound"), { recursive: true });
  await Bun.write(join(serverUsers, "q2/baseq2/sound/permission-fixture.wav"), sound);
  const httpRequests: string[] = [];
  const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => { httpRequests.push(request.url); return new Response("sound/permission-fixture.wav\n"); } });
  const native = spyOn(Q2PeerDownload.prototype, "begin"), writes = spyOn(DownloadSink, "create"), consolePrint = spyOn(SeatConsole.prototype, "print");
  let server: Application | null = null, client: RemoteApplication | null = null;
  const prints: string[] = [], host = { print: (text: string): undefined => { prints.push(text); return undefined; } };
  try {
    const launch = parseApplicationCommand(["--game", "q2-classic-baseq2", "--movement", "q2", "--character", "q2", "--dedicated", "--mode", "coop", "--listen-q2", "0", "--bind", "127.0.0.1"]);
    if (launch.kind !== "run") throw new Error("Missing server options");
    server = await Application.open({ ...launch.options, userContentRoot: serverUsers }, host);
    const cvars = server.simulation.q2ServerCvars(); if (cvars === null) throw new Error("Missing source cvars");
    cvars.set("allow_download", "1"); cvars.set("sv_downloadserver", `http://127.0.0.1:${http.port}/`);
    if (mode === "http-off") {
      const entity = [...server.simulation.q2Source()?.game.entities.values() ?? []].find(entity => entity.visible && entity.classname.startsWith("monster_"));
      if (entity === undefined) throw new Error("Missing source monster for sound configstring");
      entity.sound = "permission-fixture.wav";
    }
    const address = server.networkAddress; if (address === null) throw new Error("Missing server address");
    const selected = parseApplicationCommand(["--game", "q2-classic-baseq2", "--movement", "q2", "--character", "q2", "--mode", "coop", "--connect-q2", `127.0.0.1:${address.port}`, "--renderer", "cpu", "--width", "160", "--height", "120", "--hidden"]);
    if (selected.kind !== "run") throw new Error("Missing client options");
    client = await RemoteApplication.open({ ...selected.options, userContentRoot: clientUsers }, host);
    const remote = client, authoritative = server;
    expect(remote.clientCommands?.cvars.dialect).toBe("q2-classic");
    expect(remote.clientCommands?.cvars.variableValue("allow_download")).toBe(mode === "disabled" ? 0 : 1);
    expect(remote.clientCommands?.cvars.variableValue("cl_http_downloads")).toBe(mode === "http-off" ? 0 : 1);
    const exchange = async (): Promise<void> => { await remote.step(50); await Bun.sleep(1); await authoritative.step(50); await Bun.sleep(1); await remote.step(50); };
    for (let index = 0; index < 100 && (remote.networkPhase !== "active" || remote.localPlayers.length === 0); index++) await exchange();
    expect(remote.networkPhase).toBe("active");
    expect(remote.session.world).toBeNull();
    expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
    expect(httpRequests).toEqual([]);
    if (mode === "disabled") {
      expect(native.mock.calls).toHaveLength(0); expect(writes.mock.calls).toHaveLength(0);
      expect(await Bun.file(destination).exists()).toBe(false);
      expect((await readdir(join(clientUsers, "q2/baseq2"), { recursive: true })).some(path => path.includes(".download-"))).toBe(false);
    } else {
      expect(native.mock.calls.map(call => call[1])).toContain("sound/permission-fixture.wav");
      expect(writes.mock.calls.length).toBeGreaterThan(0);
      expect(await Bun.file(destination).bytes()).toEqual(new Uint8Array(sound));
    }
    const local = remote.localPlayers[0]; if (local === undefined) throw new Error(`Missing seat: ${prints.join("")}`);
    const key = (code: number): void => { for (const down of [true, false]) remote.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    key(96); remote.input({ seat: local.seat.id, kind: "text", text: "allow_download", timeMilliseconds: performance.now() }); key(13); await exchange();
    expect(consolePrint.mock.calls.some(([text]) => text.includes('"allow_download" is'))).toBe(true);
    await remote.close(); client = null;
    expect(await Bun.file(cfg).text()).toContain(`set allow_download "${mode === "disabled" ? 0 : 1}"`);
  } finally { await client?.close(); await server?.close(); await http.stop(true); native.mockRestore(); writes.mockRestore(); consolePrint.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);
