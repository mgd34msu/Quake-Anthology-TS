import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { ActorSlotCheckpoint, SavedActorId } from "../../../../src/contracts/session.ts";
import type { BodyState } from "../../../../src/contracts/world.ts";
import type { CombatState, InventoryEntry } from "../../../../src/contracts/gameplay.ts";
import type { Q2Entity, Q2FoundationHost, Q2PresentationEvent, Q2TraceRequest } from "../../../../src/content/q2/foundation/host.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2FoundationCheckpoint } from "../../../../src/content/q2/foundation/checkpoint.ts";
import { Q2ItemModule } from "../../../../src/content/q2/foundation/items.ts";
import type { Q2ItemsCheckpoint } from "../../../../src/content/q2/foundation/items.ts";
import { Q2Weapons, Q2WeaponState } from "../../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2WeaponsCheckpoint } from "../../../../src/content/q2/foundation/weapons/checkpoint.ts";
import { Q2PlayerState } from "../../../../src/content/q2/base/player/types.ts";
import { q2PlayerSpawns } from "../../../../src/content/q2/base/player/spawns.ts";
import { parseQ2Entities, zero } from "../../../../src/content/q2/foundation/fields.ts";
import { Q2Ctf, ctfPlayer, saveCtfActor, encodeQ2CtfCheckpoint, decodeQ2CtfCheckpoint } from "../../../../src/content/q2/multiplayer/ctf/index.ts";
import type { Q2CtfCheckpoint, Q2CtfEvent } from "../../../../src/content/q2/multiplayer/ctf/index.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import type { SourceActorCheckpoint } from "../../../../src/world/actors/registry.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";

interface SavedFixture {
  readonly now: number;
  readonly slots: readonly ActorSlotCheckpoint[];
  readonly sources: readonly SourceActorCheckpoint[];
  readonly actors: readonly { readonly actor: SavedActorId; readonly body: BodyState; readonly combat: CombatState | null; readonly inventory: readonly InventoryEntry[] | null }[];
  readonly players: readonly { readonly actor: SavedActorId; readonly state: Q2PlayerState }[];
  readonly foundation: Q2FoundationCheckpoint;
  readonly items: Q2ItemsCheckpoint;
  readonly weapons: Q2WeaponsCheckpoint;
  readonly ctf: Q2CtfCheckpoint;
}

function fixture(saved: SavedFixture | null = null) {
  let now = saved?.now ?? 0, flags = 0;
  const identities = createIdentityOwner("original-q2-ctf"), actors = saved === null ? new SessionActorRegistry(identities) : SessionActorRegistry.restore(identities, saved.slots, saved.sources);
  const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const inventory = new SharedInventoryTable(actors), common = new Map<ActorId, Q2PlayerState>(), events: Q2CtfEvent[] = [], presentation: Q2PresentationEvent[] = [], destinations: (string | null)[] = [];
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", context: request => ({ arithmetic: "binary64", player: common.has(request.target), monster: false,
    attackerPlayer: request.attack.attacker !== null && common.has(request.attack.attacker), hasEnemy: false, easySkill: false, deathmatch: true,
    defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false }),
    armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64" })) }));
  if (saved !== null) {
    for (const entry of saved.actors) {
      const actor = actors.resolveSaved(entry.actor); if (actor === null) throw new Error("Missing fixture saved actor");
      bodies.create(actor, { ...entry.body, ground: null }); if (entry.combat !== null) combat.create(actor, entry.combat); if (entry.inventory !== null) inventory.create(actor, entry.inventory);
    }
    for (const entry of saved.players) { const actor = actors.resolveSaved(entry.actor); if (actor === null) throw new Error("Missing fixture saved player"); common.set(actor.id, Object.assign(new Q2PlayerState(entry.state.slot, entry.state.enteredAt), entry.state)); }
  } else {
    const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn"); bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
    for (let slot = 0; slot < 3; slot++) {
      const actor = actors.allocate("q3:character", "q3:sarge"), state = new Q2PlayerState(slot, 0); state.name = ["red", "redmate", "blue"][slot] ?? "player"; state.skin = "male/grunt"; state.userinfo = `\\name\\${state.name}\\skin\\male/grunt`; state.connected = true;
      common.set(actor.id, state); bodies.create(actor, { origin: { x: slot * 512, y: 0, z: 64 }, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null });
      combat.create(actor, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null }); inventory.create(actor, []);
    }
  }
  const world = actors.ownedBy("q2:game").find(actor => actors.sourceOf(actor.id)?.slot === 0); if (world === undefined) throw new Error("Missing fixture world");
  const host: Q2FoundationHost = { actors, callbacks, bodies, combat, inventory, now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => 0.25, schedule: () => undefined, touchTriggers: () => undefined,
    trace: (request: Q2TraceRequest) => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null,
      sourcePlane: { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 }, secondary: null }),
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [...common.keys()], players: () => [...common.keys()],
    worldActor: () => world.id, isPlayer: actor => common.has(actor), isMonster: () => false, inlineModelBounds: () => ({ min: zero, max: zero }),
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined, playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }), keyConsumed: () => undefined,
    prepareLevelChange: () => undefined, emit: event => { presentation.push(event); return undefined; }, transition: () => undefined, diagnostic: message => { throw new Error(message); } };
  const items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
  const weapons = new Q2Weapons({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const ctf: Q2Ctf = new Q2Ctf({ items, weapons, player: actor => common.get(actor) ?? null, setSkin: (actor, skin) => { const state = common.get(actor); if (state === undefined) throw new Error("Missing fixture skin"); state.skin = skin; return undefined; },
    spawnPlayer: (entity, game) => { const placement = ctf.selectSpawn(entity, game); if (placement !== null) game.move(entity, placement); combat.setHealth(entity.actor, 100); combat.setTraits(entity.actor, { canTakeDamage: true }); game.solid(entity, "box"); return undefined; },
    observer: () => undefined, teleport: (entity, game, origin, angles, velocity) => game.move(entity, { origin, angles, velocity }), chase: () => undefined, setGrapplePrediction: () => undefined,
    gravity: () => 800, emit: event => { events.push(event); return undefined; }, endLevel: (_game, map) => { destinations.push(map); return undefined; }, kick: actor => { common.delete(actor); return undefined; },
    setDeathmatchFlags: value => { flags = value; return undefined; }, chatAllowed: () => true });
  const game = new Q2Foundation(host, { edition: "classic", mapName: "q2ctf1", skill: 1, mode: "deathmatch", get deathmatchFlags() { return flags; }, maxClients: 8,
    provider: "q2:game", campaign: "q2:campaign", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q3:movement" }, [ctf, items, q2PlayerSpawns]);
  game.sourceCallbacks.register(weapons.callbacks);
  if (saved !== null) { game.restore(saved.foundation); items.restore(game, saved.items); weapons.restore(game, saved.weapons); ctf.restore(saved.ctf, game); }
  else {
    for (const [classname, x] of [["info_player_team1", 0], ["info_player_team2", 1024], ["info_player_deathmatch", 512]] satisfies readonly [string, number][]) game.spawn({ classname, ordinal: 1, values: new Map([["origin", `${x} 0 64`]]) });
    for (const [actor, state] of common) { const owned = actors.resolveOwned(actor); if (owned === null) throw new Error("Missing fixture player"); const entity = game.attachPlayer(owned); items.configurePlayer(owned, game, true); weapons.bind(entity, game, new Q2WeaponState("blaster")); ctf.admitted(entity, game); ctf.join(entity, game, state.slot === 2 ? 2 : 1); }
  }
  function player(slot: number): Q2Entity { const actor = [...common].find(([, state]) => state.slot === slot)?.[0], entity = actor === undefined ? null : game.entity(actor); if (entity === null) throw new Error("Missing fixture player slot"); return entity; }
  function advance(time: number): undefined {
    now = time;
    for (const entity of [...game.entities.values()]) if (entity.nextThink !== null && entity.nextThink <= now && entity.think !== null) { const think = entity.think; entity.nextThink = null; think(entity, game); }
    return undefined;
  }
  function touch(entity: Q2Entity, player: Q2Entity): undefined { callbacks.touch({ self: entity.actor, other: player.actor.id, plane: null, surface: null }); return undefined; }
  function save(): SavedFixture {
    const rows = actors.observations().map(value => { const body = bodies.read(value.id); if (body === null) throw new Error("Missing fixture body"); return { actor: saveCtfActor(value.id), body, combat: combat.read(value.id), inventory: inventory.has(value.id) ? inventory.entries(value.id) : null }; });
    return { now, slots: actors.checkpoint(), sources: actors.sourceCheckpoint(), actors: rows, players: [...common].map(([actor, state]) => ({ actor: saveCtfActor(actor), state: { ...state } })),
      foundation: game.capture(), items: items.capture(game), weapons: weapons.capture(game), ctf: decodeQ2CtfCheckpoint(encodeQ2CtfCheckpoint(ctf.capture())) };
  }
  return { game, ctf, items, weapons, inventory, combat, common, events, presentation, destinations, player, advance, touch, save };
}

test("grapple retains a zero-health brush and releases a damageable dead anchor", () => {
  const scene = fixture(), owner = scene.player(0), core = scene.ctf.grapple.equipment;
  if (core === null) throw new Error("Missing native CTF grapple");
  const brush = scene.game.create("test_brush_anchor");
  scene.game.solid(brush, "brush");
  scene.combat.create(brush.actor, { health: 0, armor: { kind: "none" }, mass: 100,
    canTakeDamage: false, invulnerable: false, team: null });
  expect(core.fireGrapple(owner.actor.id, scene.game, zero, { x: 1, y: 0, z: 0 })).toBe(true);
  const hook = scene.game.entity(core.state(owner.actor.id).grapple);
  if (hook === null) throw new Error("Missing actual source hook");
  core.touch(hook, scene.game, { self: hook.actor, other: brush.actor.id, plane: null, surface: null });
  core.pull(hook, scene.game, false);
  expect(core.state(owner.actor.id).grapple).toBe(hook.actor.id);
  expect(scene.game.host.actors.isLive(hook.actor.id)).toBe(true);
  scene.combat.setTraits(brush.actor, { canTakeDamage: true });
  core.pull(hook, scene.game, false);
  expect(core.state(owner.actor.id).grapple).toBeNull();
  expect(scene.game.host.actors.isLive(hook.actor.id)).toBe(false);
});

function flags(scene: ReturnType<typeof fixture>) {
  const red = scene.game.spawn({ classname: "item_flag_team1", ordinal: 2, values: new Map([["origin", "0 0 128"]]) });
  const blue = scene.game.spawn({ classname: "item_flag_team2", ordinal: 3, values: new Map([["origin", "1024 0 128"]]) }); scene.advance(0.2); return { red, blue };
}

test("original flag actors capture, return and assist through shared inventory and score", () => {
  const scene = fixture(), bases = flags(scene), red = scene.player(0), mate = scene.player(1), blue = scene.player(2);
  scene.touch(bases.blue, red); scene.touch(bases.red, blue);
  expect(scene.inventory.count(red.actor.id, "q2:item_flag_team2")).toBe(1); expect(bases.blue.visible).toBe(false);
  scene.advance(1); scene.ctf.flags.drop(blue, scene.game);
  const dropped = [...scene.game.entities.values()].find(entity => entity.classname === "item_flag_team1" && entity !== bases.red); if (dropped === undefined) throw new Error("Missing dropped original flag");
  scene.touch(dropped, blue); expect(scene.inventory.count(blue.actor.id, "q2:item_flag_team1")).toBe(0);
  scene.touch(dropped, mate); expect(scene.ctf.flags.state(scene.game, 1)).toBe("base");
  scene.touch(bases.red, red); expect(scene.ctf.context.match.team1).toBe(1); expect(scene.inventory.count(red.actor.id, "q2:item_flag_team2")).toBe(0);
  expect(scene.common.get(red.actor.id)?.score).toBe(15); expect(scene.common.get(mate.actor.id)?.score).toBe(12); expect(scene.common.get(blue.actor.id)?.score).toBe(0);
  expect(scene.ctf.flags.state(scene.game, 2)).toBe("base");
  scene.ctf.presentation.scoreboard(red, scene.game);
  const score = scene.events.at(-1); if (score?.kind !== "scoreboard") throw new Error("Missing CTF scoreboard"); expect(score.totals).toEqual([27, 0]); expect(score.layout.length).toBeLessThan(1000);
  scene.ctf.command(red, scene.game, "say_team", ["%h", "%t"]);
  expect(scene.presentation.filter(event => event.kind === "print" && event.level === "chat").map(event => event.kind === "print" ? event.actor : null)).toEqual([red.actor.id, mate.actor.id]);
});

test("dropped flag timer and match private data restore into fresh actor identities", () => {
  const scene = fixture(), bases = flags(scene), red = scene.player(0);
  scene.touch(bases.blue, red); scene.advance(4); scene.ctf.dropInventory(red, scene.game);
  const state = ctfPlayer(scene.ctf.context, red.actor.id); state.lastFraggedCarrier = 3; scene.ctf.context.match.phase = "game"; scene.ctf.context.match.matchTime = 200; scene.ctf.match.assignGhost(red, scene.game);
  const common = scene.common.get(red.actor.id); if (common === undefined) throw new Error("Missing common score"); common.score = 42; scene.ctf.match.syncGhost(red.actor.id);
  const saved = scene.save(), restored = fixture(saved), restoredRed = restored.player(0), after = ctfPlayer(restored.ctf.context, restoredRed.actor.id);
  expect(restoredRed.actor.id).not.toBe(red.actor.id); expect(after.lastFraggedCarrier).toBe(3); expect(after.ghostCode).toBe(state.ghostCode); expect(restored.common.get(restoredRed.actor.id)?.score).toBe(42);
  expect(restored.ctf.flags.state(restored.game, 2)).toBe("dropped"); restored.advance(33.9); expect(restored.ctf.flags.state(restored.game, 2)).toBe("dropped");
  restored.advance(34); expect(restored.ctf.flags.state(restored.game, 2)).toBe("base");
  const originalDrop = saved.foundation.entities.find(entity => entity.spawn.classname === "item_flag_team2" && (entity.values.spawnflags & 0x10000) !== 0);
  expect(originalDrop?.callbacks.think).toBe("CTFDropFlagThink"); expect(restored.ctf.context.match.ghosts.get(after.ghostCode ?? 0)?.actor).toBe(restoredRed.actor.id);
});

test("match readiness, delayed spawning, votes, ghost reclaim and admin map permissions", () => {
  const scene = fixture(), red = scene.player(0), mate = scene.player(1), blue = scene.player(2);
  scene.ctf.context.match.phase = "setup"; scene.ctf.context.match.matchTime = 600;
  for (const entity of [red, mate, blue]) expect(scene.ctf.match.ready(entity, scene.game, true)).toBe(true);
  expect(scene.ctf.capture().match.phase).toBe("pregame"); scene.advance(20); scene.ctf.checkRules(scene.game); expect(scene.ctf.capture().match.phase).toBe("game");
  expect(scene.common.get(red.actor.id)?.dead).toBe(true); scene.advance(24); for (const entity of [red, mate, blue]) scene.ctf.beforePlayer(entity, scene.game); expect(scene.common.get(red.actor.id)?.dead).toBe(false);
  const ghost = ctfPlayer(scene.ctf.context, red.actor.id).ghostCode; expect(ghost).not.toBeNull();
  scene.ctf.observer(red, scene.game); expect(scene.ctf.match.restoreGhost(red, scene.game, ghost ?? 0)).toBe(true); expect(ctfPlayer(scene.ctf.context, red.actor.id).team).toBe(1);
  scene.ctf.rules.adminPassword = "private"; expect(scene.ctf.match.admin(red, scene.game, "private")).toBe(true);
  expect(scene.ctf.match.warp(red, scene.game, "../../evil")).toBe(false); expect(scene.destinations).toEqual([]);
  expect(scene.ctf.match.warp(red, scene.game, "Q2CTF3")).toBe(true); expect(scene.destinations).toEqual(["q2ctf3"]);
  scene.ctf.match.configure(red, scene.game, { matchMinutes: 15, setupMinutes: 5, startSeconds: 10, weaponsStay: true, instantItems: true, quadDrop: false, instantWeapons: true, matchLock: false });
  expect(scene.game.options.deathmatchFlags & 20).toBe(20); expect(scene.ctf.context.match.matchTime).toBe(920);
  expect(new TextDecoder().decode(encodeQ2CtfCheckpoint(scene.ctf.capture()))).not.toContain("private");
  expect(scene.ctf.match.beginElection(mate, scene.game, "map", "q2ctf2")).toBe(true); expect(scene.ctf.match.vote(mate, scene.game, true)).toBe(false); expect(scene.ctf.match.vote(blue, scene.game, true)).toBe(true); expect(scene.destinations.at(-1)).toBe("q2ctf2");
});

test("installed original CTF map rows use the registered flags, team starts and banners", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/ctf/pak0.pak");
  try {
    const entry = archive.entries.find(entry => entry.path.toLowerCase() === "maps/q2ctf1.bsp"); if (entry === undefined) throw new Error("Installed CTF archive has no q2ctf1");
    const map = readQ2Bsp(await archive.readEntry(entry)), scene = fixture(), rows = parseQ2Entities(map.entities, "classic").filter(row => /^(item_flag_team[12]|info_player_team[12]|misc_ctf_(small_)?banner)$/.test(row.classname));
    expect(rows.some(row => row.classname === "item_flag_team1")).toBe(true); expect(rows.some(row => row.classname === "item_flag_team2")).toBe(true);
    for (const row of rows) scene.game.spawn(row); scene.advance(0.2);
    const saved = scene.game.capture(); expect(saved.entities.filter(entity => entity.spawn.classname.startsWith("item_flag_team")).every(entity => entity.callbacks.think === "CTFFlagThink")).toBe(true);
    expect(rows.filter(row => row.classname.startsWith("info_player_team")).length).toBeGreaterThan(2);
  } finally { await archive.close(); }
});
