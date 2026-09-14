// CL_CheckForResend, CL_ConnectionlessPacket, SV_GetChallenge and SV_DirectConnect.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { CommonError } from "../../core/common-error.ts";
import { sourceCommandText } from "../../core/commands/text.ts";
import { setInfoValue } from "../../core/cvars/info.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { sameAddress } from "../common/endpoint.ts";
import type { Ipv4Address, LoopbackAddress } from "../common/endpoint.ts";
import { decodeConnectionless, encodeConnect, encodeConnectionlessText } from "./connectionless.ts";
import type { ConnectionlessPacket } from "./connectionless.ts";

export type Q3Address = Ipv4Address | LoopbackAddress;
export interface Q3OutgoingDatagram { readonly to: Q3Address; readonly payload: Uint8Array; }
function copyAddress(address: Q3Address): Q3Address { return address.kind === "loopback" ? { ...address } : { ...address, host: [...address.host] }; }
function addressText(address: Q3Address): string { return address.kind === "loopback" ? "loopback" : `${address.host.join(".")}:${address.port}`; }
export function q3InfoValue(info: string, key: string): string {
  if (info.length >= 8192) throw new CommonError("drop", "Info_ValueForKey: oversize infostring");
  const fields = sourceCommandText(info).split("\\");
  for (let index = info.startsWith("\\") ? 1 : 0; index + 1 < fields.length; index += 2) {
    if (fields[index]?.toLowerCase() === key.toLowerCase()) return fields[index + 1] ?? "";
  }
  return "";
}
function infoSet(info: string, key: string, value: string, print: (text: string) => void): string {
  return setInfoValue(info, key, value, { dialect: "q3", maximumLength: 1024, target: "client-userinfo", serverHighCharacters: false, print });
}
export type Q3ClientAdmissionResult = { readonly kind: "handled" }
  | { readonly kind: "admitted"; readonly address: Q3Address; readonly challenge: number; readonly qport: number }
  | { readonly kind: "connectionless"; readonly packet: ConnectionlessPacket }
  | { readonly kind: "sequenced"; readonly bytes: Uint8Array }
  | { readonly kind: "ignored" };
export class Q3ClientAdmission {
  phase: "disconnected" | "connecting" | "challenging" | "connected" = "disconnected";
  address: Q3Address | null = null;
  challenge = 0;
  connectTime = -99999;
  connectPacketCount = 0;
  lastPacketTime = 0;
  constructor(readonly qport: number, readonly print: (text: string) => void) {
    if (!Number.isInteger(qport) || qport < 0 || qport > 65535) throw new RangeError("Q3 qport must be uint16");
  }
  begin(address: Q3Address): void {
    this.address = copyAddress(address); this.phase = address.kind === "loopback" ? "challenging" : "connecting";
    this.connectTime = -99999; this.connectPacketCount = 0;
  }
  /** Caller supplies source userinfo and performs the optional legacy key-authorize request. */
  resend(now: number, userinfo: string): Q3OutgoingDatagram | null {
    if ((this.phase !== "connecting" && this.phase !== "challenging") || now - this.connectTime < 3000) return null;
    if (this.address === null) throw new Error("Connection resend has no resolved address");
    this.connectTime = now; this.connectPacketCount = (this.connectPacketCount + 1) | 0;
    if (this.phase === "connecting") return { to: copyAddress(this.address), payload: encodeConnectionlessText("getchallenge") };
    let info = sourceCommandText(userinfo).slice(0, 1023);
    info = infoSet(info, "protocol", "68", this.print); info = infoSet(info, "qport", String(this.qport), this.print);
    info = infoSet(info, "challenge", String(this.challenge), this.print);
    return { to: copyAddress(this.address), payload: encodeConnect(info) };
  }
  receive(from: Q3Address, bytes: Uint8Array, now: number): Q3ClientAdmissionResult {
    this.lastPacketTime = now;
    if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 255 && bytes[2] === 255 && bytes[3] === 255) {
      const packet = decodeConnectionless(bytes, "client");
      switch (packet.command.toLowerCase()) {
        case "challengeresponse":
          if (this.phase === "connecting") {
            this.challenge = nativeAtoi(packet.arguments[0] ?? ""); this.phase = "challenging";
            this.connectPacketCount = 0; this.connectTime = -99999;
            this.address = copyAddress(from); // Original Q3 permits a proxy to hand off the challenge.
          }
          return { kind: "handled" };
        case "connectresponse":
          if (this.phase !== "challenging" || this.address === null || !sameAddress(from, this.address, false)) return { kind: "ignored" };
          this.phase = "connected"; this.address = copyAddress(from);
          return { kind: "admitted", address: copyAddress(from), challenge: this.challenge, qport: this.qport };
        default: return { kind: "connectionless", packet };
      }
    }
    if (this.phase !== "connected" || this.address === null || !sameAddress(from, this.address)) return { kind: "ignored" };
    return { kind: "sequenced", bytes };
  }
  disconnect(): void { this.phase = "disconnected"; this.address = null; }
}

export interface Q3Challenge {
  address: Q3Address | null; challenge: number; time: number; firstTime: number; pingTime: number; connected: boolean;
}
export interface Q3AdmissionSlot {
  readonly slot: number; readonly phase: "free" | "zombie" | "connected" | "primed" | "active";
  readonly address: Q3Address | null; readonly bot: boolean; readonly qport: number; readonly lastConnectTime: number;
}
export interface Q3AcceptedConnect { readonly slot: number; readonly address: Q3Address; readonly challenge: number; readonly qport: number; readonly userinfo: string; }
export interface Q3ServerAdmissionBindings {
  readonly enabled: () => boolean;
  readonly slots: () => readonly Q3AdmissionSlot[];
  readonly privateClients: () => number;
  readonly privatePassword: () => string;
  readonly reconnectLimitSeconds: () => number;
  readonly minimumPing: () => number;
  readonly maximumPing: () => number;
  readonly authorizeAddress: () => Q3Address | null;
  readonly demoRestricted: () => boolean;
  isLan(address: Q3Address): boolean;
  random(): number;
  authorize(challenge: Readonly<Q3Challenge>): void;
  send(address: Q3Address, packet: Uint8Array): void;
  /** Shared session performs the real ClientConnect call and owns client/seat allocation. */
  admit(connection: Q3AcceptedConnect): string | null | Promise<string | null>;
  dropBot(slot: number): void | Promise<void>;
  print(text: string): void;
  query(from: Q3Address, packet: ConnectionlessPacket): void;
}
export class Q3ServerAdmission {
  readonly challenges: readonly Q3Challenge[] = Array.from({ length: 1024 }, () => ({ address: null, challenge: 0, time: 0, firstTime: 0, pingTime: 0, connected: false }));
  constructor(readonly bindings: Q3ServerAdmissionBindings) {}
  private reply(to: Q3Address, text: string): void { this.bindings.send(copyAddress(to), encodeConnectionlessText(text)); }
  private challenge(from: Q3Address, now: number): void {
    if (!this.bindings.enabled()) return;
    let oldestTime = 0x7fffffff, oldest = this.challenges[0], found: Q3Challenge | undefined;
    for (const candidate of this.challenges) {
      if (!candidate.connected && candidate.address !== null && sameAddress(from, candidate.address)) { found = candidate; break; }
      if (candidate.time < oldestTime) { oldestTime = candidate.time; oldest = candidate; }
    }
    if (found === undefined) {
      if (oldest === undefined) throw new Error("Missing challenge storage");
      found = oldest; found.challenge = (this.bindings.random() << 16) ^ this.bindings.random() ^ now;
      found.address = copyAddress(from); found.firstTime = now; found.time = now; found.connected = false;
    }
    if (this.bindings.isLan(from) || ((now - found.firstTime) | 0) > 5000) {
      found.pingTime = now; this.reply(from, `challengeResponse ${found.challenge}`); return;
    }
    this.bindings.authorize(found);
  }
  private authorize(from: Q3Address, packet: ConnectionlessPacket, now: number): void {
    const authority = this.bindings.authorizeAddress();
    if (authority === null || !sameAddress(from, authority, false)) return;
    const number = nativeAtoi(packet.arguments[0] ?? ""), challenge = this.challenges.find(value => value.challenge === number);
    if (challenge === undefined || challenge.address === null) return;
    challenge.pingTime = now;
    const result = (packet.arguments[1] ?? "").toLowerCase(), reason = packet.arguments[2] ?? "";
    if (result === "accept" || (result === "demo" && this.bindings.demoRestricted())) this.reply(challenge.address, `challengeResponse ${challenge.challenge}`);
    else {
      this.reply(challenge.address, result === "demo" ? "print\nServer is not a demo server\n" : `print\n${reason}\n`);
      challenge.address = null; challenge.challenge = 0; challenge.time = 0; challenge.firstTime = 0; challenge.pingTime = 0; challenge.connected = false;
    }
  }
  private async connect(from: Q3Address, input: string, now: number): Promise<void> {
    const host = this.bindings;
    let userinfo = sourceCommandText(input).slice(0, 1023);
    if (nativeAtoi(q3InfoValue(userinfo, "protocol")) !== 68) { this.reply(from, "print\nServer uses protocol version 68.\n"); return; }
    const qport = nativeAtoi(q3InfoValue(userinfo, "qport")), challengeNumber = nativeAtoi(q3InfoValue(userinfo, "challenge"));
    if (qport < 0 || qport > 65535) { this.reply(from, "print\nInvalid qport.\n"); return; }
    const matches = (slot: Q3AdmissionSlot): boolean => slot.address !== null && sameAddress(from, slot.address, false)
      && (slot.qport === qport || (from.kind === "ipv4" && slot.address.kind === "ipv4" && from.port === slot.address.port));
    const slots = host.slots(), existing = slots.find(slot => slot.phase !== "free" && matches(slot));
    if (existing !== undefined && ((now - existing.lastConnectTime) | 0) < Math.imul(host.reconnectLimitSeconds(), 1000)) return;
    if (from.kind !== "loopback") {
      const challenge = this.challenges.find(value => value.address !== null && sameAddress(from, value.address) && value.challenge === challengeNumber);
      if (challenge === undefined) { this.reply(from, "print\nNo or bad challenge for address.\n"); return; }
      userinfo = infoSet(userinfo, "ip", addressText(from), host.print);
      const ping = (now - challenge.pingTime) | 0; challenge.connected = true;
      if (!host.isLan(from)) {
        if (Math.fround(host.minimumPing()) !== 0 && Math.fround(ping) < Math.fround(host.minimumPing())) {
          this.reply(from, "print\nServer is for high pings only\n"); challenge.address = { ...from, port: 0 }; return;
        }
        if (Math.fround(host.maximumPing()) !== 0 && Math.fround(ping) > Math.fround(host.maximumPing())) { this.reply(from, "print\nServer is for low pings only\n"); return; }
      }
    } else userinfo = infoSet(userinfo, "ip", "localhost", host.print);
    const start = q3InfoValue(userinfo, "password") === host.privatePassword() ? 0 : host.privateClients();
    let selected = existing ?? slots.find(slot => slot.slot >= start && slot.phase === "free");
    if (selected === undefined) {
      if (from.kind !== "loopback") { this.reply(from, "print\nServer is full.\n"); return; }
      const candidates = slots.filter(slot => slot.slot >= start);
      if (candidates.some(slot => !slot.bot)) throw new CommonError("fatal", "server is full on local connect\n");
      selected = candidates.at(-1);
      if (selected === undefined) throw new CommonError("fatal", "server is full on local connect\n");
      await host.dropBot(selected.slot);
      if (!host.enabled()) return;
    }
    const rejected = await host.admit({ slot: selected.slot, address: copyAddress(from), qport, challenge: challengeNumber, userinfo });
    if (!host.enabled()) return;
    if (rejected !== null) { this.reply(from, `print\n${rejected}\n`); return; }
    this.reply(from, "connectResponse");
  }
  async receive(from: Q3Address, bytes: Uint8Array, now: number): Promise<void> {
    const packet = decodeConnectionless(bytes, "server");
    switch (packet.command.toLowerCase()) {
      case "getchallenge": this.challenge(from, now); break;
      case "ipauthorize": this.authorize(from, packet, now); break;
      case "connect": await this.connect(from, packet.arguments[0] ?? "", now); break;
      default: this.bindings.query(from, packet); break;
    }
  }
  disconnect(address: Q3Address): void { const challenge = this.challenges.find(value => value.address !== null && sameAddress(address, value.address)); if (challenge !== undefined) challenge.connected = false; }
}

/** Packet routing uses qport before accepting NAT port rebinding. */
export function routeQ3SequencedPacket(from: Q3Address, bytes: Uint8Array, slots: readonly Q3AdmissionSlot[]): Q3AdmissionSlot | null {
  if (bytes.length < 6) return null;
  const qport = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint16(4, true);
  return slots.find(slot => slot.phase !== "free" && slot.address !== null && sameAddress(from, slot.address, false) && slot.qport === qport) ?? null;
}
