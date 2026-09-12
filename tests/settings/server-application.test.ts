import { Q2Ctf } from "../../src/content/q2/multiplayer/ctf/index.ts";
import { Q2Lmctf } from "../../src/content/q2/multiplayer/lmctf/runtime.ts";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { writeServerSetting } from "../../src/settings/server/index.ts";
import type { BoundServerSetting } from "../../src/settings/server/index.ts";

function setting(application: Application, id: string): BoundServerSetting {
  const binding = application.simulation.serverSettings().find(binding => binding.definition.id === id);
  if (binding === undefined) throw new Error(`Missing server setting ${id}`); return binding;
}
test("CLI profile controls real Q2 item spawn, shared damage, limits and next-map carry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quake-server-application-")), path = join(directory, "server.json");
  await Bun.write(path, JSON.stringify({ version: 1, overrides: [
    { id: "server:q2.no-health", value: "1" }, { id: "server:friendly-fire", value: "0" }, { id: "server:frag-limit", value: "3" },
  ] }));
  const parsed = parseApplicationCommand(["--game", "q2-classic-ctf", "--map", "q2ctf1", "--movement", "q1", "--character", "q3", "--dedicated", "--server-profile", path]);
  if (parsed.kind !== "run") throw new Error("Expected source launch");
  const application = await Application.open(parsed.options, { print: () => undefined });
  try {
    const source = application.simulation.q2Source(); if (source === null) throw new Error("Missing source");
    expect(source.game.options.deathmatchFlags & 1).toBe(1);
    expect([...source.game.entities.values()].some(entity => entity.classname.startsWith("item_health"))).toBe(false);
    expect(source.players.rules.fragLimit).toBe(3);
    const clients = [application.session.createClient(0), application.session.createClient(1)];
    const actors = clients.map(client => application.simulation.admitPlayer(client.id).actor);
    const firstId = actors[0], secondId = actors[1]; if (firstId === undefined || secondId === undefined) throw new Error("Missing players");
    application.simulation.playerCommand(firstId, "team", ["red"]); application.simulation.playerCommand(secondId, "team", ["red"]);
    const first = source.game.entity(firstId), second = source.game.entity(secondId);
    if (first === null || second === null) throw new Error("Missing source players");
    source.game.host.combat.setHealth(second.actor, 100); source.game.host.combat.setArmor(second.actor, { kind: "none" });
    const zero = { x: 0, y: 0, z: 0 };
    source.game.damage(secondId, first, firstId, 10, 0, zero, zero, zero, 1, 0);
    expect(source.game.host.combat.read(secondId)?.health).toBe(100);
    expect(writeServerSetting(setting(application, "server:friendly-fire"), "1").effective).toBe("1");
    source.game.damage(secondId, first, firstId, 10, 0, zero, zero, zero, 1, 0);
    expect(source.game.host.combat.read(secondId)?.health).toBe(90);
    const player = source.players.states.get(firstId); if (player === undefined) throw new Error("Missing score owner");
    player.score = 3; source.product.checkRules();
    expect(source.players.intermission.kind).toBe("intermission");
    expect(writeServerSetting(setting(application, "server:q2.no-health"), "0").pending).toBe(true);
    await application.changeLevel("maps/q2ctf1.bsp");
    const next = application.simulation.q2Source(); if (next === null) throw new Error("Missing replacement source");
    expect(next.game.options.deathmatchFlags & (1 | 256)).toBe(0);
    expect(next.players.rules.fragLimit).toBe(3);
    expect([...next.game.entities.values()].some(entity => entity.classname.startsWith("item_health"))).toBe(true);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

test("Q3 profile seeds native match and combat owners before source map construction", async () => {
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Expected source launch");
  const application = await Application.open({ ...parsed.options, serverProfile: { version: 1, overrides: [
    { id: "server:q3.game-type", value: "3" }, { id: "server:frag-limit", value: "7" }, { id: "server:friendly-fire", value: "1" },
  ] } }, { print: () => undefined });
  try {
    const source = application.simulation.q3Source(); if (source === null) throw new Error("Missing Q3 source");
    expect(source.gameType).toBe(3);
    expect(source.settings.integer("fraglimit")).toBe(7);
    expect(source.settings.integer("g_friendlyFire")).toBe(1);
    expect(writeServerSetting(setting(application, "server:frag-limit"), "11")).toEqual({ desired: "11", effective: "7", pending: true, applyAt: "live" });
    await application.step(100);
    expect(source.settings.integer("fraglimit")).toBe(11);
  } finally { await application.close(); }
}, 30000);

test("LMCTF settings distinguish next-match duration and next-map rune spawning", async () => {
  const parsed = parseApplicationCommand(["--game", "q2-classic-lmctf", "--map", "lmctf09", "--movement", "q2", "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Expected source launch");
  const application = await Application.open({ ...parsed.options, serverProfile: { version: 1, overrides: [
    { id: "server:time-limit", value: "2" }, { id: "server:lmctf.fast-switch", value: "1" },
    { id: "server:lmctf.rune.damage", value: "0" }, { id: "server:lmctf.rune.haste", value: "0" },
    { id: "server:lmctf.rune.resist", value: "0" }, { id: "server:lmctf.rune.regen", value: "0" },
  ] } }, { print: () => undefined });
  try {
    const source = application.simulation.q2Source(), mode = source?.product.match.source;
    if (source === null || source === undefined || !(mode instanceof Q2Lmctf)) throw new Error("Missing LMCTF source");
    expect(mode.rules.fastSwitch).toBe(true);
    expect([...source.game.entities.values()].some(entity => entity.classname.endsWith("_rune"))).toBe(false);
    const client = application.session.createClient(0); application.simulation.admitPlayer(client.id);
    expect(writeServerSetting(setting(application, "server:time-limit"), "5")).toEqual({ desired: "5", effective: "2", pending: true, applyAt: "next-match" });
    mode.rules.countdownSeconds = 0; mode.match.start(source.game);
    for (let frame = 0; frame < 12; frame++) await application.step(100);
    expect(mode.match.phase).toBe("inplay");
    expect(mode.rules.timeLimitMinutes).toBe(5);
    expect(mode.match.remaining).toBeGreaterThan(290);
    expect(writeServerSetting(setting(application, "server:lmctf.rune.regen"), "1").pending).toBe(true);
    expect([...source.game.entities.values()].some(entity => entity.classname === "regen_rune")).toBe(false);
    await application.changeLevel("maps/lmctf09.bsp");
    const next = application.simulation.q2Source(); if (next === null) throw new Error("Missing new source");
    expect([...next.game.entities.values()].filter(entity => entity.classname.endsWith("_rune")).map(entity => entity.classname)).toEqual(["regen_rune"]);
    const directory = await mkdtemp(join(tmpdir(), "lmctf-effective-settings-"));
    try {
      const path = join(directory, "effective.sav");
      await application.saveGame(path); await application.loadGame(path);
      expect(application.simulation.q2ServerCvars()?.find("runes")?.value).toBe("8");
      expect(application.simulation.q2ServerCvars()?.find("runes")?.latchedValue).toBeUndefined();
      expect(application.simulation.q2ServerCvars()?.find("timelimit")?.value).toBe("5");
      expect(application.simulation.q2ServerCvars()?.find("timelimit")?.latchedValue).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { await application.close(); }
}, 30000);

for (const [game, map, ctf] of [["q2-classic-baseq2", "base1", false], ["q2-classic-ctf", "q2ctf1", true]] satisfies readonly (readonly [string, string, boolean])[]) {
  test(`${game} save restores effective limits and flags through the server owner`, async () => {
    const parsed = parseApplicationCommand(["--game", game, "--map", map, "--mode", "deathmatch", "--dedicated"]);
    if (parsed.kind !== "run") throw new Error("Expected source launch");
    const application = await Application.open(parsed.options, { print: () => undefined });
    const directory = await mkdtemp(join(tmpdir(), "q2-effective-settings-"));
    try {
      const client = application.session.createClient(0); application.simulation.admitPlayer(client.id);
      writeServerSetting(setting(application, "server:frag-limit"), "7");
      writeServerSetting(setting(application, "server:friendly-fire"), "0");
      if (ctf) writeServerSetting(setting(application, "server:capture-limit"), "4");
      const path = join(directory, "effective.sav"); await application.saveGame(path);
      writeServerSetting(setting(application, "server:frag-limit"), "19");
      writeServerSetting(setting(application, "server:friendly-fire"), "1");
      if (ctf) writeServerSetting(setting(application, "server:capture-limit"), "8");
      await application.loadGame(path);
      const source = application.simulation.q2Source(); if (source === null) throw new Error("Missing restored source");
      expect(source.players.rules.fragLimit).toBe(7);
      expect(source.game.options.deathmatchFlags & 256).toBe(256);
      expect(application.simulation.q2ServerCvars()?.find("fraglimit")?.value).toBe("7");
      expect(application.simulation.q2ServerCvars()?.find("dmflags")?.value).toBe("256");
      if (ctf) {
        expect(application.simulation.q2ServerCvars()?.find("capturelimit")?.value).toBe("4");
        const mode = source.product.match.source; if (!(mode instanceof Q2Ctf)) throw new Error("Missing restored CTF source");
        expect(mode.rules.captureLimit).toBe(4);
      }
    } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30000);
}
