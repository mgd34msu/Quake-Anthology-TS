import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { DamageDecision, ItemId } from "../../../../src/contracts/gameplay.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2CharacterActor, Q2PlayerState, q2Obituary } from "../../../../src/content/q2/base/player/index.ts";
import type { Q2CharacterHost, Q2CharacterGib, Q2PlayerMovement, Q2PlayerView } from "../../../../src/content/q2/base/player/index.ts";
import type { Q2PresentationEvent } from "../../../../src/content/q2/foundation/host.ts";

function character() {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-character-on-q1"));
  const actor = actors.allocateAtSource("q1:campaign", 1, "q2:male");
  const callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const zero = { x: 0, y: 0, z: 0 }, bounds = { min: { x: -20, y: -20, z: -24 }, max: { x: 20, y: 20, z: 48 } };
  bodies.create(actor, { origin: zero, angles: zero, velocity: zero, bounds, ground: null });
  const inventory = new SharedInventoryTable(actors); inventory.create(actor, [{ item: "q1:rockets", count: 7, capacity: 100 }]);
  const decisions: DamageDecision[] = [], views: Q2PlayerView[] = [], presentation: Q2PresentationEvent[] = [], gibs: Q2CharacterGib[] = [];
  let now = 0, dead = 0, respawns = 0;
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: (_actor, decision) => {
    decisions.push(decision); return undefined;
  }, confirmed: outcome => { if (outcome.kind === "committed") controller.recordDamage(outcome.decision); return undefined; } });
  combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64", q2: { product: "classic", ctf: false, alive: true } })),
    context: () => ({ arithmetic: "binary64", player: true, monster: false, attackerPlayer: false, hasEnemy: false, easySkill: false,
      deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false, nuke: false, noKnockback: true,
      movable: true, rejectTeamDamage: false, suppressPain: false }) }));
  const movement: { value: Q2PlayerMovement } = { value: { viewAngles: zero, commandAngles: zero, waterLevel: 3, waterType: 32,
    grounded: false, ducked: false, buttons: 0, standingBounds: bounds, animateQ2: true } };
  const host: Q2CharacterHost = { bodies, combat, inventory, now: () => now, random: () => 0.5, movement: () => movement.value,
    pointContents: () => movement.value.waterType,
    powerups: () => ({ quadUntil: 0, invulnerabilityUntil: 0, breatherUntil: 0, enviroUntil: 0 }), weapon: () => null,
    emit: event => { presentation.push(event); return undefined; }, view: (_actor, value) => { views.push(value); return undefined; }, noise: () => undefined,
    environmentDamage: (owner, amount, means, flags) => {
      combat.apply({ target: owner.id, amount, knockback: 0, direction: zero, point: zero, normal: zero, delivery: "direct",
        attack: { sequence: decisions.length, time: { kind: "seconds", value: now }, attacker: null, inflictor: null, weapon: null,
          weaponProvider: "q1:arsenal", combatProvider: "q2:combat", inventoryProvider: "q1:inventory", movementProvider: "q1:movement",
          cause: { kind: "q2", meansOfDeath: means, damageFlags: flags } } });
      return undefined;
    }, died: () => { dead++; return undefined; }, requestRespawn: () => { respawns++; return undefined; }, motion: () => undefined,
    spawnGib: gib => { gibs.push(gib); return undefined; } };
  const controller = new Q2CharacterActor(actor, host, { model: "players/male/tris.md2", skin: 0, slot: 0, mode: "coop", deathmatchFlags: 0, environment: true });
  callbacks.bind(actor, { think: null, use: null, touch: null, pain: reaction => controller.pain(reaction), die: reaction => controller.die(reaction) });
  return { actor, actors, bodies, inventory, combat, controller, movement, host, decisions, views, presentation, gibs,
    advance(value: number) { now = value; }, deaths: () => dead, respawns: () => respawns };
}

test("Q2 character preserves foreign shared actor/body/inventory and uses source drowning cadence", () => {
  const game = character();
  expect(game.actors.observations()).toHaveLength(1);
  expect(game.bodies.read(game.actor.id)?.bounds.max.z).toBe(48);
  expect(game.inventory.entries(game.actor.id)).toEqual([{ item: "q1:rockets", count: 7, capacity: 100 }]);
  game.advance(12); game.controller.endFrame(); expect(game.combat.read(game.actor.id)?.health).toBe(100);
  game.advance(12.1); game.controller.endFrame(); expect(game.combat.read(game.actor.id)?.health).toBe(96);
  game.advance(13.1); game.controller.endFrame(); expect(game.combat.read(game.actor.id)?.health).toBe(96);
  game.advance(13.2); game.controller.endFrame(); expect(game.combat.read(game.actor.id)?.health).toBe(90);
  expect(game.decisions.map(decision => decision.request.amount)).toEqual([4, 6]);
  game.movement.value = { ...game.movement.value, waterLevel: 0, waterType: 0 };
  game.advance(13.3); game.controller.endFrame(); expect(game.controller.state.airFinished).toBe(25.3);
  expect(game.controller.state.drownDamage).toBe(2);
});

test("Q2 character feeds exact shield savings and sends one death to the selected campaign", () => {
  const game = character();
  game.combat.setArmor(game.actor, { kind: "q2", item: "q2:item_armor_jacket", points: 0, normalProtection: 0.3, energyProtection: 0, powerArmor: { kind: "shield", cells: 10 } });
  game.host.environmentDamage(game.actor, 5, 1, 0);
  expect(game.controller.state.damagePowerArmor).toBe(3);
  expect(game.controller.state.damageBlood).toBe(2);
  game.combat.setArmor(game.actor, { kind: "none" });
  game.host.environmentDamage(game.actor, 110, 1, 0);
  expect(game.controller.state.dead).toBe(true);
  expect(game.deaths()).toBe(1);
  expect(game.bodies.read(game.actor.id)?.bounds.max.z).toBe(-8);
  game.host.environmentDamage(game.actor, 40, 1, 0);
  expect(game.gibs).toHaveLength(4);
  expect(game.deaths()).toBe(1);
  expect(game.controller.entity.model).toContain("skull");
  game.advance(1.1); game.movement.value = { ...game.movement.value, buttons: 1 };
  game.controller.afterClientThink(); game.controller.beginFrame(); expect(game.respawns()).toBe(1);
  expect(game.inventory.count(game.actor.id, "q1:rockets")).toBe(7);
});

test("Q2 obituary records source means-of-death scoring including friendly fire", () => {
  const first = new Q2PlayerState(0, 0), second = new Q2PlayerState(1, 0); first.name = "A"; second.name = "B";
  expect(q2Obituary(first, null, 22, true, false)).toBe("A cratered.\n"); expect(first.score).toBe(-1);
  expect(q2Obituary(first, second, 8, true, false)).toBe("A ate B's rocket\n"); expect(second.score).toBe(1);
  q2Obituary(first, second, 8 | 0x8000000, true, false); expect(second.score).toBe(0);
});

import { Q2Players } from "../../../../src/content/q2/base/player/index.ts";
import { SharedPickupAdmission } from "../../../../src/world/gameplay/pickups.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../../../src/content/composition/q2-q3-supply.ts";
import type { Q2PlayerHooks, Q2PlayerEvent } from "../../../../src/content/q2/base/player/index.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import { createQ2TargetModule } from "../../../../src/content/q2/foundation/targets.ts";
import { createQ2ItemModule } from "../../../../src/content/q2/foundation/items.ts";
import { Q2Weapons } from "../../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2FoundationHost, Q2GameOptions } from "../../../../src/content/q2/foundation/host.ts";
import type { Q2WeaponInput } from "../../../../src/content/q2/foundation/weapons/index.ts";

function campaign(options: Partial<Pick<Q2GameOptions, "edition" | "mode" | "maxClients">> = {}) {
  const shared = character(), events: Q2PlayerEvent[] = [];
  const actor = shared.actor;
  let now = 0;
  const weapons = new Q2Weapons({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const items = createQ2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
  const zero = { x: 0, y: 0, z: 0 };
  const input: Q2WeaponInput = { attack: false, latchedAttack: false, holster: false, angles: zero, ducked: false, spectator: false, notarget: false,
    hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0, haste: false, noStackDouble: false, instantSwitch: false,
    quickSwitch: false, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false };
  const hooks: Q2PlayerHooks = { movement: () => shared.movement.value, setMovement: () => undefined, emit: event => { events.push(event); return undefined; },
    noise: () => undefined, weaponInput: () => input, banned: () => false };
  const players = new Q2Players(items, weapons, hooks);
  const host: Q2FoundationHost = {
    actors: shared.actors, bodies: shared.bodies, combat: shared.combat, inventory: shared.inventory, callbacks: new ActorCallbackTable(shared.actors),
    now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => 0.5, schedule: () => undefined,
    touchTriggers: () => undefined, keyConsumed: id => { const entity = game.entity(id); return entity === null ? undefined : players.consumedKey(entity, game); },
    trace: request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0,
      surface: null, sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 }, secondary: null }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [], players: () => [actor.id], isPlayer: id => id === actor.id,
    isMonster: () => false, worldActor: () => { const world = [...game.entities.values()].find(entity => entity.classname === "worldspawn"); if (world === undefined) throw new Error("world missing"); return world.actor.id; },
    inlineModelBounds: () => ({ min: zero, max: zero }), setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, emit: () => undefined,
    playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), prepareLevelChange: () => undefined, transition: () => undefined, diagnostic: text => { throw new Error(text); },
  };
  const game = new Q2Foundation(host, { edition: "classic", mapName: "base1", skill: 1, mode: "coop", deathmatchFlags: 0, maxClients: 4,
    provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement", ...options }, [players, createQ2TargetModule(), items]);
  game.load('{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "32 64 24" } { "classname" "info_player_intermission" "origin" "100 200 300" }');
  const entity = game.attachPlayer(actor);
  shared.movement.value = { ...shared.movement.value, animateQ2: false, waterLevel: 0, waterType: 0 };
  players.attach(entity, game, { slot: 0, userinfo: "\\name\\Ranger\\skin\\male/grunt", initializeInventory: false });
  return { shared, game, entity, players, items, events, advance(value: number) { now = value; shared.advance(value); } };
}

test("Q2 campaign death bookkeeping leaves a foreign character's body to its own provider", () => {
  const active = campaign(), { shared, game, entity, players } = active;
  const before = shared.bodies.read(entity.actor.id);
  shared.inventory.configure(entity.actor, { item: "q2:key_data_cd", count: 1, capacity: 1 });
  const state = players.states.get(entity.actor.id);
  if (state === undefined) throw new Error("player not admitted");
  state.coopRespawn = players.saveCarry(entity, game);
  shared.inventory.consume(entity.actor, "q2:key_data_cd", 1); players.consumedKey(entity, game);
  expect(state.coopRespawn?.inventory.find(entry => entry.item === "q2:key_data_cd")?.count).toBe(0);
  shared.combat.setHealth(entity.actor, -1);
  players.recordDeath(entity, game, { attack: null, self: entity.actor, attacker: null, inflictor: null, kick: 0, damage: 101, point: { x: 0, y: 0, z: 0 } });
  expect(shared.bodies.read(entity.actor.id)).toEqual(before);
  expect(state.dead).toBe(true);
  players.putInServer(entity, game);
  expect(shared.inventory.count(entity.actor.id, "q2:key_data_cd")).toBe(0);
  expect(shared.inventory.count(entity.actor.id, "q1:rockets")).toBe(7);
  expect(shared.combat.read(entity.actor.id)?.health).toBe(100);
  expect(shared.bodies.read(entity.actor.id)?.origin).toEqual({ x: 32, y: 64, z: 34 });
  expect([...game.entities.values()].filter(value => value.classname === "bodyque")).toHaveLength(8);
  players.beginIntermission(game, "*base2");
  expect(players.intermission.kind).toBe("intermission");
  active.advance(5); shared.movement.value = { ...shared.movement.value, buttons: 1 }; players.afterClientThink(entity, game);
  expect(players.intermission).toMatchObject({ exit: false });
  active.advance(5.1); players.afterClientThink(entity, game); expect(players.intermission).toMatchObject({ exit: true });
});

test("Q2 catalogue dispatch retains native help, unknown chat, hooks, and intermission gates", () => {
  const { players, entity, game, shared, events } = campaign();
  const state = players.states.get(entity.actor.id);
  if (state === undefined) throw new Error("player not admitted");
  const run = (name: string, args: readonly string[] = []): boolean => players.clientCommand(entity, game, name, args);
  expect(run("GoD")).toBe(true); expect(state.god).toBe(true);
  expect(shared.combat.read(entity.actor.id)?.invulnerable).toBe(true);
  run("give", ["health", "65"]); expect(shared.combat.read(entity.actor.id)?.health).toBe(65);
  run("help"); expect(state.showHelp).toBe(true);
  run("AnUnknownCommand", ["words"]);
  expect(events.some(event => event.kind === "print" && event.text === "Ranger: AnUnknownCommand words\n")).toBe(true);
  players.beginIntermission(game, "*base2");
  run("god"); expect(state.god).toBe(true);
  events.length = 0; run("AnotherUnknownCommand");
  expect(events).toEqual([]);
  run("say", ["intermission chat"]);
  expect(events.some(event => event.kind === "print" && event.text.includes("intermission chat"))).toBe(true);
  run("help"); expect(events.some(event => event.kind === "help")).toBe(true);
  let hooked = false;
  players.hooks.command = (_entity, _game, name, args) => { hooked = name === "god" && args[0] === "hook"; return true; };
  run("GOD", ["hook"]); expect(hooked).toBe(true); expect(state.god).toBe(true);
});

test("Q2 classic give uses full item names, increments weapons, and preserves direct ammo counters", () => {
  const { players, entity, game, shared } = campaign();
  const give = (...args: string[]): void => { players.clientCommand(entity, game, "give", args); };
  give("Power", "Shield"); expect(shared.inventory.count(entity.actor.id, "q2:item_power_shield")).toBe(1);
  give("Super", "Shotgun"); expect(shared.inventory.count(entity.actor.id, "q2:weapon_supershotgun")).toBe(1);
  give("weapons"); give("weapons"); expect(shared.inventory.count(entity.actor.id, "q2:weapon_supershotgun")).toBe(3);
  give("Shells", "400"); expect(shared.inventory.count(entity.actor.id, "q2:ammo_shells")).toBe(400);
  give("Shells", "-7"); expect(shared.inventory.count(entity.actor.id, "q2:ammo_shells")).toBe(-7);
  give("ammo"); expect(shared.inventory.count(entity.actor.id, "q2:ammo_shells")).toBe(100);
});

test("Q2 rerelease give all upgrades ammo, grants eight keys, excludes protected items and supports non-pickup inventory", () => {
  const { players, entity, game, shared, items, events } = campaign({ edition: "rerelease", mode: "singleplayer", maxClients: 1 });
  const custom = (classname: string, name: string, consoleGive: "individual-only" | "inventory-only" | "forbidden"): void => {
    items.register({ kind: "custom", classname, name, consoleGive, model: "", icon: "", sound: "", rotate: false, respawn: 0,
      capacity: 1, quantity: 1, coopStay: false, droppable: false, use: null, pickup: () => { throw new Error("Excluded give item unexpectedly touched"); } });
  };
  custom("item_flag_team1", "Red Flag", "individual-only"); custom("item_tech1", "Resistance", "individual-only");
  custom("dm_tag_token", "Tag Token", "forbidden"); custom("item_compass", "Compass", "inventory-only");
  const give = (...args: string[]): void => { players.clientCommand(entity, game, "give", args); };
  give("all");
  expect(shared.inventory.count(entity.actor.id, "q2:ammo_shells")).toBe(200);
  expect(shared.inventory.count(entity.actor.id, "q2:ammo_cells")).toBe(300);
  expect(shared.inventory.count(entity.actor.id, "q2:key_power_cube")).toBe(8); expect(entity.powerCubes).toBe(255);
  expect(shared.inventory.count(entity.actor.id, "q2:item_power_shield")).toBe(1);
  expect(shared.combat.read(entity.actor.id)?.armor).toMatchObject({ kind: "q2", points: 200 });
  for (const id of ["q2:item_flag_team1", "q2:item_tech1", "q2:dm_tag_token", "q2:item_compass"] satisfies readonly ItemId[]) expect(shared.inventory.count(entity.actor.id, id)).toBe(0);
  give("item_compass"); expect(shared.inventory.count(entity.actor.id, "q2:item_compass")).toBe(1);
  give("Tag Token"); expect(events.at(-1)).toMatchObject({ kind: "print", text: "Item is not giveable.\n" });
  give("ammo_shells", "401"); expect(shared.inventory.count(entity.actor.id, "q2:ammo_shells")).toBe(401);
});

test("Q2 rerelease coop cheat gate precedes selected arsenal grants and native source items retain priority", () => {
  const { players, entity, game, shared } = campaign({ edition: "rerelease" });
  const granted: string[] = [];
  players.hooks.grantSelectedArsenal = (actor, category) => {
    expect(actor).toBe(entity.actor.id); granted.push(category);
    shared.inventory.configure(entity.actor, { item: category === "weapons" ? "q3:weapon/railgun" : "q3:ammo/slugs", count: category === "weapons" ? 1 : 200, capacity: 200 });
    return true;
  };
  players.hooks.giveSelectedItem = (_actor, args) => { granted.push(args.join(" ")); return true; };
  players.clientCommand(entity, game, "give", ["all"]); expect(granted).toEqual([]);
  players.rules.cheats = true; players.clientCommand(entity, game, "give", ["all"]);
  expect(granted).toEqual(["weapons", "ammo"]);
  expect(shared.inventory.count(entity.actor.id, "q3:weapon/railgun")).toBe(1);
  expect(shared.inventory.count(entity.actor.id, "q3:ammo/slugs")).toBe(200);
  expect(shared.inventory.entries(entity.actor.id).filter(entry => entry.item.startsWith("q2:weapon_") || entry.item.startsWith("q2:ammo_"))).toEqual([]);
  players.clientCommand(entity, game, "give", ["Power", "Shield"]); expect(granted).toHaveLength(2);
  players.clientCommand(entity, game, "give", ["foreign weapon"]); expect(granted.at(-1)).toBe("foreign weapon");
});

test("Q2 named ammo grants resolve the admitted source supply mapping even when the native name matches", () => {
  const { players, entity, game, shared, items } = campaign();
  for (const mapping of Q2_Q3_SUPPLY_PROFILE.ammo) for (const item of mapping.destinations)
    shared.inventory.configure(entity.actor, { item, count: 7, capacity: 200 });
  items.setPickupAdmission(new SharedPickupAdmission({ inventory: shared.inventory, profile: Q2_Q3_SUPPLY_PROFILE,
    ammoGranted: () => undefined, weaponGranted: () => undefined }));
  players.clientCommand(entity, game, "give", ["Cells", "50"]);
  expect(shared.inventory.count(entity.actor.id, "q3:ammo/lightning")).toBe(50);
  expect(shared.inventory.count(entity.actor.id, "q2:ammo_cells")).toBe(50);
  players.clientCommand(entity, game, "give", ["Cells"]);
  expect(shared.inventory.count(entity.actor.id, "q3:ammo/lightning")).toBe(100);
  players.clientCommand(entity, game, "give", ["Shells", "25"]);
  expect(shared.inventory.count(entity.actor.id, "q3:ammo/shotgun")).toBe(25);
  expect(shared.inventory.entries(entity.actor.id).some(entry => entry.item === "q2:ammo_shells")).toBe(false);
});

test("Q2 named supply without a pickup adapter offers canonical item IDs to the selected arsenal", () => {
  const { players, entity, game, shared } = campaign();
  const received: string[][] = [];
  players.hooks.giveSelectedItem = (_actor, args) => { received.push([...args]); return true; };
  players.clientCommand(entity, game, "give", ["Cells", "50"]);
  players.clientCommand(entity, game, "give", ["Super", "Shotgun"]);
  expect(received).toEqual([["q2:ammo_cells", "50"], ["q2:weapon_supershotgun"]]);
  expect(shared.inventory.entries(entity.actor.id).some(entry => entry.item === "q2:ammo_cells" || entry.item === "q2:weapon_supershotgun")).toBe(false);
});
