import { relativeMovementCommand } from "../q3-commands.ts";
import type { UserCommand } from "../../../../contracts/protocol.ts";
import type { OrderedMovementEffect } from "../../../../contracts/movement.ts";
import { Q2RereleaseMovementContext } from "../../../../movement/q2/index.ts";
import { copyPredictionSnapshot, predictMovementCommand } from "./step.ts";
import type { MovementPredictionOptions, MovementPredictionResult, MovementPredictionSnapshot, PredictionCommand } from "./types.ts";

export function copyPredictionCommand(command: UserCommand): UserCommand {
  switch (command.kind) {
    case "q1-netquake": return { ...command, viewAngles: { ...command.viewAngles } };
    case "q1-quakeworld": case "q2-rerelease": return { ...command, angles: { ...command.angles } };
    case "q2-classic": return { ...command, angleShorts: [...command.angleShorts] };
    case "q3": return { ...command, angleWords: [...command.angleWords] };
  }
}

/** Each seat rewinds its own movement, inventory, animation, and event state together. */
export class SelectedMovementPrediction {
  private readonly rereleaseMovement = new Q2RereleaseMovementContext();
  private snapshot: MovementPredictionSnapshot;
  private readonly commands: PredictionCommand[] = [];
  private discardedSequence = -1;
  constructor(readonly options: MovementPredictionOptions, initial: MovementPredictionSnapshot) {
    if (options.actor.id.session !== options.seat.session) throw new Error("Prediction actor and seat belong to different sessions");
    if (initial.state.kind !== options.profile.kind) throw new Error("Prediction snapshot does not match selected movement");
    this.snapshot = copyPredictionSnapshot(initial);
  }
  receive(snapshot: MovementPredictionSnapshot): undefined {
    if (snapshot.state.kind !== this.options.profile.kind) throw new Error("Prediction snapshot changed movement family");
    this.snapshot = copyPredictionSnapshot(snapshot);
    while (this.commands[0] !== undefined && this.commands[0].sequence <= snapshot.sequence) this.commands.shift();
    return undefined;
  }
  submit(entry: PredictionCommand): undefined {
    if (!Number.isSafeInteger(entry.sequence) || !Number.isFinite(entry.timeMilliseconds)) throw new RangeError("Prediction command needs a finite clock and integer sequence");
    if (entry.command.kind !== this.options.profile.kind) throw new Error("Prediction command does not match selected movement");
    const previous = this.commands.at(-1);
    if (entry.sequence <= this.snapshot.sequence || previous !== undefined && entry.sequence <= previous.sequence) return undefined;
    this.commands.push({ ...entry, command: copyPredictionCommand(entry.command), ...(entry.arsenal === undefined ? {} : { arsenal: { ...entry.arsenal } }) });
    if (this.commands.length > 64) {
      const dropped = this.commands.shift();
      if (dropped !== undefined) this.discardedSequence = dropped.sequence;
    }
    return undefined;
  }
  replay(observe?: (snapshot: MovementPredictionSnapshot) => void): MovementPredictionResult {
    let player = copyPredictionSnapshot(this.snapshot);
    const effects: OrderedMovementEffect[] = [];
    if ((player.state.kind === "q2-classic" || player.state.kind === "q2-rerelease") && (player.state.flags & 64) !== 0) {
      const latest = this.commands.at(-1), state = player.state;
      const command = latest === undefined ? undefined : relativeMovementCommand(latest, state).command;
      const shortAngle = (word: number): number => (word << 16 >> 16) * 360 / 65536;
      if (state.kind === "q2-classic" && command?.kind === "q2-classic") player = { ...player, viewAngles: {
        x: shortAngle(command.angleShorts[0]) + shortAngle(state.deltaAngleShorts[0]),
        y: shortAngle(command.angleShorts[1]) + shortAngle(state.deltaAngleShorts[1]),
        z: shortAngle(command.angleShorts[2]) + shortAngle(state.deltaAngleShorts[2]) } };
      else if (state.kind === "q2-rerelease" && command?.kind === "q2-rerelease") player = { ...player, viewAngles: {
        x: command.angles.x + state.deltaAngles.x, y: command.angles.y + state.deltaAngles.y, z: command.angles.z + state.deltaAngles.z } };
      return { status: "disabled", player, effects };
    }
    if (this.discardedSequence > player.sequence || (this.commands.at(-1)?.sequence ?? player.sequence) - player.sequence >= 63)
      return { status: "history-exhausted", player, effects };
    const profile = this.options.profile;
    let first = true;
    for (const entry of this.commands) {
      const output = predictMovementCommand(this.options, player, entry, { scene: this.options.scene,
        rereleaseMovement: this.rereleaseMovement,
        fixedMilliseconds: profile.kind === "q3" ? profile.fixedMilliseconds : null,
        noFootsteps: profile.kind === "q3" && profile.noFootsteps, gauntletHit: false, traceMask: null, firstCommand: first });
      player = output.player; effects.push(...output.result.effects); first = false;
      if (observe !== undefined) observe(copyPredictionSnapshot(player));
    }
    return { status: first ? "unchanged" : "predicted", player, effects };
  }
}
