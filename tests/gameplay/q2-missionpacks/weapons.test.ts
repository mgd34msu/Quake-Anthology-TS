import { SharedPickupAdmission } from "../../../src/world/gameplay/pickups.ts";
import { expansionSourceSupply } from "../../../src/content/composition/expansion-source-supply.ts";
import { Q2_Q1_SUPPLY_PROFILE } from "../../../src/content/composition/q2-q1-supply.ts";
import { registerSelectedQ2MissionWeapons } from "../../../src/content/composition/q2-expansion-arsenal.ts";
import { Q2SelectedArsenal } from "../../../src/app/bootstrap/simulation/arsenal/q2.ts";
import { q2PowerupTimers } from "../../../src/app/bootstrap/simulation/powerup-timers.ts";
import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import type { DamageOutcome, InventoryEntry } from "../../../src/contracts/gameplay.ts";
import type { Bounds, Vec3 } from "../../../src/contracts/math.ts";
import type { TraceResult } from "../../../src/contracts/scene.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/index.ts";
import { Q2Foundation } from "../../../src/content/q2/foundation/runtime.ts";
import type { Q2Edition, Q2FoundationHost, Q2PresentationEvent, Q2TraceRequest } from "../../../src/content/q2/foundation/host.ts";
import { Q2Weapons, Q2WeaponState, Q2_BASE_WEAPONS } from "../../../src/content/q2/foundation/weapons/index.ts";
import type { Q2WeaponEvent, Q2WeaponInput, Q2WeaponName } from "../../../src/content/q2/foundation/weapons/index.ts";
import { Q2MissionPackProjectiles } from "../../../src/content/q2/missionpacks/projectiles/index.ts";
import { Q2MissionPackWeapons } from "../../../src/content/q2/missionpacks/weapons/player.ts";
import { canonicalCauseFromNative, nativeCauseFromCanonical } from "../../../src/content/q2/missionpacks/damage.ts";
import { encodeQ2WeaponsCheckpoint, decodeQ2WeaponsCheckpoint } from "../../../src/persistence/q2-weapons.ts";
import { Q2ItemModule } from "../../../src/content/q2/foundation/items.ts";
import { Q2MoverModule } from "../../../src/content/q2/foundation/movers.ts";
import { registerQ2MissionPackArmory, Q2MissionPackEntities } from "../../../src/content/q2/missionpacks/index.ts";
import { Q2Tag } from "../../../src/content/q2/missionpacks/modes/tag.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { readQ2Bsp } from "../../../src/formats/q2-map/index.ts";
import { parseQ2Entities, inhibitQ2Spawn } from "../../../src/content/q2/foundation/fields.ts";
import type { Q2MissionPack } from "../../../src/content/q2/missionpacks/types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const forward: Vec3 = { x: 1, y: 0, z: 0 };
const plane = { normal: { x: -1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 1 };
function clearTrace(request: Q2TraceRequest): TraceResult {
  return { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, contact: { kind: "none" }, hit: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
}

describe("mission-pack source weapons", () => {
  test("selected expansion arsenal uses registered inventory, native selectors and handoffs", () => {
    for (const pack of ["xatrix", "rogue"] satisfies readonly Q2MissionPack[]) {
      const scene = fixture("classic");
      try {
        const projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
        new Q2MissionPackWeapons(projectiles).register(scene.weapons, pack);
        const definitions = scene.weapons.registeredDefinitions();
        const inventoryDefinitions = definitions.flatMap(definition => definition.ammo === null
          ? [{ item: definition.item, capacity: 1 }]
          : [{ item: definition.item, capacity: 200 }, { item: definition.ammo, capacity: 200 }]);
        const options = { game: scene.game, weapons: scene.weapons, inventoryDefinitions,
          observe: () => ({ owner: scene.self, input: { ...input, attack: false } }) };
        expect(() => new Q2SelectedArsenal(options)).toThrow("explicit pickup preference");
        const arsenal = new Q2SelectedArsenal({ ...options, pickupOrder: definitions.map(definition => definition.item) });
        arsenal.remove(scene.player.id);
        arsenal.admit(scene.player, 100);
        for (const definition of definitions) {
          scene.inventory.configure(scene.player, { item: definition.item, count: 1, capacity: 200 });
          if (definition.ammo !== null) scene.inventory.configure(scene.player, { item: definition.ammo, count: 100, capacity: 200 });
          expect(arsenal.select(scene.player.id, definition.item)).toBe(true);
          expect(arsenal.handoff(scene.player.id).accepts(definition.item)).toBe(true);
          expect(arsenal.read(scene.player.id).ammo.some(entry => entry.item === definition.item)).toBe(true);
        }
        const extension = scene.weapons.definition(pack === "xatrix" ? "phalanx" : "heatbeam");
        arsenal.handoff(scene.player.id).holster();
        for (let frame = 0; frame < 100 && !arsenal.handoff(scene.player.id).isHolstered(); frame++) {
          scene.setTime(frame / 10); arsenal.frame(scene.player.id);
        }
        expect(arsenal.handoff(scene.player.id).isHolstered()).toBe(true);
        arsenal.handoff(scene.player.id).resume(extension.item);
        expect(arsenal.read(scene.player.id).activeWeapon).toBe(extension.item);
        expect(arsenal.view(scene.player.id)?.path).toBe(extension.viewModel);
        arsenal.pickupWeapons(scene.player, ["q2:weapon_shotgun"], "never");
        expect(arsenal.pendingWeapon(scene.player.id)).toBe(null);
      } finally { scene.actors.close(); }
    }
  });

  test("selected weapon respawn interval leaves ammunition timers unchanged", () => {
    const scene = fixture("rerelease", "blaster", 0.025, "deathmatch");
    try {
      const items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined, weaponRespawnSeconds: () => 7.5 });
      items.configurePlayer(scene.player, scene.game);
      scene.inventory.configure(scene.player, { item: "q2:ammo_shells", count: 0, capacity: 100 });
      const weapon = scene.game.create("weapon_shotgun"), ammo = scene.game.create("ammo_shells");
      expect(items.spawn(weapon, scene.game)).toBe(true); expect(items.spawn(ammo, scene.game)).toBe(true);
      items.touch(weapon, scene.game, scene.player.id); items.touch(ammo, scene.game, scene.player.id);
      expect(weapon.nextThink).toBe(7.5);
      expect(ammo.nextThink).toBe(30);
      expect(scene.inventory.count(scene.player.id, "q2:weapon_shotgun")).toBe(1);
    } finally { scene.actors.close(); }
  });

  test("external handoff exits expansion repeat and held-throw paths through source runners", () => {
    for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const name of ["trap", "tesla", "heatbeam", "chainfist", "etf_rifle"]) {
      const scene = fixture(edition), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
      new Q2MissionPackWeapons(projectiles).register(scene.weapons, name === "trap" ? "xatrix" : "rogue", edition);
      const definition = scene.weapons.definition(name);
      scene.inventory.configure(scene.player, { item: definition.item, count: 20, capacity: 200 });
      if (definition.ammo !== null) scene.inventory.configure(scene.player, { item: definition.ammo, count: 20, capacity: 200 });
      scene.state.weapon = name; scene.state.phase = "ready"; scene.state.frame = definition.fireLast + 1;
      for (let frame = 0; frame <= 11; frame++) scene.step(frame / 10);
      scene.weapons.requestHolster(scene.self);
      for (let frame = 12; frame <= 100 && !scene.weapons.isHolstered(scene.self); frame++) scene.step(frame / 10);
      expect(scene.weapons.isHolstered(scene.self)).toBe(true); expect(scene.state.weapon).toBe(name);
      const inventory = scene.inventory.entries(scene.player.id);
      scene.step(11); expect(scene.inventory.entries(scene.player.id)).toEqual(inventory);
      scene.weapons.resumePrimary(scene.self, scene.game, { ...input, attack: false }, name);
      expect(scene.state.primaryHandoff).toBe("active"); expect(scene.weapons.states.get(scene.player.id)?.phase).toBe("activating");
    }
  });

  test("Rogue substitutes Xatrix item descriptors and classic random respawn replaces the source actor", () => {
    const scene = fixture("classic", "blaster", 0.1, "deathmatch");
    let armory: ReturnType<typeof registerQ2MissionPackArmory> | null = null;
    const settings = { enabled: true, noMines: false, noNukes: false, noSpheres: false };
    const items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined,
      randomRespawn: (entity, game) => armory?.items.randomRespawn(entity, game, settings) ?? null });
    armory = registerQ2MissionPackArmory("rogue", { weapons: scene.weapons, items, monster: () => null, playerEffect: () => undefined, hunterCamera: false, intermission: () => false });
    const ammo = scene.game.create("ammo_magslug");
    expect(armory.items.spawn(ammo, scene.game)).toBe(true); expect(ammo.classname).toBe("ammo_magslug");
    expect(items.itemDefinition(ammo)?.classname).toBe("ammo_flechettes");
    items.configurePlayer(scene.player, scene.game); items.touch(ammo, scene.game, scene.player.id);
    expect(scene.inventory.count(scene.player.id, "q2:ammo_flechettes")).toBe(50);
    const before = ammo.actor.id; scene.setTime(30); ammo.think?.(ammo, scene.game);
    expect(scene.actors.isLive(before)).toBe(false);
    const replacement = [...scene.game.entities.values()].find(entity => entity.classname === "ammo_rockets");
    expect(replacement?.solid).toBe("trigger"); expect(replacement?.nextThink).toBe(30.2);
    const compass = scene.game.create("item_compass"); expect(armory.items.spawn(compass, scene.game)).toBe(true);
    items.touch(compass, scene.game, scene.player.id); expect(items.use(scene.player, "q2:item_compass", scene.game)).toBe(true);
    expect(scene.presentation.some(event => event.kind === "print" && event.text === "Origin: 0,0,0    Dir: 0\n")).toBe(true);
    scene.actors.close();
  });

  test("Xatrix weapon selection cycles HyperBlaster and chooses Phalanx when rail ammo is exhausted", () => {
    const scene = fixture("classic"), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
    new Q2MissionPackWeapons(projectiles).register(scene.weapons, "xatrix");
    scene.inventory.configure(scene.player, { item: "q2:weapon_boomer", count: 1, capacity: 1 });
    scene.inventory.configure(scene.player, { item: "q2:weapon_phalanx", count: 1, capacity: 1 });
    scene.inventory.configure(scene.player, { item: "q2:ammo_magslug", count: 1, capacity: 50 });
    scene.inventory.consume(scene.player, "q2:ammo_slugs", 200);
    scene.state.weapon = "hyperblaster";
    expect(scene.weapons.requestWeapon(scene.self, scene.game, "hyperblaster")).toBe("selected"); expect(scene.state.pending).toBe("ionripper");
    expect(scene.weapons.requestWeapon(scene.self, scene.game, "railgun")).toBe("selected"); expect(scene.state.pending).toBe("phalanx");
    scene.actors.close();
  });

  test("retail expansion entity rows spawn through their source handlers with the map brush bounds", async () => {
    const classes = new Set(["rotating_light", "func_object_repair", "misc_viper_missile", "misc_amb4", "misc_nuke", "misc_crashviper", "misc_transport", "target_mal_laser", "info_teleport_destination", "trigger_teleport", "trigger_disguise", "target_steam", "target_anger", "target_killplayers", "target_blacklight", "target_orb", "misc_nuke_core", "func_plat2", "func_door_secret2", "func_force_wall"]);
    const seen = new Map<string, number>(), diagnostics: string[] = [];
    for (const pack of ["xatrix", "rogue"] satisfies readonly Q2MissionPack[]) {
      const archive = await openArchive(`/home/buzzkill/Projects/qfiles/q2/${pack}/pak0.pak`);
      try {
        for (const entry of archive.entries) {
          if (!entry.path.endsWith(".bsp")) continue;
          const map = readQ2Bsp(await archive.readEntry(entry)), scene = fixture("classic", "blaster", 0.1, "singleplayer", message => { diagnostics.push(`${pack}/${entry.path}: ${message}`); });
          const projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
          const entities = new Q2MissionPackEntities(pack, { movers: new Q2MoverModule({ pathCorner: () => undefined, combatPoint: () => undefined }), weapons: scene.weapons, projectiles, teleportPlayer: () => undefined, targetAnger: () => undefined, emit: () => undefined });
          for (const [index, model] of map.models.entries()) scene.inlineBounds.set(index, model.bounds);
          for (const row of parseQ2Entities(map.entities, "classic")) {
            if (!classes.has(row.classname) || inhibitQ2Spawn(row, scene.game.options)) continue;
            const entity = scene.game.create(row.classname, row.values);
            expect(entities.spawn(entity, scene.game)).toBe(true);
            seen.set(row.classname, (seen.get(row.classname) ?? 0) + 1);
            if (entity.solid === "brush") {
              const expected = scene.inlineBounds.get(Number(entity.model.slice(1)));
              if (expected === undefined) throw new Error(`Retail brush ${entity.model} is missing`);
              expect(scene.game.body(entity).bounds).toEqual(expected);
            }
          }
          scene.actors.close();
        }
      } finally { await archive.close(); }
    }
    expect([...seen.values()].reduce((sum, count) => sum + count, 0)).toBeGreaterThan(100);
    expect(seen.has("func_plat2")).toBe(true); expect(seen.has("func_object_repair")).toBe(true);
    expect(diagnostics).toEqual(["rogue/maps/rmine2.bsp: target_anger without target!"]);
  });

  test("rerelease projectiles retain high-rate tracker damage and source projectile collision rules", () => {
    const scene = fixture("rerelease", "blaster", 0.025), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined, gravity: () => 400 });
    scene.weapons.inputs.set(scene.self.actor.id, { ...input, playersCollide: false });
    const bolt = projectiles.fireFlechette(scene.self, scene.game, zero, forward, 10, 1150, 3);
    expect(bolt.clipMask).toBe(0x6004003);
    const victim = scene.target(100), tracker = projectiles.fireTracker(scene.self, scene.game, zero, forward, 135, 1000, victim.actor.id);
    tracker.touch?.(tracker, scene.game, { self: tracker.actor, other: victim.actor.id, plane: null, surface: null });
    const daemon = [...scene.game.entities.values()].find(entity => entity.classname === "pain daemon");
    if (daemon === undefined) throw new Error("Rerelease tracker has no damage daemon");
    expect(daemon.damage).toBe(27); expect(daemon.nextThink).toBe(0);
    daemon.think?.(daemon, scene.game); expect(daemon.nextThink).toBe(0.1); expect(scene.combat.read(victim.actor.id)?.health).toBe(473);
    const tesla = projectiles.fireTesla(scene.self, scene.game, zero, forward, 1, 400);
    expect(tesla.classname).toBe("tesla_mine"); expect(scene.combat.read(tesla.actor.id)?.health).toBe(50);
    expect(scene.game.body(tesla).velocity.z).toBe(100); expect(Math.trunc(tesla.flags / 2 ** 32) % 2).toBe(1);
    scene.actors.close();
  });

  test("rerelease registers both arsenals once and source Doppleganger retaliation creates a hunter", () => {
    const scene = fixture("rerelease"), items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
    const armory = registerQ2MissionPackArmory("rogue", { weapons: scene.weapons, items, monster: () => null, playerEffect: () => undefined, hunterCamera: false, intermission: () => false }, "rerelease");
    expect(scene.weapons.registeredDefinitions().length).toBe(20);
    expect(items.lookup("Trap")?.usable).toBe(true); expect(items.lookup("Tesla")?.usable).toBe(true);
    const decoy = armory.doppleganger.fire(scene.self, scene.game, zero, forward), killer = scene.target(900);
    decoy.pain?.(decoy, scene.game, { attack: null, self: decoy.actor, attacker: killer.actor.id, damage: 10, kick: 0 });
    decoy.die?.(decoy, scene.game, { attack: null, self: decoy.actor, attacker: killer.actor.id, inflictor: killer.actor.id, damage: 30, kick: 0, point: zero });
    const sphere = [...scene.game.entities.values()].find(entity => entity.classname === "sphere");
    expect(sphere?.enemy).toBe(killer.actor.id); expect((sphere?.spawnflags ?? 0) & 2).toBe(2);
    expect((sphere?.spawnflags ?? 0) & 0x10000).toBe(0x10000);
    expect(scene.actors.isLive(decoy.actor.id)).toBe(false); scene.actors.close();
  });

  test("Rogue platform call schedules source motion and Tesla hazard removal follows its team chain", () => {
    const scene = fixture("classic"), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
    const movers = new Q2MoverModule({ pathCorner: () => undefined, combatPoint: () => undefined }), entities = new Q2MissionPackEntities("rogue", { movers, projectiles, weapons: scene.weapons,
      teleportPlayer: () => undefined, targetAnger: () => undefined, emit: () => undefined });
    const platform = scene.game.create("func_plat2", new Map([["height", "64"]]));
    expect(entities.spawn(platform, scene.game)).toBe(true);
    expect(entities.movers?.platformState(platform)?.phase).toBe("bottom");
    scene.setTime(3); platform.use?.(platform, scene.game, null, scene.self.actor.id);
    expect(platform.nextThink).toBe(3.1);
    platform.think?.(platform, scene.game);
    expect(entities.movers?.platformState(platform)?.phase).toBe("up");
    const tesla = projectiles.fireTesla(scene.self, scene.game, zero, forward, 1, 400);
    expect(projectiles.markTeslaArea(scene.self, scene.game, tesla)).toBe(true);
    expect(projectiles.markTeslaArea(scene.self, scene.game, tesla)).toBe(false);
    expect(projectiles.badArea(scene.self.actor.id, scene.game)).toBe(true);
    const area = tesla.teamChain;
    tesla.die?.(tesla, scene.game, { attack: null, self: tesla.actor, attacker: scene.self.actor.id, inflictor: scene.self.actor.id, damage: 30, kick: 0, point: zero });
    expect(scene.game.entity(area)).toBeNull(); scene.actors.close();
  });

  test("Tag grants source pickup armor and gives quad after five owner frags", () => {
    const scene = fixture("classic", "blaster", 0.1, "deathmatch"), items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
    items.configurePlayer(scene.player, scene.game);
    let score = 0;
    const tag = new Q2Tag({ items, addScore: (_actor, amount) => { score += amount; return undefined; }, farthestSpawn: () => null, selectSpawn: () => ({ origin: zero, angles: zero }) });
    const token = scene.game.create("dm_tag_token"); tag.spawn(token, scene.game); items.touch(token, scene.game, scene.self.actor.id);
    expect(tag.ownerActor()).toBe(scene.self.actor.id); expect(scene.combat.read(scene.self.actor.id)?.armor.kind).toBe("q2");
    const victim = scene.target(100);
    for (let count = 0; count < 5; count++) tag.score(scene.self, victim, scene.game, 1, 2);
    expect(score).toBe(15); expect(items.playerPowerups(scene.player.id).quadUntil).toBe(30);
    expect(tag.changeDamage(victim.actor.id, victim.actor.id, 13)).toBe(9); scene.actors.close();
  });
  test("checked weapon checkpoint resumes a named projectile with its saved damage cause", () => {
    const scene = fixture("classic"), victim = scene.target(100);
    const bolt = scene.weapons.fireBlaster(scene.self, scene.game, { x: 20, y: 0, z: 0 }, forward, 17, 1000, 8, false, 33);
    scene.state.grenadeTime = 8; scene.state.kickOrigin = { x: -2, y: 0, z: 0 };
    const checkpoint = decodeQ2WeaponsCheckpoint(encodeQ2WeaponsCheckpoint(scene.weapons.capture(scene.game)));
    scene.weapons.blasterCauses.clear(); scene.state.grenadeTime = 0;
    scene.weapons.restore(scene.game, checkpoint);
    expect(scene.weapons.states.get(scene.self.actor.id)?.grenadeTime).toBe(8);
    expect(scene.game.sourceCallbacks.touch.name(bolt.touch)).toBe("blaster_touch");
    scene.game.host.callbacks.touch({ self: bolt.actor, other: victim.actor.id, plane: null, surface: null });
    expect(scene.combat.read(victim.actor.id)?.health).toBe(483);
    const outcome = scene.outcomes.at(-1);
    if (outcome?.kind !== "committed") throw new Error("Restored projectile missed shared combat");
    expect(outcome.decision.request.attack.cause).toEqual({ kind: "q2", meansOfDeath: 33, damageFlags: 4 });
    scene.actors.close();
  });
  test("native causes distinguish CTF grapple, Xatrix ripper, Rogue gaps, and rerelease spawn telefrag", () => {
    expect(canonicalCauseFromNative({ edition: "classic", game: "ctf", value: 34 })).toBe(56);
    expect(canonicalCauseFromNative({ edition: "classic", game: "xatrix", value: 34 })).toBe(34);
    expect(canonicalCauseFromNative({ edition: "classic", game: "rogue", value: 34 })).toBeNull();
    expect(canonicalCauseFromNative({ edition: "rerelease", id: 22, friendlyFire: false, noPointLoss: true })).toBe(57);
    for (let id = 0; id <= 58; id++) {
      const native = { edition: "rerelease", id, friendlyFire: true, noPointLoss: true } satisfies import("../../../src/contracts/gameplay.ts").Q2NativeCause;
      const canonical = canonicalCauseFromNative(native);
      if (canonical === null) throw new Error("Official rerelease cause was rejected");
      expect(nativeCauseFromCanonical({ edition: "rerelease", noPointLoss: true }, canonical)).toEqual(native);
    }
  });

  test("Phalanx fires two original plasma shots and consumes one shared Mag Slug", () => {
    const scene = fixture("classic"), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
    new Q2MissionPackWeapons(projectiles).register(scene.weapons, "xatrix");
    scene.inventory.configure(scene.player, { item: "q2:ammo_magslug", count: 3, capacity: 50 });
    scene.state.weapon = "phalanx"; scene.state.phase = "firing"; scene.state.frame = 7;
    scene.step(0); scene.step(0.1);
    const plasma = [...scene.game.entities.values()].filter(entity => entity.classname === "plasma");
    expect(plasma.map(entity => [entity.damage, entity.radiusDamage])).toEqual([[75, 120], [75, 30]]);
    expect(scene.inventory.count(scene.player.id, "q2:ammo_magslug")).toBe(2);
    expect(plasma.map(entity => Math.sign(scene.game.body(entity).velocity.y))).toEqual([1, -1]);
    expect(scene.game.sourceCallbacks.touch.name(plasma[0]?.touch ?? null)).toBe("plasma_touch");
    scene.actors.close();
  });

  test("tracker impact attaches source timed damage; ion survives a wall and expires with welding sparks", () => {
    const scene = fixture("classic"), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
    const victim = scene.target(128);
    const tracker = projectiles.fireTracker(scene.self, scene.game, { x: 20, y: 0, z: 0 }, forward, 45, 1000, victim.actor.id);
    scene.game.host.callbacks.touch({ self: tracker.actor, other: victim.actor.id, plane: null, surface: null });
    expect(scene.combat.read(victim.actor.id)?.health).toBe(500);
    const daemon = [...scene.game.entities.values()].find(entity => entity.classname === "pain daemon");
    if (daemon === undefined || daemon.think === null) throw new Error("Tracker failed to attach pain daemon");
    scene.setTime(0.1); daemon.think(daemon, scene.game);
    expect(scene.combat.read(victim.actor.id)?.health).toBe(491);
    const ion = projectiles.fireIonRipper(scene.self, scene.game, { x: 20, y: 0, z: 0 }, forward, 30, 500, 0x100000);
    expect(ion.motion).toBe("wall-bounce");
    scene.game.host.callbacks.touch({ self: ion.actor, other: scene.game.host.worldActor(), plane: null, surface: null });
    expect(scene.actors.isLive(ion.actor.id)).toBe(true);
    if (ion.think === null) throw new Error("Ion has no spark expiry");
    ion.think(ion, scene.game); expect(scene.actors.isLive(ion.actor.id)).toBe(false);
    expect(scene.presentation.at(-1)?.kind).toBe("visibility");
    expect(scene.presentation.some(event => event.kind === "effect" && event.effect === "q2:welding_sparks")).toBe(true);
    scene.actors.close();
  });
});

const input: Q2WeaponInput = {
  attack: true, latchedAttack: false, holster: false, angles: zero, ducked: false, spectator: false,
  notarget: false, hand: "right", animatePlayer: false, quadUntil: 0, doubleUntil: 0, quadFireUntil: 0,
  haste: false, noStackDouble: false, instantSwitch: false, quickSwitch: true, infiniteAmmo: false, playersCollide: true, gravity: 800, weaponThunk: false,
};

function fixture(edition: Q2Edition, name: Q2WeaponName = "blaster", frameSeconds = 0.1, mode: "singleplayer" | "deathmatch" = "singleplayer", diagnostic: (message: string) => void = message => { throw new Error(message); }) {
  let now = 0;
  const actors = new SessionActorRegistry(createIdentityOwner(`q2-weapons-${edition}-${name}`));
  const callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn");
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  const outcomes: DamageOutcome[] = [], events: Q2WeaponEvent[] = [], presentation: Q2PresentationEvent[] = [];
  const combat = new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => {
      const body = bodies.read(actor.id);
      if (body !== null) bodies.write(actor, { ...body, velocity: { x: body.velocity.x + impulse.x, y: body.velocity.y + impulse.y, z: body.velocity.z + impulse.z } });
      return undefined;
    }, beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; },
  });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", context: request => ({ arithmetic: "binary64", player: request.target.equals(player.id), monster: !request.target.equals(player.id), attackerPlayer: request.attack.attacker?.equals(player.id) ?? false,
    hasEnemy: true, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false }),
    armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary64" })) }));
  const inventory = new SharedInventoryTable(actors);
  const player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(player, { origin: zero, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null });
  combat.create(player, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  const ammo: readonly InventoryEntry[] = ["shells", "bullets", "grenades", "rockets", "cells", "slugs"].map(kind => ({ item: `q2:ammo_${kind}`, count: 200, capacity: 200 }));
  inventory.create(player, [...ammo, ...Q2_BASE_WEAPONS.filter(weapon => weapon.name !== "grenades").map(weapon => ({ item: weapon.item, count: 1, capacity: 1 }))]);
  const monsters = new Set<ActorId>(), foreignPlayers = new Set<ActorId>();
  const tracing = { trace: clearTrace };
  const inlineBounds = new Map<number, Bounds>();
  const host: Q2FoundationHost = {
    actors, callbacks, bodies, combat, inventory,
    now: () => now, gravity: () => 800, frameSeconds: () => frameSeconds, random: () => 0.5, schedule: () => undefined, touchTriggers: () => undefined,
    trace: request => tracing.trace(request), pointContents: () => 0, inPvs: () => true, inPhs: () => true, areasConnected: () => true,
    nearby: (origin, radius) => [...actors.ownedBy("q3:character"), ...actors.ownedBy("q2:game")].map(actor => actor.id).filter(actor => {
      const body = bodies.read(actor);
      return body !== null && Math.hypot(body.origin.x - origin.x, body.origin.y - origin.y, body.origin.z - origin.z) <= radius;
    }), players: () => [player.id], worldActor: () => world.id, isPlayer: actor => actor.equals(player.id) || foreignPlayers.has(actor), isMonster: actor => monsters.has(actor),
    inlineModelBounds: model => inlineBounds.get(model) ?? { min: zero, max: zero }, setSolid: () => undefined, setMotion: () => undefined, setAreaPortal: () => undefined,
    playerViewState: actor => actor.equals(player.id) ? { viewAngles: input.angles, oldVelocity: bodies.read(actor)?.velocity ?? zero } : null,
    keyConsumed: () => undefined, prepareLevelChange: () => undefined,
    emit: event => { presentation.push(event); return undefined; }, transition: () => undefined, diagnostic: message => { diagnostic(message); return undefined; },
  };
  const game = new Q2Foundation(host, { edition, mapName: "weapon-check", skill: 1, mode, deathmatchFlags: 0, maxClients: 1,
    provider: "q2:game", campaign: "q2:campaign", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, []);
  const self = game.attachPlayer(player);
  const weapons = new Q2Weapons({ emit: event => { events.push(event); return undefined; }, noise: () => undefined, dodge: () => undefined,
    lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const state = weapons.bind(self, game, new Q2WeaponState(name));
  const definition = Q2_BASE_WEAPONS.find(weapon => weapon.name === name);
  if (definition === undefined) throw new Error("Missing base weapon");
  state.phase = "ready"; state.frame = definition.fireLast + 1;
  return { actors, bodies, combat, inventory, player, self, game, weapons, state, events, outcomes, presentation, tracing, monsters, foreignPlayers, inlineBounds,
    setTime(seconds: number) { now = seconds; },
    step(seconds: number, current: Q2WeaponInput = input) { now = seconds; weapons.tick(self, game, current); },
    target(x: number) {
      const target = game.create("monster_soldier");
      game.move(target, { origin: { x, y: 0, z: 0 }, bounds: { min: zero, max: zero } });
      combat.create(target.actor, { health: 500, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
      monsters.add(target.actor.id);
      return target;
    },
  };
}


test("expansion impact noise retains native and foreign owners and rejects released actors", () => {
  const scene = fixture("classic"), noises: ActorId[] = [];
  const base = new Q2Weapons({ ...scene.weapons.hooks, noise: (actor, _origin, secondary) => { if (secondary) noises.push(actor); return undefined; } });
  const projectiles = new Q2MissionPackProjectiles({ base, monster: () => null, playerEffect: () => undefined });
  const foreign = scene.actors.allocate("q1:character", "q1:player"), body = scene.bodies.read(scene.player.id);
  if (body === null) throw new Error("Missing shared player body");
  scene.bodies.create(foreign, { ...body, origin: { x: 128, y: 0, z: 0 } });
  scene.foreignPlayers.add(foreign.id);
  expect(scene.game.entity(foreign.id)).toBeNull();
  const impact = (actor: typeof scene.player) => {
    const bolt = projectiles.fireIonRipper({ actor }, scene.game, { x: 200, y: 0, z: 0 }, forward, 30, 500, 0);
    if (bolt.touch === null) throw new Error("Missing actual ion touch");
    return { bolt, touch: bolt.touch };
  };
  for (const actor of [scene.player, foreign]) {
    const { bolt, touch } = impact(actor);
    touch(bolt, scene.game, { self: bolt.actor, other: scene.game.host.worldActor(), plane: null, surface: null });
  }
  expect(noises).toEqual([scene.player.id, foreign.id]);
  const pending = impact(foreign);
  scene.actors.release(foreign);
  const replacement = scene.actors.allocate("q1:character", "q1:player");
  scene.foreignPlayers.add(replacement.id);
  pending.touch(pending.bolt, scene.game, { self: pending.bolt.actor, other: scene.game.host.worldActor(), plane: null, surface: null });
  expect(noises).toEqual([scene.player.id, foreign.id]);
  expect(base.noises.has(foreign.id)).toBe(false);
  scene.actors.close();
});

test("proximity explosion credits live shared owners and falls back after their lifetime ends", () => {
  for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) for (const foreignOwner of [false, true]) for (const released of [false, true]) {
    const scene = fixture(edition), projectiles = new Q2MissionPackProjectiles({ base: scene.weapons, monster: () => null, playerEffect: () => undefined });
    try {
      const owner = foreignOwner ? scene.actors.allocate("q1:character", "q1:player") : scene.player;
      if (foreignOwner) {
        const body = scene.bodies.read(scene.player.id); if (body === null) throw new Error("Missing source fixture body");
        scene.bodies.create(owner, { ...body, origin: { x: -256, y: 0, z: 0 } }); scene.foreignPlayers.add(owner.id);
        expect(scene.game.entity(owner.id)).toBeNull();
      }
      const target = scene.target(64), mine = projectiles.fireProx({ actor: owner }, scene.game, zero, forward, 1, 0);
      const explode = projectiles.callbacks.think?.["Prox_Explode"]; if (explode === undefined) throw new Error("Missing source proximity callback");
      const mineId = mine.actor.id;
      if (released) {
        scene.actors.release(owner);
        const replacement = scene.actors.allocate("q3:character", "q3:sarge");
        expect(replacement.id.slot).toBe(owner.id.slot); expect(replacement.id.generation).not.toBe(owner.id.generation);
      }
      explode(mine, scene.game);
      const damage = scene.outcomes.find(outcome => outcome.kind === "committed" && outcome.decision.request.target.equals(target.actor.id));
      if (damage?.kind !== "committed") throw new Error("Source proximity explosion did not damage its actual target");
      expect(damage.decision.appliedDamage).toBeGreaterThan(0); expect(damage.decision.request.attack.attacker).toBe(released ? mineId : owner.id);
      expect(scene.actors.isLive(mineId)).toBe(false);
    } finally { scene.actors.close(); }
  }
});

for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) test(
  "active HUD timers read " + edition + " source uses, stacking, expiry and actor identity", () => {
    const scene = fixture(edition);
    const items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
    const armory = registerQ2MissionPackArmory("rogue", { weapons: scene.weapons, items, monster: () => null, playerEffect: () => undefined, hunterCamera: false, intermission: () => false }, "rerelease");
    items.configurePlayer(scene.player, scene.game);
    scene.setTime(10);
    for (const item of ["q2:item_quad", "q2:item_invulnerability", "q2:item_double", "q2:item_quadfire", "q2:item_enviro", "q2:item_breather", "q2:item_ir_goggles"] satisfies readonly import("../../../src/contracts/gameplay.ts").ItemId[]) {
      scene.inventory.configure(scene.player, { item, count: 2, capacity: 10 });
      expect(items.use(scene.player, item, scene.game)).toBe(true);
    }
    expect(items.use(scene.player, "q2:item_quad", scene.game)).toBe(true);
    const timers = () => q2PowerupTimers(items.playerPowerups(scene.player.id), armory.items.powerups(scene.player.id), scene.game.host.now());
    expect(timers().map(timer => [timer.item, timer.remainingSeconds])).toEqual([
      ["q2:item_quad", 60], ["q2:item_quadfire", 30], ["q2:item_double", 30], ["q2:item_invulnerability", 30], ["q2:item_enviro", 30], ["q2:item_breather", 30], ["q2:item_ir_goggles", 60],
    ]);
    const other = scene.target(100).actor.id;
    expect(q2PowerupTimers(items.playerPowerups(other), armory.items.powerups(other), scene.game.host.now())).toEqual([]);
    scene.setTime(39.75);
    expect(timers().map(timer => timer.remainingSeconds)).toEqual([30.25, 0.25, 0.25, 0.25, 0.25, 0.25, 30.25]);
    scene.setTime(40); expect(timers().map(timer => timer.item)).toEqual(["q2:item_quad", "q2:item_ir_goggles"]);
    scene.setTime(70); expect(timers()).toEqual([]);
  });

for (const edition of ["classic", "rerelease"] satisfies readonly Q2Edition[]) test(`selected ${edition} mission weapon installer covers registered ammunition and native callbacks`, () => {
  const scene = fixture(edition);
  try {
    const configured = registerSelectedQ2MissionWeapons(scene.game, scene.weapons, "rogue", { monster: () => null, playerEffect: () => undefined });
    const arsenal = new Q2SelectedArsenal({ game: scene.game, weapons: scene.weapons, ...configured, observe: () => ({ owner: scene.self, input }) });
    arsenal.remove(scene.player.id); arsenal.admit(scene.player, 100);
    for (const definition of scene.weapons.registeredDefinitions()) {
      expect(configured.pickupOrder.includes(definition.item)).toBe(true);
      expect(scene.inventory.entries(scene.player.id).some(entry => entry.item === definition.item)).toBe(true);
      if (definition.ammo !== null) expect(scene.inventory.entries(scene.player.id).some(entry => entry.item === definition.ammo)).toBe(true);
    }
    expect(scene.weapons.registeredDefinitions().some(definition => definition.name === "ionripper")).toBe(edition === "rerelease");
  } finally { scene.actors.close(); }
});

for (const pack of ["xatrix", "rogue"] satisfies readonly Q2MissionPack[]) test(`native ${pack} expansion weapon pickups map to admitted foreign inventory`, () => {
  const scene = fixture("classic");
  try {
    const items = new Q2ItemModule({ weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined });
    registerQ2MissionPackArmory(pack, { weapons: scene.weapons, items, monster: () => null, playerEffect: () => undefined, hunterCamera: false, intermission: () => false });
    const profile = expansionSourceSupply(Q2_Q1_SUPPLY_PROFILE);
    for (const item of new Set([...profile.ammo, ...profile.weapons].flatMap(row => row.destinations)))
      if (item.startsWith("q1:")) scene.inventory.configure(scene.player, { item, count: 0, capacity: 200 });
    const admission = new SharedPickupAdmission({ inventory: scene.inventory, profile, ammoGranted: () => undefined, weaponGranted: () => undefined });
    items.setPickupAdmission(admission);
    for (const definition of scene.weapons.registeredDefinitions().filter(definition => !Q2_BASE_WEAPONS.some(base => base.item === definition.item))) {
      for (const entry of scene.inventory.entries(scene.player.id)) if (entry.item.startsWith("q1:")) scene.inventory.configure(scene.player, { ...entry, count: 0 });
      const pickup = scene.game.create(definition.classname);
      expect(items.spawn(pickup, scene.game)).toBe(true);
      expect(items.mapsSupply(definition.item)).toBe(true);
      items.touch(pickup, scene.game, scene.player.id);
      expect(scene.inventory.entries(scene.player.id).some(entry => entry.item.startsWith("q1:") && entry.count > 0)).toBe(true);
      expect(scene.actors.isLive(pickup.actor.id)).toBe(false);
    }
  } finally { scene.actors.close(); }
});
