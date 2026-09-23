import { SharedOriginalPickupAdmission } from "../../../../src/world/gameplay/original-pickups.ts";
import type { RegularArmorState } from "../../../../src/contracts/gameplay.ts";
import type { OriginalPickupOffer } from "../../../../src/contracts/original-pickups.ts";
import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId, OwnedActor } from "../../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import type { Q2FoundationHost, Q2GameOptions, Q2PresentationEvent } from "../../../../src/content/q2/foundation/host.ts";
import { createQ2TargetModule } from "../../../../src/content/q2/foundation/targets.ts";
import { createQ2ItemModule } from "../../../../src/content/q2/foundation/items.ts";
import { createQ2MoverModule } from "../../../../src/content/q2/foundation/movers.ts";
import { encodeQ2FoundationCheckpoint, decodeQ2FoundationCheckpoint } from "../../../../src/persistence/q2-foundation.ts";
import { encodeQ2ItemsCheckpoint, decodeQ2ItemsCheckpoint } from "../../../../src/persistence/q2-items.ts";
import { encodeQ2MoversCheckpoint, decodeQ2MoversCheckpoint } from "../../../../src/persistence/q2-movers.ts";
import { Q2Monsters, placeTriggeredMonster } from "../../../../src/content/q2/foundation/monsters/index.ts";
import { Q2Weapons } from "../../../../src/content/q2/foundation/weapons/index.ts";
import { checkBottom, walkMove } from "../../../../src/content/q2/foundation/monsters/ai.ts";
import type { TraceResult } from "../../../../src/contracts/scene.ts";
import { inhibitQ2Spawn, parseQ2Entities } from "../../../../src/content/q2/foundation/fields.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../../src/formats/q2-map/index.ts";
import { SharedPickupAdmission } from "../../../../src/world/gameplay/pickups.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../../../src/content/composition/q2-q3-supply.ts";
import { Q3_WEAPON_ITEMS, q3SpawnLoadout } from "../../../../src/content/q3/foundation/arsenal.ts";

const options: Q2GameOptions = { edition: "classic", mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0,
  maxClients: 4, provider: "q2:official", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" };
const zero = { x: 0, y: 0, z: 0 };

test("source train route observes real corner offsets, stops and ambiguous targets without mutation", () => {
  const fixture = targetGame({ ...options, edition: "rerelease" }), { game, movers } = fixture;
  const a = game.spawn({ classname: "path_corner", ordinal: 10, values: new Map([
    ["targetname", "station-a"], ["target", "station-b"], ["origin", "0 0 0"], ["wait", "1"],
  ]) });
  const b = game.spawn({ classname: "path_corner", ordinal: 11, values: new Map([
    ["targetname", "station-b"], ["target", "station-a"], ["origin", "256 0 0"], ["wait", "2"],
  ]) });
  const train = game.spawn({ classname: "func_train", ordinal: 12, values: new Map([["target", "station-a"], ["speed", "100"]]) });
  game.move(train, { bounds: { min: { x: -32, y: -32, z: -8 }, max: { x: 32, y: 32, z: 8 } } });
  const before = movers.capture(game), body = game.body(train);
  const initial = movers.trainRoute(train, game);
  expect(initial?.running).toBe(false);
  expect(initial?.stops).toEqual([
    { actor: a.actor.id, origin: { x: 32, y: 32, z: 8 }, next: b.actor.id, wait: 1, teleport: false },
    { actor: b.actor.id, origin: { x: 288, y: 32, z: 8 }, next: a.actor.id, wait: 2, teleport: false },
  ]);
  expect(movers.capture(game)).toEqual(before); expect(game.body(train)).toEqual(body);
  fixture.advance(0.1); fixture.advance(0.2);
  expect(movers.trainRoute(train, game)?.running).toBe(true);
  expect(movers.trainRoute(train, game)?.destination).toBe(b.actor.id);
  const boardingX = game.body(train).origin.x;
  fixture.advance(0.3); fixture.advance(0.4);
  expect(game.body(train).origin.x).toBeGreaterThan(boardingX);
  train.use?.(train, game, null, null);
  expect(movers.trainRoute(train, game)?.running).toBe(true);
  train.spawnflags |= 2;
  train.use?.(train, game, null, null);
  expect(movers.trainRoute(train, game)?.running).toBe(false);
  game.spawn({ classname: "path_corner", ordinal: 13, values: new Map([["targetname", "station-a"], ["origin", "512 0 0"]]) });
  expect(movers.trainRoute(train, game)).toBeNull();
});

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
  const host: Q2FoundationHost = { actors, bodies, callbacks, combat, inventory, originalPickups: new SharedOriginalPickupAdmission(actors, combat, inventory), now: () => now, gravity: () => 800, frameSeconds: () => 0.1, random: () => 0.5,
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
  const movers = createQ2MoverModule({ pathCorner: () => undefined, combatPoint: () => undefined });
  const game = new Q2Foundation(host, selected, [createQ2TargetModule(), items, movers]);
  const player = actors.allocateAtSource(options.provider, 1, "q3:character"); players.push(player.id);
  bodies.create(player, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  combat.create(player, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  inventory.create(player, []); game.attachPlayer(player); items.configurePlayer(player, game, true);
  return { game, host, player, items, movers, events, advance(seconds: number) {
    const elapsed = seconds - now;
    for (const entity of game.entities.values()) {
      const body = game.body(entity);
      game.move(entity, { origin: { x: body.origin.x + body.velocity.x * elapsed, y: body.origin.y + body.velocity.y * elapsed, z: body.origin.z + body.velocity.z * elapsed } }, false);
    }
    now = seconds;
    const due = [...scheduled].filter(([, when]) => when <= now).sort(([a], [b]) => a.id.slot - b.id.slot);
    for (const [actor] of due) {
      scheduled.delete(actor);
      if (actors.isLive(actor.id)) callbacks.think(actor, { frame: Math.round(seconds * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
    }
  } };
}

describe("Q2 permanent gameplay foundation", () => {
  for (const edition of ["classic", "rerelease"] satisfies readonly Q2GameOptions["edition"][]) {
    for (const authored of [
      { field: "", once: 1, rereleaseLoop: 1 },
      { field: '"attenuation" "0"', once: 1, rereleaseLoop: 1 },
      { field: '"attenuation" "-1"', once: 0, rereleaseLoop: 0 },
      { field: '"attenuation" "1"', once: 1, rereleaseLoop: 0.2 },
      { field: '"attenuation" "2"', once: 2, rereleaseLoop: 0.4 },
      { field: '"attenuation" "3"', once: 3, rereleaseLoop: 1 },
      { field: '"attenuation" "5"', once: 5, rereleaseLoop: 1 },
      { field: '"attenuation" "-2"', once: -2, rereleaseLoop: 1 },
    ]) {
      for (const spawnflags of [1, 2]) {
        test(`speaker ${edition} loop flag ${spawnflags} ${authored.field || "default attenuation"} starts, stops and restarts at source gain and distance`, () => {
          const scene = targetGame({ ...options, edition });
          try {
            const speaker = scene.game.load(`{ "classname" "target_speaker" "noise" "world/mach" "origin" "100 200 300" "volume" "0.25" "spawnflags" "${spawnflags}" ${authored.field} }`).spawned[0];
            if (speaker === undefined) throw new Error("Missing speaker");
            const start: Extract<Q2PresentationEvent, { kind: "sound" }> = { kind: "sound", actor: speaker.actor.id, origin: { x: 100, y: 200, z: 300 }, path: "world/mach.wav", channel: 2,
              volume: 1, attenuation: edition === "classic" ? 1 : authored.rereleaseLoop, reliable: false, loop: "start" };
            if (spawnflags === 2) {
              expect(speaker.sound).toBe("");
              expect(scene.events).toEqual([]);
              scene.host.callbacks.use(speaker.actor, scene.player.id, scene.player.id);
            }
            expect(speaker.sound).toBe("world/mach.wav");
            expect(scene.events).toEqual([start]);
            scene.host.callbacks.use(speaker.actor, scene.player.id, scene.player.id);
            expect(speaker.sound).toBe("");
            expect(scene.events).toEqual([start, { ...start, loop: "stop" }]);
            scene.host.callbacks.use(speaker.actor, scene.player.id, scene.player.id);
            expect(speaker.sound).toBe("world/mach.wav");
            expect(scene.events).toEqual([start, { ...start, loop: "stop" }, start]);
          } finally { scene.host.actors.close(); }
        });
      }
      for (const volume of [0, 0.25]) {
        test(`speaker ${edition} one-shot ${authored.field || "default attenuation"} volume ${volume} retains authored parameters`, () => {
          const scene = targetGame({ ...options, edition });
          try {
            const speaker = scene.game.load(`{ "classname" "target_speaker" "noise" "world/mach.wav" "volume" "${volume}" "spawnflags" "4" ${authored.field} }`).spawned[0];
            if (speaker === undefined) throw new Error("Missing speaker");
            expect(scene.events).toEqual([]);
            const once: Extract<Q2PresentationEvent, { kind: "sound" }> = { kind: "sound", actor: speaker.actor.id, origin: zero, path: "world/mach.wav", channel: 2,
              volume: volume || 1, attenuation: authored.once, reliable: true, loop: "once" };
            scene.host.callbacks.use(speaker.actor, scene.player.id, scene.player.id);
            scene.host.callbacks.use(speaker.actor, scene.player.id, scene.player.id);
            expect(speaker.sound).toBe("");
            expect(scene.events).toEqual([once, once]);
          } finally { scene.host.actors.close(); }
        });
      }
    }
  }

  test("triggered monster placement clears multiple foreign collision lifetimes", () => {
    const { game, host, player } = targetGame(options), victims: OwnedActor[] = [];
    const body = host.bodies.read(player.id); if (body === null) throw new Error("player body");
    for (let i = 0; i < 2; i++) {
      const victim = host.actors.allocate("q1:monsters/classic/id1", "q1:monster_army"); victims.push(victim);
      host.bodies.create(victim, body);
      host.combat.create(victim, { health: 10, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 100, canTakeDamage: true, invulnerable: false, team: null });
      host.callbacks.bind(victim, { think: null, touch: null, use: null, pain: null, die: () => host.actors.release(victim) });
      expect(game.entity(victim.id)).toBeNull();
    }
    let traces = 0;
    host.trace = request => {
      traces++; const victim = victims.find(candidate => host.actors.isLive(candidate.id));
      return { kind: "q2", fraction: victim === undefined ? 1 : 0, startSolid: victim !== undefined, allSolid: victim !== undefined, end: request.end,
        hit: victim === undefined ? { kind: "none" } : { kind: "actor", actor: victim.id }, contact: { kind: "none" }, contents: victim === undefined ? 0 : 0x02000000, surface: null, sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 }, secondary: null };
    };
    placeTriggeredMonster(game, player);
    expect(victims.map(victim => host.actors.isLive(victim.id))).toEqual([false, false]);
    expect(traces).toBe(5);
    expect(host.bodies.read(player.id)?.origin.z).toBe(1);
  });
  test("authored monster drops use the real owner body and source toss continuation", () => {
    const { game, host, items, advance } = targetGame(options);
    const actor = host.actors.allocate("q1:monsters", "q1:monster_army");
    host.bodies.create(actor, { origin: { x: 40, y: 20, z: 24 }, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
    expect(game.entity(actor.id)).toBeNull();
    const dropped = items.dropMonster(actor, game, "Shells");
    if (dropped === null) throw new Error("Missing source FindItem drop");
    expect(dropped.classname).toBe("ammo_shells"); expect(dropped.owner).toBe(actor.id);
    expect(game.body(dropped).origin).toEqual({ x: 40, y: 20, z: 24 });
    expect(game.body(dropped).velocity).toEqual({ x: 100, y: 0, z: 300 });
    expect(dropped.count).toBe(0); expect(dropped.motion).toBe("toss"); expect(dropped.nextThink).toBe(1);
    const saved = () => game.capture().entities.find(entry => entry.actor.slot === dropped.actor.id.slot);
    expect(saved()?.callbacks.touch).toBe("drop_temp_touch");
    advance(1);
    expect(dropped.owner).toBe(actor.id); expect(saved()?.callbacks.touch).toBe("Touch_Item");
  });
  test("selected Q3 supply consumes retail base1 weapons and preserves Q2 refusal, drops and respawn", async () => {
    const archive = await openArchive(`${import.meta.dir}/../../../../../qfiles/q2/baseq2/pak0.pak`);
    try {
      const entry = archive.findEntries("maps/base1.bsp")[0];
      if (entry === undefined) throw new Error("Missing base1");
      const authored = parseQ2Entities(readQ2Bsp(await archive.readEntry(entry)).entities).find(entity => entity.classname === "weapon_shotgun");
      if (authored === undefined) throw new Error("Missing retail shotgun");
      for (const mode of ["singleplayer", "coop", "deathmatch"] satisfies readonly Q2GameOptions["mode"][]) {
        const { game, host, player, items, events, advance } = targetGame({ ...options, mode });
        host.trace = request => ({ kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end,
          contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null,
          sourcePlane: { normal: zero, distance: 0, type: 0, signbits: 0 }, secondary: null });
        for (const item of q3SpawnLoadout("q3:arsenal", "baseq3", false).ammo) host.inventory.configure(player, item);
        for (const mapping of Q2_Q3_SUPPLY_PROFILE.weapons) for (const destination of mapping.destinations) expect(Q3_WEAPON_ITEMS.some(item => item.item === destination)).toBe(true);
        const selected: string[] = [];
        const selections: string[] = [];
        const admission = new SharedPickupAdmission({ inventory: host.inventory, profile: Q2_Q3_SUPPLY_PROFILE,
          ammoGranted: () => undefined, weaponGranted: (_actor, weapons, selection) => { selected.push(...weapons); selections.push(selection); return undefined; } });
        items.setPickupAdmission(admission);
        const shotgun = game.create(authored.classname, authored.values); expect(items.spawn(shotgun, game)).toBe(true);
        expect(items.observeSupply(game, shotgun.actor.id, player.id)?.availability.kind).toBe("inactive");
        advance(0.2);
        const beforeObservation = { inventory: host.inventory.entries(player.id), items: items.capture(game), events: events.length, selected: [...selected] };
        const health = host.combat.read(player.id)?.health;
        if (health === undefined) throw new Error("Missing recipient health");
        host.combat.setHealth(player, 0.5);
        expect(items.observeSupply(game, shotgun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: false });
        items.touch(shotgun, game, player.id);
        expect({ inventory: host.inventory.entries(player.id), items: items.capture(game), events: events.length, selected: [...selected] }).toEqual(beforeObservation);
        host.combat.setHealth(player, 1);
        expect(items.observeSupply(game, shotgun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: true });
        host.combat.setHealth(player, health);
        const observation = items.observeSupply(game, shotgun.actor.id, player.id);
        if (observation === null) throw new Error("Actual shotgun supply missing");
        expect(observation.availability).toEqual({ kind: "ready", eligible: true });
        const preview = admission.preview(player.id, observation.offer);
        expect(items.previewSupply(game, shotgun.actor.id, player.id)).toEqual(preview);
        expect(preview.ammo).toEqual([{ item: "q3:ammo/shotgun", before: 0, given: 10 }]);
        expect({ inventory: host.inventory.entries(player.id), items: items.capture(game), events: events.length, selected: [...selected] }).toEqual(beforeObservation);
        items.touch(shotgun, game, player.id);
        expect(host.inventory.count(player.id, "q3:weapon/shotgun")).toBe(1);
        expect(host.inventory.count(player.id, "q3:ammo/shotgun")).toBe(10);
        expect(host.inventory.count(player.id, "q2:weapon_shotgun")).toBe(0);
        expect(selected).toEqual(["q3:weapon/shotgun"]);
        expect(selections).toEqual(["always"]);
        if (mode === "coop") {
          expect(items.observeSupply(game, shotgun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: false });
          items.touch(shotgun, game, player.id); expect(host.inventory.count(player.id, "q3:ammo/shotgun")).toBe(10);
        }
        if (mode === "deathmatch") {
          expect(host.actors.isLive(shotgun.actor.id)).toBe(true); expect(shotgun.visible).toBe(false);
          expect(items.observeSupply(game, shotgun.actor.id, player.id)?.availability).toEqual({ kind: "respawning", atSeconds: 30.2 });
          advance(30.2);
          expect(items.observeSupply(game, shotgun.actor.id, player.id)?.availability).toEqual({ kind: "ready", eligible: true });
        }
        if (mode === "singleplayer") expect(host.actors.isLive(shotgun.actor.id)).toBe(false);
        for (const flags of [0x10000, 0x20000]) {
          const dropped = game.create("weapon_shotgun", new Map([["spawnflags", String(flags)]])); items.spawn(dropped, game);
          expect(items.observeSupply(game, dropped.actor.id, player.id)?.offer).toEqual({ kind: "weapon", offer: {
            item: "q2:weapon_shotgun", ammo: flags === 0x10000 ? [] : [{ item: "q2:ammo_shells", amount: 10 }] } });
          const before = host.inventory.count(player.id, "q3:ammo/shotgun"); items.touch(dropped, game, player.id);
          expect(host.inventory.count(player.id, "q3:ammo/shotgun")).toBe(before + (flags === 0x10000 ? 0 : 10));
          expect(host.actors.isLive(dropped.actor.id)).toBe(false);
        }
        host.inventory.give(player, "q3:ammo/grenadelauncher", 200);
        host.inventory.give(player, "q2:ammo_grenades", 50);
        const report = game.load('{ "classname" "ammo_grenades" "target" "attempt" } { "classname" "target_secret" "targetname" "attempt" }');
        const grenades = report.spawned[0]; if (grenades === undefined) throw new Error("Missing grenades");
        items.touch(grenades, game, player.id); items.touch(grenades, game, player.id);
        expect(game.counters.foundSecrets).toBe(mode === "deathmatch" ? 0 : 1); expect(host.actors.isLive(grenades.actor.id)).toBe(true);
        expect(host.inventory.count(player.id, "q3:weapon/grenadelauncher")).toBe(0);
        host.inventory.consume(player, "q3:ammo/grenadelauncher", 200); host.inventory.consume(player, "q2:ammo_grenades", 50); grenades.count = 3;
        items.touch(grenades, game, player.id);
        expect(host.inventory.count(player.id, "q3:ammo/grenadelauncher")).toBe(3);
        expect(host.inventory.count(player.id, "q3:weapon/grenadelauncher")).toBe(1);
        expect(host.inventory.count(player.id, "q2:ammo_grenades")).toBe(3);
        expect(selections).toEqual(["always", "never", "never", "always"]);
        const cells = game.create("ammo_cells"), shield = game.create("item_power_shield");
        items.spawn(cells, game); items.spawn(shield, game);
        items.touch(cells, game, player.id); items.touch(shield, game, player.id);
        expect(host.inventory.count(player.id, "q2:ammo_cells")).toBe(50);
        expect(host.inventory.count(player.id, "q3:ammo/plasmagun")).toBe(50);
        expect(host.inventory.count(player.id, "q3:ammo/lightning")).toBe(50);
        expect(host.inventory.count(player.id, "q3:ammo/bfg")).toBe(50);
        if (mode !== "deathmatch") expect(items.use(player, "q2:item_power_shield", game)).toBe(true);
        expect(host.combat.read(player.id)?.armor).toMatchObject({ powered: { kind: "shield", cells: 50 } });
        host.inventory.consume(player, "q2:ammo_cells", 10);
        expect(host.combat.read(player.id)?.armor).toMatchObject({ powered: { kind: "shield", cells: 40 } });
        expect(host.inventory.count(player.id, "q3:ammo/plasmagun")).toBe(50);
      }
      const native = targetGame(options);
      const grenade = native.game.create("ammo_grenades"); native.items.spawn(grenade, native.game);
      const beforeGrenade = { inventory: native.host.inventory.entries(native.player.id), source: native.items.capture(native.game), events: native.events.length };
      const grenadePreview = native.items.previewSupply(native.game, grenade.actor.id, native.player.id);
      expect(grenadePreview).toEqual({ accepted: true, ammo: [{ item: "q2:ammo_grenades", before: 0, given: 5 }], weapons: [{ item: "q2:ammo_grenades", before: 0, given: 5 }] });
      expect(grenadePreview?.weapons[0]).toBe(grenadePreview?.ammo[0]);
      expect({ inventory: native.host.inventory.entries(native.player.id), source: native.items.capture(native.game), events: native.events.length }).toEqual(beforeGrenade);
      native.items.touch(grenade, native.game, native.player.id);
      expect(native.host.inventory.count(native.player.id, "q2:ammo_grenades")).toBe(5);

      const nativeShotgun = native.game.create(authored.classname, authored.values); native.items.spawn(nativeShotgun, native.game);
      const nativeObservation = native.items.observeSupply(native.game, nativeShotgun.actor.id, native.player.id);
      if (nativeObservation === null) throw new Error("Native shotgun supply missing");
      const before = native.host.inventory.entries(native.player.id);
      const expected = native.items.previewSupply(native.game, nativeShotgun.actor.id, native.player.id);
      if (expected === null) throw new Error("Native shotgun preview missing");
      expect(native.host.inventory.entries(native.player.id)).toEqual(before);
      native.items.touch(nativeShotgun, native.game, native.player.id);
      for (const receipt of [...expected.weapons, ...expected.ammo]) expect(native.host.inventory.count(native.player.id, receipt.item)).toBe(receipt.before + receipt.given);
      expect(native.items.observeSupply(native.game, nativeShotgun.actor.id, native.player.id)).toBeNull();
    } finally { archive.close(); }
  });
  test("source gravity direction supports ceiling walking and ceiling water sampling independently of gravity strength", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2GameOptions["edition"][]) {
      const scene = targetGame({ ...options, edition });
      const world = scene.host.actors.allocateAtSource(options.provider, 0, "q2:worldspawn");
      let wet = false, steep = false, touches = 0;
      scene.host.worldActor = () => world.id; scene.host.players = () => []; scene.host.inPvs = () => false;
      scene.host.touchTriggers = () => { touches++; return undefined; };
      scene.host.pointContents = point => point.z > 128 ? 1 : wet && point.z >= 126 ? 32 : 0;
      scene.host.trace = request => {
        const normal = steep ? { x: 0.8, y: 0, z: -0.6 } : { x: 0, y: 0, z: -1 };
        const plane = { normal, distance: -128, type: 2, signbits: 4 };
        const clear: TraceResult = { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
        const offset = request.bounds?.max.z ?? 0, from = request.start.z + offset, to = request.end.z + offset;
        if (to <= from || to < 128) return clear;
        const fraction = Math.max(0, (128 - from) / (to - from));
        return { ...clear, fraction, startSolid: from > 128, allSolid: from > 128, end: {
          x: request.start.x + (request.end.x - request.start.x) * fraction, y: request.start.y + (request.end.y - request.start.y) * fraction, z: 128 - offset },
          hit: { kind: "world", model: 0 }, contact: { kind: "plane", plane }, contents: 1 };
      };
      const weapons = new Q2Weapons({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
      const monsters = new Q2Monsters(weapons), entity = scene.game.create("monster_soldier_light", new Map([["origin", "0 0 60"]]));
      entity.gravityVector = { x: 0, y: 0, z: 1 }; entity.gravity = 1.3;
      expect(monsters.spawn(entity, scene.game)).toBe(true);
      const context = monsters.context(entity.actor.id); if (context === null) throw new Error("Missing source ceiling monster");
      scene.advance(0.1);
      expect(scene.game.body(entity).origin.z).toBe(96); expect(scene.game.body(entity).ground).toBe(world.id);
      expect(checkBottom(context, scene.game.body(entity).origin)).toBe(true);
      expect(walkMove(context, 0, 8)).toBe(true); expect(scene.game.body(entity).origin).toEqual({ x: 8, y: 0, z: 96 }); expect(touches).toBe(1);
      // Force the source slow support check, including rerelease quadrant hulls.
      scene.host.pointContents = point => wet && point.z >= 126 && point.z <= 128 ? 32 : 0;
      expect(checkBottom(context, scene.game.body(entity).origin)).toBe(true);
      wet = true; scene.advance(0.2); expect(context.state.waterLevel).toBe(1);
      const saved = decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(scene.game.capture())).entities.find(value => value.actor.slot === entity.actor.id.slot);
      expect(saved?.values.gravityVector).toEqual({ x: 0, y: 0, z: 1 }); expect(saved?.values.gravity).toBe(1.3);
      steep = true; scene.game.link(entity); scene.advance(0.31); expect(scene.game.body(entity).ground).toBeNull();
      steep = false; scene.game.move(entity, { ground: world.id, velocity: { x: 0, y: 0, z: -101 } }); scene.advance(0.42);
      expect(scene.game.body(entity).ground).toBeNull();
      scene.host.actors.close();
    }
  });

  test("fresh source restore continues a moving door, delayed secret, speaker and megahealth timers", () => {
    const scene = targetGame();
    scene.host.inlineModelBounds = model => {
      if (model !== 1) throw new Error("Only the isolated door brush is present");
      return { min: zero, max: { x: 64, y: 32, z: 32 } };
    };
    const loaded = scene.game.load('{ "classname" "func_door" "model" "*1" "healthtarget" "health-trigger" "itemtarget" "item-trigger" "targetname" "door" "speed" "100" "wait" "2" } { "classname" "trigger_relay" "targetname" "relay" "target" "secret" "delay" "0.5" } { "classname" "target_secret" "targetname" "secret" } { "classname" "item_health_mega" } { "classname" "target_speaker" "targetname" "speaker" "noise" "world/mach" "spawnflags" "2" }');
    const door = loaded.spawned[0], relay = loaded.spawned[1], mega = loaded.spawned[3], speaker = loaded.spawned[4];
    if (door === undefined || relay === undefined || mega === undefined || speaker === undefined) throw new Error("Missing source save actors");
    expect(door.healthTarget).toBe("health-trigger"); expect(door.itemTarget).toBe("item-trigger"); expect(door.alpha).toBe(1);
    door.healthTarget = ""; door.itemTarget = ""; door.alpha = 0.25;
    scene.game.show(door);
    expect([...scene.events].reverse().find(event => event.kind === "model" && event.actor === door.actor.id)).toMatchObject({ alpha: 0.25 });
    scene.items.touch(mega, scene.game, scene.player.id);
    scene.advance(0.1);
    scene.host.callbacks.use(door.actor, scene.player.id, scene.player.id);
    scene.host.callbacks.use(relay.actor, scene.player.id, scene.player.id);
    scene.host.callbacks.use(speaker.actor, scene.player.id, scene.player.id);
    door.beam = relay.actor.id; scene.game.remove(relay);
    scene.advance(0.2);
    const source = decodeQ2FoundationCheckpoint(encodeQ2FoundationCheckpoint(scene.game.capture()));
    const itemState = decodeQ2ItemsCheckpoint(encodeQ2ItemsCheckpoint(scene.items.capture(scene.game)));
    const moverState = decodeQ2MoversCheckpoint(encodeQ2MoversCheckpoint(scene.movers.capture(scene.game)));
    const actors = SessionActorRegistry.restore(createIdentityOwner("q2-foundation-restored"), scene.host.actors.checkpoint(), scene.host.actors.sourceCheckpoint());
    const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
    const inventory = new SharedInventoryTable(actors), combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    for (const entry of scene.host.actors.observations()) {
      const actor = actors.resolveSaved(entry.id), body = scene.host.bodies.read(entry.id), state = scene.host.combat.read(entry.id);
      if (actor === null) throw new Error("Missing restored shared actor");
      if (body !== null) bodies.create(actor, { ...body, ground: body.ground === null ? null : actors.referenceSaved(body.ground) });
      if (state !== null) combat.create(actor, state);
      if (scene.host.inventory.has(entry.id)) inventory.create(actor, scene.host.inventory.entries(entry.id));
    }
    let now = 0.2;
    const events: Q2PresentationEvent[] = [], scheduled = new Map<OwnedActor, number>(), player = actors.referenceSaved(scene.player.id);
    const host: Q2FoundationHost = { ...scene.host, actors, callbacks, bodies, combat, inventory, now: () => now,
      players: () => [player], isPlayer: actor => actor === player,
      random: () => { throw new Error("Restoration and this continuation must not consume spawn randomness"); },
      emit: event => { events.push(event); return undefined; },
      schedule: (actor, due) => { if (due === null) scheduled.delete(actor); else scheduled.set(actor, due); return undefined; } };
    const items = createQ2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
    const movers = createQ2MoverModule({ pathCorner: () => undefined, combatPoint: () => undefined });
    const game = new Q2Foundation(host, options, [createQ2TargetModule(), items, movers]);
    game.restore(source); items.restore(game, itemState); movers.restore(game, moverState);
    expect(events).toHaveLength(0);
    expect(game.capture()).toEqual(source);
    expect(items.capture(game)).toEqual(itemState); expect(movers.capture(game)).toEqual(moverState);
    const restoredDoor = game.entity(actors.referenceSaved(door.actor.id)), restoredSpeaker = game.entity(actors.referenceSaved(speaker.actor.id));
    if (restoredDoor === null || restoredSpeaker === null) throw new Error("Missing restored source actors");
    expect(restoredDoor.healthTarget).toBe(""); expect(restoredDoor.itemTarget).toBe(""); expect(restoredDoor.alpha).toBe(0.25);
    expect(restoredDoor.beam?.slot).toBe(relay.actor.id.slot); expect(game.entity(restoredDoor.beam)).toBeNull();
    expect(restoredSpeaker.sound).toBe("world/mach.wav");
    for (const entity of game.entities.values()) if (entity.nextThink !== null) host.schedule(entity.actor, entity.nextThink);
    for (let tick = 3; tick <= 50; tick++) {
      const next = tick / 10, elapsed = next - now;
      for (const entity of game.entities.values()) {
        const body = game.body(entity);
        game.move(entity, { origin: { x: body.origin.x + body.velocity.x * elapsed, y: body.origin.y + body.velocity.y * elapsed, z: body.origin.z + body.velocity.z * elapsed } }, false);
      }
      now = next; scene.advance(now);
      for (const [actor] of [...scheduled].filter(([, due]) => due <= now).sort(([a], [b]) => a.id.slot - b.id.slot)) {
        scheduled.delete(actor);
        if (actors.isLive(actor.id)) callbacks.think(actor, { frame: tick, time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
      }
    }
    expect(game.counters.foundSecrets).toBe(1); expect(combat.read(player)?.health).toBe(199);
    expect(game.body(restoredDoor).origin.x).toBeCloseTo(0, 10);
    expect(game.body(restoredDoor)).toEqual(scene.game.body(door));
    expect(game.capture()).toEqual(scene.game.capture());
    expect(items.capture(game)).toEqual(scene.items.capture(scene.game)); expect(movers.capture(game)).toEqual(scene.movers.capture(scene.game));
    callbacks.use(restoredSpeaker.actor, player, player);
    expect(events.at(-1)).toMatchObject({ kind: "sound", path: "world/mach.wav", loop: "stop" });
    actors.close(); scene.host.actors.close();
  });

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
    expect(armor?.regular.kind).toBe("q2"); if (armor?.regular.kind !== "q2") throw new Error("Missing Q2 armor");
    expect(armor.regular.points).toBe(62);
    host.inventory.give(player, "q2:ammo_cells", 40);
    expect(items.use(player, "q2:item_power_shield", game)).toBe(true);
    host.inventory.consume(player, "q2:ammo_cells", 10);
    expect(host.combat.read(player.id)?.armor).toMatchObject({ powered: { kind: "shield", cells: 30 } });
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
    host.combat.create(other, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
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


test("Q2 original pickup scope includes eligibility, refused targets and accepted map respawn", () => {
  const { game, host, player, items } = targetGame({ ...options, mode: "deathmatch" });
  let armor: RegularArmorState = { kind: "source", points: 400, item: "mod:original-armor" };
  const offers: OriginalPickupOffer[] = [];
  const remove = host.combat.bindProtection(player, { channel: "regular", owner: "mod:original-pickup", rule: "armor", admission: { kind: "replace-current-primary" }, inventoryItems: [],
    read: () => armor, validateWrite: () => undefined, write: next => { armor = next; return undefined; }, absorb: () => ({ saved: 0 }),
    pickups: [{ id: "armor", offered: ["q2:item_armor_jacket", "q2:item_armor_combat"], take: (offer, stores) => {
      offers.push(offer); if (offer.item === "q2:item_armor_combat") return "refused";
      const before = armor; armor = { kind: "source", points: 419, item: "mod:original-upgrade" };
      stores.stored({ regular: { before, after: armor } }); return "accepted";
    } }] });
  const [accepted, refused] = game.load('{ "classname" "item_armor_jacket" "target" "again" "count" "17" } { "classname" "item_armor_combat" "target" "again" }').spawned;
  if (accepted === undefined || refused === undefined) throw new Error("Missing map pickups");
  let targets = 0, eligibility = 0;
  items.setPickupPolicy({ canPickup: () => true, beforePickup: () => { eligibility++; return true; }, afterPickup: () => undefined, keepAfterPickup: () => false });
  const target = game.create("pickup_scope_target"); target.targetname = "again";
  target.use = (_entity, _game, other) => {
    targets++;
    const item = game.entity(other); if (item !== null) items.touch(item, game, player.id);
    return undefined;
  };
  items.touch(accepted, game, player.id);
  expect(offers).toHaveLength(1); expect(eligibility).toBe(1); expect(targets).toBe(1);
  expect(offers[0]).toMatchObject({ item: "q2:item_armor_jacket", count: { kind: "override", amount: 17 }, source: accepted.actor.owner,
    defaultResource: { kind: "protection", channel: "regular" } });
  expect(accepted.nextThink).toBe(20); expect(accepted.visible).toBe(false); expect(host.actors.isLive(accepted.actor.id)).toBe(true);
  items.touch(refused, game, player.id);
  expect(offers).toHaveLength(2); expect(eligibility).toBe(2); expect(targets).toBe(2);
  expect(host.actors.isLive(refused.actor.id)).toBe(true);
  expect(host.combat.read(player.id)?.armor.regular).toEqual(armor);
  remove(); expect(host.combat.read(player.id)?.armor.regular).toEqual({ kind: "none" });
  host.actors.close();
});
