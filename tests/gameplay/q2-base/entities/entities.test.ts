import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import type { DamageOutcome } from "../../../../src/contracts/gameplay.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2FoundationHost, Q2PresentationEvent } from "../../../../src/content/q2/foundation/host.ts";
import { createQ2TargetModule } from "../../../../src/content/q2/foundation/targets.ts";
import { Q2MoverModule } from "../../../../src/content/q2/foundation/movers.ts";
import { Q2Ballistics } from "../../../../src/content/q2/foundation/weapons/ballistics.ts";
import { Q2Monsters } from "../../../../src/content/q2/foundation/monsters/index.ts";
import { createQ2BaseEntityModule, q2ClockText, snapQ2TurretEighth } from "../../../../src/content/q2/base/entities/index.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

function fixture() {
  let now = 0;
  const actors = new SessionActorRegistry(createIdentityOwner("q2-base-entities")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const events: Q2PresentationEvent[] = [], outcomes: DamageOutcome[] = [], players: ActorId[] = [];
  const scheduled = new Map<OwnedActor, number>();
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined,
    confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(() => ({ arithmetic: "binary64", screenFacingDot: 1 })),
    context: request => ({ arithmetic: "binary64", player: players.includes(request.target), monster: false, attackerPlayer: false,
      hasEnemy: false, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false,
      nuke: false, noKnockback: true, movable: false, rejectTeamDamage: false, suppressPain: false }) }));
  const host: Q2FoundationHost = { actors, bodies, callbacks, combat, inventory: new SharedInventoryTable(actors),
    now: () => now, frameSeconds: () => 0.1, random: () => 0.5, touchTriggers: () => undefined, keyConsumed: () => undefined,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end,
      contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null, secondary: null,
      sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 } }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [],
    players: () => players, isPlayer: actor => players.includes(actor), isMonster: () => false,
    worldActor: () => { throw new Error("No world query in these source callback cases"); },
    inlineModelBounds: () => ({ min: zero, max: { x: 128, y: 128, z: 64 } }), setSolid: () => undefined, setMotion: () => undefined,
    setAreaPortal: () => undefined, emit: event => { events.push(event); return undefined; },
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), prepareLevelChange: () => undefined, transition: () => undefined,
    diagnostic: message => { throw new Error(message); } };
  const weapons = new Q2Ballistics({ emit: () => undefined, noise: () => undefined, dodge: () => undefined,
    lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons);
  const movers = new Q2MoverModule({ pathCorner: (corner, game, actor) => monsters.touchPathCorner(corner, game, actor),
    combatPoint: (point, game, actor) => monsters.touchCombatPoint(point, game, actor) });
  const entities = createQ2BaseEntityModule({ movers, weapons,
    teleportPlayer: () => { throw new Error("Unexpected teleport"); }, playerPush: () => undefined, setActorGravity: () => undefined,
    localTime: () => ({ hour: 1, minute: 2, second: 3 }),
    turretDriver: (entity, game) => monsters.spawnInfantryDriver(entity, game), resumeMonster: (entity, game) => monsters.resumeMonster(entity, game) });
  const game = new Q2Foundation(host, { edition: "classic", mapName: "base-entities", skill: 1, mode: "singleplayer", deathmatchFlags: 0,
    maxClients: 1, provider: "q2:official", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q3:movement" },
  [entities, movers, createQ2TargetModule()]);
  function spawn(classname: string, values: ReadonlyMap<string, string> = new Map<string, string>()) { return game.spawn({ classname, ordinal: -1, values }); }
  return { actors, host, game, entities, events, outcomes, spawn,
    advance(seconds: number) {
      now = seconds;
      for (const [actor] of [...scheduled].filter(([, due]) => due <= now).sort(([a], [b]) => a.id.slot - b.id.slot)) {
        scheduled.delete(actor);
        if (actors.isLive(actor.id)) callbacks.think(actor, { frame: Math.round(now * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
      }
    },
  };
}

describe("Q2 base entity source behaviors", () => {
  test("cross-level target preserves source scheduling plus delayed use after its own removal", () => {
    const scene = fixture();
    scene.spawn("target_secret", new Map([["targetname", "secret"]]));
    const target = scene.spawn("target_crosslevel_target", new Map([["spawnflags", "5"], ["target", "secret"], ["delay", "0.2"]]));
    const trigger = scene.spawn("target_crosslevel_trigger", new Map([["spawnflags", "5"]]));
    scene.host.callbacks.use(trigger.actor, null, null);
    expect(scene.game.counters.serverFlags).toBe(5);
    scene.advance(0.2); expect(scene.actors.isLive(target.actor.id)).toBe(false); expect(scene.game.counters.foundSecrets).toBe(0);
    scene.advance(0.4); expect(scene.game.counters.foundSecrets).toBe(1);
    scene.actors.close();
  });

  test("clock drives source character frames and fires its pathtarget on countdown completion", () => {
    const scene = fixture();
    const digit = scene.spawn("target_character", new Map([["team", "clock"], ["count", "2"], ["model", "*1"]]));
    scene.spawn("target_string", new Map([["team", "clock"], ["targetname", "display"]]));
    scene.spawn("target_secret", new Map([["targetname", "finished"]]));
    scene.spawn("func_clock", new Map([["target", "display"], ["spawnflags", "2"], ["count", "1"], ["pathtarget", "finished"]]));
    scene.advance(1); expect(digit.frame).toBe(1);
    scene.advance(2); expect(digit.frame).toBe(0); expect(scene.game.counters.foundSecrets).toBe(1);
    expect(q2ClockText(3661, 2)).toBe(" 1:01:01"); expect(q2ClockText(61, 1)).toBe(" 1:01");
    expect(snapQ2TurretEighth(-0.0625)).toBe(-0.125);
    scene.actors.close();
  });

  test("platform starts below its authored brush while conveyor use updates source speed", () => {
    const scene = fixture();
    const platform = scene.spawn("func_plat", new Map([["model", "*1"]]));
    expect(scene.entities.platformState(platform)).toEqual({ top: zero, bottom: { x: 0, y: 0, z: -56 }, phase: "bottom" });
    expect(scene.game.body(platform).origin.z).toBe(-56); expect(platform.speed).toBe(20);
    const conveyor = scene.spawn("func_conveyor", new Map([["model", "*2"], ["speed", "125"], ["spawnflags", "2"]]));
    expect(conveyor.speed).toBe(0);
    scene.host.callbacks.use(conveyor.actor, null, null); expect(conveyor.speed).toBe(125);
    scene.host.callbacks.use(conveyor.actor, null, null); expect(conveyor.speed).toBe(0);
    scene.actors.close();
  });

  test("target blaster retains the original projectile behavior and target-specific death cause", () => {
    const scene = fixture();
    const emitter = scene.spawn("target_blaster", new Map([["spawnflags", "2"], ["dmg", "15"]]));
    scene.host.callbacks.use(emitter.actor, null, null);
    const bolt = [...scene.game.entities.values()].find(entity => entity.classname === "bolt");
    if (bolt === undefined) throw new Error("Target did not fire a blaster projectile");
    expect(bolt.effects).toBe(8);
    const victim = scene.game.create("victim");
    scene.host.combat.create(victim.actor, { health: 100, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
    scene.host.callbacks.touch({ self: bolt.actor, other: victim.actor.id, plane: null, surface: null });
    expect(scene.host.combat.read(victim.actor.id)?.health).toBe(85);
    const outcome = scene.outcomes.at(-1);
    if (outcome?.kind !== "committed") throw new Error("Target blast did not reach shared combat");
    expect(outcome.decision.request.attack.cause).toEqual({ kind: "q2", meansOfDeath: 33, damageFlags: 4 });
    expect(outcome.decision.request.attack.weapon).toBeNull();
    scene.actors.close();
  });

  test("turret driver joins the real pusher team and shared infantry death removes it", () => {
    const scene = fixture();
    const report = scene.game.load(`
      { "classname" "turret_base" "team" "gun" "model" "*1" }
      { "classname" "turret_breach" "team" "gun" "model" "*2" "target" "muzzle" "targetname" "barrel" }
      { "classname" "info_notnull" "targetname" "muzzle" "origin" "32 0 0" }
      { "classname" "turret_driver" "target" "barrel" "origin" "-32 0 0" }
    `);
    const base = report.spawned.find(entity => entity.classname === "turret_base"), driver = report.spawned.find(entity => entity.classname === "turret_driver");
    if (base === undefined || driver === undefined) throw new Error("Turret assembly did not spawn");
    scene.advance(0.1);
    expect(scene.game.pushTeam(base.actor.id)).toHaveLength(3);
    expect(driver.teamMaster?.equals(base.actor.id)).toBe(true); expect(driver.frame).toBe(0);
    scene.game.damage(driver.actor.id, base, null, 100, 0, zero, zero, zero, 1);
    expect(scene.game.counters.killedMonsters).toBe(1); expect(driver.teamMaster).toBeNull();
    expect(scene.game.pushTeam(base.actor.id)).toHaveLength(2);
    scene.actors.close();
  });
});
