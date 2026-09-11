import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../../src/app/bootstrap/options.ts";
import { Q2Lmctf } from "../../../../src/content/q2/multiplayer/lmctf/runtime.ts";

test("LMCTF referee match survives a saved pending map transition in one application", async () => {
  const parsed = parseApplicationCommand(["--game", "q2-classic-lmctf", "--map", "lmctf09", "--movement", "q2", "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Expected launch options");
  const directory = await mkdtemp(join(tmpdir(), "lmctf-match-"));
  const application = await Application.open(parsed.options, { print: () => undefined });
  try {
    const source = application.simulation.q2Source();
    if (source === null || !(source.product.match.source instanceof Q2Lmctf)) throw new Error("Expected LMCTF source");
    const mode = source.product.match.source;
    const clients = [application.session.createClient(0), application.session.createClient(1)];
    const players = clients.map(client => ({ client: client.id, admission: application.simulation.admitPlayer(client.id) }));
    const first = players[0]; if (first === undefined) throw new Error("Missing first client");
    for (const [index, player] of players.entries()) application.simulation.playerCommand(player.admission.actor, "team", [index === 0 ? "red" : "blue"]);
    mode.rules.refPassword = "test-ref"; mode.rules.countdownSeconds = 15; mode.rules.autoLock = true;
    expect(mode.rules.mapList).toContain("lmctf09");
    application.simulation.playerCommand(first.admission.actor, "match", ["lmctf09"]);
    expect(mode.match.pendingMap).toBeNull();
    application.simulation.playerCommand(first.admission.actor, "referee", ["test-ref"]);
    application.simulation.playerCommand(first.admission.actor, "match", ["not-a-map"]);
    expect(mode.match.pendingMap).toBeNull();
    const state = mode.states.get(first.admission.actor); if (state === undefined) throw new Error("Missing source state");
    state.statistics.set("score", 123);
    application.simulation.playerCommand(first.admission.actor, "match", ["lmctf09"]);
    expect(mode.match.pendingMap).toEqual({ map: "lmctf09", countdown: true });
    const path = join(directory, "pending.sav");
    await application.saveGame(path);
    await application.loadGame(path);
    await application.step(100);
    await application.step(100);
    const next = application.simulation.q2Source();
    if (next === null || !(next.product.match.source instanceof Q2Lmctf)) throw new Error("Expected new LMCTF source");
    const after = next.product.match.source;
    expect(after.match.capture()).toEqual({ pendingMap: null, phase: "countdown", remaining: 15, nextThink: 1, paused: false, teamsLocked: true });
    for (const [index, player] of players.entries()) {
      const actor = application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(player.client));
      if (actor === undefined) throw new Error("Lost session client");
      expect(actor.equals(player.admission.actor)).toBe(false);
      const carried = after.states.get(actor);
      expect(carried?.team).toBe(index === 0 ? 1 : 2);
      expect(carried?.statistics.size).toBe(0);
      expect(next.players.states.get(actor)?.score).toBe(0);
      if (index === 0) expect((carried?.extraFlags ?? 0) & 2).toBe(2);
    }
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);
