import type { MovementInput, MovementResult, MovementServices, MovementState, Q1MovementInput, WeaponStepInput, WeaponStepResult } from "../../../../contracts/movement.ts";
import type { FrameContext } from "../../../../contracts/time.ts";
import { createNumericOperations } from "../../../../core/numeric.ts";
import { createQ1MovementProvider, createQwMovementProvider } from "../../../../movement/q1/index.ts";
import { createQ2ClassicMovementProvider, createQ2RereleaseMovementProvider } from "../../../../movement/q2/index.ts";
import { createQ3MovementProvider, Q3_SOURCE_POSTURES } from "../../../../movement/q3/index.ts";
import { q3SourceAnimation, q3SourceTorso } from "../../../../movement/q3/animation.ts";
import { MoveFlags } from "../../../../movement/q3/constants.ts";
import { stepQ3Arsenal } from "../../../../content/q3/foundation/arsenal.ts";
import { stepQ3CharacterAnimation } from "../../../../content/q3/foundation/character.ts";
import type { TraceShape } from "../../../../contracts/scene.ts";
import type { MovementProbeOptions, MovementPredictionSnapshot, PredictionCommand, PredictionStepOptions } from "./types.ts";
import { resolveQ3ArsenalControls } from "../arsenal-intent.ts";

export function copyMovementState(state: MovementState): MovementState {
  switch (state.kind) {
    case "q1-netquake": return { ...state, origin: { ...state.origin }, oldOrigin: { ...state.oldOrigin }, velocity: { ...state.velocity },
      angles: { ...state.angles }, angularVelocity: { ...state.angularVelocity }, viewAngles: { ...state.viewAngles }, punchAngles: { ...state.punchAngles }, waterJumpDirection: { ...state.waterJumpDirection } };
    case "q1-quakeworld": return { ...state, origin: { ...state.origin }, velocity: { ...state.velocity }, angles: { ...state.angles } };
    case "q2-classic": return { ...state, originEighths: [...state.originEighths], velocityEighths: [...state.velocityEighths], deltaAngleShorts: [...state.deltaAngleShorts] };
    case "q2-rerelease": return { ...state, origin: { ...state.origin }, velocity: { ...state.velocity }, deltaAngles: { ...state.deltaAngles } };
    case "q3": return { ...state, origin: { ...state.origin }, velocity: { ...state.velocity }, deltaAngleWords: [...state.deltaAngleWords],
      grapplePoint: { ...state.grapplePoint }, viewAngles: { ...state.viewAngles } };
  }
}

export function copyPredictionSnapshot(snapshot: MovementPredictionSnapshot): MovementPredictionSnapshot {
  return { ...snapshot, state: copyMovementState(snapshot.state),
    arsenal: { ...snapshot.arsenal, state: { ...snapshot.arsenal.state }, ammo: snapshot.arsenal.ammo.map(entry => ({ ...entry })) },
    animation: { ...snapshot.animation, state: { ...snapshot.animation.state } }, environment: { ...snapshot.environment },
    bounds: { min: { ...snapshot.bounds.min }, max: { ...snapshot.bounds.max } }, viewAngles: { ...snapshot.viewAngles }, viewOffset: { ...snapshot.viewOffset },
    contact: snapshot.contact === null ? null : { ...snapshot.contact },
    q3Arsenal: snapshot.q3Arsenal === null ? null : { ...snapshot.q3Arsenal } };
}

/** One command operates only on copied player state and read-only collision queries. */
export function predictMovementCommand(configuration: MovementProbeOptions, snapshot: MovementPredictionSnapshot,
  entry: PredictionCommand, options: PredictionStepOptions, shape: TraceShape = { kind: "box", bounds: configuration.standingBounds }) {
  const source = copyPredictionSnapshot(snapshot), profile = configuration.profile;
  let command = entry.command;
  if (source.arsenal.state.kind === "q3" && source.q3Arsenal !== null) {
    const controls = resolveQ3ArsenalControls(source.arsenal, entry.arsenal, command, source.q3Arsenal.product);
    if (command.kind === "q3" && entry.arsenal !== undefined) command = { ...command,
      weapon: controls.requestedWeapon, buttons: (command.buttons & ~4) | (controls.useHoldable ? 4 : 0) };
  } else if (entry.arsenal !== undefined) throw new Error("Prediction has no selected arsenal owner for this intent");
  const environment = source.state.kind === "q3" ? { ...source.environment, gravityMultiplier: 1 } : source.environment;
  const duration = command.kind === "q1-netquake" || command.kind === "q3"
    ? Math.max(0, entry.timeMilliseconds - source.commandTimeMilliseconds) : command.milliseconds;
  const sourceSeconds = profile.kind === "q1-netquake" || profile.kind === "q1-quakeworld";
  const frame: FrameContext = { frame: entry.sequence, phase: "client-command",
    time: sourceSeconds ? { kind: "seconds", value: entry.timeMilliseconds / 1000 } : { kind: "milliseconds", value: entry.timeMilliseconds },
    elapsed: sourceSeconds ? { kind: "seconds", value: duration / 1000 } : { kind: "milliseconds", value: duration } };
  let runtime = source.q3Arsenal;
  const weaponStep = (input: WeaponStepInput): WeaponStepResult => {
    // Native Q1/Q2 client prediction does not execute server weapon gamecode.
    if (input.arsenal.state.kind !== "q3") return { arsenal: input.arsenal, animation: input.animation, effects: [] };
    if (runtime === null) throw new Error("Q3 prediction needs the snapshot's private arsenal runtime");
    const controls = resolveQ3ArsenalControls(input.arsenal, entry.arsenal, input.command, runtime.product);
    const result = stepQ3Arsenal(input, runtime, input.command.kind === "q3"
      ? { ...controls, useHoldable: (input.command.buttons & 4) !== 0 } : controls);
    runtime = result.runtime;
    return result;
  };
  const services: MovementServices = { scene: options.scene, numeric: createNumericOperations(profile.numeric),
    touch: (_contact, state) => ({ kind: "continue", state }), weaponStep,
    animationStep: input => input.animation.state.kind === "q3"
      ? stepQ3CharacterAnimation(input, runtime?.product ?? "baseq3", source.environment.health <= 0, runtime?.eventSequence ?? 0)
      : { animation: input.animation, effects: [] } };
  const base = { actor: configuration.actor, commandSequence: entry.sequence, frame,
    shape, environment,
    arsenal: source.arsenal, animation: source.animation, execution: "prediction" } satisfies Omit<Q1MovementInput, "kind" | "command" | "state" | "profile">;
  const state = source.state;
  const q1Options = { viewHeight: configuration.standingViewHeight, hooks: {
    link: (_actor: MovementInput["actor"], next: MovementState) => ({ kind: "continue", state: next } satisfies ReturnType<MovementServices["touch"]>),
    isBsp: configuration.isBrush,
    beforePhysics: (_input: MovementInput, next: MovementState) => ({ kind: "continue", state: next } satisfies ReturnType<MovementServices["touch"]>),
    afterPhysics: (_input: MovementInput, next: MovementState) => ({ kind: "continue", state: next } satisfies ReturnType<MovementServices["touch"]>),
  } };
  let result: MovementResult;
  if (profile.kind === "q1-netquake" && state.kind === "q1-netquake" && command.kind === "q1-netquake") {
    result = createQ1MovementProvider(profile.id, q1Options).move({ ...base, kind: state.kind, state, profile, command }, services);
  } else if (profile.kind === "q1-quakeworld" && state.kind === "q1-quakeworld" && command.kind === "q1-quakeworld") {
    result = createQwMovementProvider(profile.id, q1Options).move({ ...base, kind: state.kind, state, profile, command }, services);
  } else if (profile.kind === "q2-classic" && state.kind === "q2-classic" && command.kind === "q2-classic") {
    result = createQ2ClassicMovementProvider(profile.id).move({ ...base, kind: state.kind, state,
      profile: { ...profile, snapInitial: false }, command }, services);
  } else if (profile.kind === "q2-rerelease" && state.kind === "q2-rerelease" && command.kind === "q2-rerelease") {
    result = createQ2RereleaseMovementProvider(profile.id, options.rereleaseMovement).move({ ...base, kind: state.kind, state, profile, command,
      snapInitial: options.firstCommand, viewOffset: source.viewOffset }, services);
  } else if (profile.kind === "q3" && state.kind === "q3" && command.kind === "q3") {
    result = createQ3MovementProvider({ id: profile.id,
      postures: () => source.animation.state.kind === "q3" ? Q3_SOURCE_POSTURES : {
        standingViewHeight: configuration.standingViewHeight,
        crouched: { bounds: { min: configuration.standingBounds.min, max: { ...configuration.standingBounds.max, z: 4 } }, viewHeight: -2 },
        dead: { bounds: { min: configuration.standingBounds.min, max: { ...configuration.standingBounds.max, z: -8 } }, viewHeight: -16 },
        invulnerabilityExpanded: Q3_SOURCE_POSTURES.invulnerabilityExpanded },
      ...(options.traceMask === null ? {} : { tracePolicy: () => ({ kind: "q3", contentsMask: options.traceMask ?? 0, curves: true, playerCurveClip: true } satisfies import("../../../../contracts/scene.ts").TracePolicy) }),
      hooks: {
        firing: context => (context.command.buttons & 1) !== 0 && context.motion.health > 0,
        animation: (request, context) => context.animation.state.kind === "q3" ? q3SourceAnimation(request, context) : { animation: context.animation, effects: [] },
        torso: context => context.animation.state.kind === "q3" ? q3SourceTorso(11, context, true) : { animation: context.animation, effects: [] },
        weapon: context => {
          const moved = weaponStep({ actor: configuration.actor, command: { ...command, buttons: context.command.buttons, weapon: context.command.weapon }, frame: context.frame,
            arsenal: context.arsenal, animation: context.animation, environment, gauntletHit: options.gauntletHit });
          return { ...moved, movementFlags: runtime === null ? context.motion.pmFlags
            : (context.motion.pmFlags & ~(MoveFlags.RESPAWNED | MoveFlags.USE_ITEM_HELD)) | (runtime.respawned ? MoveFlags.RESPAWNED : 0) | (runtime.useItemHeld ? MoveFlags.USE_ITEM_HELD : 0) };
        },
      },
    }).move({ ...base, kind: state.kind, state, command,
      profile: { ...profile, fixedMilliseconds: options.fixedMilliseconds, noFootsteps: options.noFootsteps } }, services);
  } else throw new Error(`Prediction command ${command.kind} and state ${state.kind} do not match selected ${profile.kind}`);
  if (result.status !== "active") throw new Error("Private movement prediction cannot remove an authoritative actor");
  if ((result.kind === "q2-classic" || result.kind === "q2-rerelease") && result.arsenal.state.kind === "q3") {
    const step = weaponStep({ actor: configuration.actor, command, frame, environment,
      arsenal: result.arsenal, animation: result.animation, gauntletHit: options.gauntletHit });
    const previous = result.effects;
    result = { ...result, arsenal: step.arsenal, animation: step.animation,
      effects: [...previous, ...step.effects.map((effect, index) => ({ effect, substep: 0, sequence: previous.length + index, time: frame.time }))] };
  }
  const player: MovementPredictionSnapshot = { ...source, environment, sequence: entry.sequence, commandTimeMilliseconds: entry.timeMilliseconds,
    state: result.state, arsenal: result.arsenal, animation: result.animation, bounds: result.bounds, viewAngles: result.viewAngles,
    viewHeight: result.viewHeight, contact: { ground: result.ground, waterLevel: result.waterLevel, waterType: result.waterType }, q3Arsenal: runtime };
  return { player, result };
}
