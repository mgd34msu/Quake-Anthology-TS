import type { ExecutableRecipe, GameFamily } from "../../../contracts/content.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { MovementEnvironment, MovementInput, MovementProfile, MovementProvider, MovementResult, MovementServices, MovementState } from "../../../contracts/movement.ts";
import type { TracePolicy } from "../../../contracts/scene.ts";
import { createQ1MovementProvider, createQwMovementProvider } from "../../../movement/q1/index.ts";
import type { Q1MovementOptions } from "../../../movement/q1/types.ts";
import { createQ2ClassicMovementProvider, createQ2RereleaseMovementProvider, Q2RereleaseMovementContext } from "../../../movement/q2/index.ts";
import { createQ3MovementProvider, EntityEvent, Q3_SOURCE_POSTURES, Q3_SOURCE_STANDING_BOUNDS } from "../../../movement/q3/index.ts";
import type { Q3MovementHooks, Q3Postures } from "../../../movement/q3/index.ts";
import { createQ3SourceMovementHooks } from "../../../content/q3/foundation/movement-hooks.ts";
import { q3SourceAnimation, q3SourceTorso } from "../../../movement/q3/animation.ts";
import { PlayerAnimation } from "../../../movement/q3/constants.ts";
import { q3SpawnArsenalRuntime } from "../../../content/q3/foundation/arsenal.ts";
import { readQ3ArsenalRuntime, readQ3MovementState } from "./q3/player-state.ts";
import { movementOrigin, movementProfile, providerFamily } from "./players.ts";
import type { MovementPlayer } from "./players.ts";
import type { SharedSimulation } from "./runtime.ts";
import { createSharedQuakeWorldMovement } from "./shared-quakeworld-movement.ts";

function relocated(state: MovementState, origin: Vec3, velocity: Vec3): MovementState {
  if (state.kind === "q2-classic") return { ...state,
    originEighths: [Math.trunc(origin.x * 8), Math.trunc(origin.y * 8), Math.trunc(origin.z * 8)],
    velocityEighths: [Math.trunc(velocity.x * 8), Math.trunc(velocity.y * 8), Math.trunc(velocity.z * 8)] };
  return { ...state, origin, velocity };
}
export type LocomotionPlayer = Pick<MovementPlayer, "profile" | "standingBounds" | "sourceMovement" | "character" | "worldGravity" | "q2MovementConfig" | "flight">;
export function capturePlayerLocomotion(player: LocomotionPlayer): LocomotionPlayer {
  return { character: player.character, profile: player.profile, standingBounds: player.standingBounds, flight: player.flight,
    worldGravity: player.worldGravity, q2MovementConfig: player.q2MovementConfig, sourceMovement: player.sourceMovement === null ? null : { ...player.sourceMovement } };
}
export function playerLocomotionMatches(player: LocomotionPlayer, previous: LocomotionPlayer): boolean {
  return player.flight === previous.flight && player.profile === previous.profile && player.character === previous.character && player.standingBounds === previous.standingBounds
    && player.worldGravity === previous.worldGravity && player.q2MovementConfig?.airAccelerate === previous.q2MovementConfig?.airAccelerate
    && player.q2MovementConfig?.n64Physics === previous.q2MovementConfig?.n64Physics && player.sourceMovement?.traceMask === previous.sourceMovement?.traceMask
    && player.sourceMovement?.fixedMsec === previous.sourceMovement?.fixedMsec && player.sourceMovement?.noFootsteps === previous.sourceMovement?.noFootsteps;
}
export function playerTracePolicy(player: LocomotionPlayer): TracePolicy {
  switch (player.profile.kind) {
    case "q1-netquake": case "q1-quakeworld": return { kind: "q1", move: "normal", hull: null };
    case "q2-classic": return { kind: "q2", contentsMask: 0x02010003, leafContents: "stored" };
    case "q2-rerelease": return { kind: "q2", contentsMask: 0x02010003, leafContents: "merged" };
    case "q3": return { kind: "q3", contentsMask: player.sourceMovement?.traceMask ?? 0x02010001, curves: true, playerCurveClip: true };
  }
}
export function playerStandingBounds(character: GameFamily): Bounds {
  return character === "q3" ? Q3_SOURCE_STANDING_BOUNDS : { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
}
export function playerPostures(player: Pick<MovementPlayer, "character" | "standingBounds" | "viewHeight">): Q3Postures {
  return player.character === "q3" ? Q3_SOURCE_POSTURES : { standingViewHeight: player.viewHeight,
    crouched: { bounds: { min: player.standingBounds.min, max: { ...player.standingBounds.max, z: 4 } }, viewHeight: -2 },
    dead: { bounds: { min: player.standingBounds.min, max: { ...player.standingBounds.max, z: -8 } }, viewHeight: -16 },
    invulnerabilityExpanded: Q3_SOURCE_POSTURES.invulnerabilityExpanded };
}
export function locomotionTemplate(recipe: ExecutableRecipe): LocomotionPlayer {
  const character = providerFamily(recipe.character.definition.provider);
  return { character, profile: movementProfile(recipe), sourceMovement: null, q2MovementConfig: null, worldGravity: 800, flight: false, standingBounds: playerStandingBounds(character) };
}
export function playerCrouchedBounds(player: LocomotionPlayer): Bounds {
  return playerPostures({ ...player, viewHeight: 0 }).crouched.bounds;
}
export function selectedMovementProfile(player: Pick<MovementPlayer, "profile" | "worldGravity" | "sourceMovement" | "q2MovementConfig">,
  profile: MovementProfile = player.profile): MovementProfile {
  if (profile.kind === "q1-netquake" || profile.kind === "q1-quakeworld") return { ...profile, parameters: { ...profile.parameters, gravity: player.worldGravity } };
  if (profile.kind === "q3" && player.sourceMovement !== null) return { ...profile,
    fixedMilliseconds: player.sourceMovement.fixedMsec, noFootsteps: player.sourceMovement.noFootsteps };
  const q2 = player.q2MovementConfig;
  if (q2 !== null && profile.kind === "q2-classic") return { ...profile, airAccelerate: q2.airAccelerate };
  if (q2 !== null && profile.kind === "q2-rerelease") return { ...profile, ...q2 };
  return profile;
}
export function playerMovementEnvironment(player: Pick<MovementPlayer, "sourceEnvironment" | "gravityMultiplier" | "state" | "flight" | "movementSpeedMultiplier">,
  combat: { readonly health: number; readonly invulnerable: boolean }): MovementEnvironment {
  const source = player.sourceEnvironment, multiplier = player.movementSpeedMultiplier;
  const speed = multiplier === 1 ? {} : { speedMultiplier: multiplier };
  return source === null ? { ...speed, health: combat.health, flight: player.flight && combat.health > 0, haste: false, invulnerable: combat.invulnerable,
    gravityMultiplier: player.state.kind === "q3" ? 1 : player.gravityMultiplier }
    : { ...source, ...speed, flight: (source.flight || player.flight) && combat.health > 0, health: combat.health, invulnerable: source.invulnerable || combat.invulnerable,
      gravityMultiplier: player.state.kind === "q3" ? 1 : source.gravityMultiplier };
}
export interface PlayerMovementHooks {
  readonly nativeQuakeWorld?: boolean;
  readonly publishPosture?: (bounds: Bounds, viewHeight: number) => void;
  readonly q1: Q1MovementOptions;
  readonly q2: Q2RereleaseMovementContext;
  readonly q3: Q3MovementHooks;
}
export function createPlayerMovementProvider(player: Pick<MovementPlayer, "profile" | "character" | "standingBounds" | "viewHeight" | "sourceMovement">,
  hooks: PlayerMovementHooks): MovementProvider {
  const profile = player.profile;
  switch (profile.kind) {
    case "q1-netquake": return createQ1MovementProvider(profile.id, hooks.q1);
    case "q1-quakeworld": return hooks.nativeQuakeWorld === true ? createQwMovementProvider(profile.id, hooks.q1)
      : createSharedQuakeWorldMovement(profile.id, hooks.q1, player.standingBounds,
        playerPostures({ ...player, viewHeight: 22 }), hooks.publishPosture);
    case "q2-classic": return createQ2ClassicMovementProvider(profile.id);
    case "q2-rerelease": return createQ2RereleaseMovementProvider(profile.id, hooks.q2);
    case "q3": return createQ3MovementProvider({ id: profile.id, hooks: hooks.q3, postures: () => playerPostures(player),
      ...(player.sourceMovement === null ? {} : { tracePolicy: () => ({ kind: "q3", contentsMask: player.sourceMovement?.traceMask ?? 0x02010001,
        curves: true, playerCurveClip: true } satisfies Extract<TracePolicy, { readonly kind: "q3" }>) }) });
  }
}
export type MovementPredictionPlayer = Readonly<Pick<MovementPlayer,
  "client" | "actor" | "profile" | "standingBounds" | "bounds" | "sourceMovement" | "character" | "worldGravity" | "q2MovementConfig" | "flight"
  | "sourceEnvironment" | "gravityMultiplier" | "movementSpeedMultiplier" | "state" | "arsenal" | "animation" | "viewHeight">> & {
  readonly services: Pick<MovementServices, "numeric">;
  readonly q3Arsenal?: import("../../../content/q3/foundation/arsenal.ts").Q3ArsenalRuntimeState;
};
export interface PlayerMovementPrediction {
  readonly provider: MovementProvider;
  readonly services: MovementServices;
  input(previous: MovementResult | null, index: number, commandMove: Vec3): MovementInput;
}

/** Providers receive detached movement and hook state, while all traces read the active shared scene. */
export function createPlayerMovementPrediction(simulation: SharedSimulation, player: MovementPredictionPlayer, origin: Vec3, velocity: Vec3,
  milliseconds: number, crouched = false, selectedProfile: MovementProfile = selectedMovementProfile(player)): PlayerMovementPrediction {
  const profile = selectedProfile, source = simulation.q3Source(), entity = source?.pool.at(player.client.slot);
  const combat = simulation.combat.read(player.actor.id) ?? player.sourceEnvironment;
  if (combat === null) throw new Error("Player has no combat state during movement prediction");
  const environment = playerMovementEnvironment(player, combat);
  const baseline = entity !== undefined && source !== null && profile.kind === "q3" ? readQ3MovementState(entity, source.records) : player.state;
  let initial = relocated(baseline, origin, velocity);
  if (initial.kind === "q3") initial = { ...initial, movementFlags: (initial.movementFlags & ~2) | (crouched ? 1 : 0) };
  let q3Hooks: Q3MovementHooks;
  if (player.arsenal.state.kind === "q3") {
    let runtime = entity !== undefined && source !== null ? readQ3ArsenalRuntime(entity, q3SpawnArsenalRuntime(source.options.product, 100)) : player.q3Arsenal ?? q3SpawnArsenalRuntime("baseq3", 100);
    q3Hooks = createQ3SourceMovementHooks({ read: () => runtime, write: (_actor, _execution, next) => { runtime = next; return undefined; }, gauntletHit: () => false });
  } else {
    q3Hooks = { firing: () => false,
      animation: (request, context) => context.animation.state.kind === "q3" ? q3SourceAnimation(request, context) : { animation: context.animation, effects: [] },
      torso: context => context.animation.state.kind === "q3" ? q3SourceTorso(PlayerAnimation.TORSO_STAND, context, true) : { animation: context.animation, effects: [] },
      weapon: context => ({ arsenal: context.arsenal, animation: context.animation, effects: [], movementFlags: context.motion.pmFlags }) };
  }
  const nativeQuakeWorld = simulation.quakecSource()?.kind === "quakeworld";
  const provider = createPlayerMovementProvider(player, { nativeQuakeWorld, q1: { viewHeight: player.viewHeight }, q2: new Q2RereleaseMovementContext(), q3: q3Hooks });
  return { provider, services: { scene: simulation.scene, numeric: player.services.numeric,
    touch: (_contact, state) => ({ kind: "continue", state }),
    weaponStep: input => ({ arsenal: input.arsenal, animation: input.animation, effects: [] }),
    animationStep: input => ({ animation: input.animation, effects: [] }) },
    input(previous, index, commandMove): MovementInput {
      if (previous?.status === "actor-removed") throw new Error("Movement prediction removed its actor");
      const state = previous?.state ?? initial, yaw = Math.atan2(commandMove.y, commandMove.x);
      const horizontal = Math.min(400, Math.hypot(commandMove.x, commandMove.y)), up = Math.max(-400, Math.min(400, commandMove.z));
      const angles = { x: 0, y: yaw * 180 / Math.PI, z: 0 }, words: readonly [number, number, number] = [0, Math.round(yaw * 65536 / (Math.PI * 2)) & 65535, 0];
      const time = (baseline.kind === "q3" ? baseline.commandTimeMilliseconds : simulation.timeSeconds * 1000) + (index + 1) * milliseconds;
      const bounds = profile.kind === "q1-quakeworld" && !nativeQuakeWorld
        ? previous?.bounds ?? (crouched ? playerCrouchedBounds(player) : player.bounds) : player.standingBounds;
      const base = { actor: player.actor, commandSequence: index, execution: "prediction", shape: { kind: "box", bounds },
        frame: { frame: index, time: { kind: "milliseconds", value: time }, elapsed: { kind: "milliseconds", value: milliseconds }, phase: "client-command" },
        environment,
        arsenal: previous?.arsenal ?? player.arsenal, animation: previous?.animation ?? player.animation } satisfies Omit<MovementInput, "kind" | "profile" | "state" | "command">;
      if (profile.kind === "q1-netquake" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, acknowledgedServerTimeSeconds: time / 1000, viewAngles: angles, forwardMove: horizontal, sideMove: 0, upMove: up, buttons: up > 0 ? 2 : 0, impulse: 0 } };
      if (profile.kind === "q1-quakeworld" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, milliseconds, angles, forwardMove: horizontal, sideMove: 0, upMove: up, buttons: up > 0 ? 2 : 0, impulse: 0 } };
      if (profile.kind === "q2-classic" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, milliseconds, angleShorts: [words[0] - state.deltaAngleShorts[0], words[1] - state.deltaAngleShorts[1], words[2] - state.deltaAngleShorts[2]], forwardMove: horizontal, sideMove: 0, upMove: up, buttons: 0, impulse: 0, lightLevel: 0 } };
      if (profile.kind === "q2-rerelease" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        viewOffset: { x: 0, y: 0, z: player.viewHeight }, snapInitial: true,
        command: { kind: profile.kind, milliseconds, angles: { x: -state.deltaAngles.x, y: angles.y - state.deltaAngles.y, z: -state.deltaAngles.z }, forwardMove: horizontal, sideMove: 0, buttons: up > 0 ? 8 : up < 0 ? 16 : 0, serverFrame: index } };
      if (profile.kind === "q3" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, serverTimeMilliseconds: time, angleWords: [-state.deltaAngleWords[0], (words[1] - state.deltaAngleWords[1]) & 65535, -state.deltaAngleWords[2]],
          forwardMove: Math.round(horizontal * 127 / 400), rightMove: 0, upMove: Math.round(up * 127 / 400), buttons: 0, weapon: entity?.client?.ps.weapon ?? (player.arsenal.state.kind === "q3" ? player.arsenal.state.sourceWeapon : 0) } };
      throw new Error("Player state differs from selected movement");
    } };
}

export function movementObservation(result: Extract<MovementResult, { readonly status: "active" }>) {
  const medium = result.waterLevel === 0 ? "dry" : result.kind === "q1-netquake" || result.kind === "q1-quakeworld"
    ? result.waterType === -4 ? "slime" : result.waterType === -5 ? "lava" : "water"
    : result.waterType & 16 ? "slime" : result.waterType & 8 ? "lava" : "water";
  return { origin: movementOrigin(result.state), grounded: result.ground.kind !== "none", medium,
    damagingFall: result.effects.some(({ effect }) => effect.kind === "event"
      && (effect.value.event === EntityEvent.EV_FALL_MEDIUM || effect.value.event === EntityEvent.EV_FALL_FAR)) };
}
