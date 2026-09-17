import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../src/content/q2/foundation/runtime.ts";
import { createQ2TargetModule } from "../../../src/content/q2/foundation/targets.ts";
import { createQ2ItemModule } from "../../../src/content/q2/foundation/items.ts";
import { Q2Weapons } from "../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2FoundationHost } from "../../../src/content/q2/foundation/host.ts";
import type { Q2PlayerHooks, Q2PlayerMovement } from "../../../src/content/q2/base/player/index.ts";
import { Q2CharacterActor } from "../../../src/content/q2/base/player/index.ts";
import type { Q2CharacterHost } from "../../../src/content/q2/base/player/index.ts";
import { Q2RereleasePlayers, createQ2RereleaseModule } from "../../../src/content/q2/rerelease/index.ts";
import type { Q2RereleaseEvent, Q2RereleaseHooks } from "../../../src/content/q2/rerelease/index.ts";
import { decodeQ2PlayersCheckpoint, encodeQ2PlayersCheckpoint, decodeQ2CharacterCheckpoint, encodeQ2CharacterCheckpoint } from "../../../src/persistence/q2-players.ts";
import { decodeQ2RereleasePlayersCheckpoint, encodeQ2RereleasePlayersCheckpoint, decodeQ2RereleaseModuleCheckpoint, encodeQ2RereleaseModuleCheckpoint } from "../../../src/persistence/q2-rerelease-state.ts";
import { killQ2RereleaseBox } from "../../../src/content/q2/rerelease/killbox.ts";
import { q2WorldText } from "../../../src/content/q2/rerelease/world-text.ts";
import { SharedPickupAdmission } from "../../../src/world/gameplay/pickups.ts";

function rerelease(initializeInventory = true, worldFields = "", startItems = "") {
  const actors = new SessionActorRegistry(createIdentityOwner("rr-source-check")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const inventory = new SharedInventoryTable(actors), combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const ids: ActorId[] = [], events: Q2RereleaseEvent[] = [], messages: string[] = [], transitions: string[] = [];
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
    persistentInventoryInitialized: (entity, game) => items.giveStartItems(entity.actor, game, startItems),
    weaponInput: () => ({ attack: false, latchedAttack: false, holster: false, angles: zero, ducked: false, spectator: false, notarget: false,
      hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false, instantSwitch: false,
      quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false }) };
  const rrHooks: Q2RereleaseHooks = { emit: event => { events.push(event); return undefined; }, lightStyle: () => "az", playerIdentity: actor => ({ seat: ids.indexOf(actor), socialId: "" }),
    clipTrigger: () => true, navigation: () => ({ kind: "no-navigation" }), monstersSearching: () => false, groundedOnWorld: () => true,
    pushPlayer: () => undefined, setActorGravity: () => undefined, setWorldGravity: () => undefined };
  const weapons = new Q2Weapons({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const items = createQ2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
  const players = new Q2RereleasePlayers(items, weapons, hooks, rrHooks), module = createQ2RereleaseModule({ players, hooks: rrHooks });
  const host: Q2FoundationHost = { actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => 0.025, random: () => 0.5,
    schedule: () => undefined, touchTriggers: () => undefined, keyConsumed: () => undefined,
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0,
      surface: null, sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 }, secondary: null }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [], players: () => ids, isPlayer: actor => ids.includes(actor), isMonster: () => false,
    worldActor: () => { const world = [...game.entities.values()].find(entity => entity.classname === "worldspawn"); if (world === undefined) throw new Error("world missing"); return world.actor.id; },
    inlineModelBounds: () => bounds, setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined,
    emit: event => { if (event.kind === "centerprint") messages.push(event.text); return undefined; }, playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }),
    prepareLevelChange: () => undefined, transition: intent => { if (intent.kind === "campaign-level") transitions.push(intent.map); return undefined; }, diagnostic: message => { throw new Error(message); } };
  const game = new Q2Foundation(host, { edition: "rerelease", mapName: "base1", skill: 1, mode: "coop", deathmatchFlags: 0, maxClients: 4,
    provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q2:movement" }, [module, players, createQ2TargetModule(), items]);
  game.load(`{ "classname" "worldspawn" ${worldFields} } { "classname" "info_player_start" }`);
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
  return { game, players, module, items, events, messages, transitions, first, second, movement, movements, combat, inventory, advance(value: number) { now = value; } };
}

test("rerelease world text emits authored orientation, refresh lifetime and trigger behavior", () => {
  const active = rerelease(), { game, first, events } = active;
  const label = game.spawn({ classname: "info_world_text", ordinal: 10, values: new Map([
    ["message", "Door\nAbove"], ["angle", "-3"], ["sounds", "1"], ["spawnflags", "1"], ["target", "label-target"],
  ]) });
  const target = game.spawn({ classname: "trigger_relay", ordinal: 11, values: new Map([["targetname", "label-target"]]) });
  let used = 0;
  target.use = (_entity, _services, other, activator) => { expect(other).toBe(label.actor.id); expect(activator).toBe(label.actor.id); used++; return undefined; };
  expect(label.nextThink).toBeNull(); expect(events.filter(event => event.kind === "world-text")).toHaveLength(0);
  label.use?.(label, game, first.actor.id, first.actor.id);
  const draw = events.find(event => event.kind === "world-text");
  if (draw === undefined || draw.kind !== "world-text") throw new Error("world text event missing");
  expect(draw.text).toMatchObject({ text: "Door\nAbove", cellSize: 1.6, color: { x: 1, y: 0, z: 0, w: 1 }, orientation: { kind: "billboard" }, depthTest: true, font: "classic" });
  expect(draw.lifetime).toBe(0.025); expect(label.nextThink).toBe(0.025); expect(used).toBe(1);
  active.advance(0.025); label.think?.(label, game);
  expect(events.filter(event => event.kind === "world-text")).toHaveLength(2); expect(label.nextThink).toBe(0.05);
  label.use?.(label, game, first.actor.id, first.actor.id);
  expect(label.nextThink).toBeNull(); expect(label.activator).toBeNull(); expect(used).toBe(2);
  expect(game.sourceCallbacks.think.name(label.think)).toBe("rr.info_world_text_think");
  expect(game.sourceCallbacks.use.name(label.use)).toBe("rr.info_world_text_use");

  const fixed = game.spawn({ classname: "info_world_text", ordinal: 12, values: new Map([
    ["message", "Fixed"], ["angle", "90"], ["radius", "0.5"], ["spawnflags", "3"],
  ]) });
  fixed.use?.(fixed, game, first.actor.id, first.actor.id);
  expect(fixed.use).toBeNull();
  const last = events.at(-1);
  if (last?.kind !== "world-text") throw new Error("fixed world text event missing");
  expect(last.text.orientation).toEqual({ kind: "fixed", angles: { x: 0, y: 270, z: 0 } }); expect(last.text.cellSize).toBe(4);
  const removed = game.spawn({ classname: "info_world_text", ordinal: 13, values: new Map([["message", "Once"], ["spawnflags", "5"]]) });
  removed.use?.(removed, game, first.actor.id, first.actor.id); expect(game.entity(removed.actor.id)).toBeNull();
});

test("Q2 world text adapter preserves byte glyph truncation and copies source vectors", () => {
  const origin = { x: 1, y: 2, z: 3 }, angles = { x: 0, y: 90, z: 0 };
  const text = q2WorldText({ origin, angles, text: "\u0141" + "b".repeat(140), color: { x: 1, y: 1, z: 1, w: 1 }, size: 0.2, depthTest: false });
  origin.x = 99; angles.y = 180;
  expect(text.text).toBe("A" + "b".repeat(126)); expect(text.origin.x).toBe(1);
  expect(text.orientation).toEqual({ kind: "fixed", angles: { x: 0, y: 90, z: 0 } }); expect(text.depthTest).toBe(false);
});

test("rerelease liquid damage remains 10 Hz with 40 Hz source frames", () => {
  const active = rerelease(), { first, players, game } = active;
  active.movements.set(first.actor.id, { ...active.movement(first.actor.id), waterLevel: 1, waterType: 8 });
  active.advance(1); players.endFrame(first, game);
  active.advance(1.025); players.endFrame(first, game);
  active.advance(1.075); players.endFrame(first, game);
  expect(active.combat.read(first.actor.id)?.health).toBe(97);
  active.advance(1.1); players.endFrame(first, game);
  expect(active.combat.read(first.actor.id)?.health).toBe(94);
});

test("rerelease pickups and fog preserve independent split players", () => {
  const active = rerelease(), { game, first, second, items, module, players } = active;
  const ammo = game.spawn({ classname: "ammo_shells", ordinal: 2, values: new Map([["message", "per player pickup"]]) });
  ammo.think?.(ammo, game);
  const before = { source: module.capture(), inventory: active.inventory.entries(first.actor.id), message: ammo.message, events: [...active.events] };
  expect(items.observeSupply(game, ammo.actor.id, first.actor.id)?.availability).toEqual({ kind: "ready", eligible: true });
  expect({ source: module.capture(), inventory: active.inventory.entries(first.actor.id), message: ammo.message, events: [...active.events] }).toEqual(before);
  items.touch(ammo, game, first.actor.id);
  expect(items.observeSupply(game, ammo.actor.id, first.actor.id)?.availability).toEqual({ kind: "ready", eligible: false });
  expect(items.observeSupply(game, ammo.actor.id, second.actor.id)?.availability).toEqual({ kind: "ready", eligible: true });
  expect(ammo.message).toBe("per player pickup");
  items.touch(ammo, game, first.actor.id); items.touch(ammo, game, second.actor.id);
  expect(active.inventory.count(first.actor.id, "q2:ammo_shells")).toBe(10);
  expect(active.inventory.count(second.actor.id, "q2:ammo_shells")).toBe(10);
  expect(game.entity(ammo.actor.id)).toBe(ammo);
  expect(active.messages).toEqual(["per player pickup", "per player pickup"]);
  const saved = decodeQ2RereleaseModuleCheckpoint(encodeQ2RereleaseModuleCheckpoint(module.capture()));
  active.events.length = 0;
  module.restore(game, saved);
  expect(active.events.filter(event => event.kind === "item-visibility")).toEqual([
    { kind: "item-visibility", actor: first.actor.id, item: ammo.actor.id, visible: false },
    { kind: "item-visibility", actor: second.actor.id, item: ammo.actor.id, visible: false },
  ]);
  const fog = game.spawn({ classname: "trigger_fog", ordinal: 3, values: new Map([["spawnflags", "9"], ["fog_density", "0.6"], ["fog_color", "0.2 0.3 0.4"]]) });
  fog.touch?.(fog, game, { self: fog.actor, other: first.actor.id, plane: null, surface: null });
  module.forceFog(first.actor.id, false);
  expect(players.extra(first.actor.id).fog.fog.density).toBe(0.6);
  expect(players.extra(second.actor.id).fog.fog.density).toBe(0);
  const events = active.events.filter(event => event.kind === "fog");
  expect(events).toHaveLength(1);
});

test("rerelease named callbacks and player source save restore into a fresh runtime", () => {
  const active = rerelease();
  const target = active.game.spawn({ classname: "target_story", ordinal: 2, values: new Map([["message", "Strogg transmission"]]) });
  target.use?.(target, active.game, null, active.first.actor.id);
  active.players.context(active.first, active.game).state.nextDrownTime = 14.5;
  active.players.context(active.first, active.game).state.damagePowerArmor = 3;
  active.players.extra(active.first.actor.id).invisibilityUntil = 30.25;
  active.players.extra(active.first.actor.id).invisibilityFadeUntil = 2.4;
  const foundation = active.game.capture(), items = active.items.capture(active.game), player = decodeQ2PlayersCheckpoint(encodeQ2PlayersCheckpoint(active.players.capture()));
  const extras = decodeQ2RereleasePlayersCheckpoint(encodeQ2RereleasePlayersCheckpoint(active.players.captureRerelease()));
  const module = decodeQ2RereleaseModuleCheckpoint(encodeQ2RereleaseModuleCheckpoint(active.module.capture()));
  const restored = rerelease(false);
  restored.game.spawn({ classname: "target_story", ordinal: 2, values: new Map([["message", "Strogg transmission"]]) });
  restored.game.restore(foundation); restored.items.restore(restored.game, items); restored.players.restore(restored.game, player);
  restored.players.restoreRerelease(restored.game, extras); restored.module.restore(restored.game, module);
  expect(restored.players.context(restored.first, restored.game).state.nextDrownTime).toBe(14.5);
  expect(restored.players.context(restored.first, restored.game).state.damagePowerArmor).toBe(3);
  expect(restored.players.extra(restored.first.actor.id).invisibilityUntil).toBe(30.25);
  expect(restored.players.extra(restored.first.actor.id).invisibilityFadeUntil).toBe(2.4);
  expect(restored.players.extra(restored.second.actor.id).invisibilityUntil).toBe(0);
  expect(restored.module.story).toBe("Strogg transmission");
  expect(foundation.entities.find(entity => entity.spawn.classname === "target_story")?.callbacks.use).toBe("rr.use_target_story");
});

test("rerelease invisibility checkpoint deadlines must be finite", () => {
  const active = rerelease();
  for (const field of ["invisibilityUntil", "invisibilityFadeUntil"]) {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      const checkpoint = active.players.captureRerelease();
      const malformed = { ...checkpoint, players: checkpoint.players.map(entry => ({ ...entry, state: { ...entry.state, [field]: invalid } })) };
      expect(() => decodeQ2RereleasePlayersCheckpoint(encodeQ2RereleasePlayersCheckpoint(malformed))).toThrow("expected a finite number");
    }
  }
});

test("rerelease healthbar expiry clears both seats and preserves the source deadline", () => {
  const active = rerelease(), { game, module, first, second } = active;
  const controller = game.spawn({ classname: "target_story", ordinal: 2, values: new Map([["message", "Boss"], ["delay", "1"]]) });
  module.healthBars[0] = { controller: controller.actor.id, target: first.actor.id, deadUntil: null };
  module.transferHealthbarTarget(first.actor.id, second.actor.id, game);
  expect(controller.enemy).toBe(second.actor.id);
  expect(module.healthBars[0]?.target).toBe(second.actor.id);
  module.transferHealthbarTarget(second.actor.id, first.actor.id, game);
  active.combat.setHealth(first.actor, 0);
  active.advance(1); module.endPlayerFrame(first, game); module.endPlayerFrame(second, game);
  active.advance(2); module.endPlayerFrame(first, game);
  expect(module.healthBars[0]?.deadUntil).toBe(2);
  expect(active.events.filter(event => event.kind === "healthbar" && event.visible).length).toBe(3);
  active.advance(2.025); module.endPlayerFrame(first, game); module.endPlayerFrame(second, game);
  expect(module.healthBars[0]).toBeNull();
  expect(active.events.flatMap(event => event.kind === "healthbar" && !event.visible ? [event.actor] : [])).toEqual([first.actor.id, second.actor.id]);
});

test("rerelease changelevel retains inventory-clear and fade flags until source travel", () => {
  const active = rerelease(), { game, players, first } = active;
  const exit = game.spawn({ classname: "target_changelevel", ordinal: 2, values: new Map([["map", "*base2"], ["spawnflags", "120"]]) });
  active.inventory.configure(first.actor, { item: "q2:ammo_shells", count: 20, capacity: 100 });
  game.counters.serverFlags = 0xffffffff;
  active.advance(1); exit.use?.(exit, game, first.actor.id, first.actor.id);
  expect(players.intermission).toMatchObject({ kind: "intermission", map: "*base2", exit: true });
  expect(game.counters.serverFlags).toBe(0xff00);
  expect(active.events.filter(event => event.kind === "end-of-unit")).toHaveLength(0);
  players.checkRules(game);
  expect(players.intermissionFadeUntil).toBe(2.3);
  active.advance(1.5); players.fadeFrame(game);
  expect(active.events.filter(event => event.kind === "screen-blend").map(event => event.blend.w)).toEqual([0.5000000000000002, 0.5000000000000002]);
  active.advance(2.275); players.checkRules(game);
  expect(active.transitions).toHaveLength(0);
  expect(active.inventory.count(first.actor.id, "q2:ammo_shells")).toBe(20);
  active.advance(2.3); players.checkRules(game);
  expect(active.transitions).toEqual(["q2:base2"]);
  expect(active.inventory.count(first.actor.id, "q2:ammo_shells")).toBe(0);
  expect(active.combat.read(first.actor.id)?.health).toBe(0);
  const carry = players.saveCarry(first, game), fresh = rerelease();
  fresh.players.restoreCarry(fresh.first, fresh.game, carry);
  expect(fresh.combat.read(fresh.first.actor.id)?.health).toBe(100);
  expect(fresh.inventory.count(fresh.first.actor.id, "q2:weapon_blaster")).toBe(1);
  expect(fresh.inventory.count(fresh.first.actor.id, "q2:ammo_shells")).toBe(0);
});

test("rerelease mission notifications keep per-seat latches and Quake 64 goal order", () => {
  const active = rerelease(), { game, module, players, first, second } = active;
  const help = game.spawn({ classname: "target_help", ordinal: 2, values: new Map([["message", "Disable the generator"], ["spawnflags", "3"], ["origin", "48 0 0"]]) });
  help.use?.(help, game, null, first.actor.id);
  help.use?.(help, game, null, first.actor.id);
  expect(module.campaign.mission.primaryChanges).toBe(1);
  expect(module.poi?.origin.x).toBe(48);
  active.advance(0.275); players.endFrame(first, game);
  expect(active.events.filter(event => event.kind === "mission-objective")).toHaveLength(0);
  active.advance(0.3); players.endFrame(first, game); players.endFrame(second, game); players.endFrame(first, game);
  expect(active.events.filter(event => event.kind === "mission-objective").map(event => event.actor)).toEqual([first.actor.id, second.actor.id]);
  players.clientCommand(first, game, "help", []);
  expect(players.extra(first.actor.id).helpChanged).toBe(0);
  expect(players.extra(second.actor.id).helpChanged).toBe(1);
  const q64 = rerelease(true, '"goals" "Find the commander\tDestroy the gate"');
  q64.advance(0.3); q64.players.endFrame(q64.first, q64.game);
  const goal = q64.game.spawn({ classname: "target_goal", ordinal: 2, values: new Map([["spawnflags", "1"]]) });
  goal.use?.(goal, q64.game, null, q64.first.actor.id);
  expect(q64.module.campaign.mission.primary).toBe("Destroy the gate");
  expect(q64.game.counters.foundGoals).toBe(1);
  expect(q64.events.flatMap(event => event.kind === "mission-objective" && event.actor === q64.first.actor.id ? [event.text] : [])).toEqual(["Find the commander", "Destroy the gate"]);
});

test("Q64 moving scenery and camera use shared bodies and the source scheduler", () => {
  const active = rerelease(), { game, module, first, second } = active;
  const spinning = game.spawn({ classname: "func_spinning", ordinal: 2, values: new Map([["accel", "5"], ["decel", "20"]]) });
  active.advance(0.025); spinning.think?.(spinning, game);
  expect(spinning.angularVelocity).toEqual({ x: 5, y: 5, z: 5 });
  expect(spinning.motion).toBe("push");
  const eye = game.spawn({ classname: "func_eye", ordinal: 3, values: new Map([["target", "eye-story"]]) });
  game.spawn({ classname: "target_story", ordinal: 4, values: new Map([["targetname", "eye-story"], ["message", "Player spotted"]]) });
  game.move(first, { origin: { x: 128, y: 128, z: 0 } }); game.move(second, { origin: { x: -128, y: 0, z: 0 } });
  active.advance(0.1); eye.think?.(eye, game);
  expect(eye.enemy).toBe(first.actor.id); expect(eye.frame).toBe(2); expect(module.story).toBe("Player spotted");
  expect(game.body(eye).angles.y).toBeCloseTo(1.12, 2);
  const corner = game.create("path_corner", new Map([["targetname", "camera-end"], ["origin", "108 0 32"]]));
  const camera = game.spawn({ classname: "target_camera", ordinal: 5, values: new Map([["target", "camera-end"], ["origin", "100 0 32"], ["speed", "100"]]) });
  camera.use?.(camera, game, null, first.actor.id);
  const dummy = game.entity(camera.enemy);
  expect(dummy?.owner).toBe(first.actor.id); expect(game.body(first).origin).toEqual({ x: 100, y: 0, z: 32 });
  expect(camera.goal).toBe(corner.actor.id);
  active.advance(0.125); camera.think?.(camera, game);
  expect(game.body(first).origin).toEqual({ x: 102, y: 0, z: 32 }); expect(game.body(second).origin).toEqual(game.body(first).origin);
  expect(module.q64.capture().cameras[0]?.state.remaining).toBe(6);
  game.spawn({ classname: "target_story", ordinal: 6, values: new Map([["targetname", "blue-light"], ["rgba", "0 0 1"]]) });
  const light = game.spawn({ classname: "target_light", ordinal: 7, values: new Map([["target", "blue-light"], ["rgba", "1 0 0"], ["speed", "0.2"], ["spawnflags", "1"], ["radius", "64"]]) });
  light.think?.(light, game);
  expect(light.skin >>> 0).toBe(0x7f007f00); expect(light.nextThink).toBe(0.225);
  expect(active.events.flatMap(event => event.kind === "dynamic-light" && event.actor === light.actor.id ? [event.radius] : [])).toEqual([64, 64, 64]);
  const checkpoint = decodeQ2RereleaseModuleCheckpoint(encodeQ2RereleaseModuleCheckpoint(module.capture()));
  module.restore(game, checkpoint);
  expect(module.q64.capture()).toEqual(checkpoint.q64);
});

test("rerelease cooperative telefrag overlap protects both shared players", () => {
  const active = rerelease(), { first, second, game, players } = active;
  players.rereleaseOptions.coopPlayerCollision = true;
  game.solid(first, "box"); game.solid(second, "box"); game.link(first); game.link(second);
  first.clipMask = 0x42010003; second.clipMask = 0x42010003;
  expect(killQ2RereleaseBox(first, game, players, true, true)).toBe(true);
  expect(active.combat.read(first.actor.id)?.health).toBe(100); expect(active.combat.read(second.actor.id)?.health).toBe(100);
  expect(first.clipMask & 0x40000000).toBe(0); expect(second.clipMask & 0x40000000).toBe(0);
  game.move(second, { origin: { x: 100, y: 0, z: 0 } }); players.endFrame(first, game);
  expect(first.clipMask & 0x40000000).toBe(0x40000000);
  active.inventory.configure(first.actor, { item: "q2:key_data_cd", count: 1, capacity: 1 });
  players.clientCommand(first, game, "drop", ["Data CD"]);
  expect(active.inventory.count(first.actor.id, "q2:key_data_cd")).toBe(0);
});

test("detached Q2 character private state survives checked bytes without changing shared inventory or body", () => {
  const active = rerelease(), { first, game } = active;
  const host: Q2CharacterHost = { bodies: game.host.bodies, combat: game.host.combat, inventory: game.host.inventory,
    now: () => 10, random: () => 0.5, movement: active.movement, pointContents: () => 0, powerups: actor => active.items.playerPowerups(actor),
    weapon: () => null, emit: () => undefined, view: () => undefined, noise: () => undefined, environmentDamage: () => undefined,
    died: () => undefined, requestRespawn: () => undefined, motion: () => undefined, spawnGib: () => undefined };
  const options = { model: "players/male/tris.md2", skin: 0, slot: 0, deathmatchFlags: 0, environment: false };
  const firstController = new Q2CharacterActor(first.actor, host, { ...options, mode: "singleplayer" });
  firstController.state.damageBlood = 12; firstController.state.nextDrownTime = 11; firstController.state.latchedButtons = 1; firstController.setAnimation("pain", 54, 57);
  const checkpoint = decodeQ2CharacterCheckpoint(encodeQ2CharacterCheckpoint(firstController.capture()));
  const inventory = active.inventory.entries(first.actor.id), body = game.body(first);
  const restored = new Q2CharacterActor(first.actor, host, { ...options, mode: "singleplayer" });
  restored.restore(checkpoint, actor => game.host.actors.referenceSaved(actor));
  expect(restored.capture()).toEqual(checkpoint);
  expect(game.body(first)).toEqual(body);
  expect(active.inventory.entries(first.actor.id)).toEqual(inventory);
});

test("flashlight presentation follows source hand and suppresses death/intermission without clearing carried state", () => {
  const { players, module, game, first, combat, events } = rerelease();
  const state = players.states.get(first.actor.id);
  if (state === undefined) throw new Error("Missing source player");
  state.hand = "left";
  module.toggleFlashlight(first.actor.id, game, true);
  expect(events.at(-1)).toEqual({ kind: "flashlight", actor: first.actor.id, enabled: true, hand: "left" });
  combat.setHealth(first.actor, 0);
  players.emitFlashlight(first.actor.id, game);
  expect(events.at(-1)).toMatchObject({ enabled: false });
  expect(players.extra(first.actor.id).flashlight).toBe(true);
  combat.setHealth(first.actor, 100);
  players.intermission = { kind: "intermission", map: "base2", started: 0, exit: false, landmark: null };
  players.emitFlashlight(first.actor.id, game);
  expect(events.at(-1)).toMatchObject({ enabled: false });
  players.intermission = { kind: "playing" }; state.hand = "center";
  module.spawned(first, game);
  expect(events.at(-1)).toEqual({ kind: "flashlight", actor: first.actor.id, enabled: true, hand: "center" });
  module.toggleFlashlight(first.actor.id, game, false);
  expect(events.at(-1)).toMatchObject({ enabled: false });
  expect(players.extra(first.actor.id).flashlight).toBe(false);
});

test("authored starting items use native pickups, explicit ammo counts and zero removal without leaked temporary entities", () => {
  const { game, items, first, inventory } = rerelease();
  const before = game.entities.size;
  items.giveStartItems(first.actor, game, "weapon_shotgun;ammo_shells 20;key_data_cd");
  expect(inventory.count(first.actor.id, "q2:weapon_shotgun")).toBe(1);
  expect(inventory.count(first.actor.id, "q2:ammo_shells")).toBeGreaterThanOrEqual(20);
  expect(inventory.count(first.actor.id, "q2:key_data_cd")).toBe(1);
  expect(game.entities.size).toBe(before);
  items.giveStartItems(first.actor, game, "weapon_shotgun 0;ammo_shells 0;key_data_cd 0");
  expect(inventory.count(first.actor.id, "q2:weapon_shotgun")).toBe(0);
  expect(inventory.count(first.actor.id, "q2:ammo_shells")).toBe(0);
  expect(inventory.count(first.actor.id, "q2:key_data_cd")).toBe(0);
  expect(() => items.giveStartItems(first.actor, game, "key_data_cd;not_an_item")).toThrow("Invalid Q2 starting item");
  expect(inventory.count(first.actor.id, "q2:key_data_cd")).toBe(0);
});

test("restored campaign presentation preserves marker deadline and help visibility without replaying compass callbacks", () => {
  const active = rerelease(), { game, first, module, players, events } = active;
  const state = players.states.get(first.actor.id); if (state === undefined) throw new Error("Missing player state");
  state.showHelp = true; module.campaign.mission.primary = "Open the gate";
  active.advance(2); module.sendPoi(first.actor.id, game);
  const saved = decodeQ2RereleasePlayersCheckpoint(encodeQ2RereleasePlayersCheckpoint(players.captureRerelease()));
  expect(saved.players.find(entry => entry.actor.slot === first.actor.id.slot)?.state.helpMarkerUntil).toBe(12);
  events.length = 0; active.advance(5); module.resumePresentation(game, first.actor.id);
  expect(events.find(event => event.kind === "poi")).toMatchObject({ duration: 7000 });
  expect(events.find(event => event.kind === "help-computer")).toMatchObject({ visible: true, primary: "Open the gate" });
  events.length = 0; active.advance(13); module.resumePresentation(game, first.actor.id);
  expect(events.some(event => event.kind === "poi" || event.kind === "help-path")).toBe(false);
  const campaign = structuredClone(module.campaign); campaign.crossUnitFlags = 123;
  module.restoreCampaign(campaign); campaign.mission.primary = "mutated caller";
  expect(module.campaign.crossUnitFlags).toBe(123);
  expect(module.campaign.mission.primary).toBe("Open the gate");
});

test("authored Q2 grants and removals preserve selected foreign arsenal mapping", () => {
  const { game, items, first, inventory } = rerelease();
  inventory.configure(first.actor, { item: "q3:weapon/shotgun", count: 0, capacity: 1 });
  inventory.configure(first.actor, { item: "q3:ammo/shells", count: 0, capacity: 200 });
  inventory.configure(first.actor, { item: "q3:weapon/grenadelauncher", count: 0, capacity: 1 });
  inventory.configure(first.actor, { item: "q3:ammo/grenades", count: 0, capacity: 200 });
  items.setPickupAdmission(new SharedPickupAdmission({ inventory, profile: { id: "q3:fixture", weaponOwnership: "all-destinations",
    ammo: [{ source: "q2:ammo_shells", destinations: ["q3:ammo/shells"] }, { source: "q2:ammo_grenades", destinations: ["q3:ammo/grenades"] }],
    weapons: [{ source: "q2:weapon_shotgun", destinations: ["q3:weapon/shotgun"] }, { source: "q2:ammo_grenades", destinations: ["q3:weapon/grenadelauncher"] }] },
    ammoGranted: () => undefined, weaponGranted: () => undefined }));
  items.giveStartItems(first.actor, game, "weapon_shotgun;ammo_shells 20");
  expect(inventory.count(first.actor.id, "q3:weapon/shotgun")).toBe(1);
  expect(inventory.count(first.actor.id, "q3:ammo/shells")).toBeGreaterThanOrEqual(20);
  expect(inventory.count(first.actor.id, "q2:weapon_shotgun")).toBe(0);
  items.giveStartItems(first.actor, game, "weapon_shotgun 0;ammo_shells 0");
  expect(inventory.count(first.actor.id, "q3:weapon/shotgun")).toBe(0);
  expect(inventory.count(first.actor.id, "q3:ammo/shells")).toBe(0);
  items.giveStartItems(first.actor, game, "weapon_blaster 0;ammo_grenades 200");
  expect(inventory.count(first.actor.id, "q3:weapon/grenadelauncher")).toBe(1);
  expect(inventory.count(first.actor.id, "q3:ammo/grenades")).toBe(200);
  items.giveStartItems(first.actor, game, "ammo_grenades 0");
  expect(inventory.count(first.actor.id, "q3:weapon/grenadelauncher")).toBe(0);
  expect(inventory.count(first.actor.id, "q3:ammo/grenades")).toBe(0);
});

test("dead carry rebuilds native starting inventory once while living travel retains its current count", () => {
  const { game, items, first, players, inventory } = rerelease(true, "", "ammo_shells 20");
  items.giveStartItems(first.actor, game, "ammo_shells 7");
  const living = players.saveCarry(first, game);
  players.restoreCarry(first, game, living);
  expect(inventory.count(first.actor.id, "q2:ammo_shells")).toBe(7);
  players.restoreCarry(first, game, { ...living, health: 0 });
  expect(inventory.count(first.actor.id, "q2:ammo_shells")).toBe(20);
});
