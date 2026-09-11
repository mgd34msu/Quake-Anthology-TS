import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2FoundationHost, Q2GameOptions, Q2PresentationEvent } from "../../../../src/content/q2/foundation/host.ts";
import { createQ2TargetModule } from "../../../../src/content/q2/foundation/targets.ts";
import { createQ2ItemModule } from "../../../../src/content/q2/foundation/items.ts";
import { inhibitQ2Spawn, parseQ2Entities } from "../../../../src/content/q2/foundation/fields.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";

const options: Q2GameOptions = { edition: "classic", mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0,
  maxClients: 4, provider: "q2:official", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" };
const zero = { x: 0, y: 0, z: 0 };

function targetGame(selected: Q2GameOptions = options) {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-foundation"));
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const callbacks = new ActorCallbackTable(actors);
  const inventory = new SharedInventoryTable(actors);
  const events: Q2PresentationEvent[] = [];
  const scheduled = new Map<OwnedActor, number>();
  const players: ActorId[] = [];
  let now = 0;
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  combat.register(createQ2CombatPolicy({ id: options.combatProvider, armor: nativeVictimArmor(() => ({ arithmetic: "binary64", screenFacingDot: 1, q2: { product: selected.edition, ctf: false, alive: true } })),
    context: request => ({ arithmetic: "binary64", player: players.includes(request.target), monster: false, attackerPlayer: false,
      hasEnemy: false, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false,
      friendlyFire: false, nuke: false, noKnockback: true, movable: false, rejectTeamDamage: false, suppressPain: false }) }));
  const host: Q2FoundationHost = { actors, bodies, callbacks, combat, inventory, now: () => now, frameSeconds: () => 0.1, random: () => 0.5,
    schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; },
    touchTriggers: () => undefined,
    trace: () => { throw new Error("This target-only check must not query geometry"); },
    pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true, nearby: () => [],
    players: () => players, isPlayer: actor => players.includes(actor), isMonster: () => false,
    worldActor: () => { throw new Error("This target-only check has no world actor"); },
    inlineModelBounds: () => { throw new Error("This target-only check must not use brush models"); },
    setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined,
    emit: event => { events.push(event); return undefined; }, playerViewState: () => ({ viewAngles: zero, oldVelocity: zero }),
    keyConsumed: () => undefined, prepareLevelChange: () => undefined, transition: () => undefined, diagnostic: () => undefined };
  const items = createQ2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
  const game = new Q2Foundation(host, selected, [createQ2TargetModule(), items]);
  const player = actors.allocateAtSource(options.provider, 1, "q3:character"); players.push(player.id);
  bodies.create(player, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  inventory.create(player, []); game.attachPlayer(player); items.configurePlayer(player, game, true);
  return { game, host, player, items, events, advance(seconds: number) {
    now = seconds;
    const due = [...scheduled].filter(([, when]) => when <= now).sort(([a], [b]) => a.id.slot - b.id.slot);
    for (const [actor] of due) {
      scheduled.delete(actor);
      if (actors.isLive(actor.id)) callbacks.think(actor, { frame: Math.round(seconds * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
  } };
}

describe("Q2 permanent gameplay foundation", () => {
  test("delayed target uses survive freeing their source and resolve an authored secret once", () => {
    const { game, host, player, advance } = targetGame();
    const report = game.load('{ "classname" "trigger_relay" "targetname" "switch" "target" "secret" "delay" "0.2" }\n{ "classname" "target_secret" "targetname" "secret" }');
    const relay = report.spawned[0];
    if (relay === undefined) throw new Error("Missing relay");
    host.callbacks.use(relay.actor, player.id, player.id);
    game.remove(relay);
    advance(0.1); expect(game.counters.foundSecrets).toBe(0);
    advance(0.2); expect(game.counters.foundSecrets).toBe(1); expect(game.targets("secret")).toHaveLength(0);
    expect(host.combat.read(player.id)?.health).toBe(100);
  });

  test("armor salvages through the shared authority and power armor spends the live cell inventory", () => {
    const { game, host, player, items } = targetGame();
    const report = game.load('{ "classname" "item_armor_jacket" }\n{ "classname" "item_armor_combat" }\n{ "classname" "item_power_shield" }');
    for (const entity of report.spawned) items.touch(entity, game, player.id);
    const armor = host.combat.read(player.id)?.armor;
    expect(armor?.kind).toBe("q2"); if (armor?.kind !== "q2") throw new Error("Missing Q2 armor");
    expect(armor.points).toBe(62);
    host.inventory.give(player, "q2:ammo_cells", 40);
    expect(items.use(player, "q2:item_power_shield", game)).toBe(true);
    host.inventory.consume(player, "q2:ammo_cells", 10);
    expect(host.combat.read(player.id)?.armor).toMatchObject({ powerArmor: { kind: "shield", cells: 30 } });
    const inflictor = game.create("test_blaster");
    game.damage(player.id, inflictor, null, 30, 0, zero, zero, zero, 1);
    expect(host.inventory.count(player.id, "q2:ammo_cells")).toBe(20);
    expect(host.combat.read(player.id)?.health).toBe(96);
  });

  test("cooperative cubes consume only the matching identity and ammo packs retain upgraded capacity", () => {
    const { game, host, player, items } = targetGame({ ...options, mode: "coop" });
    const report = game.load('{ "classname" "key_power_cube" } { "classname" "key_power_cube" } { "classname" "trigger_key" "item" "key_power_cube" "target" "opened" } { "classname" "target_secret" "targetname" "opened" } { "classname" "item_pack" }');
    const first = report.spawned[0], second = report.spawned[1], gate = report.spawned[2], pack = report.spawned[4];
    if (first === undefined || second === undefined || gate === undefined || pack === undefined) throw new Error("Missing key fixture actors");
    const other = host.actors.allocateAtSource(options.provider, 2, "q1:character");
    host.bodies.create(other, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
    host.combat.create(other, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
    host.inventory.create(other, []); const otherEntity = game.attachPlayer(other);
    // The host's player query includes foreign character owners in the shared client slots.
    const players = [player.id, other.id]; host.players = () => players; host.isPlayer = actor => players.includes(actor);
    items.touch(first, game, player.id); items.touch(second, game, player.id); items.touch(second, game, player.id);
    items.touch(first, game, other.id);
    expect(host.inventory.count(player.id, "q2:key_power_cube")).toBe(2);
    expect(game.entity(player.id)?.powerCubes).toBe(3); expect(otherEntity.powerCubes).toBe(1);
    host.callbacks.use(gate.actor, player.id, player.id);
    expect(host.inventory.count(player.id, "q2:key_power_cube")).toBe(1);
    expect(host.inventory.count(other.id, "q2:key_power_cube")).toBe(0);
    expect(game.entity(player.id)?.powerCubes).toBe(2); expect(otherEntity.powerCubes).toBe(0);
    expect(game.counters.foundSecrets).toBe(1);
    items.touch(pack, game, player.id); items.configurePlayer(player, game);
    expect(host.inventory.entries(player.id).find(entry => entry.item === "q2:ammo_bullets")).toMatchObject({ count: 50, capacity: 300 });
    expect(host.inventory.entries(player.id).find(entry => entry.item === "q2:ammo_rockets")).toMatchObject({ count: 5, capacity: 100 });
  });

  test("real classic and rerelease base1 preserve authored spawn fields and edition inhibition", async () => {
    const classicArchive = await openArchive(`${import.meta.dir}/../../../../../qfiles/q2/baseq2/pak0.pak`);
    const rereleaseArchive = await openArchive(`${import.meta.dir}/../../../../../qfiles/q2/rerelease/baseq2/pak0.pak`);
    try {
      const classicEntry = classicArchive.findEntries("maps/base1.bsp")[0], rereleaseEntry = rereleaseArchive.findEntries("maps/base1.bsp")[0];
      if (classicEntry === undefined || rereleaseEntry === undefined) throw new Error("Missing supplied base1 fixture");
      const classic = parseQ2Entities(readQ2Bsp(await classicArchive.readEntry(classicEntry)).entities, "classic");
      const rerelease = parseQ2Entities(readQ2Bsp(await rereleaseArchive.readEntry(rereleaseEntry)).entities, "rerelease");
      expect(classic).toHaveLength(634); expect(rerelease).toHaveLength(780);
      expect(classic.filter(entity => entity.classname.startsWith("monster_"))).toHaveLength(19);
      expect(rerelease.find(entity => entity.classname === "target_changelevel")?.values.get("target")).toBe("lm_base1");
      const coopOnly = parseQ2Entities('{ "classname" "target_secret" "spawnflags" "16384" }')[0];
      if (coopOnly === undefined) throw new Error("Missing authored entity");
      expect(inhibitQ2Spawn(coopOnly, options)).toBe(false);
      expect(inhibitQ2Spawn(coopOnly, { ...options, edition: "rerelease" })).toBe(true);
      expect(inhibitQ2Spawn(coopOnly, { ...options, edition: "rerelease", mode: "coop" })).toBe(false);
    } finally { classicArchive.close(); rereleaseArchive.close(); }
  });
});
