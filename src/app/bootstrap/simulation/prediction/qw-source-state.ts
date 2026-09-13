/* Native QW client continuation follows quake-1-re-ts qw/client/cl_pred.ts. */
import type { Q1MovementProfile, QwMovementProfile } from "../../../../contracts/movement.ts";
import type { QwPlayerState, QwUserCommand } from "../../../../contracts/protocol.ts";
import type { QwMoveVariables } from "../../../../network/q1/quakeworld.ts";
import { SelectedMovementPrediction } from "./runtime.ts";
import { copyPredictionSnapshot } from "./step.ts";
import type { MovementPredictionOptions, MovementPredictionResult, MovementPredictionSnapshot } from "./types.ts";

export function qwPredictionProfile(base: Q1MovementProfile | QwMovementProfile, variables: QwMoveVariables): QwMovementProfile {
  return { kind: "q1-quakeworld", id: base.id, numeric: base.numeric,
    clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 50 }, parameters: { ...variables } };
}

export interface QwPredictionStatus { readonly health: number; readonly spectator: number; }

/** Playerinfo has no oldbuttons, waterjumptime or ground: retain the matching command's continuation. */
export function qwPredictionSnapshot(base: MovementPredictionSnapshot, player: QwPlayerState,
  status: QwPredictionStatus, acknowledged: MovementPredictionSnapshot | null,
  sequence: number, commandTimeMilliseconds: number): MovementPredictionSnapshot {
  if (status.spectator !== 0) throw new Error("The native QW graphical player slice does not admit spectators");
  if (base.state.kind !== "q1-quakeworld") throw new Error("QW prediction requires a QW snapshot");
  const continuation = acknowledged?.state.kind === "q1-quakeworld" ? acknowledged.state : base.state;
  const viewHeight = (player.flags & 1024) !== 0 ? 8 : (player.flags & 512) !== 0 ? -16 : 22;
  return copyPredictionSnapshot({ ...base, sequence, commandTimeMilliseconds,
    state: { kind: "q1-quakeworld", origin: { ...player.origin }, velocity: { ...player.velocity }, angles: { ...base.viewAngles },
      oldButtons: continuation.oldButtons, waterJumpTimeSeconds: continuation.waterJumpTimeSeconds,
      ground: continuation.ground, dead: status.health <= 0, spectator: 0 },
    viewHeight, viewOffset: { x: 0, y: 0, z: viewHeight },
    environment: { ...base.environment, health: status.health, gravityMultiplier: 1 },
    contact: acknowledged?.contact ?? base.contact });
}

interface SentPrediction {
  readonly command: QwUserCommand;
  readonly timeMilliseconds: number;
  player: MovementPredictionSnapshot | null;
}

/** One seat and one server-world lifetime; collision and movement remain shared engine services. */
export class QuakeWorldPrediction {
  private profile: QwMovementProfile;
  private readonly prediction: SelectedMovementPrediction;
  private readonly history = new Map<number, SentPrediction>();
  private acknowledgedSequence: number;
  private lastSent: number;
  private viewHeight: number;
  private result: MovementPredictionResult;
  constructor(options: MovementPredictionOptions, initial: MovementPredictionSnapshot, variables: QwMoveVariables) {
    if (options.profile.kind !== "q1-netquake" && options.profile.kind !== "q1-quakeworld") throw new Error("QW prediction requires Q1 movement parameters");
    if (initial.state.kind !== "q1-quakeworld" || initial.state.spectator !== 0) throw new Error("QW prediction requires an admitted native player");
    this.profile = qwPredictionProfile(options.profile, variables);
    const owner = this;
    this.prediction = new SelectedMovementPrediction({ ...options, get profile() { return owner.profile; } }, initial);
    this.acknowledgedSequence = initial.sequence; this.lastSent = initial.sequence;
    this.viewHeight = initial.viewHeight;
    this.result = this.prediction.replay();
  }
  sent(sequence: number, command: QwUserCommand, now: number): void {
    if (sequence <= this.lastSent) return;
    this.prediction.submit({ sequence, timeMilliseconds: now, command });
    this.lastSent = sequence;
    this.history.set(sequence, { command: { ...command, angles: { ...command.angles } }, timeMilliseconds: now, player: null });
    while (this.history.size > 64) { const first = this.history.keys().next(); if (!first.done) this.history.delete(first.value); }
    this.predict();
  }
  acknowledged(sequence: number, _now: number): void {
    if (!Number.isSafeInteger(sequence)) throw new RangeError("QW acknowledgement needs an integer channel sequence");
    this.acknowledgedSequence = Math.max(this.acknowledgedSequence, sequence);
  }
  /** Call only for a packet containing this player's playerinfo, after its channel acknowledgement. */
  receive(base: MovementPredictionSnapshot, player: QwPlayerState, variables: QwMoveVariables, status: QwPredictionStatus): void {
    const acknowledged = this.history.get(this.acknowledgedSequence);
    const snapshot = qwPredictionSnapshot(base, player, status, acknowledged?.player ?? null,
      this.acknowledgedSequence, acknowledged?.timeMilliseconds ?? base.commandTimeMilliseconds);
    this.profile = qwPredictionProfile(this.profile, variables);
    this.viewHeight = snapshot.viewHeight;
    this.prediction.receive(snapshot);
    for (const sequence of this.history.keys()) if (sequence <= this.acknowledgedSequence) this.history.delete(sequence);
    this.predict();
  }
  private predict(): void {
    const result = this.prediction.replay(player => {
      const entry = this.history.get(player.sequence);
      if (entry !== undefined) entry.player = this.clientContinuation(player, entry.command);
    });
    const command = this.history.get(result.player.sequence)?.command;
    this.result = { ...result, player: command === undefined ? result.player : this.clientContinuation(result.player, command) };
  }
  private clientContinuation(player: MovementPredictionSnapshot, command: QwUserCommand): MovementPredictionSnapshot {
    if (player.state.kind !== "q1-quakeworld") throw new Error("QW replay changed movement family");
    // CL_PredictUsercmd writes to.oldbuttons = pmove.cmd.buttons, unlike the server's PMove latch.
    return { ...player, viewHeight: this.viewHeight, viewOffset: { x: 0, y: 0, z: this.viewHeight },
      state: { ...player.state, oldButtons: command.buttons } };
  }
  replay(): MovementPredictionResult { return { ...this.result, player: copyPredictionSnapshot(this.result.player) }; }
}
