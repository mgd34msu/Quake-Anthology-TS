import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import { BaseMonster } from "../../../src/content/q1/base/monsters.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
for (const edition of ["classic", "rerelease"] satisfies readonly ("classic" | "rerelease")[]) {
  test.skipIf(!existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))(`Q2 notarget stops already alerted ${edition} Q1 monsters with Q3 character and QuakeWorld movement`, async () => {
    const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q1", "--character", "q3", "--dedicated", "--mode", "singleplayer"]);
    if (launch.kind !== "run") throw new Error("Expected mixed source launch");
    const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
    const enemySource: ProviderReference = { provider: `q1:monsters/${edition}/id1`, content: catalog.require(edition === "classic" ? "q1-classic-id1" : "q1-rerelease-id1").id };
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
      movement: { kind: "selected", value: { provider: "q1:movement", content: catalog.require("q1-quakeworld").id } },
      enemies: { kind: "selected", value: { kind: "replace", default: { source: enemySource, classname: "monster_enforcer" }, byClassname: { monster_soldier_light: { source: enemySource, classname: "monster_army" } } } } } });
    const content = await loadApplicationContent(launch.options, recipe), identity = createIdentityOwner(`notarget-${edition}`);
    const monsters: BaseMonster[] = [], originalStart = BaseMonster.prototype.start;
    const observeStart = spyOn(BaseMonster.prototype, "start").mockImplementation(function (this: BaseMonster) { monsters.push(this); return originalStart.call(this); });
    const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
    try {
      const actor = simulation.admitPlayer(identity.client(0, 0)).actor;
      for (let frame = 0; frame < 12; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
      const monster = monsters.find(value => value.game.live(value.entity));
      if (monster === undefined) throw new Error("Selected Q1 monster did not start");
      const army = [...monster.game.entities.values()].find(value => value.monster?.species === "army");
      if (army === undefined || army.monster === null) throw new Error("Selected Q1 army did not start");
      const source = simulation.q2Source(), player = source?.game.entity(actor);
      if (source === null || player === undefined || player === null) throw new Error("Missing authoritative Q2 player");
      monster.found(actor); monster.state.oldEnemy = actor;
      army.monster.enemy = actor; army.monster.oldEnemy = actor;
      army.monster.mode = "attack"; army.monster.firstFrame = 81; army.monster.sequence = Array.from({ length: 9 }, () => 0); army.monster.frameIndex = 4;
      expect(monster.enemy?.equals(actor)).toBe(true);
      simulation.playerCommand(actor, "notarget", []);
      expect((player.flags & 32) !== 0).toBe(true);
      expect(source.players.states.get(actor)?.notarget).toBe(true);
      expect(monster.game.monsterTarget(actor)?.notarget).toBe(true);
      const entitiesBefore = monster.game.entities.size, healthBefore = monster.game.health(actor);
      const yawBefore = monster.game.body(monster.entity).angles.y;
      monster.play("enf_atk6");
      monster.game.named.action(army, "monster_frame")();
      expect(monster.game.entities.size).toBe(entitiesBefore);
      expect(monster.game.health(actor)).toBe(healthBefore);
      expect(monster.game.body(monster.entity).angles.y).toBe(yawBefore);
      expect(army.monster.enemy).toBeNull();
      expect(army.monster.oldEnemy).toBeNull();
      expect(army.monster.mode).not.toBe("attack");
      expect(monster.enemy).toBeNull();
      expect(monster.state.oldEnemy).toBeNull();
      expect(monster.entity.attackState).toBe("straight");
      expect(monster.findTarget()).toBe(false);
      simulation.playerCommand(actor, "notarget", []);
      expect((player.flags & 32) !== 0).toBe(false);
      expect(monster.game.monsterTarget(actor)?.notarget).toBe(false);
    } finally { observeStart.mockRestore(); simulation.close(); await content.close(); }
  }, 20000);
}
