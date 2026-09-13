import { expect, test } from "bun:test";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import type { ItemId } from "../../../src/contracts/gameplay.ts";
import { spawnItem, finishSpawningItem } from "../../../src/content/q3/base/game/item-lifecycle.ts";
import { SpawnVariables } from "../../../src/content/q3/base/game/spawn.ts";
import { itemList } from "../../../src/content/q3/base/shared/items.ts";
import type { Q1Weapon } from "../../../src/content/q1/foundation/types.ts";

for (const edition of ["classic", "rerelease"] satisfies readonly ("classic" | "rerelease")[]) for (const product of ["q2-classic-baseq2", "q3-baseq3"]) test(`${edition} Hipnotic selected weapons hit actual players on ${product} with source projectile lifetime`, async () => {
  const parsed = parseApplicationCommand(["--game", product, "--map", product.startsWith("q2") ? "base1" : "q3dm1", "--movement", "q1", "--character", product.startsWith("q3") ? "q3" : "q1", "--mode", "deathmatch", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require(`q1-${edition}-hipnotic`).id }] } } });
  const content = await loadApplicationContent(parsed.options, recipe), identity = createIdentityOwner(`${product}-hipnotic-${edition}`);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 0, mode: "deathmatch", seed: 17, maxClients: 2 } satisfies Parameters<typeof createSimulation>[0];
  const simulation = createSimulation(options);
  try {
    const client = identity.client(0, 0), targetClient = identity.client(1, 0), actor = simulation.admitPlayer(client).actor, target = simulation.admitPlayer(targetClient).actor;
    const selected = simulation.q1WeaponSource(), player = simulation.movementPlayer(actor), victim = simulation.movementPlayer(target);
    if (selected === null || player === null || victim === null) throw new Error("Missing shared players");
    const game = selected.game, native = game.player(actor); if (native === null) throw new Error("Missing selected source player");
    expect(game.options.edition).toBe(edition); expect(game.playerExtensions.size).toBe(0); expect(game.registeredWeapons.size).toBe(3);
    // Explicit native pickup fixtures exercise source eligibility and lifecycle on real maps.
    const q2 = simulation.q2Source(), q3 = simulation.q3Source();
    if (q2 !== null) {
      for (const [classname, base, hip] of [["weapon_hyperblaster", "lightning", "hipnotic:laser"], ["weapon_grenadelauncher", "grenadelauncher", "hipnotic:proximity"], ["weapon_bfg", "lightning", "hipnotic:mjolnir"]] satisfies readonly (readonly [string, Q1Weapon, Q1Weapon])[]) {
        const pickup = q2.game.create(classname); expect(q2.items.spawn(pickup, q2.game)).toBe(true);
        q2.items.touch(pickup, q2.game, actor);
        expect(simulation.inventory.count(actor, game.weaponItem(base))).toBe(1);
        expect(simulation.inventory.count(actor, game.weaponItem(hip))).toBe(1);
      }
    } else if (q3 !== null) {
      const receiver = q3.records.nativeByActor(actor); if (receiver === null) throw new Error("Missing native pickup receiver");
      for (const [classname, base, hip] of [["weapon_plasmagun", "lightning", "hipnotic:laser"], ["weapon_grenadelauncher", "grenadelauncher", "hipnotic:proximity"], ["weapon_bfg", "lightning", "hipnotic:mjolnir"]] satisfies readonly (readonly [string, Q1Weapon, Q1Weapon])[]) {
        const item = itemList("baseq3").find(item => item.className === classname); if (item === undefined) throw new Error("Missing native item definition");
        const pickup = q3.pool.spawn(); pickup.classname = classname; pickup.spawnflags = 1;
        spawnItem(pickup, item, new SpawnVariables([]), () => false, q3.itemLifecycle); finishSpawningItem(pickup, q3.itemLifecycle);
        pickup.touch?.(pickup, receiver, { self: pickup.actor, other: actor, plane: null, surface: null });
        expect(simulation.inventory.count(actor, game.weaponItem(base))).toBe(1);
        expect(simulation.inventory.count(actor, game.weaponItem(hip))).toBe(1);
        expect(pickup.r.contents).toBe(0);
      }
    }
    const weapons: readonly Q1Weapon[] = ["hipnotic:laser", "hipnotic:proximity", "hipnotic:mjolnir"];
    for (const weapon of weapons) simulation.inventory.give(player.actor, game.weaponItem(weapon), 1);
    for (const ammo of ["q1:ammo/cells", "q1:ammo/rockets"] satisfies readonly ItemId[]) simulation.inventory.give(player.actor, ammo, 50);
    let sequence = 0, yaw = 0;
    const step = (attack = false, impulse = 0, milliseconds = 100) => simulation.step({ elapsedMilliseconds: milliseconds, commands: [{ actor, source: { kind: "remote-client", client }, sequence: sequence++,
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: { x: 0, y: yaw, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse } }] });
    for (let i = 0; i < 5; i++) step();
    const origin = simulation.bodies.read(actor)?.origin; if (origin === undefined) throw new Error("Missing shooter body");
    const direction = [0, 90, 180, 270].find(angle => {
      const r = angle * Math.PI / 180;
      return game.host.trace({ start: origin, end: { x: origin.x + Math.cos(r) * 128, y: origin.y + Math.sin(r) * 128, z: origin.z }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, ignore: actor, monsters: false }).fraction === 1;
    });
    if (direction === undefined) throw new Error("No clear firing lane at actual spawn"); yaw = direction;
    const place = (distance: number): void => {
      const body = simulation.bodies.read(actor), other = simulation.bodies.read(target); if (body === null || other === null) throw new Error("Missing firing lane bodies");
      const shooterState = player.readState(), targetState = victim.readState();
      if (shooterState.kind !== "q1-netquake" || targetState.kind !== "q1-netquake") throw new Error("Expected native Q1 movement");
      player.commit({ ...shooterState, origin, oldOrigin: origin, angles: { x: 0, y: yaw, z: 0 }, viewAngles: { x: 0, y: yaw, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, ground: { kind: "none" }, flags: shooterState.flags & ~512 }, true, false);
      const targetOrigin = { x: origin.x + Math.cos(yaw * Math.PI / 180) * distance, y: origin.y + Math.sin(yaw * Math.PI / 180) * distance, z: origin.z };
      victim.commit({ ...targetState, origin: targetOrigin, oldOrigin: targetOrigin, velocity: { x: 0, y: 0, z: 0 }, ground: { kind: "none" }, flags: targetState.flags & ~512 }, true, false);
      simulation.combat.setHealth(victim.actor, 1000); simulation.combat.setArmor(victim.actor, { kind: "none" });
    };
    for (const weapon of weapons) {
      for (let i = 0; i < 12 && game.time < native.attackFinished; i++) step();
      simulation.playerCommand(actor, "use", [game.weaponItem(weapon)]); expect(native.weapon).toBe(weapon);
      if (weapon === "hipnotic:mjolnir") simulation.inventory.consume(player.actor, "q1:ammo/cells", simulation.inventory.count(actor, "q1:ammo/cells"));
      place(weapon === "hipnotic:mjolnir" ? 40 : 80);
      const ammo = game.weaponAmmo(weapon), before = ammo === null ? 0 : simulation.inventory.count(actor, ammo);
      step(true);
      for (let i = 0; i < 8 && (simulation.combat.read(target)?.health ?? 0) === 1000; i++) step();
      expect(simulation.combat.read(target)?.health).toBeLessThan(1000);
      if (ammo !== null) expect(simulation.inventory.count(actor, ammo)).toBe(before - 1);
      else expect(simulation.inventory.count(actor, "q1:ammo/cells")).toBe(0);
      expect(simulation.playerUi(actor).weaponStatus?.item).toBe(game.weaponItem(weapon));
      expect(simulation.presentations().find(model => model.actor.equals(actor) && model.viewWeapon)?.path).toBe(game.weaponModel(weapon));
    }
    for (let i = 0; i < 15 && game.time < native.attackFinished; i++) step();
    simulation.playerCommand(actor, "use", ["q1:weapon/hipnotic:proximity"]); place(400); step(true);
    const mine = [...game.entities.values()].find(entity => entity.classname === "proximity_grenade");
    if (mine === undefined) throw new Error("Missing live source mine");
    if (product.startsWith("q3")) {
      expect(() => simulation.checkpoint()).toThrow("complete saved-game checkpoint");
      for (let i = 0; i < 600 && game.entities.has(mine.actor); i++) step();
      expect(game.entities.has(mine.actor)).toBe(false);
      return;
    }
    const saved = decodeSaveImage(encodeSaveImage(simulation.checkpoint())), restoredIdentity = createIdentityOwner(`restored-${product}-${edition}`);
    const restored = createSimulation({ ...options, identity: restoredIdentity, restoredClients: [restoredIdentity.client(0, 0), restoredIdentity.client(1, 0)], restore: saved });
    try {
      const restoredActor = restored.players()[0], restoredGame = restored.q1WeaponSource()?.game;
      if (restoredActor === undefined || restoredGame === undefined) throw new Error("Missing restored selected source");
      expect(restoredGame.player(restoredActor)?.weapon).toBe("hipnotic:proximity");
      const restoredMine = [...restoredGame.entities.values()].find(entity => entity.classname === "proximity_grenade");
      expect(restoredMine?.delay).toBe(mine.delay); expect(restoredMine?.touch).not.toBeNull();
      for (let i = 0; i < 3; i++) { simulation.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] }); }
      expect([...restoredGame.entities.values()].filter(entity => entity.classname === "proximity_grenade").map(entity => ({ delay: entity.delay, origin: restoredGame.body(entity).origin })))
        .toEqual([...game.entities.values()].filter(entity => entity.classname === "proximity_grenade").map(entity => ({ delay: entity.delay, origin: game.body(entity).origin })));
      expect(simulation.captureTravel().players[0]?.selectedArsenal).toMatchObject({ kind: "q1", state: { weapon: "hipnotic:proximity" } });
      for (let i = 0; i < 270 && [...restoredGame.entities.values()].some(entity => entity.classname === "proximity_grenade"); i++) restored.step({ elapsedMilliseconds: 100, commands: [] });
      expect([...restoredGame.entities.values()].some(entity => entity.classname === "proximity_grenade")).toBe(false);
    } finally { restored.close(); }
  } finally { simulation.close(); await content.close(); }
}, 30000);

import { Application } from "../../../src/app/bootstrap/application.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { mkdir } from "node:fs/promises";

for (const product of ["q2-classic-baseq2", "q3-baseq3"]) test(`actual ${product} input selects Hipnotic through impulse, console, cycle and mouse wheel menu`, async () => {
  const parsed = parseApplicationCommand(["--game", product, "--map", product.startsWith("q2") ? "base1" : "q3dm1", "--movement", "q1",
    "--character", product.startsWith("q3") ? "q3" : "q1", "--mode", "deathmatch", "--renderer", "cpu", "--width", "640", "--height", "480", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require("q1-rerelease-hipnotic").id }] } } });
  const application = await Application.open(parsed.options, { print: () => undefined }, recipe);
  try {
    const local = application.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    const presentation = local.seat.presentation, movement = application.simulation.movementPlayer(local.actor), game = application.simulation.q1WeaponSource()?.game;
    if (!(presentation instanceof WorldSeatPresentation) || movement === null || game === undefined) throw new Error("Missing shared native frontend");
    for (const weapon of ["hipnotic:laser", "hipnotic:mjolnir", "hipnotic:proximity"] satisfies readonly Q1Weapon[]) application.simulation.inventory.give(movement.actor, game.weaponItem(weapon), 1);
    application.simulation.inventory.give(movement.actor, "q1:ammo/cells", 50); application.simulation.inventory.give(movement.actor, "q1:ammo/rockets", 50);
    const key = (code: number, down: boolean): void => { application.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    presentation.local.input.bind({ input: { kind: "key", code: 49 }, target: { kind: "command", text: "impulse 225" } });
    key(49, true); await application.step(100); key(49, false);
    expect(game.player(local.actor)?.weapon).toBe("hipnotic:laser");
    expect(application.simulation.playerUi(local.actor).weaponStatus?.source.provider).toBe("q1:weapons/rerelease/hipnotic");
    application.input({ seat: local.seat.id, kind: "mouse-wheel", delta: { x: 0, y: 1 }, timeMilliseconds: performance.now() });
    await application.step(100);
    expect(game.player(local.actor)?.weapon).toBe("hipnotic:mjolnir");
    application.queueCommand("use", ["q1:weapon/hipnotic:proximity"], local.seat.id); await application.step(100);
    expect(game.player(local.actor)?.weapon).toBe("hipnotic:proximity");
    key(113, true); await application.step(100);
    const wheel = presentation.ui.weaponWheel.drawState().wheel;
    if (wheel === null) throw new Error("Real wheel binding did not open");
    const index = wheel.items.findIndex(item => item.id === "q1:weapon/hipnotic:laser"), angle = index * Math.PI * 2 / wheel.items.length;
    application.input({ seat: local.seat.id, kind: "mouse-motion", position: { x: 320, y: 240 }, delta: { x: Math.sin(angle) * 180, y: -Math.cos(angle) * 180 }, timeMilliseconds: performance.now() });
    await application.step(100);
    expect(presentation.ui.weaponWheel.drawState().wheel?.selected).toBe("q1:weapon/hipnotic:laser");
    await mkdir(".artifacts/tmp/hipnotic-selected", { recursive: true });
    await Bun.write(`.artifacts/tmp/hipnotic-selected/${product}-wheel.png`, encodePng(640, 480, application.readPixels()));
    key(113, false); await application.step(100);
    expect(game.player(local.actor)?.weapon).toBe("hipnotic:laser");
    expect(application.simulation.presentations().find(model => model.actor.equals(local.actor) && model.viewWeapon)?.path).toBe("progs/v_laserg.mdl");
    await Bun.write(`.artifacts/tmp/hipnotic-selected/${product}-laser.png`, encodePng(640, 480, application.readPixels()));
    expect(application.simulation.playerUi(local.actor).weaponStatus?.source.content).toBe(catalog.require("q1-rerelease-hipnotic").id);
  } finally { await application.close(); }
}, 60000);

for (const [product, edition] of [["q1-classic-id1", "classic"], ["q1-classic-id1", "rerelease"], ["q1-classic-hipnotic", "rerelease"]] satisfies readonly (readonly [string, "classic" | "rerelease"])[]) test(`selected ${edition} Hipnotic admits, accepts source impulses and travels on ${product}`, async () => {
  const parsed = parseApplicationCommand(["--game", product, "--map", product.endsWith("id1") ? "e1m1" : "hip1m1", "--mode", "coop", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require(`q1-${edition}-hipnotic`).id }] } } });
  const content = await loadApplicationContent(parsed.options, recipe), identity = createIdentityOwner(`hipnotic-${product}`);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 0, mode: "coop", seed: 17, maxClients: 1 } satisfies Parameters<typeof createSimulation>[0];
  const simulation = createSimulation(options);
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor), selected = simulation.q1WeaponSource()?.game, map = simulation.q1Source();
    if (player === null || selected === undefined || map === null) throw new Error("Missing Q1 selected player");
    expect(map.game.options.edition).toBe("classic"); expect(selected.options.edition).toBe(edition);
    expect(recipe.map.entities.content).toBe(catalog.require(product).id);
    expect(selected.playerExtensions.size).toBe(0);
    // Synthetic ready native pickups exercise the registered source touch callback after map precaching closes.
    for (const classname of ["weapon_lightning", "weapon_grenadelauncher"]) {
      const pickup = map.game.create(classname); pickup.solid = "trigger";
      map.game.named.touch(pickup, "item_touch")(actor, null);
    }
    for (const weapon of ["lightning", "grenadelauncher", "hipnotic:laser", "hipnotic:mjolnir", "hipnotic:proximity"] satisfies readonly Q1Weapon[])
      expect(simulation.inventory.count(actor, selected.weaponItem(weapon))).toBe(1);
    simulation.inventory.give(player.actor, "q1:ammo/cells", 20); simulation.inventory.give(player.actor, "q1:ammo/rockets", 10);
    simulation.playerCommand(actor, "use", ["Laser Cannon"]); expect(selected.player(actor)?.weapon).toBe("hipnotic:laser");
    simulation.playerCommand(actor, "use", ["grenadelauncher"]); expect(selected.player(actor)?.weapon).toBe("grenadelauncher");
    simulation.playerCommand(actor, "use", ["hipnotic:mjolnir"]); expect(selected.player(actor)?.weapon).toBe("hipnotic:mjolnir");
    let sequence = 0;
    for (const [impulse, weapon] of [[225, "hipnotic:laser"], [226, "hipnotic:mjolnir"], [6, "hipnotic:proximity"]] satisfies readonly (readonly [number, Q1Weapon])[]) {
      if (impulse === 6) simulation.playerCommand(actor, "use", ["q1:weapon/grenadelauncher"]);
      simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client }, sequence: sequence++, command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse } }] });
      expect(selected.player(actor)?.weapon).toBe(weapon);
    }
    const travel = simulation.captureTravel(), travelIdentity = createIdentityOwner(`travel-${product}`);
    const traveled = createSimulation({ ...options, identity: travelIdentity, travel });
    try {
      const arrival = traveled.admitTravel(travelIdentity.client(0, 0), travel).actor;
      expect(traveled.playerUi(arrival).activeWeapon).toBe("q1:weapon/hipnotic:proximity");
      expect(traveled.inventory.count(arrival, "q1:ammo/rockets")).toBe(simulation.inventory.count(actor, "q1:ammo/rockets"));
      expect(traveled.q1WeaponSource()?.game.registeredWeapons.size).toBe(3);
      expect(traveled.q1Source()?.game.options.edition).toBe("classic");
    } finally { traveled.close(); }
  } finally { simulation.close(); await content.close(); }
}, 30000);

test("native Q3 mouse cycle retains its cgame command owner", async () => {
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--mode", "deathmatch", "--renderer", "cpu", "--width", "320", "--height", "240", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const application = await Application.open(parsed.options, { print: () => undefined });
  try {
    const local = application.localPlayers[0]; if (local === undefined) throw new Error("Missing native local player");
    for (let i = 0; i < 5; i++) await application.step(100);
    const source = application.simulation.q3Source(), item = itemList("baseq3").find(item => item.className === "weapon_shotgun");
    const receiver = source?.records.nativeByActor(local.actor);
    if (source === null || receiver == null || item === undefined) throw new Error("Missing native Q3 item receiver");
    const pickup = source.pool.spawn(); pickup.classname = "weapon_shotgun"; pickup.spawnflags = 1;
    spawnItem(pickup, item, new SpawnVariables([]), () => false, source.itemLifecycle); finishSpawningItem(pickup, source.itemLifecycle);
    pickup.touch?.(pickup, receiver, { self: pickup.actor, other: local.actor, plane: null, surface: null });
    for (let i = 0; i < 8; i++) await application.step(100);
    const before = application.simulation.playerUi(local.actor).activeWeapon;
    application.input({ seat: local.seat.id, kind: "mouse-wheel", delta: { x: 0, y: 1 }, timeMilliseconds: performance.now() });
    for (let i = 0; i < 8; i++) await application.step(100);
    expect(application.simulation.movementPlayer(local.actor)?.arsenal.state.kind).toBe("q3");
    expect(application.simulation.playerUi(local.actor).activeWeapon).not.toBe(before);
    expect(application.simulation.q1WeaponSource()).toBeNull();
  } finally { await application.close(); }
}, 30000);
