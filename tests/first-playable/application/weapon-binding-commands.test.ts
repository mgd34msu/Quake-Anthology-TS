import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { InputRouter } from "../../../src/input/router.ts";
import { captureMovementPlayer, readMovementPlayer } from "../../../src/app/bootstrap/simulation/player-checkpoint.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";
import type { SavedActorId } from "../../../src/contracts/session.ts";

for (const arsenal of ["q3", "hipnotic"]) test(`console-authored ${arsenal} weapon bindings select the actual arsenal on a Q2 world`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-weapon-binding-"));
  let app: Application | null = null, router: InputRouter | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", arsenal === "q3" ? "q2" : "q3",
      "--character", "q2", "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
    const preset = applicationPreset(catalog, parsed.options);
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [arsenal === "q3"
      ? { provider: "q3:official", content: catalog.require("q3-baseq3").id }
      : { provider: "q1:official", content: catalog.require("q1-rerelease-hipnotic").id }] } } });
    const application = app = await Application.open(parsed.options, { print: () => undefined }, recipe);
    await application.step(100);
    const local = application.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    const movement = application.simulation.movementPlayer(local.actor);
    if (movement === null) throw new Error("Missing movement player");
    const controls = local.seat.presentation.ui.local;
    const route = router = new InputRouter({ seats: [{ input: controls.input, controller: { kind: "none" } }], keyboardSeat: local.seat.id,
      controllers: null, now: () => performance.now(), ticks: () => 0, subframe: false, unhandled: () => undefined });
    const key = (code: number, down: boolean): void => route.handlePlatform({ kind: "key", timestamp: 0, scancode: code, keycode: code, modifiers: 0, down, repeat: false });
    const tap = (code: number): void => { key(code, true); key(code, false); };
    const submit = async (text: string): Promise<void> => {
      route.handlePlatform({ kind: "text", timestamp: 0, text }); tap(13); await application.step(1); await application.step(1);
    };
    tap(96); expect(controls.input.focus.kind).toBe("console");
    await submit(arsenal === "q3" ? 'bind 3 "weapon 3"' : 'bind 6 "impulse 6"');
    tap(96); expect(controls.input.focus.kind).toBe("game");
    if (arsenal === "q3") {
      application.simulation.inventory.give(movement.actor, "q3:weapon/shotgun", 1);
      application.simulation.inventory.give(movement.actor, "q3:ammo/shotgun", 20);
      expect(application.simulation.playerUi(local.actor).activeWeapon).not.toBe("q3:weapon/shotgun");
      tap(51);
      for (let frame = 0; frame < 10; frame++) await application.step(100);
      expect(application.simulation.playerUi(local.actor).activeWeapon).toBe("q3:weapon/shotgun");
    } else {
      const game = application.simulation.q1WeaponSource()?.game, player = game?.player(local.actor);
      if (game === undefined || player === null || player === undefined) throw new Error("Missing selected Hipnotic player");
      application.simulation.inventory.give(movement.actor, "q1:weapon/grenadelauncher", 1);
      application.simulation.inventory.give(movement.actor, "q1:weapon/hipnotic:proximity", 1);
      application.simulation.inventory.give(movement.actor, "q1:ammo/rockets", 20);
      const original = player.weapon;
      player.attackFinished = game.time + 1;
      tap(54); await application.step(100);
      expect(player.weapon).toBe(original);
      const pending = captureMovementPlayer(movement);
      const reference = (saved: SavedActorId) => {
        const actor = application.simulation.actors.resolveSaved(saved);
        if (actor === null) throw new Error("Missing checkpoint actor");
        return actor.id;
      };
      const restored = readMovementPlayer(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(pending))), reference);
      expect(restored.arsenalIntent).toEqual({ provider: movement.arsenal.provider, weapon: null, useHoldable: false, impulse: 6 });
      expect(() => readMovementPlayer(new SaveReader({ ...pending, arsenalIntent: { ...pending.arsenalIntent, impulse: 256 } }), reference)).toThrow("source impulse exceeds one byte");
      expect(() => readMovementPlayer(new SaveReader({ ...pending, arsenalIntent: { ...pending.arsenalIntent, provider: "invalid" } }), reference)).toThrow();
      expect(() => readMovementPlayer(new SaveReader({ ...pending, arsenalIntent: { ...pending.arsenalIntent, weapon: "invalid" } }), reference)).toThrow();
      await application.step(100);
      expect(player.weapon).toBe(original);
      expect(movement.arsenalIntent?.impulse).toBe(6);
      for (let frame = 0; frame < 12; frame++) await application.step(100);
      expect(player.weapon).toBe("grenadelauncher");
      expect(movement.arsenalIntent?.impulse ?? 0).toBe(0);
      tap(54); await application.step(100);
      expect(player.weapon).toBe("hipnotic:proximity");
      tap(54); await application.step(100);
      expect(player.weapon).toBe("grenadelauncher");
    }
  } finally { router?.close(); try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 120000);
