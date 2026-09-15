import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { CommandContext } from "../../../src/contracts/common.ts";

test("dedicated Application targets actual VM clients and retains command authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "qc-host-console-")), output: string[] = [];
  let application: Application | null = null;
  try {
    const launch = parseApplicationCommand(["--game", "q1-classic-hipnotic", "--progs", "progs.dat", "--map", "hip1m1", "--dedicated", "--mode", "singleplayer", "--movement", "q1", "--character", "q1", "--user-content-root", root]);
    if (launch.kind !== "run") throw new Error("Missing dedicated VM launch");
    const app = await Application.open(launch.options, { print: text => { output.push(text); } }); application = app;
    const source = app.simulation.quakecSource(); if (source === null) throw new Error("Missing VM source");
    const client = app.session.createClient(0); client.connect("loopback");
    const actor = app.simulation.admitPlayer(client.id).actor, slot = source.sourceSlot(actor);
    if (slot === null) throw new Error("Missing admitted VM actor");
    expect(app.simulation.movementPlayer(actor)?.client.equals(client.id)).toBe(true);
    const flags = () => Math.trunc(source.entities.at(slot).float(source.machine.fieldOffset("flags")));
    const server: CommandContext = { session: app.session.session, origin: { kind: "server-console" } };
    app.queueCommand("god", ["0"], null, server); await app.step(1); expect(flags() & 64).toBe(64);
    app.queueCommand("notarget", ["0"], null, server); await app.step(1); expect(flags() & 128).toBe(128);
    app.queueCommand("noclip", ["0"], null, server); await app.step(1);
    expect(source.entities.at(slot).float(source.machine.fieldOffset("movetype"))).toBe(8);
    app.queueCommand("god", [], null, server); await app.step(1);
    expect(output.join("")).toContain("connected slots: 0"); expect(flags() & 64).toBe(64);
    const remote: CommandContext = { session: app.session.session, origin: { kind: "script", name: "remote.cfg", caller: { kind: "remote-client", client: client.id } } };
    app.queueCommand("god", ["0"], null, remote); await app.step(1);
    expect(output.join("")).toContain("only the server console"); expect(flags() & 64).toBe(64);
    app.queueCommand("god", [], null, remote); await app.step(1); expect(flags() & 64).toBe(0);
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
