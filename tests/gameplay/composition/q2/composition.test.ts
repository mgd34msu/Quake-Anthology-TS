import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { registerQ2ServerCvars, q2RereleaseItemServices } from "../../../../src/settings/server/q2-owner.ts";
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
import type { Q2CompositionServices, Q2MatchSelection } from "../../../../src/content/composition/q2/index.ts";
import { Q2Ctf } from "../../../../src/content/q2/multiplayer/ctf/index.ts";
import { Q2Lmctf } from "../../../../src/content/q2/multiplayer/lmctf/runtime.ts";
import { Q2Tag } from "../../../../src/content/q2/missionpacks/modes/index.ts";
function compose(initializeInventory = true, entities = '{ "classname" "worldspawn" } { "classname" "info_player_start" }', match: Q2MatchSelection = { kind: "standard" }, clientCount = 2, deathmatchFlags?: Q2CompositionServices["deathmatchFlags"], options: Pick<Q2CompositionServices, "randomItems" | "dropQuadFire"> = {}) {
  const actors = new SessionActorRegistry(createIdentityOwner("rr-source-check")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const inventory = new SharedInventoryTable(actors), combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const ids: ActorId[] = [], events: Q2RereleaseEvent[] = [], messages: string[] = [];
  const zero = { x: 0, y: 0, z: 0 }, bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
  const movements = new Map<ActorId, Q2PlayerMovement>();
  let now = 0;
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
  const host: Q2FoundationHost = { actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => 0.025, random: () => 0.5,
    schedule: () => undefined, touchTriggers: () => undefined, keyConsumed: () => undefined,
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: (match.kind === "ctf" || match.kind === "lmctf") && request.end.z === request.start.z - 128 ? request.start : request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0,
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
    services: { ...options, ...(deathmatchFlags === undefined ? {} : { deathmatchFlags }), gravity: () => 800, emit: () => undefined, hunterCamera: false, strongMines: false,
      foreignPowerups: () => ({quadUntil: 0, doubleUntil: 0, invulnerabilityUntil: 0}) }, rereleaseHooks: rrHooks });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", sourceEffects: composition.match.sourceEffects(composition.game), armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64", q2: { product: "rerelease", ctf: false, alive: true } })),
    context: () => ({ arithmetic: "binary64", player: true, monster: false, attackerPlayer: false, hasEnemy: false, easySkill: false,
      deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false, nuke: false, noKnockback: true, movable: true, rejectTeamDamage: false, suppressPain: false }) }));
  const { game, items } = composition, module = composition.rerelease?.entities, players = composition.rerelease?.players;
  if (module === undefined || players === undefined) throw new Error("rerelease composition missing");
  const report = game.load(entities);
  composition.afterSpawn();
  for (let slot = 0; slot < clientCount; slot++) {
    const actor = actors.allocateAtSource("q2:players", slot + 1, "q2:male"); ids.push(actor.id);
    bodies.create(actor, { origin: zero, angles: zero, velocity: zero, bounds, ground: null });
    movements.set(actor.id, { viewAngles: zero, commandAngles: zero, waterLevel: 0, waterType: 0, grounded: true, ducked: false, buttons: 0, standingBounds: bounds, animateQ2: false });
    if (match.kind === "ctf" || match.kind === "lmctf") composition.admit(actor, { slot, userinfo: `\\name\\Player${slot}`, initializeInventory, useQ2Weapons: false });
    else { const entity = game.attachPlayer(actor); players.attach(entity, game, { slot, userinfo: `\\name\\Player${slot}`, initializeInventory, useQ2Weapons: false }); }
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
  active.players.recordDeath(active.first, active.game, { attack: null, self: active.first.actor, attacker: active.second.actor.id, inflictor: active.second.actor.id, damage: 110, kick: 0, point: active.game.body(active.first).origin });
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

const ctfMap = '{ "classname" "worldspawn" } { "classname" "info_player_start" } { "classname" "info_player_deathmatch" "origin" "400 0 0" } { "classname" "info_player_team1" "origin" "-400 0 0" } { "classname" "info_player_team2" "origin" "400 0 0" } { "classname" "item_flag_team1" "origin" "-500 0 0" } { "classname" "item_flag_team2" "origin" "500 0 0" }';

test("CTF composes shared admission, team commands, source flag capture and checkpoint", () => {
  const active = compose(true, ctfMap, { kind: "ctf" }), mode = active.composition.match.source;
  if (!(mode instanceof Q2Ctf)) throw new Error("Missing CTF mode");
  expect(active.report.unsupported).toEqual([]);
  expect(active.players.states.get(active.first.actor.id)?.spectator).toBe(true);
  expect(active.players.clientCommand(active.first, active.game, "team", ["red"])).toBe(true);
  expect(active.players.clientCommand(active.second, active.game, "team", ["blue"])).toBe(true);
  expect(active.game.body(active.first).origin.x).toBe(-400);
  const red = [...active.game.entities.values()].find(entity => entity.classname === "item_flag_team1"), blue = [...active.game.entities.values()].find(entity => entity.classname === "item_flag_team2");
  if (red === undefined || blue === undefined) throw new Error("Missing CTF flags");
  red.think?.(red, active.game); blue.think?.(blue, active.game);
  blue.touch?.(blue, active.game, { self: blue.actor, other: active.first.actor.id, plane: null, surface: null });
  expect(active.inventory.count(active.first.actor.id, "q2:item_flag_team2")).toBe(1);
  red.touch?.(red, active.game, { self: red.actor, other: active.first.actor.id, plane: null, surface: null });
  expect(mode.context.match.team1).toBe(1);
  const checkpoint = captureQ2Product(active.composition);
  const restored = compose(false, ctfMap, { kind: "ctf" });
  restoreQ2Product(restored.composition, checkpoint);
  const restoredMode = restored.composition.match.source;
  if (!(restoredMode instanceof Q2Ctf)) throw new Error("Missing restored CTF mode");
  expect(restoredMode.context.match.team1).toBe(1);
  expect(restoredMode.states.get(restored.first.actor.id)?.team).toBe(1);
});

test("LMCTF composes team admission, flag capture and checkpoint", () => {
  const active = compose(true, ctfMap, { kind: "lmctf" }), mode = active.composition.match.source;
  if (!(mode instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  expect(active.report.unsupported).toEqual([]);
  expect(mode.states.get(active.first.actor.id)?.team).toBe(1);
  expect(mode.states.get(active.second.actor.id)?.team).toBe(2);
  const red = mode.flags.flag(1, active.game), blue = mode.flags.flag(2, active.game);
  if (red === null || blue === null) throw new Error("Missing LMCTF flags");
  mode.flags.pickup(blue, active.game, active.first.actor.id);
  expect(mode.flags.carried(active.first.actor.id, active.game)).not.toBeNull();
  mode.flags.pickup(red, active.game, active.first.actor.id);
  expect(mode.states.get(active.first.actor.id)?.statistics.get("captures")).toBe(1);
  const checkpoint = captureQ2Product(active.composition);
  const restored = compose(false, ctfMap, { kind: "lmctf" });
  restoreQ2Product(restored.composition, checkpoint);
  const restoredMode = restored.composition.match.source;
  if (!(restoredMode instanceof Q2Lmctf)) throw new Error("Missing restored LMCTF mode");
  expect(restoredMode.states.get(restored.first.actor.id)?.statistics.get("captures")).toBe(1);
  expect(restoredMode.flags.flag(1, restored.game)).not.toBeNull();
});

test("CTF strength and resistance execute at native shared armor stages", () => {
  const active = compose(true, ctfMap, { kind: "ctf" });
  active.players.clientCommand(active.first, active.game, "team", ["red"]);
  active.players.clientCommand(active.second, active.game, "team", ["blue"]);
  active.inventory.configure(active.first.actor, { item: "q2:item_tech2", count: 1, capacity: 1 });
  active.inventory.configure(active.second.actor, { item: "q2:item_tech1", count: 1, capacity: 1 });
  active.combat.setArmor(active.second.actor, { regular: { kind: "q2", points: 200, normalProtection: 0.8, energyProtection: 0.6, item: "q2:item_armor_body" }, powered: { kind: "none" } });
  const zero = { x: 0, y: 0, z: 0 };
  active.game.damage(active.second.actor.id, active.first, active.first.actor.id, 100, 0, zero, zero, zero, 1, 0);
  expect(active.combat.read(active.second.actor.id)?.health).toBe(80);
  const armor = active.combat.read(active.second.actor.id)?.armor;
  expect(armor?.regular.kind === "q2" ? armor.regular.points : null).toBe(40);
});

test("LMCTF runes execute between shared armor stages and heal vampire on committed damage", () => {
  const active = compose(true, ctfMap, { kind: "lmctf" }), mode = active.composition.match.source;
  if (!(mode instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  const damage = active.game.spawn({ classname: "damage_rune", ordinal: 100, values: new Map<string, string>() });
  const resist = active.game.spawn({ classname: "resist_rune", ordinal: 101, values: new Map<string, string>() });
  expect(mode.runes.pickup(damage, active.game, active.first.actor.id)).toBe(true);
  expect(mode.runes.pickup(resist, active.game, active.second.actor.id)).toBe(true);
  active.combat.setArmor(active.second.actor, { regular: { kind: "q2", points: 200, normalProtection: 0.8, energyProtection: 0.6, item: "q2:item_armor_body" }, powered: { kind: "none" } });
  const zero = { x: 0, y: 0, z: 0 };
  active.game.damage(active.second.actor.id, active.first, active.first.actor.id, 100, 0, zero, zero, zero, 1, 0);
  expect(active.combat.read(active.second.actor.id)?.health).toBe(80);
  const armor = active.combat.read(active.second.actor.id)?.armor;
  expect(armor?.regular.kind === "q2" ? armor.regular.points : null).toBe(120);
  mode.runes.drop(active.first.actor.id, active.game); mode.runes.drop(active.second.actor.id, active.game);
  const vampire = active.game.spawn({ classname: "vampire_rune", ordinal: 102, values: new Map<string, string>() });
  expect(mode.runes.pickup(vampire, active.game, active.first.actor.id)).toBe(true);
  active.combat.setHealth(active.first.actor, 200); active.combat.setArmor(active.second.actor, { regular: { kind: "none" }, powered: { kind: "none" } });
  active.game.damage(active.second.actor.id, active.first, active.first.actor.id, 40, 0, zero, zero, zero, 1, 0);
  expect(active.combat.read(active.second.actor.id)?.health).toBe(40);
  expect(active.combat.read(active.first.actor.id)?.health).toBe(220);
});

test("CTF menu and admin settings commands validate source actions", () => {
  const active = compose(true, ctfMap, { kind: "ctf" }), mode = active.composition.match.source;
  if (!(mode instanceof Q2Ctf)) throw new Error("Missing CTF mode");
  expect(mode.command(active.first, active.game, "ctf-menu", ["invalid-action"])).toBe(false);
  expect(mode.command(active.first, active.game, "ctf-menu", ["join-red"])).toBe(true);
  expect(mode.states.get(active.first.actor.id)?.team).toBe(1);
  expect(mode.command(active.first, active.game, "ctf-settings", ["matchMinutes", "25"])).toBe(false);
  const state = mode.states.get(active.first.actor.id);
  if (state === undefined) throw new Error("Missing CTF player");
  state.admin = true;
  expect(mode.command(active.first, active.game, "ctf-settings", ["matchMinutes", "Infinity"])).toBe(false);
  expect(mode.command(active.first, active.game, "ctf-settings", ["matchMinutes", "25"])).toBe(true);
  expect(mode.rules.matchMinutes).toBe(25);
  expect(mode.command(active.first, active.game, "ctf-settings", ["weaponsStay", "true"])).toBe(true);
  expect(active.game.options.deathmatchFlags & 4).toBe(4);
});

test("CTF competition setup gates shared item pickups and resumes them in play", () => {
  const active = compose(true, ctfMap, { kind: "ctf" }), mode = active.composition.match.source;
  if (!(mode instanceof Q2Ctf)) throw new Error("Missing CTF mode");
  mode.command(active.first, active.game, "ctf-menu", ["join-red"]);
  active.combat.setHealth(active.first.actor, 50);
  const health = active.game.spawn({ classname: "item_health_small", ordinal: 110, values: new Map<string, string>() });
  health.think?.(health, active.game);
  mode.context.match.phase = "setup";
  active.items.touch(health, active.game, active.first.actor.id);
  expect(active.combat.read(active.first.actor.id)?.health).toBe(50);
  mode.context.match.phase = "none";
  active.items.touch(health, active.game, active.first.actor.id);
  expect(active.combat.read(active.first.actor.id)?.health).toBe(52);
});

test("LMCTF referee countdown and team lock survive the shared checkpoint", () => {
  const active = compose(true, ctfMap, { kind: "lmctf" }), mode = active.composition.match.source;
  if (!(mode instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  mode.rules.refPassword = "match-ref"; mode.rules.countdownSeconds = 1; mode.rules.timeLimitMinutes = 1; mode.rules.autoLock = true;
  mode.command(active.first, active.game, "startmatch", []);
  expect(mode.match.phase).toBe("none");
  mode.command(active.first, active.game, "referee", ["match-ref"]);
  mode.command(active.first, active.game, "startmatch", []);
  expect(mode.match.phase).toBe("countdown"); expect(mode.context.canScore()).toBe(false);
  expect(mode.context.flagsTouchable()).toBe(false); expect(mode.match.teamsLocked).toBe(true);
  mode.join(active.second, active.game, 1);
  expect(mode.states.get(active.second.actor.id)?.team).toBe(2);
  active.advance(1); mode.playerFrame(active.first, active.game);
  const checkpoint = captureQ2Product(active.composition);
  const restored = compose(false, ctfMap, { kind: "lmctf" }); restoreQ2Product(restored.composition, checkpoint);
  const restoredMode = restored.composition.match.source;
  if (!(restoredMode instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  expect(restoredMode.match.capture()).toEqual(mode.match.capture());
  expect(restoredMode.rules.refPassword).toBe("");
  restored.advance(2); restoredMode.playerFrame(restored.first, restored.game);
  expect(restoredMode.match.phase).toBe("inplay"); expect(restoredMode.match.remaining).toBe(59);
  expect(restoredMode.context.canScore()).toBe(true);
  restoredMode.command(restored.first, restored.game, "stopmatch", []);
  expect(restoredMode.match.phase).toBe("none"); expect(restoredMode.match.teamsLocked).toBe(false);
});

import { readInventoryEntry } from "../../../../src/persistence/save-image.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../../src/persistence/value.ts";

test("LMCTF plasma retains signed native cell debits and infinite-ammo counters through saves", () => {
  for (const scenario of [{ cells: 1, infinite: false, expected: -9 }, { cells: 1, infinite: true, expected: -8 }, { cells: 10, infinite: false, expected: 0 }, { cells: 10, infinite: true, expected: 1 }]) {
    const active = compose(true, ctfMap, { kind: "lmctf" }), weapons = active.composition.weapons;
    active.composition.setDeathmatchFlags(scenario.infinite ? 8192 : 0);
    active.inventory.configure(active.first.actor, { item: "q2:ammo_cells", count: scenario.cells, capacity: 200 });
    const state = weapons.bind(active.first, active.game);
    state.weapon = "lmctf:plasma"; state.phase = "firing"; state.frame = 4;
    const input = { attack: true, latchedAttack: false, holster: false, angles: { x: 0, y: 0, z: 0 }, ducked: false, spectator: false, notarget: false,
      hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false, instantSwitch: false,
      quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false } satisfies import("../../../../src/content/q2/foundation/weapons/types.ts").Q2WeaponInput;
    weapons.tick(active.first, active.game, input);
    expect(active.inventory.count(active.first.actor.id, "q2:ammo_cells")).toBe(scenario.expected);
    expect(state.frame).toBe(5);
    expect([...active.game.entities.values()].filter(entity => entity.classname === "goop")).toHaveLength(3);
    const entry = active.inventory.entries(active.first.actor.id).find(value => value.item === "q2:ammo_cells");
    expect(entry?.capacity).toBe(200); expect(entry?.countPolicy).toEqual({ kind: "source-counter", arithmetic: "int32" });
    const restoredEntry = readInventoryEntry(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(entry))));
    active.inventory.configure(active.first.actor, { item: "q2:ammo_cells", count: 100, capacity: 200 });
    active.inventory.configure(active.first.actor, restoredEntry);
    expect(active.inventory.count(active.first.actor.id, "q2:ammo_cells")).toBe(scenario.expected);
    expect(restoredEntry.countPolicy).toEqual(entry?.countPolicy);
    active.advance(0.1); weapons.tick(active.first, active.game, input);
    expect(active.inventory.count(active.first.actor.id, "q2:ammo_cells")).toBe(scenario.expected);
    expect([...active.game.entities.values()].filter(entity => entity.classname === "goop")).toHaveLength(3);
  }
});


test("LMCTF native skip vote resumes ballots and strict deadline through a checkpoint", () => {
  const tooFew = compose(true, ctfMap, { kind: "lmctf" }), refused = tooFew.composition.match.source;
  if (!(refused instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  refused.command(tooFew.first, tooFew.game, "lmctf-vote", ["skip"]);
  expect(refused.vote.startedAt).toBeNull();
  const active = compose(true, ctfMap, { kind: "lmctf" }, 4), mode = active.composition.match.source;
  if (!(mode instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  mode.command(active.first, active.game, "lmctf-vote", ["skip"]);
  expect(mode.vote.startedAt).toBe(0);
  expect((mode.states.get(active.first.actor.id)?.extraFlags ?? 0) & 192).toBe(64);
  mode.command(active.second, active.game, "voteno", []);
  mode.command(active.second, active.game, "voteyes", []);
  expect((mode.states.get(active.second.actor.id)?.extraFlags ?? 0) & 192).toBe(64);
  const checkpoint = captureQ2Product(active.composition);
  const restored = compose(false, ctfMap, { kind: "lmctf" }, 4); restoreQ2Product(restored.composition, checkpoint);
  const voteMode = restored.composition.match.source;
  if (!(voteMode instanceof Q2Lmctf)) throw new Error("Missing LMCTF mode");
  expect(voteMode.vote.startedAt).toBe(0);
  expect((voteMode.states.get(restored.second.actor.id)?.extraFlags ?? 0) & 192).toBe(64);
  restored.advance(30); voteMode.playerFrame(restored.first, restored.game);
  expect(voteMode.vote.startedAt).toBe(0); expect(restored.players.intermission.kind).toBe("playing");
  restored.advance(30.1); voteMode.playerFrame(restored.first, restored.game);
  expect(voteMode.vote.startedAt).toBeNull(); expect(restored.players.intermission.kind).toBe("intermission");
});

test("DeathBall initializes required flags through the external owner and preserves its configured bits", () => {
  let flags = 16;
  const active = compose(true, '{ "classname" "worldspawn" } { "classname" "info_player_start" } { "classname" "dm_dball_ball_start" }', { kind: "deathball", team1Skin: "male/ctf_r", team2Skin: "male/ctf_b", goalLimit: 5 }, 2,
    { read: () => flags, write: value => { flags = value; return undefined; } });
  const required = 0x20000 | 0x80000 | 0x40000 | 256 | 64;
  expect(flags).toBe(16 | required);
  expect(active.game.options.deathmatchFlags).toBe(16 | required);
  expect(active.composition.movementStopSpeed).toBe(0);
});


test("rerelease live random-item policy replaces the existing pickup at respawn", () => {
  const id = createIdentityOwner("random-items"), cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: id.session, origin: { kind: "server-console" } } });
  registerQ2ServerCvars(cvars, "q2:tag");
  const active = compose(true, undefined, { kind: "tag" }, 2, undefined, q2RereleaseItemServices(cvars));
  const pickup = active.game.spawn({ classname: "ammo_shells", ordinal: 9, values: new Map<string, string>() });
  const actor = pickup.actor.id;
  pickup.think?.(pickup, active.game);
  expect(active.items.touch(pickup, active.game, active.first.actor.id)).toBeUndefined();
  active.advance(30); pickup.think?.(pickup, active.game);
  expect(pickup.classname).toBe("ammo_shells");
  cvars.set("g_dm_random_items", "1");
  active.items.touch(pickup, active.game, active.second.actor.id);
  active.advance(60); pickup.think?.(pickup, active.game);
  expect(pickup.actor.id).toBe(actor); expect(pickup.classname).not.toBe("ammo_shells");
  expect(active.items.itemDefinition(pickup)?.classname).toBe(pickup.classname);
});

test("rerelease DualFire death drop preserves remaining duration and obeys live suppression", () => {
  for (const allow of [true, false]) {
    const id = createIdentityOwner("dual-fire-drop"), cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: id.session, origin: { kind: "server-console" } } });
    registerQ2ServerCvars(cvars, "q2:tag"); cvars.set("g_dm_no_quadfire_drop", allow ? "0" : "1");
    const active = compose(true, undefined, { kind: "tag" }, 2, undefined, q2RereleaseItemServices(cvars));
    const state = active.players.states.get(active.first.actor.id); if (state === undefined) throw new Error("Missing player"); state.useQ2Weapons = true;
    active.inventory.configure(active.first.actor, { item: "q2:item_quadfire", count: 1, capacity: 2 });
    active.items.use(active.first.actor, "q2:item_quadfire", active.game);
    active.advance(10);
    active.players.recordDeath(active.first, active.game, { attack: null, self: active.first.actor, attacker: active.second.actor.id, inflictor: active.second.actor.id, damage: 110, kick: 0, point: active.game.body(active.first).origin });
    const drop = [...active.game.entities.values()].find(entity => entity.classname === "item_quadfire");
    if (!allow) { expect(drop).toBeUndefined(); continue; }
    if (drop === undefined) throw new Error("No DualFire drop");
    expect(drop.nextThink).toBe(30); expect(drop.spawnflags & 0x20000).not.toBe(0);
    active.items.touch(drop, active.game, active.second.actor.id);
    expect(active.composition.armory?.items.powerups(active.second.actor.id).quadFireUntil).toBe(30);
    expect(active.composition.armory?.items.powerups(active.first.actor.id).quadFireUntil).toBe(0);
  }
});
