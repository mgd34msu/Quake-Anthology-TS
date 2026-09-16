import type { CvarRegistry } from "../../../core/cvars/index.ts";
/* Q3 cl_main.c, cl_parse.c and cl_input.c application binding. GPL-2.0-or-later. */
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { sameAddress } from '../../../network/common/endpoint.ts';
import type { Ipv4Address, IpAddress } from '../../../network/common/endpoint.ts';
import { Q3ClientAdmission } from '../../../network/q3/admission.ts';
import { Q3ClientConnection } from '../../../network/q3/client.ts';
import type { Q3ClientBindings, Q3ConnectionIdentity } from '../../../network/q3/client.ts';
import { q3ChannelDelivery } from '../../../network/q3/transport.ts';
import type { WireUserCommand } from '../../../network/q3/message.ts';
import { MessageReader } from '../../../network/q3/message.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
export interface Q3ApplicationClientHost extends Pick<Q3ClientBindings, 'systemInfo' | 'snapshot' | 'mapRestart' | 'print' | 'downloadSize' | 'download'> {
  clearActive(assertCurrent: () => void): void | Promise<void>;
  gamestate(state: Parameters<Q3ClientBindings['gamestate']>[0], generation: number, assertCurrent: () => void): Promise<void>;
  readonly downloading: boolean;
  readonly identity: Q3ConnectionIdentity;
  readonly userinfo: () => string;
  attach(connection: Q3ClientConnection): void;
  command(command: ActorCommand): WireUserCommand;
  disconnected(reason: string): void;
}
export function q3ApplicationClientBindings(host: Q3ApplicationClientHost, lifecycle: {
  assertCurrent(): void;
  cleared(): void;
  primed(): void;
  snapshot: Q3ClientBindings['snapshot'];
}): Q3ClientBindings {
  return {
    assertCurrent: () => lifecycle.assertCurrent(),
    print: text => host.print(text),
    clearActive: async () => { await host.clearActive(() => lifecycle.assertCurrent()); lifecycle.assertCurrent(); lifecycle.cleared(); },
    systemInfo: info => host.systemInfo(info),
    gamestate: async (state, generation) => { await host.gamestate(state, generation, () => lifecycle.assertCurrent()); lifecycle.assertCurrent(); lifecycle.primed(); },
    snapshot: (snapshot, ping) => { host.snapshot(snapshot, ping); lifecycle.snapshot(snapshot, ping); },
    downloadSize: size => host.downloadSize(size), download: block => host.download(block),
    mapRestart: () => host.mapRestart(),
    levelShot: () => { throw new Error('Remote server cannot request a local levelshot'); },
    localServerRunning: () => false,
  };
}
export interface Q3ClientNetworkOptions {
  readonly transport: DatagramTransport<IpAddress>;
  readonly remote: Ipv4Address;
  readonly host: Q3ApplicationClientHost;
  readonly qport: number;
  readonly cvars?: CvarRegistry;
  readonly timeoutMilliseconds?: number;
}
export class Q3ClientNetwork implements ApplicationNetwork {
  readonly role = 'client';
  readonly wire: ApplicationNetwork['wire'] = { kind: 'source', protocol: { kind: 'q3', version: 68 } };
  private readonly admission: Q3ClientAdmission;
  private connection: Q3ClientConnection | null = null;
  private peer: Ipv4Address;
  private state: ApplicationNetworkPhase = 'connecting';
  private primed = false;
  private entered = false;
  private lastReceived = 0;
  private lastUserinfo = "";
  constructor(readonly options: Q3ClientNetworkOptions) {
    this.peer = options.remote;
    this.admission = new Q3ClientAdmission(options.qport, text => options.host.print(text));
    this.admission.begin(options.remote);
  }
  get phase(): ApplicationNetworkPhase { return this.state; }
  get native(): Q3ClientConnection | null { return this.connection; }
  get connectPacketCount(): number { return this.admission.connectPacketCount; }
  command(text: string): void {
    if (this.connection === null) throw new Error('Q3 client has no connection');
    this.connection.reliable.add(text);
  }
  sendPacket(): void { this.send(performance.now()); }
  private send(now: number): void {
    const connection = this.connection;
    if (connection === null) return;
    connection.transmit({ realTime: now, packetDup: this.options.cvars?.get("cl_packetdup")?.integerValue ?? 1, noDelta: false }, q3ChannelDelivery<Ipv4Address>(this.options.transport, () => this.peer, connection.sourceState, text => this.options.host.print(text)));
  }
  async poll(now: number): Promise<readonly ActorCommand[]> {
    if (this.state === 'closed' || this.state === 'rejected') return [];
    const request = this.admission.resend(now, this.options.host.userinfo());
    if (request !== null && request.to.kind === 'ipv4') this.options.transport.send(request.to, request.payload);
    for (;;) {
      const packet = this.options.transport.poll(); if (packet === null) break;
      if (packet.kind !== 'packet' || packet.from.kind !== 'ipv4') continue;
      const result = this.admission.receive(packet.from, packet.payload, now);
      if (result.kind === 'admitted') {
        if (result.address.kind !== 'ipv4') throw new Error('Q3 application requires IPv4');
        this.peer = result.address; this.state = 'loading'; this.lastReceived = now;
        const host = this.options.host;
        const assertCurrent = (): void => { if (this.connection !== connection || this.state === 'closed' || this.state === 'rejected') throw new Error('Q3 callback belongs to a retired connection'); };
        const connection = new Q3ClientConnection(host.identity, 'baseq3', { kind: 'network', challenge: result.challenge, qport: result.qport }, q3ApplicationClientBindings(host, {
          assertCurrent,
          cleared: () => { this.state = 'loading'; this.primed = false; this.entered = false; },
          primed: () => { this.primed = !host.downloading; },
          snapshot: snapshot => { if ((snapshot.flags & 2) === 0 && this.primed) this.state = 'active'; },
        }));
        this.connection = connection; host.attach(connection);
      } else if (result.kind === 'sequenced' && this.connection !== null) {
        try { await this.connection.receiveDatagram(result.bytes, now); this.lastReceived = now; }
        catch (error) { this.state = 'rejected'; this.options.host.disconnected(error instanceof Error ? error.message : String(error)); throw error; }
      } else if (result.kind === 'connectionless') {
        if (result.packet.command === 'print') {
          const text = new Uint8Array(result.packet.payload.length + 1);
          text.set(result.packet.payload);
          this.options.host.print(new MessageReader(text, 'oob').readString());
        }
        else if (result.packet.command === 'disconnect' && this.connection !== null && sameAddress(packet.from, this.peer) && now - this.lastReceived >= 3000) { this.state = 'closed'; this.options.host.disconnected('Server disconnected'); return []; }
      }
    }
    const connection = this.connection;
    if (connection !== null) {
      const userinfo = this.options.host.userinfo();
      if (userinfo !== this.lastUserinfo) { connection.reliable.add(`userinfo "${userinfo}"`); this.lastUserinfo = userinfo; }
      if (now - this.lastReceived > (this.options.timeoutMilliseconds ?? 120000)) { this.state = 'rejected'; this.options.host.disconnected('Q3 connection timed out'); return []; }
      if (this.primed && !this.entered) {
        connection.commands.append({ serverTime: 0, angles: [0, 0, 0], forwardmove: 0, rightmove: 0, upmove: 0, buttons: 0, weapon: 0 });
        this.entered = true;
      }
      if (connection.readyToSend({ realTime: now, active: this.state === 'active', primed: this.primed, cinematic: false, downloading: this.options.host.downloading, local: false, lan: this.peer.host[0] === 127 || this.peer.host[0] === 10 || (this.peer.host[0] === 192 && this.peer.host[1] === 168) || (this.peer.host[0] === 172 && this.peer.host[1] >= 16 && this.peer.host[1] <= 31), maximumPackets: this.options.cvars?.get("cl_maxpackets")?.integerValue ?? 30 })) this.send(now);
    }
    return [];
  }
  submit(commands: readonly ActorCommand[], _now: number): void {
    if (this.state !== 'active' || this.connection === null) return;
    if (commands.length > 1) throw new Error('A native Q3 connection carries one player');
    for (const command of commands) this.connection.commands.append(this.options.host.command(command));
  }
  publish(_output: SimulationOutput, _events: readonly SimulationPresentationEvent[], _now: number): void { throw new Error('Remote client cannot publish authoritative state'); }
  close(): void {
    if (this.options.transport.closed) return;
    if (this.connection !== null && this.state !== 'closed' && this.state !== 'rejected') this.connection.disconnectPackets({ realTime: performance.now(), packetDup: this.options.cvars?.get("cl_packetdup")?.integerValue ?? 1, noDelta: false }, q3ChannelDelivery<Ipv4Address>(this.options.transport, () => this.peer, this.connection.sourceState, text => this.options.host.print(text)));
    this.state = 'closed'; this.admission.disconnect(); this.options.transport.close();
  }
}
