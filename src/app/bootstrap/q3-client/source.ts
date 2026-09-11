import type { ActorId } from "../../../contracts/identity.ts";
import type { ActorCommand } from "../../../contracts/session.ts";
import { tokenizeCommand } from "../../../core/commands/index.ts";
import type { SourcePlayerState, UserCommand } from "../../../content/q3/base/shared/player-state.ts";
import { ClientCommandHistory } from "../../../content/q3/presentation/prediction.ts";
import type { SnapshotSource } from "../../../content/q3/presentation/snapshots.ts";
import type { Snapshot } from "../../../network/q3/server-message.ts";
import { PlayerStateRecord, PlayerStateSlots } from "../../../network/q3/state/player.ts";
import type { Q3VisibleEntities } from "../../../network/q3/visibility.ts";
import type { Q3SourcePresentationState } from "../simulation/q3/presentation.ts";
import type { SimulationPresentationEvent } from "../simulation/types.ts";

function transportPlayer(source: SourcePlayerState): PlayerStateRecord<number, number, number> {
  const output = new PlayerStateRecord(source.product, source.pmType, source.weapon, source.weaponState);
  const slots = (input: SourcePlayerState["stats"]): PlayerStateSlots => new PlayerStateSlots(input.length, input.copy());
  output.copyFrom({ ...source, product: source.product, origin: source.origin, velocity: source.velocity,
    stats: slots(source.stats), persistant: slots(source.persistant), powerups: slots(source.powerups), ammo: slots(source.ammo),
    events: slots(source.events), eventParms: slots(source.eventParms) });
  return output;
}

/** One seat's local server transport retains the same snapshot and command rings as cgame. */
export class ApplicationQ3Source implements SnapshotSource {
  readonly commands = new ClientCommandHistory();
  private readonly snapshots = new Map<number, Snapshot>();
  private readonly serverCommands = new Map<number, readonly string[]>();
  private readonly actors = new Map<number, ActorId>();
  private readonly strings = Array.from({ length: 1024 }, () => "");
  private readonly appliedStrings = Array.from({ length: 1024 }, () => "");
  private number = 0;
  private reliable = 0;
  private sequence = -1;
  private commandSequence = -1;
  time = 0;
  readonly clientNumber: number;
  constructor(readonly actor: ActorId, initial: Q3SourcePresentationState,
    private readonly select: (player: PlayerStateRecord<number, number, number>, source: Q3SourcePresentationState) => Q3VisibleEntities,
    private readonly sourceActor: (number: number) => ActorId | null,
    private readonly predictionCommand?: (command: ActorCommand, sourceTimeMilliseconds: number) => UserCommand) {
    const client = initial.clients.find(client => client.actor.equals(actor));
    if (client === undefined) throw new Error("Q3 presentation seat has no source player");
    this.clientNumber = client.slot;
    for (const entry of initial.configstrings) { this.strings[entry.index] = entry.value; this.appliedStrings[entry.index] = entry.value; }
    this.receive(initial, [], []);
  }
  current(): { readonly number: number; readonly serverTime: number } { return { number: this.number, serverTime: this.time }; }
  read(number: number): Snapshot | null { return this.snapshots.get(number) ?? null; }
  getGameState(): readonly string[] { return this.appliedStrings.slice(); }
  getServerCommand(sequence: number): readonly string[] | null {
    const command = this.serverCommands.get(sequence) ?? null;
    if (command?.[0] === "cs") {
      const index = Number(command[1]), value = command[2];
      if (!Number.isInteger(index) || index < 0 || index >= 1024 || value === undefined) throw new Error("Invalid local source configstring command");
      this.appliedStrings[index] = value;
    }
    return command;
  }
  actorAt(number: number): ActorId {
    const actor = this.actors.get(number) ?? this.sourceActor(number);
    if (actor === null) throw new Error(`Q3 sound entity ${number} has no source actor`);
    return actor;
  }
  private command(argv: readonly string[]): void {
    this.serverCommands.set(++this.reliable, argv);
    this.serverCommands.delete(this.reliable - 64);
  }
  receive(source: Q3SourcePresentationState, events: readonly SimulationPresentationEvent[], commands: readonly ActorCommand[]): void {
    if (source.time < this.time) throw new Error("Q3 presentation world time rewound");
    const player = source.clients.find(client => client.actor.equals(this.actor));
    if (player === undefined || player.slot !== this.clientNumber) throw new Error("Q3 presentation seat changed source player");
    for (const row of source.entities) this.actors.set(row.state.number, row.actor);
    for (const row of source.clients) this.actors.set(row.slot, row.actor);
    const strings = Array.from({ length: 1024 }, () => "");
    for (const entry of source.configstrings) strings[entry.index] = entry.value;
    for (const [index, value] of strings.entries()) {
      if (this.strings[index] === value) continue;
      this.strings[index] = value; this.command(["cs", String(index), value]);
    }
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.kind !== "q3-source") continue;
      if (event.event.kind === "server-command" && (event.event.client < 0 || event.event.client === this.clientNumber)) this.command(tokenizeCommand(event.event.text, "q3").argv);
    }
    for (const input of commands) {
      if (!input.actor.equals(this.actor) || input.sequence <= this.commandSequence) continue;
      this.commandSequence = input.sequence;
      const command = input.command;
      if (this.predictionCommand !== undefined) this.commands.append(this.predictionCommand(input, source.time));
      else if (command.kind === "q3") this.commands.append({ serverTime: command.serverTimeMilliseconds, angles: { x: command.angleWords[0], y: command.angleWords[1], z: command.angleWords[2] },
        buttons: command.buttons, weapon: command.weapon, forwardmove: command.forwardMove, rightmove: command.rightMove, upmove: command.upMove });
      else throw new Error("Selected foreign movement requires its private cgame prediction command adapter");
    }
    if (this.number > 0 && source.time === this.time) return;
    this.time = source.time;
    const playerState = transportPlayer(player.state), visible = this.select(playerState, source);
    const areaMask = new Uint8Array(32); areaMask.set(visible.areaMask);
    const previous = this.number++;
    this.snapshots.set(this.number, { messageNumber: this.number, serverTime: source.time, deltaNumber: previous === 0 ? -1 : previous,
      flags: 0, serverCommandNumber: this.reliable, parseEntitiesNumber: 0, areaMask,
      playerState, entities: visible.entities });
    this.snapshots.delete(this.number - 32);
  }
}
