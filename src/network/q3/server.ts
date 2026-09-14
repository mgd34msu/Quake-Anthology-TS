// SV_ExecuteClientMessage, SV_UserMove and SV_SendMessageToClient source ordering.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Q3ConnectionIdentity } from "./client.ts";
import { ClientMessageReader, InvalidClientOpcodeError, InvalidClientCommandCountError } from "./client-message.ts";
import type { ClientMessagePart, UnfilteredClientMovement } from "./client-message.ts";
import { MessageWriter, SourceMessageState } from "./message.ts";
import type { WireUserCommand } from "./message.ts";
import { Netchannel, xorClientMessage, xorServerMessage } from "./netchan.ts";
import type { ChannelDelivery, ChannelResult } from "./netchan.ts";
import { ServerReliableCommands } from "./reliable.ts";
import type { ReliableCommand } from "./reliable.ts";
import { ServerOpcode, writeServerMessage } from "./server-message.ts";
import type { Gamestate } from "./server-message.ts";
import type { Q3ServerSnapshotHistory } from "./snapshot-store.ts";
import { verifyQ3PureCommand } from "./pure.ts";
import type { Q3PureServer, Q3PureResult } from "./pure.ts";

export interface Q3ServerBindings {
  assertCurrent(): void;
  readonly serverId: () => number;
  readonly restartedServerId: () => number;
  readonly checksumFeed: () => number;
  readonly pure: () => boolean;
  readonly debugBuild: boolean;
  readonly time: () => number;
  readonly clientRunning: () => boolean;
  readonly floodProtect: () => boolean;
  readonly downloadName: () => string;
  command(command: ReliableCommand, clientOK: boolean): boolean | Promise<boolean>;
  enterWorld(command: WireUserCommand): void | Promise<void>;
  think(command: WireUserCommand): void | Promise<void>;
  resendGamestate(): void | Promise<void>;
  drop(reason: string): void | Promise<void>;
  print(text: string): void;
}
export interface Q3ServerRate {
  readonly rate: number; readonly maxRate: number; readonly snapshotMsec: number;
  readonly local: boolean; readonly forceLan: boolean; readonly lan: boolean;
}
export function q3RateMilliseconds(messageSize: number, rate: number, maxRate: number): number {
  messageSize = Math.min(messageSize, 1500);
  if (maxRate !== 0) rate = Math.min(rate, Math.max(maxRate, 1000));
  if (rate === 0) throw new RangeError("Source snapshot rate division by zero");
  return Math.trunc(Math.imul((messageSize + 48) | 0, 1000) / rate) | 0;
}

/** One admitted client, with game calls bound by the shared session. */
export class Q3ServerConnection {
  readonly channel: Netchannel;
  readonly reliable = new ServerReliableCommands();
  readonly sourceState: SourceMessageState;
  private readonly queuedMessages: Uint8Array[] = [];
  phase: "connected" | "primed" | "active" | "zombie" = "connected";
  lastClientCommand = 0;
  lastClientCommandString = "";
  messageAcknowledge = 0;
  deltaMessage = -1;
  gamestateMessageNumber = -1;
  lastUserCommand: WireUserCommand = { serverTime: 0, angles: [0, 0, 0], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 };
  pureAuthentic = false;
  gotPureCommand = false;
  nextSnapshotTime = 0;
  rateDelayed = false;
  reliableSent = 0;
  nextReliableTime = 0;
  constructor(readonly identity: Q3ConnectionIdentity, readonly challenge: number, qport: number, readonly snapshots: Q3ServerSnapshotHistory, readonly bindings: Q3ServerBindings) {
    this.channel = new Netchannel("server", qport);
    this.sourceState = new SourceMessageState(text => { bindings.print(text); });
  }
  async receiveDatagram(packet: Uint8Array): Promise<ChannelResult> {
    this.bindings.assertCurrent();
    const result = this.channel.receive(packet);
    if (result.kind !== "accepted" || this.phase === "zombie") return result;
    await this.executeMessage(new ClientMessageReader(xorClientMessage(result.payload, this.challenge, sequence => this.reliable.lookupMasked(sequence))));
    return result;
  }
  async executeMessage(reader: ClientMessageReader): Promise<void> {
    const host = this.bindings, serverId = host.serverId();
    host.assertCurrent();
    this.messageAcknowledge = reader.prefix.messageAcknowledge;
    if (this.messageAcknowledge < 0) { if (host.debugBuild) await host.drop("DEBUG: illegible client message"); return; }
    const header = reader.readHeader();
    this.reliable.assignAcknowledgement(header.reliableAcknowledge);
    if (this.reliable.acknowledge < this.reliable.sequence - 64) {
      if (host.debugBuild) await host.drop("DEBUG: illegible client message");
      this.reliable.assignAcknowledgement(this.reliable.sequence); return;
    }
    if (header.serverId !== host.serverId() && host.downloadName().length === 0 && !this.lastClientCommandString.includes("nextdl")) {
      if (header.serverId >= host.restartedServerId() && header.serverId < host.serverId()) return;
      if (this.messageAcknowledge > this.gamestateMessageNumber) await host.resendGamestate();
      return;
    }
    while (true) {
      host.assertCurrent();
      let part: ClientMessagePart;
      try { part = reader.next(); }
      catch (error) { if (!(error instanceof InvalidClientOpcodeError)) throw error; host.print("WARNING: bad command byte for client\n"); return; }
      if (part.kind === "eof") return;
      if (part.kind === "command") {
        if (this.lastClientCommand >= part.command.sequence) continue;
        if (part.command.sequence > ((this.lastClientCommand + 1) | 0)) { await host.drop("Lost reliable commands"); return; }
        const clientOK = host.clientRunning() || this.phase !== "active" || !host.floodProtect() || host.time() >= this.nextReliableTime;
        this.nextReliableTime = (host.time() + 1000) | 0;
        if (!await host.command(part.command, clientOK) || !this.current(serverId)) return;
        this.lastClientCommand = part.command.sequence; this.lastClientCommandString = part.command.text.slice(0, 1023);
        if (this.phase === "zombie") return;
      } else {
        this.deltaMessage = part.deltaMessage;
        await this.userMove(reader); return;
      }
    }
  }
  private current(serverId: number): boolean {
    if (this.phase === "zombie") return false;
    this.bindings.assertCurrent();
    if (serverId !== this.bindings.serverId()) throw new Error("Q3 client callback belongs to a retired server world");
    return true;
  }
  private async userMove(reader: ClientMessageReader): Promise<void> {
    const host = this.bindings, serverId = host.serverId();
    let movement: UnfilteredClientMovement;
    try { movement = reader.readMovement({ checksumFeed: host.checksumFeed(), serverCommand: sequence => this.reliable.lookupMasked(sequence) }); }
    catch (error) { if (!(error instanceof InvalidClientCommandCountError)) throw error; host.print(error.count < 1 ? "cmdCount < 1\n" : "cmdCount > MAX_PACKET_USERCMDS\n"); return; }
    this.snapshots.frame(this.messageAcknowledge).messageAcked = host.time();
    if (host.pure() && !this.pureAuthentic && !this.gotPureCommand) { if (this.phase === "active") await host.resendGamestate(); return; }
    if (this.phase === "primed") {
      this.lastUserCommand = movement.commands[0]; this.phase = "active";
      await host.enterWorld(this.lastUserCommand); if (!this.current(serverId)) return;
    }
    if (host.pure() && !this.pureAuthentic) { await host.drop("Cannot validate pure client!"); return; }
    if (this.phase !== "active") { this.deltaMessage = -1; return; }
    const latest = movement.commands.at(-1);
    if (latest === undefined) throw new RangeError("Missing decoded user command");
    for (const command of movement.commands) {
      if (command.serverTime > latest.serverTime || command.serverTime <= this.lastUserCommand.serverTime) continue;
      this.lastUserCommand = { ...command, angles: [...command.angles] };
      await host.think(command); if (!this.current(serverId)) return;
    }
  }
  private transmit(writer: MessageWriter, rate: Q3ServerRate, delivery: ChannelDelivery): void {
    const now = this.bindings.time(), frame = this.snapshots.frame(this.channel.outgoingSequence);
    frame.messageSize = writer.byteLength; frame.messageSent = now; frame.messageAcked = -1;
    writer.writeByte(ServerOpcode.Eof);
    const plaintext = writer.toBytes();
    if (this.channel.hasUnsentFragments) {
      this.queuedMessages.push(plaintext);
      // This source path advances one old fragment without dequeuing at its end.
      this.channel.transmitNextFragment(delivery);
    }
    else this.channel.beginTransmit(xorServerMessage(plaintext, this.challenge, this.channel.outgoingSequence, this.lastClientCommandString), delivery);
    if (rate.local || (rate.forceLan && rate.lan)) { this.nextSnapshotTime = (now - 1) | 0; return; }
    let interval = q3RateMilliseconds(writer.byteLength, rate.rate, rate.maxRate);
    if (interval < rate.snapshotMsec) { interval = rate.snapshotMsec; this.rateDelayed = false; } else this.rateDelayed = true;
    this.nextSnapshotTime = (now + interval) | 0;
    if (this.phase !== "active" && this.bindings.downloadName().length === 0 && this.nextSnapshotTime < ((now + 1000) | 0)) this.nextSnapshotTime = (now + 1000) | 0;
  }
  sendGamestate(state: Gamestate, rate: Q3ServerRate, delivery: ChannelDelivery): void {
    this.phase = "primed"; this.pureAuthentic = false; this.gotPureCommand = false;
    this.gamestateMessageNumber = this.channel.outgoingSequence;
    const writer = new MessageWriter("bitstream", 16384, this.sourceState);
    const operations = [...this.reliable.pending().map(command => ({ kind: "command", ...command } satisfies import("./server-message.ts").ServerOperation)),
      { ...state, commandSequence: this.reliable.sequence, checksumFeed: this.bindings.checksumFeed() }];
    writeServerMessage(writer, this.lastClientCommand, operations, { product: this.snapshots.product, messageNumber: this.channel.outgoingSequence,
      reliableSequence: this.lastClientCommand, serverCommandSequence: this.reliable.sequence, parseEntitiesNumber: 0, baseline: number => this.snapshots.baseline(number), history: () => null });
    this.reliableSent = this.reliable.sequence;
    this.transmit(writer, rate, delivery);
  }
  sendSnapshot(serverFlags: number, rate: Q3ServerRate, delivery: ChannelDelivery, appendDownload: (writer: MessageWriter) => void): void {
    if (this.channel.hasUnsentFragments) {
      this.nextSnapshotTime = (this.bindings.time() + q3RateMilliseconds(this.channel.remainingUnsentBytes, rate.rate, rate.maxRate)) | 0;
      this.transmitNextFragment(delivery); return;
    }
    const writer = new MessageWriter("bitstream", 16384, this.sourceState);
    writer.writeLong(this.lastClientCommand);
    for (const command of this.reliable.pending()) { writer.writeByte(ServerOpcode.Command); writer.writeLong(command.sequence); writer.writeString(command.text); }
    this.reliableSent = this.reliable.sequence;
    this.snapshots.write(writer, this.channel.outgoingSequence, this.deltaMessage, this.phase === "active", this.bindings.time(), serverFlags | (this.rateDelayed ? 1 : 0) | (this.phase === "active" ? 0 : 2));
    appendDownload(writer);
    if (writer.overflowed) { this.bindings.print("WARNING: msg overflowed\n"); writer.clear(); }
    this.transmit(writer, rate, delivery);
  }
  transmitNextFragment(delivery: ChannelDelivery): void {
    if (!this.channel.hasUnsentFragments) throw new Error("No pending server fragments");
    this.channel.transmitNextFragment(delivery);
    if (!this.channel.hasUnsentFragments) {
      const next = this.queuedMessages.shift();
      if (next !== undefined) this.channel.beginTransmit(xorServerMessage(next, this.challenge, this.channel.outgoingSequence, this.lastClientCommandString), delivery);
    }
  }
  async verifyPure(server: Q3PureServer, argv: readonly string[], sendRejectedSnapshot: () => void): Promise<Q3PureResult> {
    const result = verifyQ3PureCommand(server, argv);
    if (result.kind === "ignored") return result;
    this.gotPureCommand = true; this.pureAuthentic = result.kind === "authentic";
    if (result.kind === "rejected") {
      this.nextSnapshotTime = -1; this.phase = "active"; sendRejectedSnapshot(); await this.bindings.drop(result.reason);
    }
    return result;
  }
}
