import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ProviderId } from "../../../src/contracts/identity.ts";
import { Q2Ballistics } from "../../../src/content/q2/foundation/weapons/ballistics.ts";
import type { Q2Entity, Q2GameServices } from "../../../src/content/q2/foundation/host.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const arsenals: readonly { readonly name: string; readonly catalog: string; readonly provider: ProviderId }[] = [
  { name: "native Q1", catalog: "q1-classic-id1", provider: "q1:official" },
  { name: "selected Q2", catalog: "q2-classic-baseq2", provider: "q2:official" },
  { name: "selected Q3", catalog: "q3-baseq3", provider: "q3:official" },
];
for (const arsenal of arsenals) test.skipIf(!existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))(`NetQuake player cooks and throws an offhand grenade while keeping ${arsenal.name} arsenal`, async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m3", "--character", "q3", "--dedicated", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Expected Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: "selected", value: [{ provider: arsenal.provider, content: catalog.require(arsenal.catalog).id }] },
    equipment: { kind: "selected", value: { grapple: { kind: "disabled" }, handGrenades: { kind: "enabled",
      source: { provider: "q2:equipment/hand-grenades", content: catalog.require("q2-classic-baseq2").id }, edition: "classic", binding: "offhand", initialAmmo: 5, capacity: 50 } } } } });
  const content = await loadApplicationContent(launch.options, recipe), identity = createIdentityOwner(`netquake-offhand-${arsenal.name}`), client = identity.client(0, 0);
  const launches: { readonly game: Q2GameServices; readonly entity: Q2Entity }[] = [], original = Q2Ballistics.prototype.fireHandGrenade;
  const observeLaunch = spyOn(Q2Ballistics.prototype, "fireHandGrenade").mockImplementation(function (this: Q2Ballistics, owner, game, spec) {
    const entity = original.call(this, owner, game, spec); launches.push({ game, entity }); return entity;
  });
  const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(client).actor, source = simulation.q1Source(), movement = simulation.movementPlayer(actor);
    if (source === null || movement === null) throw new Error("Missing native Q1 player");
    expect(movement.profile.kind).toBe("q1-netquake");
    let sequence = 0;
    const step = () => simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client }, sequence: sequence++,
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: source.game.time, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } }] });
    for (let index = 0; index < 8; index++) step();
    const mainWeapon = simulation.playerUi(actor).activeWeapon;
    expect(mainWeapon).not.toBeNull();
    const sourcePlayer = source.game.player(actor);
    if (sourcePlayer === null) throw new Error("Missing original Q1 powerup owner");
    sourcePlayer.powerups.set("quad", source.game.time + 30);
    const ammo = simulation.inventory.count(actor, "q2:ammo_grenades");
    simulation.setHandGrenadeInput(actor, true); step();
    expect(simulation.handGrenadeState(actor)?.action.kind).toBe("preparing");
    expect(simulation.inventory.count(actor, "q2:ammo_grenades")).toBe(ammo - 1);
    for (let index = 0; index < 20 && simulation.handGrenadeState(actor)?.action.kind !== "cooking"; index++) step();
    expect(simulation.handGrenadeState(actor)?.action.kind).toBe("cooking");
    expect(launches).toHaveLength(0);
    for (let index = 0; index < 4; index++) step();
    expect(simulation.playerUi(actor).activeWeapon).toBe(mainWeapon);
    simulation.setHandGrenadeInput(actor, false); step();
    expect(simulation.handGrenadeState(actor)?.action.kind).toBe("releasing");
    for (let index = 0; index < 4 && launches.length === 0; index++) step();
    expect(launches).toHaveLength(1);
    const grenade = launches[0];
    if (grenade === undefined) throw new Error("Offhand source grenade missing");
    expect(grenade.entity.owner?.equals(actor)).toBe(true);
    expect(grenade.entity.damage).toBe(500);
    const zombie = [...source.game.entities.values()].find(entity => entity.classname === "monster_zombie" && entity.damageable);
    if (zombie === undefined) throw new Error("Authored e1m3 zombie missing");
    const body = source.game.body(zombie);
    grenade.game.move(grenade.entity, { origin: { x: body.origin.x, y: body.origin.y, z: body.origin.z + 8 }, velocity: { x: 0, y: 0, z: 0 } });
    for (let index = 0; index < 40 && simulation.actors.isLive(grenade.entity.actor.id); index++) step();
    expect(simulation.actors.isLive(grenade.entity.actor.id)).toBe(false);
    expect(zombie.model).toBe("progs/h_zombie.mdl");
    expect(zombie.damageable).toBe(false);
    expect(simulation.inventory.count(actor, "q2:ammo_grenades")).toBe(ammo - 1);
    expect(simulation.playerUi(actor).activeWeapon).toBe(mainWeapon);
    expect(launches).toHaveLength(1);
    for (let index = 0; index < 20 && simulation.handGrenadeState(actor)?.action.kind !== "idle"; index++) step();
    expect(simulation.handGrenadeState(actor)?.action.kind).toBe("idle");
    simulation.setHandGrenadeInput(actor, true);
    for (let index = 0; index < 20 && simulation.handGrenadeState(actor)?.action.kind !== "cooking"; index++) step();
    expect(simulation.handGrenadeState(actor)?.action.kind).toBe("cooking");
    const world = source.game.world;
    if (world === null) throw new Error("Missing Q1 world damage source");
    source.game.damage(actor, world.actor.id, world.actor.id, 10000);
    expect(source.game.health(actor)).toBeLessThanOrEqual(0);
    expect(launches).toHaveLength(2);
    for (let index = 0; index < 4; index++) step();
    expect(launches).toHaveLength(2);
    expect(simulation.handGrenadeState(actor)?.action.kind).toBe("disarmed");
    expect(simulation.inventory.count(actor, "q2:ammo_grenades")).toBe(ammo - 2);
  } finally { observeLaunch.mockRestore(); simulation.close(); await content.close(); }
}, 20000);
