// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec3 } from "../../../src/contracts/math.ts";
import type { Q3MovementInput, Q3MovementProfile } from "../../../src/contracts/movement.ts";
import type { SceneQueries } from "../../../src/contracts/scene.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createNumericOperations, Q3_BINARY32_PROFILE } from "../../../src/core/numeric.ts";
import { q3SpawnAnimation, q3SpawnArsenalRuntime, q3SpawnLoadout } from "../../../src/content/q3/foundation/arsenal.ts";
import { createQ3SourceMovementHooks } from "../../../src/content/q3/foundation/movement-hooks.ts";
import { createQ3MovementProvider, Q3_SOURCE_POSTURES, Q3_SOURCE_STANDING_BOUNDS } from "../../../src/movement/q3/index.ts";
import { createMovementAdmission, createMovementRouteAdmission } from "../../../src/bots/navigation/index.ts";
import type { NavigationPredictionDriver, NavigationProfile, NavigationWorld } from "../../../src/bots/navigation/index.ts";

export const movement: Q3MovementProfile = { kind: "q3", id: "q3:movement", product: "baseq3", fixedMilliseconds: null, noFootsteps: false,
  numeric: Q3_BINARY32_PROFILE, clock: { kind: "q3", serverFrameMilliseconds: 50, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 } };
export const profile: NavigationProfile = { movement, shape: { kind: "box", bounds: Q3_SOURCE_STANDING_BOUNDS },
  crouchedShape: { kind: "box", bounds: Q3_SOURCE_POSTURES.crouched.bounds },
  policy: { kind: "q3", contentsMask: 0x02010001, curves: true, playerCurveClip: true },
  capabilities: new Set(["walk", "jump", "drop", "swim", "water-jump", "crouch"]), maximumStep: 18, minimumFloorNormal: 0.7,
  maximumDrop: 128, team: null, monster: false };
const zero: Vec3 = { x: 0, y: 0, z: 0 };

export function navigationWorld(scene: SceneQueries): NavigationWorld & { revision: number; commands: number } {
  const owner = createIdentityOwner("navigation-prediction"), actor = owner.ownedActor(owner.actor(1, 1), "q3:character");
  const driver: NavigationPredictionDriver = { begin() {
      let arsenalRuntime = { ...q3SpawnArsenalRuntime("baseq3", 100), respawned: false };
      const provider = createQ3MovementProvider({ id: movement.id, postures: () => Q3_SOURCE_POSTURES,
        hooks: createQ3SourceMovementHooks({ read() { return arsenalRuntime; }, write(_actor, _execution, value) { arsenalRuntime = value; }, gauntletHit() { return false; } }) });
      return { provider, services: { scene, numeric: createNumericOperations(Q3_BINARY32_PROFILE),
        touch() { throw new Error("Prediction must not invoke authoritative touches"); }, weaponStep() { throw new Error("Source hooks own weapons"); }, animationStep() { throw new Error("Source hooks own animation"); } },
        input(previous, index, request): Q3MovementInput {
          if (previous !== null && (previous.kind !== "q3" || previous.status !== "active")) throw new Error("Unexpected prediction result");
          world.commands++;
          const origin = previous?.state.origin ?? request.from, yaw = Math.atan2(request.to.y - origin.y, request.to.x - origin.x);
          return { kind: "q3", actor, commandSequence: index + 1, profile: movement, execution: "prediction", shape: profile.shape,
            frame: { frame: index + 1, time: { kind: "milliseconds", value: (index + 1) * 16 }, elapsed: { kind: "milliseconds", value: 16 }, phase: "client-command" },
            environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 },
            arsenal: previous?.arsenal ?? q3SpawnLoadout("q3:arsenal", "baseq3", false),
            animation: previous?.animation ?? { provider: "q3:character", state: q3SpawnAnimation() },
            command: { kind: "q3", serverTimeMilliseconds: (index + 1) * 16, angleWords: [0, Math.round(yaw * 65536 / (Math.PI * 2)) & 65535, 0],
              buttons: 0, weapon: 2, forwardMove: 127, rightMove: 0,
              upMove: request.mode === "jump" || request.mode === "water-jump" ? 127 : request.mode === "crouch" ? -127 : 0 },
            state: previous?.state ?? { kind: "q3", commandTimeMilliseconds: 0, movementType: 0, bobCycle: 0, movementFlags: 0,
              movementTimeMilliseconds: 0, origin: request.from, velocity: zero, gravity: 800, speed: 320,
              deltaAngleWords: [0, 0, 0], movementDirection: 0, grapplePoint: zero, flags: 0, viewAngles: zero, viewHeight: 26,
              ground: { kind: "none" }, predictableEventSequence: 0, jumpPad: null, movementFrame: 0, jumpPadFrame: 0 } };
        } };
    } };
  const limits = { maximumSeconds: 2, maximumCommands: 125, tolerance: 6 };
  const world = { scene, passActor: null, revision: 0, commands: 0, entity() { return null; }, hazard() { return false; },
    admit: createMovementAdmission(driver, limits),
    beginRoute(selected: NavigationProfile) { return createMovementRouteAdmission(driver, selected, limits); },
  };
  return world;
}
