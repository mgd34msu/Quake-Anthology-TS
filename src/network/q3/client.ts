// cl_parse.c, cl_cgame.c and cl_input.c connection storage and ordered packet calls.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { ClientId, SeatId } from "../../contracts/identity.ts";
import { CommonError } from "../../core/common-error.ts";
import { tokenizeCommand } from "../../core/commands/text.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { beginClientMessage, finishClientMessage, writeClientMovement } from "./client-message.ts";
import type { DemoMessageReader, DemoEnd } from "./demo.ts";
import { ClientGameStateStorage } from "./game-state.ts";
import { MessageReader, SourceMessageState } from "./message.ts";
import type { WireUserCommand } from "./message.ts";
import { Netchannel, xorClientMessage, xorServerMessage } from "./netchan.ts";
import type { ChannelDelivery, ChannelResult } from "./netchan.ts";
import { SourceParseEntities } from "./parse-entities.ts";
import { ClientReliableCommands } from "./reliable.ts";
import { ServerMessageCursor } from "./server-message.ts";
import type { Download, Gamestate, GamestateEntry, ServerMessage, ServerOperation, Snapshot } from "./server-message.ts";
import { SnapshotHistory } from "./snapshot-history.ts";
import { EntityStateRecord } from "./state/entity.ts";
import type { Product } from "./state/product.ts";

export interface Q3ConnectionIdentity { readonly client: ClientId; readonly seat: SeatId | null; }
export interface Q3ClientBindings {
  /** Session retirement invalidates continuation after an awaited source callback. */
  assertCurrent(): void;
  print(text: string): void;
  clearActive(): void;
  systemInfo(info: string): Promise<void>;
  gamestate(state: Gamestate, generation: number): Promise<void>;
  snapshot(snapshot: Snapshot, ping: number): void;
  downloadSize(size: number): number;
  download(block: Download): Promise<void>;
  mapRestart(): void;
  levelShot(): void;
  readonly localServerRunning: () => boolean;
}
export type Q3ClientPacketResult = Exclude<ChannelResult, { readonly kind: "accepted" }>
  | { readonly kind: "accepted"; readonly sequence: number; readonly dropped: number; readonly message: ServerMessage };
export type Q3ClientMode = { readonly kind: "network"; readonly challenge: number; readonly qport: number }
  | { readonly kind: "demo"; readonly reader: DemoMessageReader };

function copyCommand(command: WireUserCommand): WireUserCommand { return { ...command, angles: [...command.angles] }; }
function zeroCommand(): WireUserCommand { return { serverTime: 0, angles: [0, 0, 0], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }; }
/** The wire command ring also feeds the selected movement predictor. */
export class Q3CommandHistory {
  private readonly commands = Array.from({ length: 64 }, zeroCommand);
  private number = 0;
  get currentNumber(): number { return this.number; }
  append(command: WireUserCommand): number { this.number = (this.number + 1) | 0; this.commands[this.number & 63] = copyCommand(command); return this.number; }
  read(number: number): WireUserCommand | null {
    if (!Number.isInteger(number)) throw new RangeError("Invalid user command number");
    if (number > this.number) throw new CommonError("drop", "CL_GetUserCmd: requested future command");
    if (number <= ((this.number - 64) | 0)) return null;
    const command = this.commands[number & 63];
    if (command === undefined) throw new RangeError("Missing command ring slot");
    return copyCommand(command);
  }
  restart(): void { for (let index = 0; index < 64; index++) this.commands[index] = zeroCommand(); }
  clear(): void { this.restart(); this.number = 0; }
}

interface SentPacket { readonly commandNumber: number; readonly serverTime: number; readonly realTime: number; }
export interface Q3ClientSendOptions { readonly realTime: number; readonly packetDup: number; readonly noDelta: boolean; }
export interface Q3ClientSendReadiness {
  readonly realTime: number; readonly active: boolean; readonly primed: boolean;
  readonly cinematic: boolean; readonly downloading: boolean; readonly local: boolean; readonly lan: boolean;
  readonly maximumPackets: number;
}

/** A connection owns its wire histories, never the simulation or a render loop. */
export class Q3ClientConnection {
  readonly reliable = new ClientReliableCommands();
  readonly parseEntities = new SourceParseEntities();
  readonly history = new SnapshotHistory(this.parseEntities);
  readonly gameState = new ClientGameStateStorage(message => { throw new CommonError("drop", message); });
  readonly commands = new Q3CommandHistory();
  readonly sourceState = new SourceMessageState(text => { this.bindings.print(text); });
  readonly baselines = Array.from({ length: 1024 }, () => new EntityStateRecord<number>(0));
  readonly channel: Netchannel | null;
  private readonly serverCommands = Array.from({ length: 64 }, () => "");
  private readonly outPackets: SentPacket[] = Array.from({ length: 32 }, () => ({ commandNumber: 0, serverTime: 0, realTime: 0 }));
  private bigConfigString = "";
  serverMessageSequence = 0;
  serverCommandSequence = 0;
  lastExecutedServerCommand = 0;
  serverId = 0;
  checksumFeed = 0;
  clientNumber = 0;
  generation = 0;
  demoWaiting = true;
  lastPacketSentTime = 0;

  constructor(readonly identity: Q3ConnectionIdentity, readonly product: Product, readonly mode: Q3ClientMode, readonly bindings: Q3ClientBindings) {
    this.channel = mode.kind === "network" ? new Netchannel("client", mode.qport) : null;
  }
  private serverCommand(sequence: number): string {
    const value = this.serverCommands[sequence & 63];
    if (value === undefined) throw new RangeError("Missing server command ring slot");
    return value;
  }
  private clearActive(): void {
    this.history.clear(); this.parseEntities.clear(); this.gameState.clear(); this.commands.clear();
    this.serverId = 0;
    for (const baseline of this.baselines) baseline.copyFrom(new EntityStateRecord<number>(0));
    this.outPackets.fill({ commandNumber: 0, serverTime: 0, realTime: 0 });
    this.generation++; this.bindings.clearActive();
  }
  private ping(snapshot: Snapshot, realTime: number): number {
    for (let index = 0; index < 32; index++) {
      const packet = this.outPackets[((this.channel?.outgoingSequence ?? 1) - 1 - index) & 31];
      if (packet !== undefined && snapshot.playerState.commandTime >= packet.serverTime) return (realTime - packet.realTime) | 0;
    }
    return 999;
  }
  /** Accepts plaintext from channel decode or a demo record, retaining source mutation barriers. */
  async receiveMessage(sequence: number, bytes: Uint8Array, realTime: number): Promise<ServerMessage> {
    this.bindings.assertCurrent();
    if (this.mode.kind === "network" && (sequence <= this.serverMessageSequence || sequence < 1)) throw new RangeError("Server message sequence must advance");
    this.serverMessageSequence = sequence;
    const cursor = new ServerMessageCursor(bytes, "<q3-server-message>", null, this.mode.kind === "network" ? 4 : 0, this.parseEntities, size => this.bindings.downloadSize(size));
    let acknowledge = 0, commandSequence = 0, clientNumber = 0, checksumFeed = 0;
    let entries: GamestateEntry[] = [];
    const operations: ServerOperation[] = [];
    const client = this;
    while (true) {
      this.bindings.assertCurrent();
      const step = cursor.next({ product: this.product, get messageNumber() { return client.serverMessageSequence; }, get reliableSequence() { return client.reliable.sequence; },
        get serverCommandSequence() { return client.serverCommandSequence; }, get parseEntitiesNumber() { return client.parseEntities.number; },
        baseline: number => this.baselines[number] ?? null, history: number => this.history.borrowSlot(number, this.product) });
      switch (step.kind) {
        case "acknowledge": acknowledge = step.sequence; this.reliable.assignAcknowledgement(step.sequence); break;
        case "gamestate-start": this.clearActive(); entries = []; break;
        case "gamestate-sequence": commandSequence = step.sequence; this.serverCommandSequence = step.sequence; this.gameState.beginEntries(); break;
        case "gamestate-entry": {
          entries.push(step.entry);
          if (step.entry.kind === "configstring") this.gameState.append(step.entry.index, step.entry.value);
          else {
            const baseline = this.baselines[step.entry.number];
            if (baseline === undefined) throw new RangeError("Invalid source baseline number");
            baseline.copyFrom(step.entry.entity);
          }
          break;
        }
        case "gamestate-client": clientNumber = step.number; this.clientNumber = step.number; break;
        case "gamestate-checksum": checksumFeed = step.checksum; this.checksumFeed = step.checksum; break;
        case "gamestate-end": {
          const state: Gamestate = { kind: "gamestate", commandSequence, entries, clientNumber, checksumFeed };
          operations.push(state);
          await this.applySystemInfo(); this.bindings.assertCurrent();
          await this.bindings.gamestate(state, this.generation);
          break;
        }
        case "snapshot-header": if (step.deltaNumber <= 0) this.demoWaiting = false; break;
        case "operation": {
          const operation = step.operation; operations.push(operation);
          switch (operation.kind) {
            case "nop": break;
            case "command": this.serverCommandSequence = operation.sequence; this.serverCommands[operation.sequence & 63] = operation.text.slice(0, 1023); break;
            case "snapshot": if (this.history.publish(operation)) this.bindings.snapshot(operation.snapshot, this.ping(operation.snapshot, realTime)); break;
            case "download": await this.bindings.download(operation.block); break;
          }
          break;
        }
        case "end": return { reliableAcknowledge: acknowledge, serverCommandSequence: this.serverCommandSequence, parseEntitiesNumber: this.parseEntities.number, operations, terminal: step.terminal };
      }
    }
  }
  private async applySystemInfo(): Promise<void> {
    const info = this.gameState.get(1) ?? "", fields = info.split("\\");
    this.serverId = 0;
    for (let index = info.startsWith("\\") ? 1 : 0; index + 1 < fields.length; index += 2) {
      if (fields[index]?.toLowerCase() === "sv_serverid") { this.serverId = nativeAtoi(fields[index + 1] ?? ""); break; }
    }
    await this.bindings.systemInfo(info);
  }
  copyGamestate(): Gamestate {
    const entries: GamestateEntry[] = [];
    for (let index = 0; index < 1024; index++) { const value = this.gameState.get(index); if (value !== null) entries.push({ kind: "configstring", index, value }); }
    for (const [number, entity] of this.baselines.entries()) if (entity.number !== 0) entries.push({ kind: "baseline", number, entity: entity.copy() });
    return { kind: "gamestate", commandSequence: this.serverCommandSequence, entries, clientNumber: this.clientNumber, checksumFeed: this.checksumFeed };
  }
  async receiveDatagram(packet: Uint8Array, realTime: number): Promise<Q3ClientPacketResult> {
    this.bindings.assertCurrent();
    if (this.channel === null || this.mode.kind !== "network") throw new Error("Demo connection cannot receive datagrams");
    const result = this.channel.receive(packet);
    if (result.kind !== "accepted") return result;
    const ack = new MessageReader(result.payload).readLong();
    const plaintext = xorServerMessage(result.payload, this.mode.challenge, result.sequence, this.reliable.lookupMasked(ack));
    const message = await this.receiveMessage(result.sequence, plaintext, realTime);
    return { kind: "accepted", sequence: result.sequence, dropped: result.dropped, message };
  }
  async readDemo(realTime: number): Promise<ServerMessage | DemoEnd> {
    if (this.mode.kind !== "demo") throw new Error("Network connection cannot read demo messages");
    const record = this.mode.reader.next(sequence => { this.serverMessageSequence = sequence; });
    return record.kind === "end" ? record : this.receiveMessage(record.sequence, record.payload, realTime);
  }
  /** Call at CG_GetServerCommand, rather than eagerly executing commands during packet parse. */
  async getServerCommand(sequence: number): Promise<readonly string[] | null> {
    this.bindings.assertCurrent();
    if (sequence <= this.serverCommandSequence - 64) {
      if (this.mode.kind === "demo") return null;
      throw new CommonError("drop", "CL_GetServerCommand: a reliable command was cycled out");
    }
    if (sequence > this.serverCommandSequence) throw new CommonError("drop", "CL_GetServerCommand: requested a command not received");
    this.lastExecutedServerCommand = sequence;
    let text = this.serverCommand(sequence), argv = tokenizeCommand(text, "q3").argv, name = argv[0] ?? "";
    if (name === "disconnect") throw new CommonError("server-disconnect", argv.length >= 2 ? `Server Disconnected - ${argv[1] ?? ""}` : "Server disconnected\n");
    if (name === "bcs0") { this.bigConfigString = `cs ${argv[1] ?? ""} "${argv[2] ?? ""}`.slice(0, 8191); return null; }
    if (name === "bcs1" || name === "bcs2") {
      const suffix = argv[2] ?? "", last = name === "bcs2";
      if (this.bigConfigString.length + suffix.length + (last ? 1 : 0) >= 8192) throw new CommonError("drop", "bcs exceeded BIG_INFO_STRING");
      this.bigConfigString += suffix;
      if (!last) return null;
      this.bigConfigString += '"'; text = this.bigConfigString;
      argv = tokenizeCommand(text, "q3").argv; name = argv[0] ?? "";
    }
    if (name === "cs") {
      const index = nativeAtoi(argv[1] ?? "");
      if (this.gameState.modify(index, argv.slice(2).join(" ")) && index === 1) { await this.applySystemInfo(); this.bindings.assertCurrent(); }
      argv = tokenizeCommand(text, "q3").argv;
    } else if (name === "map_restart") { this.commands.restart(); this.bindings.mapRestart(); }
    else if (name === "clientLevelShot") { if (!this.bindings.localServerRunning()) return null; this.bindings.levelShot(); }
    return argv;
  }
  transmit(options: Q3ClientSendOptions, delivery: ChannelDelivery): void {
    this.bindings.assertCurrent();
    if (this.channel === null || this.mode.kind !== "network") throw new Error("Demo connection cannot send packets");
    const packetDup = Math.max(0, Math.min(5, Math.trunc(options.packetDup)));
    const old = this.outPackets[(this.channel.outgoingSequence - 1 - packetDup) & 31];
    if (old === undefined) throw new RangeError("Missing outgoing packet slot");
    const count = Math.min(32, this.commands.currentNumber - old.commandNumber), commands: WireUserCommand[] = [];
    for (let index = 0; index < count; index++) {
      const command = this.commands.read(this.commands.currentNumber - count + index + 1);
      if (command === null) throw new Error("Outgoing user command was overwritten");
      commands.push(command);
    }
    const header = { serverId: this.serverId, messageAcknowledge: this.serverMessageSequence, reliableAcknowledge: this.serverCommandSequence };
    const writer = beginClientMessage(header, this.reliable.pending(), this.sourceState);
    if (commands.length !== 0) {
      const latest = this.history.latest;
      const kind = options.noDelta || latest === null || this.demoWaiting || latest.messageNumber !== this.serverMessageSequence ? "move-no-delta" : "move";
      writeClientMovement(writer, { kind, commands }, header, { checksumFeed: this.checksumFeed, serverCommand: sequence => this.serverCommand(sequence) });
    }
    this.outPackets[this.channel.outgoingSequence & 31] = { commandNumber: this.commands.currentNumber, serverTime: commands.at(-1)?.serverTime ?? 0, realTime: options.realTime };
    this.lastPacketSentTime = options.realTime;
    const bytes = xorClientMessage(finishClientMessage(writer), this.mode.challenge, sequence => this.serverCommand(sequence));
    this.channel.beginTransmit(bytes, delivery);
    while (this.channel.hasUnsentFragments) this.channel.transmitNextFragment(delivery);
  }
  readyToSend(options: Q3ClientSendReadiness): boolean {
    if (this.mode.kind === "demo" || this.channel === null || options.cinematic) return false;
    if (options.downloading && options.realTime - this.lastPacketSentTime < 50) return false;
    if (!options.active && !options.primed && !options.downloading && options.realTime - this.lastPacketSentTime < 1000) return false;
    if (options.local || options.lan) return true;
    const maximum = Math.max(15, Math.min(125, Math.trunc(options.maximumPackets)));
    const previous = this.outPackets[(this.channel.outgoingSequence - 1) & 31];
    if (previous === undefined) throw new RangeError("Missing outgoing packet slot");
    return options.realTime - previous.realTime >= Math.trunc(1000 / maximum);
  }
  disconnectPackets(options: Q3ClientSendOptions, delivery: ChannelDelivery): void {
    if (this.mode.kind !== "network") return;
    this.reliable.add("disconnect");
    for (let pass = 0; pass < 3; pass++) this.transmit(options, delivery);
  }
}
