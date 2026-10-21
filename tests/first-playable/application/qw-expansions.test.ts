import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

// Every QuakeWorld expansion product boots and plays locally.
const cases: readonly (readonly [string, string])[] = [
  ["q1-quakeworld-hipnotic", "hip1m1"], ["q1-quakeworld-rogue", "r1m1"], ["q1-quakeworld-dopa", "e5m1"],
  ["q1-quakeworld-mg1", "mgdm1"], ["q1-quakeworld-mg3", "map1"], ["q1-quakeworld-quake64", "ndm1"], ["q1-quakeworld-ctf", "ctf1"]];

for (const [product, map] of cases) {
  test(`${product} plays ${map} locally`, async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-qw-expansion-"));
    let app: Application | null = null;
    try {
      const parsed = parseApplicationCommand(["--game", product, "--map", map, "--mode", "deathmatch",
        "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
      if (parsed.kind !== "run") throw new Error("Missing launch options");
      const application = app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: () => undefined });
      for (let frame = 0; frame < 12; frame++) await application.step(25);
      const local = application.localPlayers[0];
      if (local === undefined) throw new Error("Missing local player");
      expect(application.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
    } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  }, 180000);
}
