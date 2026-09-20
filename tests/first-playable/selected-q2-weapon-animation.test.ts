import { expect, test } from "bun:test";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationPreset, loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { readQ2WeaponState } from "../../src/persistence/q2-weapons.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../src/persistence/value.ts";

for (const edition of ["classic", "rerelease"]) test(`selected Q2 ${edition} weapons return to idle pose in a rerelease Q1 world`, async () => {
  const parsed = parseApplicationCommand(["--game", "q1-rerelease-id1", "--map", "start", "--movement", "q2", "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Expected startup options");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: {
    kind: "selected", value: [{ provider: "q2:official", content: catalog.require(`q2-${edition}-baseq2`).id }] } } });
  const content = await loadApplicationContent(parsed.options, recipe);
  const identity = createIdentityOwner(`selected-q2-animation-${edition}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    const client = identity.client(0, 0), seat = identity.seat(0), admission = simulation.admitPlayer(client);
    const player = simulation.movementPlayer(admission.actor), source = simulation.q2WeaponSource();
    if (player === null || source === null) throw new Error("Missing selected source arsenal");
    simulation.combat.setTraits(player.actor, { invulnerable: true });
    let sequence = 0;
    const step = (buttons = 0) => {
      simulation.step({ elapsedMilliseconds: 25, commands: [{ actor: admission.actor, source: { kind: "local-seat", client, seat },
        sequence: sequence++, command: { kind: "q2-classic", milliseconds: 25, angleShorts: [0, 0, 0],
          forwardMove: 0, sideMove: 0, upMove: 0, buttons, impulse: 0, lightLevel: 0 } }] });
      const gun = simulation.presentations().find(value => value.actor.equals(admission.actor) && value.viewWeapon);
      if (gun === undefined) throw new Error("Missing selected weapon presentation");
      return gun;
    };
    for (const name of ["bfg", "shotgun"]) {
      const definition = source.weapons.definition(name);
      simulation.inventory.configure(player.actor, { item: definition.item, count: 1, capacity: 1 });
      if (definition.ammo === null) throw new Error("Expected ammunition");
      simulation.inventory.configure(player.actor, { item: definition.ammo, count: 200, capacity: 200 });
      expect(simulation.requestWeapon(admission.actor, { provider: player.arsenal.provider, item: definition.item })).toBe(true);
      for (let index = 0; index < 100; index++) step();
      const state = source.weapons.states.get(admission.actor);
      if (state === undefined) throw new Error("Missing source weapon state");
      expect(state.phase).toBe("ready");
      const frames = new Set<number>(), recoil = new Map<number, number>(); let kickTime: number | null = null;
      const sample = (pitch: number) => {
        if (kickTime === null && Math.abs(pitch) > 0.5) {
          kickTime = source.game.host.now();
          const saved = readQ2WeaponState(new SaveReader(decodeCheckpointValue(encodeCheckpointValue({ ...state }))));
          expect(saved.kickTime).toBe(state.kickTime);
          const { kickTime: savedTime, ...legacy } = saved;
          expect(readQ2WeaponState(new SaveReader(legacy)).kickTime).toBeCloseTo(savedTime, 6);
        }
        if (kickTime !== null) recoil.set(Math.round((source.game.host.now() - kickTime) * 1000), Math.abs(pitch));
      };
      step(1);
      for (let index = 0; index < 200; index++) {
        const gun = step(); frames.add(gun.frame);
        sample(gun.angles.x - player.viewAngles.x);
      }
      expect(simulation.inventory.count(admission.actor, definition.ammo)).toBe(200 - definition.quantity);
      expect(frames.size).toBeGreaterThan(10);
      expect(kickTime).not.toBeNull();
      if (name === "bfg") {
        expect(recoil.get(0)).toBeCloseTo(edition === "classic" ? 40 : 20, 5);
        expect(recoil.get(200)).toBeGreaterThan(0);
        expect(recoil.get(200)).toBeLessThan(recoil.get(0) ?? 0);
        expect(recoil.get(600)).toBe(0);
      } else expect(recoil.get(200)).toBe(0);
      expect(state.phase).toBe("ready");
      const idle = step();
      expect(idle.angles).toEqual(player.viewAngles);
      expect(idle.origin).toEqual({ ...player.view().origin, z: player.view().origin.z + player.viewHeight });
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);
