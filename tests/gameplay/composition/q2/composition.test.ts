import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2Weapons } from "../../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2FoundationHost } from "../../../../src/content/q2/foundation/host.ts";
import type { Q2PlayerHooks, Q2PlayerMovement } from "../../../../src/content/q2/base/player/index.ts";
import type { Q2RereleaseEvent, Q2RereleaseHooks } from "../../../../src/content/q2/rerelease/index.ts";

import { createQ2ProductRuntime, captureQ2Product, restoreQ2Product } from "../../../../src/content/composition/q2/index.ts";
import { loadApplicationContent } from "../../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../../src/app/bootstrap/options.ts";
import type { Q2MatchSelection } from "../../../../src/content/composition/q2/index.ts";
import { Q2Tag } from "../../../../src/content/q2/missionpacks/modes/index.ts";
function compose(initializeInventory = true, entities = '{ "classname" "worldspawn" } { "classname" "info_player_start" }', match: Q2MatchSelection = { kind: "standard" }) {
  const actors = new SessionActorRegistry(createIdentityOwner("rr-source-check")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const inventory = new SharedInventoryTable(actors), combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const ids: ActorId[] = [], events: Q2RereleaseEvent[] = [], messages: string[] = [];
  const zero = { x: 0, y: 0, z: 0 }, bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
  const movements = new Map<ActorId, Q2PlayerMovement>();
  let now = 0;
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64", q2: { product: "rerelease", ctf: false, alive: true } })),
    context: () => ({ arithmetic: "binary64", player: true, monster: false, attackerPlayer: false, hasEnemy: false, easySkill: false,
      deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false, nuke: false, noKnockback: true, movable: true, rejectTeamDamage: false, suppressPain: false }) }));
  const movement = (actor: ActorId): Q2PlayerMovement => {
    const value = movements.get(actor); if (value === undefined) throw new Error("missing player movement"); return value;
  };
  const hooks: Q2PlayerHooks = { movement, setMovement: () => undefined, emit: () => undefined, noise: () => undefined, banned: () => false,
    weaponInput: () => ({ attack: false, latchedAttack: false, holster: false, angles: zero, ducked: false, spectator: false, notarget: false,
      hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false, instantSwitch: false,
      quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false }) };
  const rrHooks: Q2RereleaseHooks = { emit: event => { events.push(event); return undefined; }, playerIdentity: actor => ({ seat: ids.indexOf(actor), socialId: "" }),
    clipTrigger: () => true, navigation: () => ({ kind: "no-navigation" }), monstersSearching: () => false, groundedOnWorld: () => true,
    pushPlayer: () => undefined, setActorGravity: () => undefined, setWorldGravity: () => undefined, lightStyle: () => "m" };
  const weapons = new Q2Weapons({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const host: Q2FoundationHost = { actors, callbacks, bodies, combat, inventory, now: () => now, frameSeconds: () => 0.025, random: () => 0.5,
    schedule: () => undefined, touchTriggers: () => undefined, keyConsumed: () => undefined,
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0,
      surface: null, sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 }, secondary: null }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [], players: () => ids, isPlayer: actor => ids.includes(actor), isMonster: () => false,
    worldActor: () => { const world = [...game.entities.values()].find(entity => entity.classname === "worldspawn"); if (world === undefined) throw new Error("world missing"); return world.actor.id; },
    inlineModelBounds: () => bounds, setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined,
    emit: event => { if (event.kind === "centerprint") messages.push(event.text); return undefined; }, playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }),
    prepareLevelChange: () => undefined, transition: () => undefined, diagnostic: message => { throw new Error(message); } };
  const composition = createQ2ProductRuntime({ edition: "rerelease", program: "baseq2", host, weapons, match,
    options: { mapName: "base1", skill: 1, mode: match.kind === "standard" ? "coop" : "deathmatch", deathmatchFlags: 0, maxClients: 4,
      provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q2:movement" },
    playerHooks: hooks, itemHooks: { weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined },
    entityHooks: { playerPush: () => undefined, setActorGravity: () => undefined, localTime: () => ({hour: 12, minute: 0, second: 0}) },
    services: { gravity: () => 800, emit: () => undefined, hunterCamera: false, strongMines: false,
      foreignPowerups: () => ({quadUntil: 0, doubleUntil: 0, invulnerabilityUntil: 0}) }, rereleaseHooks: rrHooks });
  const { game, items } = composition, module = composition.rerelease?.entities, players = composition.rerelease?.players;
  if (module === undefined || players === undefined) throw new Error("rerelease composition missing");
  const report = game.load(entities);
  composition.afterSpawn();
  for (let slot = 0; slot < 2; slot++) {
    const actor = actors.allocateAtSource("q2:players", slot + 1, "q2:male"); ids.push(actor.id);
    bodies.create(actor, { origin: zero, angles: zero, velocity: zero, bounds, ground: null });
    movements.set(actor.id, { viewAngles: zero, commandAngles: zero, waterLevel: 0, waterType: 0, grounded: true, ducked: false, buttons: 0, standingBounds: bounds, animateQ2: false });
    const entity = game.attachPlayer(actor); players.attach(entity, game, { slot, userinfo: `\\name\\Player${slot}`, initializeInventory, useQ2Weapons: false });
  }
  const firstId = ids[0], secondId = ids[1];
  if (firstId === undefined || secondId === undefined) throw new Error("players missing");
  const first = game.entity(firstId), second = game.entity(secondId);
  if (first === null || second === null) throw new Error("source players missing");
  return { composition, report, game, players, module, items, events, messages, first, second, movement, movements, combat, inventory, advance(value: number) { now = value; } };
}

test("combined rerelease source preserves private seats, expansion powers and named entity saves", () => {
  const active = compose();
  expect(active.composition.weapons.definition("ionripper").name).toBe("ionripper");
  expect(active.composition.weapons.definition("disintegrator").name).toBe("disintegrator");
  expect(active.players.extra(active.first.actor.id).seat).toBe(0);
  expect(active.players.extra(active.second.actor.id).seat).toBe(1);
  const gekk = active.game.spawn({ classname: "monster_gekk", ordinal: 3, values: new Map<string, string>() });
  const stalker = active.game.spawn({ classname: "monster_stalker", ordinal: 4, values: new Map<string, string>() });
  const guardian = active.game.spawn({ classname: "monster_guardian", ordinal: 5, values: new Map<string, string>() });
  expect(active.composition.monsters.context(gekk.actor.id)?.state.kind).toBe("gekk");
  expect(active.composition.monsters.context(stalker.actor.id)?.state.kind).toBe("stalker");
  expect(active.composition.monsters.context(guardian.actor.id)?.state.kind).toBe("guardian");
  const target = active.game.spawn({ classname: "target_story", ordinal: 2, values: new Map([["message", "source private story"]]) });
  target.use?.(target, active.game, null, active.first.actor.id);
  active.inventory.configure(active.first.actor, { item: "q2:item_double", count: 1, capacity: 2 });
  active.items.use(active.first.actor, "q2:item_double", active.game);
  expect(active.composition.armory?.items.powerups(active.first.actor.id).doubleUntil).toBe(30);
  const checkpoint = captureQ2Product(active.composition);
  const restored = compose(false);
  restored.game.spawn({ classname: "monster_gekk", ordinal: 3, values: new Map<string, string>() });
  restored.game.spawn({ classname: "monster_stalker", ordinal: 4, values: new Map<string, string>() });
  restored.game.spawn({ classname: "monster_guardian", ordinal: 5, values: new Map<string, string>() });
  restored.game.spawn({ classname: "target_story", ordinal: 2, values: new Map([["message", "source private story"]]) });
  restoreQ2Product(restored.composition, checkpoint);
  expect(restored.module.story).toBe("source private story");
  expect(restored.composition.armory?.items.powerups(restored.first.actor.id).doubleUntil).toBe(30);
  expect(restored.composition.armory?.items.powerups(restored.second.actor.id).doubleUntil).toBe(0);
});

test("Tag source scoring transfers the live token before player death drops inventory", () => {
  const active = compose(true, undefined, { kind: "tag" }), source = active.composition.match.source;
  if (!(source instanceof Q2Tag)) throw new Error("Tag source not selected");
  const token = [...active.game.entities.values()].find(entity => entity.classname === "dm_tag_token");
  if (token === undefined) throw new Error("No source Tag token after map spawn");
  active.items.touch(token, active.game, active.first.actor.id);
  expect(source.ownerActor()).toBe(active.first.actor.id);
  active.first.lastAttack = active.game.attack(active.second, active.second.actor.id, 1, 0, null);
  active.players.recordDeath(active.first, active.game, { self: active.first.actor, attacker: active.second.actor.id, inflictor: active.second.actor.id, damage: 110, kick: 0, point: active.game.body(active.first).origin });
  expect(source.ownerActor()).toBe(active.second.actor.id);
  expect(active.players.states.get(active.second.actor.id)?.score).toBe(5);
  expect(active.composition.match.damage(active.first.actor.id, null, 100)).toBe(75);
});

test("retail rerelease base1 entities use the composed source registry", async () => {
  const parsed = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--movement", "q2", "--character", "q2", "--dedicated", "--mode", "coop"]);
  if (parsed.kind !== "run") throw new Error("No source launch");
  const content = await loadApplicationContent(parsed.options);
  try {
    const active = compose(true, content.world.entities);
    expect(active.report.unsupported).toEqual([]);
    expect(active.game.counters.totalMonsters).toBeGreaterThan(10);
    expect(active.players.states.size).toBe(2);
  } finally { await content.close(); }
}, 30000);
