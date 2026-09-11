// Command replay and correction from id Software code/cgame/cg_predict.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { ActorAnimationState, ArsenalState, MovementProvider, MovementServices,
  OrderedMovementEffect, Q3MovementInput, Q3MovementState } from "../../contracts/movement.ts";
import type { Q3UserCommand } from "../../contracts/protocol.ts";
import type { TraceHit } from "../../contracts/scene.ts";
import { add3, length3, scale3, sub3, vec3 } from "../../core/math.ts";
import { qvmFloatToInt } from "../../core/numeric.ts";
import { MoveFlags, MoveType } from "./constants.ts";

const f32 = Math.fround;

function emptyCommand(): Q3UserCommand {
  return { kind: "q3", serverTimeMilliseconds: 0, angleWords: [0, 0, 0], buttons: 0,
    weapon: 0, forwardMove: 0, rightMove: 0, upMove: 0 };
}
function copyCommand(command: Q3UserCommand): Q3UserCommand {
  return { ...command, angleWords: [command.angleWords[0], command.angleWords[1], command.angleWords[2]] };
}

export interface Q3CommandSource {
  readonly currentNumber: number;
  read(number: number): Q3UserCommand | null;
}

/** CL_GetUserCmd's zeroed CMD_BACKUP ring survives map_restart. */
export class Q3CommandHistory implements Q3CommandSource {
  private readonly commands = Array.from({ length: 64 }, emptyCommand);
  private number = 0;
  get currentNumber(): number { return this.number; }
  append(command: Q3UserCommand): number {
    this.number = (this.number + 1) | 0;
    this.commands[this.number & 63] = copyCommand(command);
    return this.number;
  }
  read(number: number): Q3UserCommand | null {
    if (!Number.isInteger(number)) throw new RangeError("Invalid user command number");
    if (number > this.number) throw new Error(`CL_GetUserCmd: ${number} >= ${this.number}`);
    if (number <= ((this.number - 64) | 0)) return null;
    const command = this.commands[number & 63];
    if (command === undefined) throw new Error("Missing command ring slot");
    return copyCommand(command);
  }
}

/** Movement, weapon/ammo and animation rewind together; the host restores other owner state. */
export interface Q3PredictedActor {
  readonly movement: Q3MovementState;
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
}
export interface Q3PredictionSnapshot {
  readonly serverTimeMilliseconds: number;
  readonly actor: Q3PredictedActor;
}
export interface Q3PredictionSettings {
  readonly demoPlayback: boolean;
  readonly noPredict: boolean;
  readonly synchronousClients: boolean;
  readonly fixed: boolean;
  readonly movementMilliseconds: number;
  readonly errorDecayInteger: number;
  readonly errorDecayValue: number;
  readonly showMiss: number;
}
export interface Q3PredictionFrame {
  readonly timeMilliseconds: number;
  readonly previousTimeMilliseconds: number;
  readonly snapshot: Q3PredictionSnapshot;
  readonly nextSnapshot: Q3PredictionSnapshot | null;
  readonly nextFrameTeleport: boolean;
  readonly thisFrameTeleport: boolean;
  readonly health: number;
}
export interface Q3PredictionTriggers {
  readonly actor: Q3PredictedActor;
  readonly hyperspace: boolean;
  readonly effects: readonly OrderedMovementEffect[];
}
export interface Q3PredictionHost {
  readonly commands: Q3CommandSource;
  readonly movement: Extract<MovementProvider, { readonly kind: "q3" }>;
  settings(): Q3PredictionSettings;
  setMovementMilliseconds(value: number): void;
  /** Restore selected providers' holdables, game words and other prediction-owned state. */
  restoreSnapshot(snapshot: Q3PredictionSnapshot): void;
  movementInput(actor: Q3PredictedActor, command: Q3UserCommand, commandNumber: number,
    physicsTimeMilliseconds: number): Q3MovementInput;
  movementServices(physicsTimeMilliseconds: number): MovementServices;
  /** Source item admission, teleport and jump-pad prediction occur after Pmove. */
  touchTriggers(actor: Q3PredictedActor, bounds: Bounds, physicsTimeMilliseconds: number): Q3PredictionTriggers;
  adjustForMover(origin: Vec3, ground: TraceHit, fromMilliseconds: number, toMilliseconds: number): Vec3;
  transition(current: Q3PredictedActor, previous: Q3PredictedActor, effects: readonly OrderedMovementEffect[]): void | Promise<void>;
  warn(message: string): void;
}

function interpolateVector(a: Vec3, b: Vec3, fraction: number): Vec3 {
  return vec3(f32(a.x + f32(fraction * f32(b.x - a.x))), f32(a.y + f32(fraction * f32(b.y - a.y))),
    f32(a.z + f32(fraction * f32(b.z - a.z))));
}
function lerpAngle(from: number, to: number, fraction: number): number {
  if (f32(to - from) > 180) to = f32(to - 360);
  if (f32(to - from) < -180) to = f32(to + 360);
  return f32(from + f32(fraction * f32(to - from)));
}

export function updateQ3PredictionView(state: Q3MovementState, health: number, command: Q3UserCommand): Q3MovementState {
  if (state.movementType === MoveType.PM_INTERMISSION || state.movementType === MoveType.PM_SPINTERMISSION ||
      (state.movementType !== MoveType.PM_SPECTATOR && health <= 0)) return state;
  let deltaPitch = state.deltaAngleWords[0];
  let pitch = ((command.angleWords[0] + deltaPitch) << 16) >> 16;
  if (pitch > 16000) { deltaPitch = (16000 - command.angleWords[0]) | 0; pitch = 16000; }
  else if (pitch < -16000) { deltaPitch = (-16000 - command.angleWords[0]) | 0; pitch = -16000; }
  const yaw = ((command.angleWords[1] + state.deltaAngleWords[1]) << 16) >> 16;
  const roll = ((command.angleWords[2] + state.deltaAngleWords[2]) << 16) >> 16;
  return { ...state, deltaAngleWords: [deltaPitch, state.deltaAngleWords[1], state.deltaAngleWords[2]],
    viewAngles: vec3(pitch * (360 / 65536), yaw * (360 / 65536), roll * (360 / 65536)) };
}

export class Q3PredictionRuntime {
  private predicted: Q3PredictedActor | null = null;
  private command = emptyCommand();
  private error = vec3(0, 0, 0);
  private errorTime = 0;
  constructor(readonly host: Q3PredictionHost) {}

  get actor(): Q3PredictedActor | null { return this.predicted; }
  get predictedError(): Vec3 { return this.error; }
  get predictedErrorTime(): number { return this.errorTime; }

  private requiredCommand(number: number): Q3UserCommand {
    const command = this.host.commands.read(number);
    if (command === null) throw new Error("Prediction command source violated its CMD_BACKUP window");
    return command;
  }

  private interpolate(frame: Q3PredictionFrame, grabAngles: boolean): Q3PredictedActor {
    const previous = frame.snapshot;
    let movement = previous.actor.movement;
    if (grabAngles) movement = updateQ3PredictionView(movement, frame.health, this.requiredCommand(this.host.commands.currentNumber));
    const next = frame.nextSnapshot;
    if (frame.nextFrameTeleport || next === null || next.serverTimeMilliseconds <= previous.serverTimeMilliseconds) {
      return { ...previous.actor, movement };
    }
    const fraction = f32(f32((frame.timeMilliseconds - previous.serverTimeMilliseconds) | 0) /
      f32((next.serverTimeMilliseconds - previous.serverTimeMilliseconds) | 0));
    const a = previous.actor.movement, b = next.actor.movement;
    const cycle = b.bobCycle < a.bobCycle ? (b.bobCycle + 256) | 0 : b.bobCycle;
    return { ...previous.actor, movement: { ...movement,
      bobCycle: qvmFloatToInt(f32(f32(a.bobCycle) + f32(fraction * f32((cycle - a.bobCycle) | 0)))),
      origin: interpolateVector(a.origin, b.origin, fraction), velocity: interpolateVector(a.velocity, b.velocity, fraction),
      viewAngles: grabAngles ? movement.viewAngles : vec3(lerpAngle(a.viewAngles.x, b.viewAngles.x, fraction),
        lerpAngle(a.viewAngles.y, b.viewAngles.y, fraction), lerpAngle(a.viewAngles.z, b.viewAngles.z, fraction)) } };
  }

  async predict(frame: Q3PredictionFrame): Promise<Q3PredictionOutput> {
    const settings = this.host.settings();
    const snapshot = frame.snapshot;
    if (this.predicted === null) this.predicted = snapshot.actor;
    if (settings.demoPlayback || (snapshot.actor.movement.movementFlags & MoveFlags.FOLLOW) !== 0 ||
        settings.noPredict || settings.synchronousClients) {
      const grabAngles = !settings.demoPlayback && (snapshot.actor.movement.movementFlags & MoveFlags.FOLLOW) === 0;
      this.predicted = this.interpolate(frame, grabAngles);
      return { status: "interpolated", actor: this.predicted, hyperspace: false, effects: [], consumedTeleport: false };
    }
    const old = this.predicted;
    const current = this.host.commands.currentNumber;
    const oldest = this.requiredCommand((current - 63) | 0);
    if (oldest.serverTimeMilliseconds > snapshot.actor.movement.commandTimeMilliseconds && oldest.serverTimeMilliseconds < frame.timeMilliseconds) {
      if (settings.showMiss !== 0) this.host.warn("exceeded PACKET_BACKUP on commands\n");
      return { status: "command-backup-exceeded", actor: old, hyperspace: false, effects: [], consumedTeleport: false };
    }
    const latest = this.requiredCommand(current);
    const selected = frame.nextSnapshot !== null && !frame.nextFrameTeleport && !frame.thisFrameTeleport ? frame.nextSnapshot : snapshot;
    this.host.restoreSnapshot(selected);
    this.predicted = selected.actor;
    const physicsTime = selected.serverTimeMilliseconds;
    if (settings.movementMilliseconds < 8) this.host.setMovementMilliseconds(8);
    else if (settings.movementMilliseconds > 33) this.host.setMovementMilliseconds(33);
    const effects: OrderedMovementEffect[] = [];
    let moved = false;
    let hyperspace = false;
    let consumedTeleport = false;
    for (let number = (current - 63) | 0; number <= current; number++) {
      const command = this.host.commands.read(number);
      if (command !== null) this.command = copyCommand(command);
      if (settings.fixed) this.predicted = { ...this.predicted,
        movement: updateQ3PredictionView(this.predicted.movement, frame.health, this.command) };
      const ps = this.predicted.movement;
      if (this.command.serverTimeMilliseconds <= ps.commandTimeMilliseconds || this.command.serverTimeMilliseconds > latest.serverTimeMilliseconds) continue;
      if (ps.commandTimeMilliseconds === old.movement.commandTimeMilliseconds) {
        if (frame.thisFrameTeleport && !consumedTeleport) {
          this.error = vec3(0, 0, 0); consumedTeleport = true;
          if (settings.showMiss !== 0) this.host.warn("PredictionTeleport\n");
        } else {
          const adjusted = this.host.adjustForMover(ps.origin, ps.ground, physicsTime, frame.previousTimeMilliseconds);
          const delta = sub3(old.movement.origin, adjusted), length = f32(length3(delta));
          if (length > f32(0.1)) {
            if (settings.showMiss !== 0) this.host.warn(`Prediction miss: ${length.toFixed(6)}\n`);
            if (settings.errorDecayInteger !== 0) {
              const elapsed = (frame.timeMilliseconds - this.errorTime) | 0;
              let fraction = f32(f32(f32(settings.errorDecayValue) - f32(elapsed)) / f32(settings.errorDecayValue));
              if (fraction < 0) fraction = 0;
              this.error = scale3(this.error, fraction);
            } else this.error = vec3(0, 0, 0);
            this.error = add3(delta, this.error); this.errorTime = frame.previousTimeMilliseconds;
          }
        }
      }
      if (settings.fixed) this.command = { ...this.command, serverTimeMilliseconds: Math.imul(
        Math.trunc(((this.command.serverTimeMilliseconds + settings.movementMilliseconds - 1) | 0) /
          settings.movementMilliseconds), settings.movementMilliseconds) };
      const input = this.host.movementInput(this.predicted, this.command, number, physicsTime);
      const result = this.host.movement.move({ ...input, state: this.predicted.movement, arsenal: this.predicted.arsenal,
        animation: this.predicted.animation, command: this.command, commandSequence: number, execution: "prediction",
        profile: { ...input.profile, fixedMilliseconds: settings.fixed ? settings.movementMilliseconds : null } }, this.host.movementServices(physicsTime));
      effects.push(...result.effects);
      if (result.status === "actor-removed") {
        return { status: "actor-removed", effects, consumedTeleport };
      }
      this.predicted = { movement: result.state, arsenal: result.arsenal, animation: result.animation };
      moved = true;
      const triggers = this.host.touchTriggers(this.predicted, result.bounds, physicsTime);
      this.predicted = triggers.actor; hyperspace ||= triggers.hyperspace; effects.push(...triggers.effects);
    }
    if (!moved) return { status: "unchanged", actor: this.predicted, hyperspace, effects, consumedTeleport };
    this.predicted = { ...this.predicted, movement: { ...this.predicted.movement,
      origin: this.host.adjustForMover(this.predicted.movement.origin, this.predicted.movement.ground, physicsTime, frame.timeMilliseconds) } };
    if (settings.showMiss !== 0 && this.predicted.movement.predictableEventSequence > ((old.movement.predictableEventSequence + 2) | 0)) {
      this.host.warn("WARNING: dropped event\n");
    }
    await this.host.transition(this.predicted, old, effects);
    return { status: "predicted", actor: this.predicted, hyperspace, effects, consumedTeleport };
  }
}

export type Q3PredictionOutput = {
  readonly status: "predicted" | "interpolated" | "unchanged" | "command-backup-exceeded";
  readonly actor: Q3PredictedActor;
  readonly hyperspace: boolean;
  readonly effects: readonly OrderedMovementEffect[];
  readonly consumedTeleport: boolean;
} | { readonly status: "actor-removed"; readonly effects: readonly OrderedMovementEffect[]; readonly consumedTeleport: boolean };
