import type { ClientId } from '../../../contracts/identity.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { tokenizeCommand } from '../../../core/commands/text.ts';
import { Q3ServerAdmission, routeQ3SequencedPacket } from '../../../network/q3/admission.ts';
import type { Q3Address, Q3AdmissionSlot, Q3AcceptedConnect } from '../../../network/q3/admission.ts';
import { Q3ServerConnection } from '../../../network/q3/server.ts';
import { Q3ServerSnapshotHistory, Q3SnapshotEntities } from '../../../network/q3/snapshot-store.ts';
import type { EntityStateFields } from '../../../network/q3/state/entity.ts';
import { EntityStateRecord } from '../../../network/q3/state/entity.ts';
import { q3ChannelDelivery } from '../../../network/q3/transport.ts';
import { encodeConnectionlessText } from '../../../network/q3/connectionless.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { Q3ApplicationPlayer, Q3ApplicationServerHost } from './q3-types.ts';
interface Peer { readonly baselines: Map<number, EntityStateFields>; remote: Q3Address; player: Q3ApplicationPlayer; readonly connection: Q3ServerConnection; lastReceived: number; readonly connectedAt: number; sequence: number; userinfo: string; }
export interface Q3ServerNetworkOptions { readonly transport: DatagramTransport<NetworkAddress>; readonly host: Q3ApplicationServerHost; readonly random: () => number; readonly timeoutMilliseconds?: number; }
const rate = { rate: 25000, maxRate: 0, snapshotMsec: 50, local: false, forceLan: false, lan: false };
export class Q3ServerNetwork implements ApplicationNetwork {
  readonly role = 'server';
  readonly wire = { kind: 'source', protocol: { kind: 'q3', version: 68 } } satisfies ApplicationNetwork['wire'];
  private ended = false;
  private now = 0;
  private serverId = 1;
  private serverFlags = 0;
  private pending: ActorCommand[] = [];
  private host: Q3ApplicationServerHost;
  private readonly peers = new Map<number, Peer>();
  private readonly entities = new Q3SnapshotEntities(32768);
  private readonly admission: Q3ServerAdmission;
  constructor(readonly options: Q3ServerNetworkOptions) {
    this.host = options.host; this.requireSupported(this.host);
    this.admission = new Q3ServerAdmission({ enabled: () => !this.ended, slots: () => this.slots(), privateClients: () => 0,
      privatePassword: () => '', reconnectLimitSeconds: () => 3, minimumPing: () => 0, maximumPing: () => 0,
      authorizeAddress: () => null, demoRestricted: () => false, isLan: address => address.kind === 'loopback' || address.host[0] === 127 || address.host[0] === 10 || (address.host[0] === 192 && address.host[1] === 168) || (address.host[0] === 172 && address.host[1] >= 16 && address.host[1] <= 31), random: options.random,
      authorize: challenge => { if (challenge.address !== null) { options.transport.send(challenge.address, encodeConnectionlessText(`challengeResponse ${challenge.challenge}`)); } }, send: (to, bytes) => { options.transport.send(to, bytes); }, admit: request => this.admit(request),
      dropBot: () => { throw new Error('Native Q3 admission cannot evict an application bot'); }, print: text => this.host.print(text),
      query: (from, packet) => {
        if (packet.command === 'getinfo' || packet.command === 'getstatus') options.transport.send(from, encodeConnectionlessText(this.host.status(packet.arguments[0] ?? '', packet.command === 'getstatus')));
      } });
  }
  get address(): NetworkAddress { return this.options.transport.address; }
  get phase(): ApplicationNetworkPhase { return this.ended ? 'closed' : 'active'; }
  get clients(): readonly Q3ApplicationPlayer[] { return [...this.peers.values()].map(peer => peer.player); }
  private requireSupported(host: Q3ApplicationServerHost): void { const support = host.supportsSourceWire(); if (support.kind === 'unsupported') throw new Error(support.reasons.join('; ')); }
  private slots(): readonly Q3AdmissionSlot[] {
    return Array.from({ length: this.host.maxClients }, (_, slot) => { const peer = this.peers.get(slot); return peer === undefined
      ? { slot, phase: this.host.occupiedSlots().includes(slot) ? 'active' : 'free', address: null, bot: false, qport: 0, lastConnectTime: 0 }
      : { slot, phase: peer.connection.phase, address: peer.remote, bot: false, qport: peer.connection.channel.qport, lastConnectTime: peer.connectedAt }; });
  }
  private delivery(peer: Peer) { return q3ChannelDelivery(this.options.transport, () => peer.remote, peer.connection.sourceState, text => this.host.print(text)); }
  private gamestate(peer: Peer): void { const state = this.host.gameState(peer.player, this.serverId); peer.baselines.clear(); for (const entry of state.entries) if (entry.kind === 'baseline') peer.baselines.set(entry.number, entry.entity); peer.connection.sendGamestate(state, rate, this.delivery(peer)); }
  private admit(request: Q3AcceptedConnect): string | null {
    const previous = this.peers.get(request.slot); if (previous !== undefined) this.disconnectClient(previous.player.client, 'reconnected');
    const admitted = this.host.admit(request); if (admitted.kind === 'rejected') return admitted.reason;
    const baselines = new Map(this.host.gameState(admitted.player, this.serverId).entries.flatMap(entry => entry.kind === 'baseline' ? [[entry.number, entry.entity] satisfies [number, typeof entry.entity]] : []));
    const snapshots = new Q3ServerSnapshotHistory(this.entities, this.host.product, number => baselines.get(number) ?? new EntityStateRecord<number>(0));
    const connection = new Q3ServerConnection({ client: admitted.player.client, seat: null }, request.challenge, request.qport, snapshots, {
      assertCurrent: () => {}, serverId: () => this.serverId, restartedServerId: () => this.serverId, checksumFeed: () => 0,
      pure: () => false, debugBuild: false, time: () => this.host.time(), clientRunning: () => false, floodProtect: () => true, downloadName: () => '',
      command: (command, clientOK) => {
        const argv = tokenizeCommand(command.text, 'q3').argv, name = argv[0] ?? '';
        if (name === 'disconnect') { this.disconnectClient(peer.player.client, 'disconnected'); return false; }
        if (name === 'userinfo') { peer.userinfo = argv[1] ?? ''; this.host.userinfo(peer.player, peer.userinfo); }
        else if (clientOK) this.host.command(peer.player, name, argv.slice(1));
        return true;
      }, enterWorld: command => { this.pending.push(this.host.input(peer.player, command, peer.sequence++)); },
      think: command => { this.pending.push(this.host.input(peer.player, command, peer.sequence++)); },
      resendGamestate: () => this.gamestate(peer), drop: reason => this.disconnectClient(peer.player.client, reason), print: text => this.host.print(text),
    });
    const peer: Peer = { baselines, remote: request.address, player: admitted.player, connection, lastReceived: this.now, connectedAt: this.now, sequence: 0, userinfo: request.userinfo };
    this.peers.set(request.slot, peer); return null;
  }
  async poll(nowMilliseconds: number): Promise<readonly ActorCommand[]> {
    if (this.ended) return []; this.now = Math.trunc(nowMilliseconds);
    for (let event = this.options.transport.poll(); event !== null; event = this.options.transport.poll()) {
      if (event.kind === 'error') { this.host.print(event.error.message); continue; }
      if (event.kind !== 'packet' || (event.from.kind !== 'ipv4' && event.from.kind !== 'loopback')) continue;
      try {
        const bytes = event.payload;
        if (bytes[0] === 255 && bytes[1] === 255 && bytes[2] === 255 && bytes[3] === 255) this.admission.receive(event.from, bytes, this.now);
        else {
          const slot = routeQ3SequencedPacket(event.from, bytes, this.slots()), peer = slot === null ? undefined : this.peers.get(slot.slot);
          if (peer !== undefined) { peer.remote = event.from; const result = peer.connection.receiveDatagram(bytes); if (result.kind === 'accepted') { peer.lastReceived = this.now; if (peer.connection.phase === 'connected') this.gamestate(peer); } }
        }
      } catch (error) { this.host.print(error instanceof Error ? error.message : String(error)); }
    }
    for (const peer of this.peers.values()) if (this.now - peer.lastReceived > (this.options.timeoutMilliseconds ?? 30000)) this.disconnectClient(peer.player.client, 'timed out');
    const commands = this.pending; this.pending = []; return commands;
  }
  submit(_commands: readonly ActorCommand[], _now: number): void {}
  publish(_output: SimulationOutput, events: readonly SimulationPresentationEvent[], nowMilliseconds: number): void {
    if (this.ended) return; this.now = Math.trunc(nowMilliseconds);
    for (const item of events) if (item.kind === 'q3-source') {
      const event = item.event;
      for (const peer of [...this.peers.values()]) {
        if (event.kind === 'drop-client' && event.client === peer.player.sourceEntity) this.disconnectClient(peer.player.client, event.reason);
        else if (event.kind === 'server-command' && (event.client === -1 || event.client === peer.player.sourceEntity)) this.queue(peer, event.text);
        else if (event.kind === 'configstring' && peer.connection.phase !== 'connected') {
          const chunks = event.value.match(/[\s\S]{1,999}/g) ?? [''];
          chunks.forEach((chunk, index) => this.queue(peer, `${chunks.length === 1 ? 'cs' : index === 0 ? 'bcs0' : index === chunks.length - 1 ? 'bcs2' : 'bcs1'} ${event.index} "${chunk}"`));
        }
      }
    }
    for (const peer of this.peers.values()) if (peer.connection.phase !== 'connected' && this.host.time() >= peer.connection.nextSnapshotTime) {
      if (!peer.connection.channel.hasUnsentFragments) { const snapshot = this.host.snapshot(peer.player);
        peer.connection.snapshots.capture(peer.connection.channel.outgoingSequence, snapshot.player, snapshot.areaMask, snapshot.entities); }
      peer.connection.sendSnapshot(this.serverFlags, rate, this.delivery(peer), () => {});
    }
  }
  private queue(peer: Peer, text: string): void { if (peer.connection.reliable.add(text).kind === 'overflow') this.disconnectClient(peer.player.client, 'Server command overflow'); }
  disconnectClient(client: ClientId, reason: string): boolean {
    const peer = [...this.peers.values()].find(peer => peer.player.client.equals(client)); if (peer === undefined) return false;
    this.queueDisconnect(peer, reason); this.peers.delete(peer.player.sourceEntity); this.admission.disconnect(peer.remote);
    this.pending = this.pending.filter(command => !command.actor.equals(peer.player.actor)); this.host.disconnect(peer.player, reason); return true;
  }
  private queueDisconnect(peer: Peer, reason: string): void {
    peer.connection.reliable.add(`disconnect "${reason.replace(/["\n\r]/g, '')}"`);
    const delivery = this.delivery(peer);
    while (peer.connection.channel.hasUnsentFragments) peer.connection.transmitNextFragment(delivery);
    peer.connection.sendSnapshot(this.serverFlags, rate, delivery, () => {});
    while (peer.connection.channel.hasUnsentFragments) peer.connection.transmitNextFragment(delivery);
    peer.connection.phase = 'zombie';
  }
  changeWorld(host: Q3ApplicationServerHost): void {
    this.requireSupported(host); const carried = [...this.peers.values()].map(peer => ({ peer, player: host.carriedPlayer(peer.player.client) }));
    this.host = host; this.serverId++; this.serverFlags ^= 4; this.pending = [];
    for (const { peer, player } of carried) { peer.player = player; this.host.userinfo(player, peer.userinfo); peer.connection.deltaMessage = -1; this.gamestate(peer); }
  }
  close(): void { if (this.ended) return; for (const peer of [...this.peers.values()]) this.disconnectClient(peer.player.client, 'Server shutdown'); this.ended = true; this.options.transport.close(); }
}
