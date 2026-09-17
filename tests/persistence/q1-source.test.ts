import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { captureQ1SourceSave, restoreQ1SourceSave } from "../../src/persistence/q1-source.ts";
import { decodeQ1Save, encodeQ1Save } from "../../src/persistence/q1.ts";

test("original Quake save restores actual edict fields into a fresh precached source", async () => {
  const launch = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", "q1", "--character", "q1", "--dedicated", "--progs", "progs.dat"]);
  if (launch.kind !== "run") throw new Error("Missing source launch");
  const content = await loadApplicationContent(launch.options);
  if (content.preparedQuakeC === null) throw new Error("Missing source program");
  const identity = createIdentityOwner("original-save"), client = identity.client(0, 0);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, mode: launch.options.mode, skill: launch.options.skill, seed: 17, maxClients: 1 };
  const first = createSimulation(options), second = createSimulation(options);
  try {
    const original = first.quakecSource(), restored = second.quakecSource();
    if (original === null || restored === null) throw new Error("Missing source runtime");
    first.admitPlayer(client); const player = second.admitPlayer(client).actor;
    const health = original.machine.fieldOffset("health");
    original.entities.at(1).setFloat(health, 73);
    original.entities.at(1).setVector(original.machine.fieldOffset("origin"), { x: 520, y: 288, z: 28 });
    const save = decodeQ1Save(encodeQ1Save(captureQ1SourceSave(original, { version: 5 }, "native", Array.from({ length: 16 }, () => 0))));
    let restoredTime = -1;
    const unknown = restoreQ1SourceSave(restored, save, header => { restoredTime = header.time; return undefined; });
    expect(unknown).toEqual({ globals: [], entities: [] });
    expect(restoredTime).toBe(save.time);
    expect(restored.entities.at(1).float(health)).toBe(73);
    expect(restored.entities.at(1).vector(restored.machine.fieldOffset("origin"))).toEqual({ x: 520, y: 288, z: 28 });
    expect(second.players()[0]).toBe(player);
    expect(second.combat.read(player)?.health).toBe(73);
    expect(restored.entities.count).toBe(save.entities.length);
    expect(restored.machine.program.digest).toBe(original.machine.program.digest);
  } finally { first.close(); second.close(); await content.close(); }
}, 30000);
