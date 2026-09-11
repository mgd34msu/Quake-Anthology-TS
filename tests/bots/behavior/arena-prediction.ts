import type { BotMovementPrediction } from "../../../src/bots/behavior/q3/navigation-types.ts";
import { projectBotMovement } from "../../../src/bots/behavior/prediction.ts";
import type { BotTravelPredictionResult } from "../../../src/bots/behavior/q3/travel/types.ts";
import type { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { readQ3ArsenalRuntime, readQ3MovementEnvironment, readQ3MovementState } from "../../../src/app/bootstrap/simulation/q3/player-state.ts";
import { createQ3MovementProvider, EntityEvent, Q3_SOURCE_POSTURES } from "../../../src/movement/q3/index.ts";
import { createQ3SourceMovementHooks } from "../../../src/content/q3/foundation/movement-hooks.ts";
import { q3SpawnArsenalRuntime } from "../../../src/content/q3/foundation/arsenal.ts";

/** The arena check borrows its actual admitted Q3 player and replays the selected provider on detached state. */
export function arenaPrediction(simulation: SharedSimulation, query: BotMovementPrediction): BotTravelPredictionResult {
  if (query.stopArea !== 0) throw new Error("This combat projection fixture requires no explicit AAS stop area");
  const source = simulation.q3Source();
  if (source === null) throw new Error("Arena prediction requires the admitted native source map");
  const entity = source.pool.at(query.entityNum), player = simulation.movementPlayer(entity.actor.id);
  if (player === null || player.profile.kind !== "q3" || player.state.kind !== "q3" || entity.client === null) throw new Error("Arena fixture selected another movement profile");
  const selected = player.profile, baseline = readQ3MovementState(entity, source.records), milliseconds = Math.round(query.frameTime * 1000);
  let runtime = readQ3ArsenalRuntime(entity, q3SpawnArsenalRuntime(source.options.product, 100));
  const provider = createQ3MovementProvider({ id: selected.id, postures: () => Q3_SOURCE_POSTURES,
    hooks: createQ3SourceMovementHooks({ read: () => runtime, write: (_actor, _execution, next) => { runtime = next; return undefined; },
      gauntletHit: context => {
        if ((context.command.buttons & 1) === 0) return false;
        throw new Error("Locomotion projections cannot fire authoritative melee attacks");
      } }) });
  return projectBotMovement(query, { provider,
    services: { scene: simulation.scene, numeric: player.services.numeric,
      touch: () => { throw new Error("Detached prediction invoked an authoritative touch"); },
      weaponStep: () => { throw new Error("Q3 source prediction bypassed its selected weapon hook"); },
      animationStep: () => { throw new Error("Q3 source prediction bypassed its selected animation hook"); } },
    input(previous, frame, commandMove) {
      if (previous !== null && (previous.status !== "active" || previous.kind !== "q3")) throw new Error("Arena projection changed movement family");
      const yaw = Math.atan2(commandMove.y, commandMove.x), horizontal = Math.hypot(commandMove.x, commandMove.y);
      const time = baseline.commandTimeMilliseconds + (frame + 1) * milliseconds;
      return { kind: "q3", actor: entity.actor, commandSequence: frame, execution: "prediction", profile: selected,
        shape: { kind: "box", bounds: player.standingBounds },
        frame: { frame, time: { kind: "milliseconds", value: time }, elapsed: { kind: "milliseconds", value: milliseconds }, phase: "client-command" },
        environment: readQ3MovementEnvironment(entity, { health: entity.health, flight: false, haste: false, invulnerable: false, gravityMultiplier: player.gravityMultiplier }),
        arsenal: previous?.arsenal ?? player.arsenal, animation: previous?.animation ?? player.animation,
        state: previous?.state ?? { ...baseline, origin: { ...query.origin }, velocity: { ...query.velocity },
          ground: query.onGround ? baseline.ground : { kind: "none" }, movementFlags: (baseline.movementFlags & ~2) | (query.presence === 4 ? 1 : 0) },
        command: { kind: "q3", serverTimeMilliseconds: time,
          angleWords: [-baseline.deltaAngleWords[0], (Math.round(yaw * 65536 / (Math.PI * 2)) - baseline.deltaAngleWords[1]) & 65535, -baseline.deltaAngleWords[2]],
          forwardMove: Math.min(127, Math.round(horizontal * 127 / 400)), rightMove: 0,
          upMove: query.presence === 4 ? -127 : Math.max(-127, Math.min(127, Math.round(commandMove.z * 127 / 400))), buttons: 0, weapon: entity.client?.ps.weapon ?? 0 } };
    },
    stopEvents(previous, result) {
      if (result.status !== "active") throw new Error("Arena projection removed its actor");
      const wasGrounded = previous?.status === "active" ? previous.ground.kind !== "none" : query.onGround;
      const grounded = result.ground.kind !== "none";
      let flags = !wasGrounded && grounded ? 1 : wasGrounded && !grounded ? 2 : 0;
      if (result.waterLevel > 0) flags |= result.waterType & 8 ? 8 : result.waterType & 16 ? 16 : 4;
      for (const { effect } of result.effects) if (effect.kind === "event"
        && (effect.value.event === EntityEvent.EV_FALL_MEDIUM || effect.value.event === EntityEvent.EV_FALL_FAR)) flags |= 32;
      return flags;
    } });
}
