import type { ActorId } from "../../../contracts/identity.ts";
import { CommonError } from "../../../core/common-error.ts";
import { Q3ServerCommandExecutor } from "../../../network/q3/client-server-command.ts";
import type { Q3ClientState } from "../../../compat/qvm/client-state.ts";
import { HistorySnapshotSource } from "../../../content/q3/presentation/snapshots.ts";
import { Q3CommandHistory } from "../../../network/q3/client.ts";
import { ClientGameStateStorage } from "../../../network/q3/game-state.ts";
import { SourceParseEntities } from "../../../network/q3/parse-entities.ts";
import type { Gamestate, Snapshot } from "../../../network/q3/server-message.ts";
import { SnapshotHistory } from "../../../network/q3/snapshot-history.ts";
import type { ApplicationQ3ClientSource } from "../q3-client.ts";

export interface LocalQ3ClientBindings {
  assertCurrent(): void;
  actorAt(number: number): ActorId;
  systemInfo(info: string): void | Promise<void>;
  mapRestart(): void;
  levelShot(): void;
  print(text: string): void;
}

/** A local seat receives authoritative server records without a network channel. */
export class LocalQ3ClientState implements Q3ClientState {
  readonly gameState = new ClientGameStateStorage(message => { throw new CommonError("drop", message); });
  readonly commands = new Q3CommandHistory();
  readonly source: ApplicationQ3ClientSource;
  readonly clientNumber: number;
  private readonly parseEntities = new SourceParseEntities();
  private readonly history = new SnapshotHistory(this.parseEntities);
  private readonly serverCommands = new Map<number, string>();
  private readonly pings = new Map<number, number>();
  private readonly serverCommandExecutor = new Q3ServerCommandExecutor();
  private retired = false;
  generation = 1;
  serverMessageSequence = 0;
  serverCommandSequence: number;
  lastExecutedServerCommand: number;

  constructor(initial: Gamestate, private readonly bindings: LocalQ3ClientBindings) {
    this.clientNumber = initial.clientNumber;
    this.serverCommandSequence = initial.commandSequence;
    this.lastExecutedServerCommand = initial.commandSequence;
    this.gameState.beginEntries();
    for (const entry of initial.entries) if (entry.kind === "configstring") this.gameState.append(entry.index, entry.value);
    const snapshots = new HistorySnapshotSource(this.history, () => this.parseEntities.number, text => bindings.print(text));
    const owner = this;
    this.source = {
      clientNumber: this.clientNumber,
      get time() { owner.assertCurrent(); return snapshots.current().serverTime; },
      get serverMessageSequence() { return owner.serverMessageSequence; },
      get lastExecutedServerCommand() { return owner.lastExecutedServerCommand; },
      commands: { get currentNumber() { return owner.commands.currentNumber; }, read: number => {
        owner.assertCurrent(); const command = owner.commands.read(number);
        return command === null ? null : { ...command, angles: { x: command.angles[0], y: command.angles[1], z: command.angles[2] } };
      } },
      current: () => { this.assertCurrent(); return snapshots.current(); },
      read: number => { this.assertCurrent(); return snapshots.read(number); },
      getGameState: () => { this.assertCurrent(); return this.gameState.copyStrings(); },
      systemInfo: () => { this.assertCurrent(); return this.gameState.get(1) ?? ""; },
      getServerCommand: number => this.getServerCommand(number),
      actorAt: number => { this.assertCurrent(); return bindings.actorAt(number); },
      snapshotPing: number => this.snapshotPing(number),
    };
  }

  private assertCurrent(): void {
    if (this.retired) throw new Error("Local Q3 client belongs to a retired gamestate");
    this.bindings.assertCurrent();
  }

  receiveServerCommand(sequence: number, text: string): void {
    this.assertCurrent();
    if (!Number.isInteger(sequence) || sequence !== this.serverCommandSequence + 1) throw new Error("Local Q3 reliable command sequence must advance without gaps");
    this.serverCommandSequence = sequence;
    this.serverCommands.set(sequence, text.slice(0, 1023));
    this.serverCommands.delete(sequence - 64);
  }

  receiveSnapshot(snapshot: Snapshot, ping = 0): void {
    this.assertCurrent();
    if (snapshot.messageNumber <= this.serverMessageSequence) throw new Error("Local Q3 snapshot sequence must advance");
    if (snapshot.serverCommandNumber !== this.serverCommandSequence) throw new Error("Local Q3 snapshot must follow its reliable commands");
    const start = this.parseEntities.number;
    for (const entity of snapshot.entities) { this.parseEntities.at(this.parseEntities.number).copyFrom(entity); this.parseEntities.advance(); }
    this.history.publish({ kind: "snapshot", validity: { kind: "valid" }, snapshot: { ...snapshot, parseEntitiesNumber: start } });
    this.serverMessageSequence = snapshot.messageNumber;
    for (const number of this.pings.keys()) if (((snapshot.messageNumber - number) | 0) >= 32) this.pings.delete(number);
    this.pings.set(snapshot.messageNumber, ping);
  }

  snapshotPing(number: number): number | null {
    this.assertCurrent();
    return this.source.read(number) === null ? null : this.pings.get(number) ?? null;
  }

  async getServerCommand(sequence: number): Promise<readonly string[] | null> {
    this.assertCurrent();
    if (sequence <= this.serverCommandSequence - 64) throw new CommonError("drop", "CL_GetServerCommand: a reliable command was cycled out");
    if (sequence > this.serverCommandSequence) throw new CommonError("drop", "CL_GetServerCommand: requested a command not received");
    const command = this.serverCommands.get(sequence);
    if (command === undefined) throw new CommonError("drop", "CL_GetServerCommand: command predates local gamestate");
    this.lastExecutedServerCommand = sequence;
    return this.serverCommandExecutor.execute(command, this.gameState, {
      assertCurrent: () => this.assertCurrent(),
      systemInfo: async () => { await this.bindings.systemInfo(this.gameState.get(1) ?? ""); },
      mapRestart: () => { this.commands.restart(); this.bindings.mapRestart(); },
      localServerRunning: () => true, levelShot: () => this.bindings.levelShot(),
    });
  }

  retire(): void {
    if (this.retired) return;
    this.retired = true; this.generation++;
    this.history.clear(); this.parseEntities.clear(); this.commands.clear(); this.gameState.clear();
    this.serverCommands.clear(); this.pings.clear(); this.serverCommandExecutor.clear();
  }
}
