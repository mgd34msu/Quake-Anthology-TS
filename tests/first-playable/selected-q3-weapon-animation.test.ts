import { expect, test } from "bun:test";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { PlayerAnimation, WeaponState } from "../../src/movement/q3/constants.ts";

test("Q2 map with QW movement preserves selected Q3 raise, drop and attack animation across physics frames", async () => {
  const parsed = parseApplicationCommand(["--menu"]);
  if (parsed.kind !== "menu") throw new Error("Expected startup options");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const selection = new StartupSelectionModel(catalog, parsed.options);
  await selection.prepareMaps();
  selection.select("product", "q2-classic-baseq2"); selection.select("map", "maps/base1.bsp");
  selection.select("movement", "q1-quakeworld"); selection.select("character", "q3-baseq3");
  selection.select("model", "sarge"); selection.select("weapons", "q3-baseq3");
  const launch = await selection.resolve();
  const content = await loadApplicationContent(launch.options, launch.recipe);
  const identity = createIdentityOwner("selected-q3-animation");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    const client = identity.client(0, 0), seat = identity.seat(0), admission = simulation.admitPlayer(client);
    const player = simulation.movementPlayer(admission.actor);
    if (player === null) throw new Error("Missing mixed player");
    simulation.inventory.configure(player.actor, { item: "q3:weapon/railgun", count: 1, capacity: 1 });
    simulation.inventory.configure(player.actor, { item: "q3:ammo/railgun", count: 20, capacity: 200 });
    let sequence = 0;
    const step = (weapon: "q3:weapon/railgun" | "q3:weapon/machinegun" | null, buttons = 0) => {
      simulation.step({ elapsedMilliseconds: 25, commands: [{ actor: admission.actor, source: { kind: "local-seat", client, seat },
        sequence: sequence++, command: { kind: "q1-quakeworld", milliseconds: 25, angles: { x: 0, y: 135, z: 0 },
          forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse: 0 },
        arsenal: { provider: "q3:official", weapon, useHoldable: false } }] });
      const view = simulation.presentations().find(value => value.actor.equals(admission.actor) && value.q3Weapon !== undefined)?.q3Weapon;
      if (view === undefined || player.animation.state.kind !== "q3" || player.arsenal.state.kind !== "q3") throw new Error("Missing Q3 state");
      return { torso: player.animation.state.torso & ~128, weaponTorso: view.torsoAnimation & ~128,
        state: player.arsenal.state.state, fire: view.lastFireMilliseconds };
    };
    step(null);
    const phases = new Set<number>();
    for (let index = 0; index < 24; index++) {
      const frame = step("q3:weapon/railgun"); phases.add(frame.state);
      expect(frame.fire).toBeNull();
      if (frame.state === WeaponState.WEAPON_DROPPING) expect(frame.torso).toBe(PlayerAnimation.TORSO_DROP);
      if (frame.state === WeaponState.WEAPON_RAISING) expect(frame.torso).toBe(PlayerAnimation.TORSO_RAISE);
      expect(frame.weaponTorso).toBe(frame.torso);
    }
    expect(phases.has(WeaponState.WEAPON_DROPPING)).toBe(true);
    expect(phases.has(WeaponState.WEAPON_RAISING)).toBe(true);
    expect(simulation.inventory.count(admission.actor, "q3:ammo/railgun")).toBe(20);
    const fired = step(null, 1);
    expect(fired.fire).not.toBeNull(); expect(fired.torso).toBe(PlayerAnimation.TORSO_ATTACK);
    expect(simulation.inventory.count(admission.actor, "q3:ammo/railgun")).toBe(19);
    for (let index = 0; index < 62; index++) step(null);
    for (let index = 0; index < 24; index++) {
      const frame = step("q3:weapon/machinegun");
      expect(frame.fire).toBe(fired.fire);
      if (frame.state === WeaponState.WEAPON_DROPPING) expect(frame.torso).toBe(PlayerAnimation.TORSO_DROP);
      if (frame.state === WeaponState.WEAPON_RAISING) expect(frame.torso).toBe(PlayerAnimation.TORSO_RAISE);
      expect(frame.weaponTorso).toBe(frame.torso);
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);
