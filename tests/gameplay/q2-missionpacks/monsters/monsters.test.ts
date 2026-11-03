import { expect } from "bun:test";
import { testCorpusRoot, corpusTest, corpusDescribe } from "../../../support/corpus.ts";

import type { Vec3 } from "../../../../src/contracts/math.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";
import { parseQ2Entities, inhibitQ2Spawn } from "../../../../src/content/q2/foundation/fields.ts";
import type { Q2SpawnFields } from "../../../../src/content/q2/foundation/host.ts";
import { q2XatrixMonsterDefinitions, q2RogueMonsterDefinitions } from "../../../../src/content/q2/missionpacks/monsters/index.ts";
import type { Q2MonsterMissionPack } from "../../../../src/content/q2/missionpacks/monsters/types.ts";
import { medicFrame } from "../../../../src/content/q2/missionpacks/monsters/tables/rogue-medic.ts";
import { finishCorpse } from "../../../../src/content/q2/base/monsters/common.ts";
import { monsterDabeam } from "../../../../src/content/q2/missionpacks/monsters/dabeam.ts";
import { walkMove } from "../../../../src/content/q2/foundation/monsters/ai.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

import { missionPackMonsterFixture } from "./monster-fixture.ts";
const test = corpusTest("q2/baseq2/pak0.pak");
const describe = corpusDescribe("q2/baseq2/pak0.pak");


const fixture = missionPackMonsterFixture;

describe("original missionpack monster source behavior", () => {
  test("implemented definitions admit their actual retail map entity rows", async () => {
    for (const pack of ["xatrix", "rogue"] satisfies readonly Q2MonsterMissionPack[]) {
      const scene = fixture(pack), definitions = pack === "xatrix" ? q2XatrixMonsterDefinitions(scene.monsters, scene.bolts) : q2RogueMonsterDefinitions(scene.monsters, scene.bolts, scene.services, scene.module.source);
      const names = new Set(definitions.map(definition => definition.classname));
      const archive = await openArchive(`${testCorpusRoot()}/q2/${pack}/pak0.pak`);
      try {
        const representatives = new Map<string, Q2SpawnFields>();
        for (const entry of archive.entries.filter(entry => entry.path.startsWith("maps/") && entry.path.endsWith(".bsp"))) {
          for (const row of parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities, "classic")) if (names.has(row.classname) && !inhibitQ2Spawn(row, scene.game.options)) representatives.set(row.classname, row);
        }
        expect(representatives.size).toBeGreaterThan(3);
        const synthetic: string[] = [];
        for (const definition of definitions) {
          const retail = representatives.get(definition.classname);
          if (retail === undefined) synthetic.push(definition.classname);
          const row = retail ?? { classname: definition.classname, ordinal: -1, values: new Map([["origin", "0 0 64"]]) };
          const entity = scene.game.spawn(row), context = scene.monsters.context(entity.actor.id);
          expect(context).not.toBeNull(); expect(entity.model).toBe(definition.model);
          expect(scene.combat.read(entity.actor.id)?.health).toBeGreaterThan(0);
        }
        // Definitions with no retail map row are admitted from a synthetic row; pinning them keeps the retail coverage from shrinking silently.
        expect(synthetic).toEqual(pack === "xatrix" ? ["monster_supertank"] : ["monster_kamikaze", "monster_brain", "monster_boss2", "monster_supertank", "monster_jorg", "monster_makron"]);
      } finally { archive.close(); scene.actors.close(); }
    }
  });

  test("carrier summons share source counts and return slots through the normal death callback", () => {
    const scene = fixture("rogue"), carrier = scene.spawn("monster_carrier", new Map([["origin", "0 0 180"]]));
    carrier.entity.enemy = scene.player.id;
    const before = scene.game.counters.totalMonsters, slots = carrier.state.monsterSlots;
    carrier.dispatch("carrier_spawn_check");
    const child = [...scene.game.entities.values()].find(entity => entity.classname === "monster_flyer");
    if (child === undefined) throw new Error("Carrier source spawn callback failed to create its flyer");
    const childContext = scene.monsters.context(child.actor.id);
    if (childContext === null) throw new Error("Summoned flyer did not join the shared controller");
    expect(childContext.state.commander).toBe(carrier.entity.actor.id);
    expect(childContext.state.spawnedBy).toBe("carrier"); expect(childContext.state.doNotCount).toBe(true);
    expect(scene.game.counters.totalMonsters).toBe(before); expect(carrier.state.monsterSlots).toBe(slots - 1);
    scene.combat.setHealth(child.actor, -5);
    child.die?.(child, scene.game, { attack: null, self: child.actor, attacker: scene.player.id, inflictor: scene.player.id, damage: 55, kick: 0, point: zero });
    expect(carrier.state.monsterSlots).toBe(slots); expect(scene.game.counters.killedMonsters).toBe(0);
    expect(scene.actors.isLive(child.actor.id)).toBe(false);
    scene.actors.close();
  });

  test("monster dabeam hides its beam before its actor is freed", () => {
    const scene = fixture("xatrix"), owner = scene.spawn("monster_soldier");
    const beam = monsterDabeam(owner.entity, scene.game, scene.player.id, { x: 0, y: 0, z: 24 }, zero, 5, false);
    scene.advance(0.1);
    const visibility = () => scene.events.flatMap(event => event.kind === "beam" && event.actor === beam.actor.id ? [event.visible] : []);
    expect(visibility()).toEqual([true]);
    scene.advance(0.2);
    expect(visibility()).toEqual([true, false]);
    expect(scene.actors.isLive(beam.actor.id)).toBe(false);
    scene.actors.close();
  });

  test("medic commander resurrects the same actor and summons through shared source counts", () => {
    const scene = fixture("rogue"), commander = scene.spawn("monster_medic_commander"), patient = scene.spawn("monster_infantry", new Map([["origin", "140 0 24"]]));
    scene.combat.setHealth(patient.entity.actor, -10); patient.state.dead = true; finishCorpse(patient);
    commander.entity.enemy = scene.player.id; commander.run();
    expect(commander.state.medic).toBe(true); expect(commander.entity.enemy).toBe(patient.entity.actor.id);
    const actor = patient.entity.actor.id, total = scene.game.counters.totalMonsters;
    commander.entity.frame = medicFrame.attack43; commander.dispatch("medic_cable_attack");
    expect(scene.combat.read(actor)?.canTakeDamage).toBe(false);
    expect(patient.state.resurrecting).toBe(true);
    commander.entity.frame = medicFrame.attack50; commander.dispatch("medic_cable_attack");
    const revived = scene.monsters.context(actor);
    expect(revived?.entity.actor.id).toBe(actor); expect(scene.combat.read(actor)?.health).toBe(100);
    expect(revived?.state.doNotCount).toBe(true); expect(revived?.state.resurrecting).toBe(false);
    expect(scene.module.source.get(patient.entity).healer).toBeNull(); expect(scene.game.counters.totalMonsters).toBe(total);
    commander.dispatch("medic_hook_retract");
    expect(commander.entity.enemy).toBe(scene.player.id); expect(commander.state.medic).toBe(false);
    const slots = commander.state.monsterSlots;
    commander.dispatch("medic_determine_spawn"); commander.dispatch("medic_finish_spawn");
    const child = [...scene.game.entities.values()].find(entity => entity.classname === "monster_soldier");
    if (child === undefined) throw new Error("Commander source reinforcement was not spawned");
    expect(scene.monsters.context(child.actor.id)?.state.commander).toBe(commander.entity.actor.id);
    expect(scene.monsters.context(child.actor.id)?.state.spawnedBy).toBe("medic");
    expect(commander.state.monsterSlots).toBe(slots - 1); expect(scene.game.counters.totalMonsters).toBe(total);
    scene.actors.close();
  });

  test("Rogue movement rejects real Tesla areas and reverses steps toward the hazard", () => {
    const scene = fixture("rogue"), actor = scene.spawn("monster_gunner"), tesla = scene.bolts.fireTesla(scene.playerEntity, scene.game, { x: 60, y: 0, z: 24 }, { x: 1, y: 0, z: 0 }, 1, 0);
    const area = scene.bolts.spawnBadArea(scene.game, { x: 40, y: -40, z: -10 }, { x: 80, y: 40, z: 100 }, 0, tesla.actor.id);
    scene.game.move(actor.entity, { ground: scene.game.host.worldActor() });
    expect(walkMove(actor, 0, 32)).toBe(false);
    expect(scene.game.body(actor.entity).origin.x).toBe(0); expect(actor.entity.enemy).toBe(tesla.actor.id);
    expect(scene.module.source.get(actor.entity).blocked).toBe(false);
    scene.game.move(actor.entity, { origin: { x: 50, y: 0, z: 24 }, angles: zero });
    expect(walkMove(actor, 0, 8)).toBe(true); expect(scene.game.body(actor.entity).origin.x).toBe(42);
    actor.state.oldEnemy = scene.player.id; scene.game.remove(area);
    expect(walkMove(actor, 0, 8)).toBe(true); expect(actor.entity.enemy).toBe(scene.player.id);
    expect(scene.game.body(actor.entity).origin.x).toBe(42); expect(scene.module.source.get(actor.entity).badArea).toBeNull();
    scene.actors.close();
  });
});
