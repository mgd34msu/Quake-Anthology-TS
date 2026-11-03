import { expect, test } from "bun:test";
import { swingAngles } from "../../../../src/content/q3/foundation/player-pose.ts";
import { PlayerAnimationParseError, parsePlayerAnimationConfig } from "../../../../src/content/q3/foundation/animation-config.ts";
import { ShaderRemapRegistry } from "../../../../src/content/q3/base/game/shader-remaps.ts";
import { snapshotViewSource } from "../../../../src/content/q3/team-arena/client-policy.ts";
import { MoveFlags } from "../../../../src/content/q3/base/shared/player-state.ts";
import { GameClient } from "../../../../src/content/q3/base/game/state.ts";
import { createQ2ItemModule } from "../../../../src/content/q2/foundation/items.ts";
import { rogueWeaponDefinitions } from "../../../../src/content/q2/missionpacks/weapons/definitions.ts";

const hooks = { weaponPicked: () => undefined, silencer: () => undefined, powerArmor: () => undefined };

test("a hostile pitch magnitude no longer hangs the player pose swing", () => {
  const result = swingAngles({ destination: 0, swingTolerance: 15, clampTolerance: 30, speed: 0.1, frameTimeMs: 50, angle: 1e30, swinging: false });
  expect(Number.isFinite(result.angle)).toBe(true);
});

test("an animation.cfg with no frame numbers reports the parser's own error class", () => {
  expect(() => parsePlayerAnimationConfig("footsteps boot\nsex m\n")).toThrow(PlayerAnimationParseError);
  expect(() => parsePlayerAnimationConfig("// comment only\n")).toThrow(PlayerAnimationParseError);
});

test("shader remap names of 64 or more bytes are cut to fit the source slot", () => {
  const remaps = new ShaderRemapRegistry(() => undefined);
  expect(() => remaps.add("textures/a", "x".repeat(80), 0)).not.toThrow();
  expect(remaps.captureSaveState()[0]?.newName).toHaveLength(63);
});

test("a follower's snapshot takes position and stores from the followed client", () => {
  const spectator = new GameClient("baseq3"), target = new GameClient("baseq3"), own = spectator.ps, followed = target.ps;
  own.clientNum = 1; followed.origin = { x: 900, y: -700, z: 50 };
  const clientAt = (number: number): GameClient => { if (number !== 1) throw new Error("Missing client"); return target; };
  expect(snapshotViewSource(own, clientAt)).toBe(own);
  own.pmFlags |= MoveFlags.FOLLOW;
  expect(snapshotViewSource(own, clientAt)).toBe(followed);
});

test("rerelease item rows carry the game_x64.dll values for body armor", () => {
  const classic = createQ2ItemModule(hooks), rerelease = createQ2ItemModule({ ...hooks, edition: "rerelease" });
  const names = new Set(["item_armor_body"]);
  expect(classic.resourcePaths(names)).toContain("sound/misc/ar1_pkup.wav");
  expect(rerelease.resourcePaths(names)).toContain("sound/misc/ar3_pkup.wav");
});

test("the Prox Launcher uses its own view and world models", () => {
  const prox = rogueWeaponDefinitions.find(definition => definition.name === "proxlauncher");
  expect(prox?.viewModel).toBe("models/weapons/v_plaunch/tris.md2");
  expect(prox?.worldModel).toBe("models/weapons/g_plaunch/tris.md2");
});
