import { Q3ServerAuthorization } from '../../../network/q3/authorization.ts';
import { q3ConfigstringCommands } from "../../../network/q3/configstrings.ts";
import type { Q3GuestOutput } from '../simulation/q3/guest-runtime.ts';
import type { ClientId } from '../../../contracts/identity.ts';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { tokenizeCommand } from '../../../core/commands/text.ts';
import { Q3ServerAdmission, routeQ3SequencedPacket, q3IsLanAddress } from '../../../network/q3/admission.ts';
import type { Q3Address, Q3AdmissionSlot, Q3AcceptedConnect } from '../../../network/q3/admission.ts';
import { checkQ3DownloadName } from '../../../network/q3/pure.ts';
import { nativeAtoi } from '../../../core/numeric.ts';
import { Q3ServerDownload } from '../../../network/q3/download.ts';
import { Q3ServerConnection } from '../../../network/q3/server.ts';
import { Q3ServerSnapshotHistory, Q3SnapshotEntities } from '../../../network/q3/snapshot-store.ts';
import type { EntityStateFields } from '../../../network/q3/state/entity.ts';
import { EntityStateRecord } from '../../../network/q3/state/entity.ts';
import { q3ChannelDelivery } from '../../../network/q3/transport.ts';
import { decodeConnectionless, encodeConnectionlessText } from '../../../network/q3/connectionless.ts';
import { RconService, q3RconCommand } from '../../../network/services/admin.ts';
import { MasterHeartbeat } from '../../../network/services/discovery.ts';
import { q3DiscoveryWire } from '../../../network/q3/discovery.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { Q3ApplicationPlayer, Q3ApplicationServerHost, Q3NetworkRoundRestart } from './q3-types.ts';
import { Q3GameCallbackError, q3GameCallback } from './q3-types.ts';
interface Peer { readonly slot: number; readonly download: Q3ServerDownload; readonly baselines: Map<number, EntityStateFields>; remote: Q3Address; player: Q3ApplicationPlayer; readonly connection: Q3ServerConnection; lastReceived: number; readonly connectedAt: number; sequence: number; userinfo: string; }
export interface Q3ServerNetworkOptions { readonly transport: DatagramTransport<NetworkAddress>; readonly host: Q3ApplicationServerHost; readonly random: () => number; readonly timeoutMilliseconds?: number; readonly resolveAuthorization?: import('../../../network/q3/authorization.ts').Q3ServerAuthorizationOptions['resolve']; }
export class Q3ServerNetwork implements ApplicationNetwork {
  readonly role = 'server';
  readonly wire = { kind: 'source', protocol: { kind: 'q3', version: 68 } } satisfies ApplicationNetwork['wire'];
  private ended = false;
  private activeOperation: Promise<unknown> | null = null;
  private closing: Promise<void> | null = null;
  private now = 0;
  private serverId = 1;
  private restartedServerId = 1;
  private serverFlags: 0 | 4 = 0;
  private checksumFeed: number;
  private changedWorld = false;
  private pending: ActorCommand[] = [];
  private host: Q3ApplicationServerHost;
  private readonly peers = new Map<number, Peer>();
  private readonly entities = new Q3SnapshotEntities(32768);
  private readonly admission: Q3ServerAdmission;
  private readonly rcon: RconService;
  private readonly masterHeartbeat: MasterHeartbeat;
  constructor(readonly options: Q3ServerNetworkOptions) {
    this.checksumFeed = (options.random() << 16) ^ options.random();
    this.host = options.host; this.requireSupported(this.host);
    this.rcon = new RconService({ password: () => this.host.administration?.rconPassword() ?? '',
      execute: async (command, output) => { const administration = this.host.administration; if (administration === undefined) throw new Error('Server administration is unavailable'); await administration.execute(command, output); },
      reply: (address, text) => { options.transport.send(address, encodeConnectionlessText(`print\n${text}`)); } });
    this.masterHeartbeat = new MasterHeartbeat(q3DiscoveryWire(), options.transport);
    if (options.transport.address.kind === 'ipx') this.host.print('Q3 IPX transport supports LAN play; IPv4 master advertisement is unavailable.\n');
    const authorization = new Q3ServerAuthorization({ ...(options.resolveAuthorization === undefined ? {} : { resolve: options.resolveAuthorization }), enabled: () => !this.ended, gameDirectory: () => this.host.admission?.gameDirectory() ?? '', strictAuth: () => this.host.admission?.strictAuth() ?? '1', send: (address, packet) => { options.transport.send(address, packet); }, print: text => this.host.print(text) });
    this.admission = new Q3ServerAdmission({ enabled: () => !this.ended && (this.host.admission?.enabled() ?? true), slots: () => this.slots(), privateClients: () => this.host.admission?.privateClients() ?? 0,
      privatePassword: () => this.host.admission?.privatePassword() ?? '', reconnectLimitSeconds: () => this.host.admission?.reconnectLimitSeconds() ?? 3, minimumPing: () => this.host.admission?.minimumPing() ?? 0, maximumPing: () => this.host.admission?.maximumPing() ?? 0,
      authorizeAddress: () => authorization.address, demoRestricted: () => this.host.admission?.demoRestricted() ?? false, isLan: q3IsLanAddress, random: options.random,
      authorize: challenge => authorization.request(challenge), send: (to, bytes) => { options.transport.send(to, bytes); }, admit: request => this.admit(request),
      dropBot: () => { throw new Error('Native Q3 admission cannot evict an application bot'); }, print: text => this.host.print(text),
      query: (from, packet) => {
        if (packet.command === 'getinfo' || packet.command === 'getstatus') {
          const response = this.host.status(packet.arguments[0] ?? '', packet.command === 'getstatus');
          if (response !== null) options.transport.send(from, encodeConnectionlessText(response));
        }
      } });
  }
  heartbeat(nowMilliseconds: number): void { if (!this.ended && this.options.transport.address.kind !== 'ipx') this.masterHeartbeat.send(this.host.administration?.masters() ?? [], Math.trunc(nowMilliseconds), true, true); }
  get recordingSource(): { readonly host: Q3ApplicationServerHost; readonly serverId: number; readonly snapshotServerBit: 0 | 4 } {
    if (this.ended) throw new Error('Q3 recording source is retired');
    return { host: this.host, serverId: this.serverId, snapshotServerBit: this.serverFlags };
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
  private gamestate(peer: Peer): void { const state = this.host.gameState(peer.player, this.serverId); peer.baselines.clear(); for (const entry of state.entries) if (entry.kind === 'baseline') peer.baselines.set(entry.number, entry.entity); peer.connection.sendGamestate(state, this.host.rate(peer.player), this.delivery(peer)); }
  private assertWorld(host: Q3ApplicationServerHost, serverId: number): void {
    if (this.ended || this.host !== host || this.serverId !== serverId) throw new Error('Q3 server operation belongs to a retired world');
  }
  private assertPeer(peer: Peer, host = this.host, serverId = this.serverId): void {
    this.assertWorld(host, serverId);
    if (this.peers.get(peer.slot) !== peer || peer.connection.phase === 'zombie') throw new Error('Q3 server callback belongs to a dropped client');
  }
  private async admit(request: Q3AcceptedConnect): Promise<string | null> {
    const host = this.host, serverId = this.serverId;
    const previous = this.peers.get(request.slot); if (previous !== undefined) await this.disconnectClient(previous.player.client, 'reconnected');
    this.assertWorld(host, serverId);
    const admitted = await q3GameCallback(() => host.admit(request));
    if (this.ended || this.host !== host || this.serverId !== serverId) {
      if (admitted.kind === 'accepted') await q3GameCallback(() => host.disconnect(admitted.player, 'Server changed during admission'));
      return 'Server changed during admission';
    }
    if (admitted.kind === 'rejected') return admitted.reason;
    const baselines = new Map(this.host.gameState(admitted.player, this.serverId).entries.flatMap(entry => entry.kind === 'baseline' ? [[entry.number, entry.entity] satisfies [number, typeof entry.entity]] : []));
    const snapshots = new Q3ServerSnapshotHistory(this.entities, this.host.product, number => baselines.get(number) ?? new EntityStateRecord<number>(0));
    const download = new Q3ServerDownload({ open: name => this.host.openDownload(name), enabled: () => this.host.downloadsEnabled(), pure: () => this.host.pure(this.serverId, this.restartedServerId).enabled, drop: async reason => { await this.disconnectClient(peer.player.client, reason); }, print: text => this.host.print(text) });
    const connection: Q3ServerConnection = new Q3ServerConnection({ client: admitted.player.client, seat: null }, request.challenge, request.qport, snapshots, {
      assertCurrent: () => this.assertPeer(peer), serverId: () => this.serverId, restartedServerId: () => this.restartedServerId, checksumFeed: () => this.checksumFeed,
      pure: () => this.host.pure(this.serverId, this.restartedServerId).enabled, debugBuild: false, time: () => this.host.time(), clientRunning: () => false, floodProtect: () => this.host.admission?.floodProtect() ?? true, downloadName: () => download.name,
      command: async (command, clientOK): Promise<boolean> => {
        const host = this.host, serverId = this.serverId;
        const argv = tokenizeCommand(command.text, 'q3').argv, name = argv[0] ?? '';
        if (name === 'disconnect') { await this.disconnectClient(peer.player.client, 'disconnected'); return false; }
        if (name === 'cp') { await connection.verifyPure(this.host.pure(this.serverId, this.restartedServerId), argv, () => this.snapshot(peer)); return connection.phase !== 'zombie'; }
        if (name === 'vdr') { connection.pureAuthentic = false; connection.gotPureCommand = false; return true; }
        if (name === 'download') { const requested = (argv[1] ?? '').slice(0, 63); try { if (requested !== '') checkQ3DownloadName(requested); } catch { await this.disconnectClient(peer.player.client, 'Invalid download path'); return false; } download.begin(requested); return true; }
        if (name === 'nextdl') { await download.acknowledge(nativeAtoi(argv[1] ?? ''), this.host.time()); return connection.phase !== 'zombie'; }
        if (name === 'stopdl') { download.close(); return true; }
        if (name === 'donedl') { if (connection.phase !== 'active') this.gamestate(peer); return true; }
        if (name === 'userinfo') { peer.userinfo = argv[1] ?? ''; await q3GameCallback(() => host.userinfo(peer.player, peer.userinfo)); }
        else if (clientOK) await q3GameCallback(() => host.command(peer.player, name, argv.slice(1)));
        this.assertWorld(host, serverId);
        return this.peers.get(peer.slot) === peer && peer.connection.phase !== 'zombie';
      }, enterWorld: async command => {
        const host = this.host, serverId = this.serverId;
        const begin = host.begin;
        if (begin === undefined) await this.input(peer, command);
        else { await q3GameCallback(() => begin.call(host, peer.player, command)); this.assertWorld(host, serverId); }
      },
      think: command => this.input(peer, command),
      resendGamestate: () => this.gamestate(peer), drop: async reason => { await this.disconnectClient(peer.player.client, reason); }, print: text => this.host.print(text),
    });
    const peer: Peer = { slot: request.slot, download, baselines, remote: request.address, player: admitted.player, connection, lastReceived: this.now, connectedAt: this.now, sequence: 0, userinfo: request.userinfo };
    this.peers.set(request.slot, peer); return null;
  }
  private async input(peer: Peer, command: import('../../../network/q3/message.ts').WireUserCommand): Promise<void> {
    const host = this.host, serverId = this.serverId;
    const accepted = await q3GameCallback(() => host.input(peer.player, command, peer.sequence++));
    this.assertWorld(host, serverId);
    if (this.peers.get(peer.slot) === peer && peer.connection.phase !== 'zombie' && accepted !== null) this.pending.push(accepted);
  }
  private async operation<T>(run: () => Promise<T>): Promise<T> {
    if (this.activeOperation !== null) throw new Error('Q3 network operation is already in progress');
    const operation = Promise.resolve().then(run); this.activeOperation = operation;
    try { return await operation; } finally { this.activeOperation = null; }
  }
  poll(nowMilliseconds: number): Promise<readonly ActorCommand[]> { return this.operation(() => this.pollPackets(nowMilliseconds)); }
  private async pollPackets(nowMilliseconds: number): Promise<readonly ActorCommand[]> {
    if (this.ended) return []; this.now = Math.trunc(nowMilliseconds);
    const host = this.host, serverId = this.serverId;
    await host.prepare(this.checksumFeed, serverId, (index, value) => this.broadcastConfigstring(index, value)); if (this.ended) return []; this.assertWorld(host, serverId);
    if (this.changedWorld) { this.changedWorld = false; for (const peer of this.peers.values()) this.gamestate(peer); }
    for (let event = this.options.transport.poll(); event !== null; event = this.options.transport.poll()) {
      if (this.ended) break;
      if (event.kind === 'error') { this.host.print(event.error.message); continue; }
      if (event.kind !== 'packet' || (event.from.kind !== 'ipv4' && event.from.kind !== 'loopback' && event.from.kind !== 'ipx')) continue;
      if (this.host.administration?.rejects(event.from)) continue;
      try {
        const bytes = event.payload;
        if (bytes[0] === 255 && bytes[1] === 255 && bytes[2] === 255 && bytes[3] === 255) {
          const packet = decodeConnectionless(bytes, 'server');
          if (packet.command === 'rcon') {
            const result = await this.rcon.handle(event.from, packet.arguments[0] ?? '', q3RconCommand(packet.line), this.now);
            this.host.administration?.record({ address: event.from, operation: 'rcon', result });
          } else await this.admission.receive(event.from, bytes, this.now);
        }
        else {
          const slot = routeQ3SequencedPacket(event.from, bytes, this.slots()), peer = slot === null ? undefined : this.peers.get(slot.slot);
          if (peer !== undefined) { peer.remote = event.from; const result = await peer.connection.receiveDatagram(bytes); if (this.peers.get(peer.slot) !== peer) continue; this.assertPeer(peer, host, serverId); if (result.kind === 'accepted') { peer.lastReceived = this.now; if (peer.connection.phase === 'connected') this.gamestate(peer); } }
        }
      } catch (error) { if (error instanceof Q3GameCallbackError) throw error; if (this.ended) break; this.host.print(error instanceof Error ? error.message : String(error)); }
    }
    if (this.ended) { this.pending = []; return []; }
    const commands = this.pending; this.pending = []; return commands;
  }
  submit(_commands: readonly ActorCommand[], _now: number): void {}
  publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[], nowMilliseconds: number): Promise<void> {
    return this.operation(() => this.publishEvents(output, events, nowMilliseconds));
  }
  private async publishEvents(_output: SimulationOutput, events: readonly SimulationPresentationEvent[], nowMilliseconds: number): Promise<void> {
    if (this.ended) return; this.now = Math.trunc(nowMilliseconds);
    await this.receiveEvents(events);
    if (this.ended) return;
    const masters = this.host.administration?.masters() ?? [];
    if (masters.length > 0 && this.options.transport.address.kind !== 'ipx') this.masterHeartbeat.send(masters, this.now, true);
    for (const peer of this.peers.values()) if (this.now - peer.lastReceived > (this.options.timeoutMilliseconds ?? 30000)) await this.disconnectClient(peer.player.client, 'timed out');
    for (const peer of this.peers.values()) if (peer.connection.phase !== 'connected' && this.host.time() >= peer.connection.nextSnapshotTime) {
      this.snapshot(peer);
    }
  }
  private async receiveEvents(events: readonly SimulationPresentationEvent[]): Promise<void> {
    for (const item of events) if (item.kind === 'q3-source') {
      const event = item.event;
      for (const peer of [...this.peers.values()]) {
        if (this.ended) return;
        if (this.peers.get(peer.slot) !== peer) continue;
        if (event.kind === 'drop-client' && event.client === peer.player.sourceEntity) await this.disconnectClient(peer.player.client, event.reason);
        else if (event.kind === 'server-command' && (event.client === -1 || event.client === peer.player.sourceEntity)) await this.queue(peer, event.text);
        else if (event.kind === 'configstring' && peer.connection.phase !== 'connected') {
          await this.configstring(peer, event.index, event.value);
        }
      }
    }
  }
  private snapshot(peer: Peer): void {
    if (!peer.connection.channel.hasUnsentFragments) { const snapshot = this.host.snapshot(peer.player); peer.connection.snapshots.capture(peer.connection.channel.outgoingSequence, snapshot.player, snapshot.areaMask, snapshot.entities); }
    const rate = this.host.rate(peer.player);
    peer.connection.sendSnapshot(this.serverFlags, rate, this.delivery(peer), writer => peer.download.write(writer, this.host.time(), rate));
  }
  gameOutput(): Q3GuestOutput {
    return {
      dropClient: async (slot, reason) => {
        const peer = [...this.peers.values()].find(peer => peer.player.sourceEntity === slot);
        if (peer !== undefined) await this.disconnectClient(peer.player.client, reason);
      },
      sendServerCommand: async (slot, text) => {
        for (const peer of [...this.peers.values()]) {
          if (this.ended || this.peers.get(peer.slot) !== peer) continue;
          if (slot === -1 || peer.player.sourceEntity === slot) await this.queue(peer, text);
        }
      },
      configstring: (index, value) => this.broadcastConfigstring(index, value),
    };
  }
  private async broadcastConfigstring(index: number, value: string): Promise<void> {
    for (const peer of [...this.peers.values()]) {
      if (peer.connection.phase === 'connected') continue;
      await this.configstring(peer, index, value);
    }
  }
  private async configstring(peer: Peer, configIndex: number, value: string): Promise<void> {
    for (const command of q3ConfigstringCommands(configIndex, value)) {
      if (this.ended || this.peers.get(peer.slot) !== peer) break;
      await this.queue(peer, command);
    }
  }
  private async queue(peer: Peer, text: string): Promise<void> { if (peer.connection.reliable.add(text).kind === 'overflow') await this.disconnectClient(peer.player.client, 'Server command overflow'); }
  async disconnectClient(client: ClientId, reason: string): Promise<boolean> {
    const peer = [...this.peers.values()].find(peer => peer.player.client.equals(client)); if (peer === undefined) return false;
    const host = this.host;
    this.peers.delete(peer.slot); this.admission.disconnect(peer.remote);
    this.pending = this.pending.filter(command => !command.actor.equals(peer.player.actor));
    try { peer.download.close(); this.queueDisconnect(peer, reason); }
    finally { await q3GameCallback(() => host.disconnect(peer.player, reason)); }
    return true;
  }
  private queueDisconnect(peer: Peer, reason: string): void {
    peer.connection.reliable.add(`disconnect "${reason.replace(/["\n\r]/g, '')}"`);
    const delivery = this.delivery(peer);
    while (peer.connection.channel.hasUnsentFragments) peer.connection.transmitNextFragment(delivery);
    peer.connection.sendSnapshot(this.serverFlags, this.host.rate(peer.player), delivery, () => {});
    while (peer.connection.channel.hasUnsentFragments) peer.connection.transmitNextFragment(delivery);
    peer.connection.phase = 'zombie';
  }
  changeWorld(host: Q3ApplicationServerHost, rejected: readonly { readonly client: ClientId; readonly reason: string }[] = []): Promise<void> {
    return this.operation(() => this.replaceWorld(host, rejected));
  }
  restartSourceRound(run: (round: Q3NetworkRoundRestart) => Promise<void>, onMutation?: () => undefined): Promise<void> {
    return this.operation(async () => {
      const binding = this.host.sourceRound;
      if (this.ended || binding === undefined) throw new Error('Q3 network host has no native source round restart');
      binding.preflight();
      if (this.serverId === 0x7fffffff) throw new Error('Q3 server id exhausted');
      const peers = [...this.peers.values()], pending = new Set(peers.map(peer => peer.slot));
      const reconnecting = new Set<number>();
      const lifecycle: { phase: 'reset' | 'bound' | 'closed' } = { phase: 'reset' };
      this.serverId++; this.serverFlags = this.serverFlags === 0 ? 4 : 0; this.pending = [];
      const host = this.host, serverId = this.serverId;
      const current = () => {
        if (lifecycle.phase === 'closed') throw new Error('Q3 source restart scope has ended');
        this.assertWorld(host, serverId);
      };
      try {
        onMutation?.();
        await host.prepare(this.checksumFeed, serverId); current();
        await run({ clients: peers.map(peer => peer.player.client), snapshotServerBit: this.serverFlags,
          bindSource: async () => {
            current();
            if (lifecycle.phase !== 'reset') throw new Error('Q3 network source round was already rebound');
            binding.rebind();
            await host.prepare(this.checksumFeed, serverId, (index, value) => this.broadcastConfigstring(index, value));
            current(); lifecycle.phase = 'bound';
          },
          receiveEvents: async events => {
            current();
            if (lifecycle.phase !== 'bound') throw new Error('Bind the Q3 network source before delivering restart events');
            await this.receiveEvents(events); current();
          },
          reconnectClient: async client => {
            current();
            if (lifecycle.phase !== 'bound') throw new Error('Bind the Q3 network source before reconnecting');
            const peer = peers.find(peer => peer.player.client.equals(client));
            if (peer === undefined) return false;
            if (!pending.has(peer.slot) || reconnecting.has(peer.slot)) throw new Error('Q3 network client was already reconnected');
            reconnecting.add(peer.slot);
            try {
              if (this.peers.get(peer.slot) === peer) {
                await this.queue(peer, 'map_restart\n'); current();
                if (this.peers.get(peer.slot) === peer) {
                  const admitted = await q3GameCallback(() => binding.reconnect(client, peer.userinfo, peer.connection.lastUserCommand));
                  current();
                  if (admitted.kind === 'rejected') await this.disconnectClient(client, admitted.reason);
                  else {
                    if (!admitted.player.client.equals(client)) throw new Error('Q3 round admission changed client identity');
                    peer.player = admitted.player; peer.connection.phase = 'active'; peer.connection.deltaMessage = -1;
                    peer.connection.nextSnapshotTime = host.time();
                  }
                }
              }
              pending.delete(peer.slot); return true;
            } finally { reconnecting.delete(peer.slot); }
          },
        });
        current();
        if (lifecycle.phase !== 'bound' || pending.size !== 0) throw new Error('Q3 source restart did not bind and reconnect every network client');
      } catch (error) {
        this.ended = true; this.pending = [];
        const failures: unknown[] = [error];
        for (const peer of this.peers.values()) { try { peer.download.close(); } catch (failure) { failures.push(failure); } }
        this.peers.clear();
        try { this.options.transport.close(); } catch (failure) { failures.push(failure); }
        if (failures.length > 1) throw new AggregateError(failures, 'Q3 source restart and network retirement failed');
        throw error;
      } finally { lifecycle.phase = 'closed'; }
    });
  }
  private async replaceWorld(host: Q3ApplicationServerHost, rejected: readonly { readonly client: ClientId; readonly reason: string }[]): Promise<void> {
    this.requireSupported(host);
    const refused = new Map<number, string>();
    for (const entry of rejected) {
      const peer = this.peers.get(entry.client.slot);
      if (peer === undefined || !peer.player.client.equals(entry.client) || refused.has(peer.slot))
        throw new Error('Q3 map rejection does not identify one carried peer');
      refused.set(peer.slot, entry.reason);
    }
    const carried = [...this.peers.values()].filter(peer => !refused.has(peer.slot)).map(peer => ({ peer, player: host.carriedPlayer(peer.player.client) }));
    this.host = host; this.serverId++; this.restartedServerId = this.serverId; this.serverFlags = this.serverFlags === 0 ? 4 : 0; this.pending = []; this.checksumFeed = (this.options.random() << 16) ^ this.options.random(); this.changedWorld = true;
    for (const entry of rejected) await this.disconnectClient(entry.client, entry.reason);
    for (const { peer, player } of carried) { peer.player = player; await q3GameCallback(() => this.host.userinfo(player, peer.userinfo)); this.assertPeer(peer); peer.download.close(); peer.connection.deltaMessage = -1; peer.connection.phase = 'connected'; }
  }
  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.ended = true; this.closing = this.closeOwned(); return this.closing;
  }
  private async closeOwned(): Promise<void> {
    const failures: unknown[] = [];
    try { await this.activeOperation; } catch (error) { failures.push(error); }
    for (const peer of [...this.peers.values()]) {
      try { await this.disconnectClient(peer.player.client, 'Server shutdown'); } catch (error) { failures.push(error); }
    }
    this.options.transport.close();
    if (failures.length !== 0) throw new AggregateError(failures, 'Q3 network shutdown failed');
  }
}
