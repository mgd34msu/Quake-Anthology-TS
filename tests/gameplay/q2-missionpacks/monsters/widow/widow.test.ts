import { expect, test } from "bun:test";
import { missionPackMonsterFixture } from "../monsters.test.ts";
import { widowFrame } from "../../../../../src/content/q2/missionpacks/monsters/tables/rogue-widow.ts";
import { widow2Frame } from "../../../../../src/content/q2/missionpacks/monsters/tables/rogue-widow2.ts";
import { widowPowerups } from "../../../../../src/content/q2/missionpacks/monsters/widow/common.ts";
import { decodeQ2MissionPackMonstersCheckpoint, encodeQ2MissionPackMonstersCheckpoint } from "../../../../../src/persistence/q2-missionpacks.ts";
import { decodeQ2FoundationCheckpoint, encodeQ2FoundationCheckpoint } from "../../../../../src/persistence/q2-foundation.ts";

const zero = { x: 0, y: 0, z: 0 };
test("Widow stalkers share the original kill count and release commander slots", () => {
  const scene = missionPackMonsterFixture("rogue");
  try {
    const boss = scene.spawn("monster_widow"); boss.entity.enemy = scene.player.id; boss.entity.frame = widowFrame.spawn10;
    const total = scene.game.counters.totalMonsters; boss.dispatch("widow_spawn_check");
    const children = [...scene.game.entities.values()].filter(entity => entity.classname === "monster_stalker");
    expect(children).toHaveLength(2); expect(boss.state.monsterUsed).toBe(2); expect(scene.game.counters.totalMonsters).toBe(total);
    for (const child of children) {
      const state = scene.monsters.context(child.actor.id)?.state;
      expect(state?.commander).toBe(boss.entity.actor.id); expect(state?.spawnedBy).toBe("widow"); expect(state?.doNotCount).toBe(true);
      scene.game.damage(child.actor.id, boss.entity, scene.player.id, 500, 0, zero, zero, zero, 0, 8);
    }
    expect(boss.state.monsterUsed).toBe(0); expect(scene.game.counters.killedMonsters).toBe(0);
  } finally { scene.actors.close(); }
});
test("Widow copies source powers and preserves global fourth-shot effects through checked bytes", () => {
  const scene = missionPackMonsterFixture("rogue");
  try {
    const boss = scene.spawn("monster_widow"); boss.entity.enemy = scene.player.id;
    widowPowerups(boss, { ...scene.services, powerups: () => ({ quadUntil: 10, doubleUntil: 0, invulnerabilityUntil: 10 }) }, scene.module.source);
    expect(scene.module.source.widowDamageMultiplier).toBe(2); expect(scene.module.source.get(boss.entity).widowDoubleUntil).toBe(10);
    expect(scene.inventory.count(boss.entity.actor.id, "q2:monster-power")).toBe(250);
    scene.rayHit(boss.entity.actor.id); boss.entity.frame = widowFrame.run01; for (let i = 0; i < 3; i++) boss.dispatch("WidowBlaster");
    const saved = decodeQ2MissionPackMonstersCheckpoint(encodeQ2MissionPackMonstersCheckpoint(scene.module.capture(scene.game)));
    expect(saved.widowShotsFired).toBe(3); expect(saved.widowDamageMultiplier).toBe(2);
    scene.module.source.widowShotsFired = 0; scene.module.restore(scene.game, saved); boss.dispatch("WidowBlaster");
    const shots = [...scene.game.entities.values()].filter(entity => entity.classname === "bolt");
    expect(shots).toHaveLength(4); expect(shots.map(entity => entity.damage)).toEqual([20, 20, 20, 20]); expect(shots.map(entity => entity.effects & 8)).toEqual([0, 0, 0, 8]);
    const core = decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(scene.game.capture()));
    expect(core.entities.find(entity => entity.actor.slot === boss.entity.actor.id.slot)?.callbacks.prethink).toBe("q2:rogue/widow_powerups");
    widowPowerups(boss, scene.services, scene.module.source); expect(scene.module.source.widowDamageMultiplier).toBe(1);
  } finally { scene.actors.close(); }
});
test("Widow2 tongue pulls the shared foreign player and death kills all living stalkers", () => {
  const scene = missionPackMonsterFixture("rogue");
  try {
    const boss = scene.spawn("monster_widow2"); boss.entity.enemy = scene.player.id;
    scene.game.move(scene.playerEntity, { origin: { x: 160, y: 0, z: 64 }, ground: scene.game.host.worldActor() });
    boss.entity.frame = widow2Frame.tongs01; boss.dispatch("Widow2Tongue"); expect(scene.combat.read(scene.player.id)?.health).toBe(998);
    boss.entity.frame = widow2Frame.tongs04; boss.dispatch("Widow2TonguePull");
    expect(scene.bodies.read(scene.player.id)?.ground).toBeNull(); expect(scene.bodies.read(scene.player.id)?.origin.z).toBe(65); expect(scene.bodies.read(scene.player.id)?.velocity.x).toBeLessThan(-900);
    const unrelated = scene.spawn("monster_stalker");
    scene.game.damage(boss.entity.actor.id, scene.playerEntity, scene.player.id, 3801, 0, zero, zero, zero, 0, 8);
    expect(boss.state.move.name).toBe("widow2_move_death"); expect(scene.combat.read(unrelated.entity.actor.id)?.health).toBeLessThanOrEqual(0);
    expect(boss.state.canTakeDamage).toBe(false);
  } finally { scene.actors.close(); }
});
test("Widow legs and Widow2 explosions finish their named source death phases", () => {
  const scene = missionPackMonsterFixture("rogue");
  try {
    const widow = scene.spawn("monster_widow"); widow.entity.enemy = scene.player.id;
    scene.advance(0.1);
    scene.game.damage(widow.entity.actor.id, scene.playerEntity, scene.player.id, 3001, 0, zero, zero, zero, 0, 8);
    for (let tick = 1; tick <= 34; tick++) scene.advance((tick + 1) / 10);
    expect(scene.actors.isLive(widow.entity.actor.id)).toBe(false);
    const legs = [...scene.game.entities.values()].find(entity => entity.classname === "widowlegs");
    if (legs === undefined) throw new Error("Widow source death did not create its legs");
    expect(scene.game.sourceCallbacks.think.name(legs.think)).toBe("q2:rogue/widowlegs_think");
    expect(decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(scene.game.capture())).entities.some(entity => entity.spawn.classname === "widowlegs")).toBe(true);
    for (let tick = 35; tick <= 75; tick++) scene.advance((tick + 1) / 10);
    expect(scene.actors.isLive(legs.actor.id)).toBe(false);
    expect([...scene.game.entities.values()].filter(entity => entity.model.startsWith("models/monsters/blackwidow/gib"))).toHaveLength(5);
    const boss = scene.spawn("monster_widow2"); boss.entity.enemy = scene.player.id;
    scene.advance(7.7);
    scene.game.damage(boss.entity.actor.id, scene.playerEntity, scene.player.id, 3801, 0, zero, zero, zero, 0, 8);
    for (let tick = 76; tick <= 123; tick++) scene.advance((tick + 2) / 10);
    expect(scene.game.sourceCallbacks.think.name(boss.entity.think)).toBe("q2:rogue/WidowExplode");
    expect(boss.entity.count).toBeGreaterThan(0);
    const saved = decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(scene.game.capture()));
    expect(saved.entities.find(entity => entity.actor.slot === boss.entity.actor.id.slot)?.callbacks.think).toBe("q2:rogue/WidowExplode");
    for (let tick = 124; tick <= 240; tick++) scene.advance((tick + 2) / 10);
    expect(boss.state.corpse).toBe(true); expect(boss.entity.motion).toBe("toss"); expect(boss.entity.frame).toBe(widow2Frame.dthsrh22); expect(boss.entity.nextThink).toBeNull();
    expect(scene.game.body(boss.entity).bounds.max.z).toBe(80); expect(boss.state.canTakeDamage).toBe(true); expect(scene.game.counters.killedMonsters).toBe(2);
  } finally { scene.actors.close(); }
});
