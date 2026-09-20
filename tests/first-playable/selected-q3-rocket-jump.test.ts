import { expect, test } from "bun:test";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { applicationPreset, loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { DamageOutcome, DamageRequest } from "../../src/contracts/gameplay.ts";
import type { BodyState } from "../../src/contracts/world.ts";

for (const movement of ["q1", "q2"]) test(`selected Q3 rockets propel a jumping ${movement} player away from the explosion in a Q1 world`, async () => {
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", movement, "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Expected startup options");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: {
    kind: "selected", value: [{ provider: "q3:official", content: catalog.require("q3-baseq3").id }] } } });
  const content = await loadApplicationContent(parsed.options, recipe);
  const identity = createIdentityOwner(`selected-q3-rocket-jump-${movement}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    const client = identity.client(0, 0), seat = identity.seat(0), admission = simulation.admitPlayer(client);
    const player = simulation.movementPlayer(admission.actor);
    if (player === null) throw new Error("Missing selected source arsenal");
    simulation.inventory.configure(player.actor, { item: "q3:weapon/rocketlauncher", count: 1, capacity: 1 });
    simulation.inventory.configure(player.actor, { item: "q3:ammo/rocketlauncher", count: 20, capacity: 200 });
    expect(simulation.requestWeapon(admission.actor, { provider: player.arsenal.provider, item: "q3:weapon/rocketlauncher" })).toBe(true);
    let sequence = 0;
    const step = (buttons = 0, upMove = 0) => simulation.step({ elapsedMilliseconds: 25, commands: [{ actor: admission.actor,
      source: { kind: "local-seat", client, seat }, sequence: sequence++, command: movement === "q1"
        ? { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: { x: 89, y: 0, z: 0 },
          forwardMove: 0, sideMove: 0, upMove, buttons: buttons | (upMove > 0 ? 2 : 0), impulse: 0 }
        : { kind: "q2-classic", milliseconds: 25, angleShorts: [Math.trunc(89 * 65536 / 360), 0, 0],
          forwardMove: 0, sideMove: 0, upMove, buttons, impulse: 0, lightLevel: 0 } }] });
    for (let index = 0; index < 100; index++) step();
    const hits: { request: DamageRequest; outcome: DamageOutcome; before: BodyState; after: BodyState; projectile: BodyState | null }[] = [];
    simulation.combat.damageOperation.register({ provider: "test:rocket-jump", id: "test:rocket-jump", order: 0, kind: "replace",
      replace: (request, next) => {
        const before = simulation.physics.bodies.read(admission.actor);
        const projectile = request.attack.originatingProjectile === undefined ? null : simulation.physics.bodies.read(request.attack.originatingProjectile);
        const outcome = next(request), after = simulation.physics.bodies.read(admission.actor);
        if (request.target.equals(admission.actor) && request.delivery === "radius" && before !== null && after !== null)
          hits.push({ request, outcome, before, after, projectile });
        return outcome;
      } });
    simulation.drainPresentationEvents();
    step(1, 200);
    for (let index = 0; index < 12 && hits.length === 0; index++) step();
    expect(simulation.inventory.count(admission.actor, "q3:ammo/rocketlauncher")).toBe(19);
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (hit === undefined) throw new Error("Missing rocket splash");
    const fire = simulation.drainPresentationEvents().find(value => value.kind === "q3-ballistics" && value.event.kind === "fire");
    if (fire?.kind !== "q3-ballistics" || hit.outcome.kind !== "committed") throw new Error("Missing source fire/damage result");
    expect(fire.event.end.z - fire.event.origin.z).toBeLessThan(-0.99);
    expect(hit.before.velocity.z).toBeGreaterThan(0);
    expect(hit.projectile?.origin).toEqual(hit.request.point);
    expect(hit.request.point.z).toBeLessThan(hit.before.origin.z);
    expect(hit.after.velocity.x).toBe(hit.before.velocity.x);
    expect(hit.after.velocity.y).toBe(hit.before.velocity.y);
    expect(hit.after.velocity.z - hit.before.velocity.z).toBeCloseTo(hit.request.amount * 8, 4);
    expect(hit.outcome.decision.mutations.find(value => value.kind === "impulse")?.movementProvider).toBe(recipe.movement.provider);
    step();
    const moved = simulation.physics.bodies.read(admission.actor);
    if (moved === null) throw new Error("Missing player body after rocket jump");
    expect(moved.origin.z).toBeGreaterThan(hit.after.origin.z);
    expect(moved.velocity.z).toBeGreaterThan(hit.before.velocity.z);
    const source = simulation.q1Source();
    if (source === null || source.game.world === null) throw new Error("Missing original Q1 world");
    source.game.damage(admission.actor, source.game.world.actor.id, null, 1);
    expect(simulation.physics.bodies.read(admission.actor)?.velocity).toEqual(moved.velocity);
  } finally { simulation.close(); await content.close(); }
}, 30000);
