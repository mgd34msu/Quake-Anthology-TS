import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { add3 } from "../../../src/core/math.ts";

for (const edition of ["classic", "rerelease"]) test(`Q2 ${edition} camera and gun consume native viewheight, world-space gun offset and view kick through crouch and death`, async () => {
  const parsed = parseApplicationCommand(["--game", `q2-${edition}-baseq2`, "--map", "base1", "--movement", "q2", "--character", "q2", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`view-${edition}`);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 0, seed: 17, maxClients: 1, playerIdentity: value => ({ seat: value.slot, socialId: "" }) });
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor, source = simulation.q2Source(), player = simulation.movementPlayer(actor);
    if (source === null || player === null) throw new Error("Missing native Q2 player");
    let sequence = 0;
    const step = (crouch = false) => {
      simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "remote-client", client }, sequence: sequence++,
        command: player.profile.kind === "q2-classic" ? { kind: "q2-classic", milliseconds: 100, angleShorts: [0, 16384, 0], forwardMove: 0, sideMove: 0, upMove: crouch ? -200 : 0, buttons: 0, impulse: 0, lightLevel: 0 }
          : { kind: "q2-rerelease", milliseconds: 100, angles: { x: 0, y: 90, z: 0 }, forwardMove: 0, sideMove: 0, buttons: crouch ? 16 : 0, serverFrame: sequence } }] });
      const record = simulation.drainPresentationEvents().filter(record => record.kind === "q2-player" && record.event.kind === "view" && record.event.actor.equals(actor)).at(-1);
      if (record?.kind !== "q2-player" || record.event.kind !== "view") throw new Error("Missing source view");
      const native = record.event.view, view = simulation.playerView(actor), body = simulation.bodies.read(actor);
      if (body === null) throw new Error("Missing player body");
      const height = native.offset.z + (edition === "rerelease" ? player.viewHeight : 0);
      expect(view.viewHeight).toBe(height);
      expect(view.origin).toEqual(add3(body.origin, { x: native.offset.x, y: native.offset.y, z: 0 }));
      const gun = simulation.presentations().find(entry => entry.viewWeapon && entry.actor.equals(actor));
      if ((simulation.combat.read(actor)?.health ?? 0) > 0) {
        expect(gun?.origin).toEqual(add3(add3(view.origin, { x: 0, y: 0, z: height }), native.gunOffset));
        expect(gun?.angles).toEqual(add3(add3(native.angles, native.kickAngles), native.gunAngles));
      } else expect(gun?.visible ?? false).toBe(false);
      console.log(JSON.stringify({ edition, height: player.viewHeight, offset: native.offset, view, gun: gun?.origin, gunOffset: native.gunOffset, gunAngles: native.gunAngles }));
      return view.viewHeight;
    };
    for (let i = 0; i < 5; i++) step();
    expect(step()).toBe(22);
    source.players.rules.gunOffset = { x: 2, y: 3, z: 4 };
    const weapon = source.weapons.states.get(actor); if (weapon === undefined) throw new Error("Missing source weapon");
    weapon.kickOrigin = { x: 1, y: 2, z: 3 }; weapon.kickAngles = { x: 2, y: 3, z: 4 };
    step();
    source.players.rules.gunOffset = { x: 0, y: 0, z: 0 };
    weapon.kickOrigin = { x: 0, y: 0, z: 0 }; weapon.kickAngles = { x: 0, y: 0, z: 0 };
    expect(step(true)).toBeLessThan(22); for (let i = 0; i < 4; i++) step(true);
    for (let i = 0; i < 4; i++) step(); expect(step()).toBe(22);
    const entity = source.game.entity(actor); if (entity === null) throw new Error("Missing native entity");
    source.game.damage(actor, entity, actor, 220, 0, { x: 0, y: 0, z: 0 }, source.game.body(entity).origin, { x: 0, y: 0, z: 0 }, 0);
    expect(simulation.combat.read(actor)?.health).toBeLessThanOrEqual(0);
    step();
    source.players.beginIntermission(source.game, "*base2"); simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.playerView(actor).viewHeight).toBe(0);
    expect(simulation.presentations().some(entry => entry.viewWeapon && entry.actor.equals(actor))).toBe(false);
  } finally { simulation.close(); await content.close(); }
}, 30000);

import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { encodePng } from "../../../src/formats/images/png.ts";

test.skipIf(process.env["QUAKE_VIEWWEAPON_RENDER"] !== "1")("actual Q1 weapon on a rerelease Q2 character shares the final source camera anchor", async () => {
  const parsed = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q1:official", content: catalog.require("q1-classic-id1").id }] } } });
  const app = await Application.open(parsed.options, { print: () => undefined }, recipe);
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    const presentation = local.seat.presentation, source = app.simulation.q2Source();
    if (!(presentation instanceof WorldSeatPresentation) || source === null) throw new Error("Missing source presentation");
    for (let i = 0; i < 10; i++) await app.step(100);
    const entity = source.game.entity(local.actor); if (entity === null) throw new Error("Missing source player");
    // Source fall feedback creates a nonzero camera offset, independently of the selected gun.
    const state = source.players.context(entity, source.game).state;
    state.fallTime = app.simulation.timeSeconds + 0.3; state.fallValue = 20;
    await app.step(25);
    const view = app.simulation.playerView(local.actor), movement = app.simulation.movementPlayer(local.actor);
    expect(view.viewHeight).toBeLessThan(movement?.viewHeight ?? 0);
    const gun = app.simulation.presentations().find(entry => entry.viewWeapon && entry.actor.equals(local.actor));
    expect(gun?.family).toBe("q1");
    for (const axis of ["x", "y", "z"] satisfies readonly ("x" | "y" | "z")[]) expect(gun?.origin[axis]).toBeCloseTo(presentation.camera().origin[axis], 5);
    expect(gun?.angles).toEqual(view.angles);
    console.log(JSON.stringify({ crossWeapon: "q1", view, camera: presentation.camera().origin, gun: gun?.origin }));
    await Bun.write("/tmp/q2-viewweapon-q1-selected-cpu.png", encodePng(320, 240, app.readPixels()));
  } finally { await app.close(); }
}, 60000);
