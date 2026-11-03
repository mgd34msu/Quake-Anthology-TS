import { EventRing, type EventCursor } from "../../../foundation/event-ring.ts";
import { UnifiedComponentPublisher } from "./unified-component-publication.ts";
import { createHmac, randomBytes } from 'node:crypto';
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { ClientId } from '../../../contracts/identity.ts';
import { addressKey, sameAddress } from '../../../network/common/endpoint.ts';
import { printablePeerText } from '../../../network/common/diagnostics.ts';
import { zeroNonFinite } from './unified-finite.ts';
import { MovementBudget } from '../../../network/common/movement-budget.ts';
import type { NetworkAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import type { CompositionIdentity, WireSelection } from '../../../network/common/session.ts';
import { UnifiedChannel } from '../../../network/unified/channel.ts';
import { decodeUnifiedPacket } from '../../../network/unified/packet.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { UnifiedApplicationPlayer, UnifiedApplicationServerHost } from '../simulation/network-unified.ts';
import { encodeUnifiedControl, decodeUnifiedControl, encodeUnifiedHandshake, decodeUnifiedHandshake, decodeUnifiedInputs } from './unified-control.ts';
import type { UnifiedControl } from './unified-control.ts';
import { encodeUnifiedFrame } from './unified-frame-codec.ts';
import { encodeCheckpointValue } from '../../../persistence/value.ts';
import { encodeUnifiedPresentationEvents, writeUnifiedSimulationEvent } from './unified-event-codec.ts';
import { unifiedResourceId } from './unified-content.ts';
import type { ApplicationNetwork } from './types.ts';

class UnifiedHostFailure extends Error {
  constructor(cause: unknown) { super('Unified authoritative host callback failed', { cause }); }
}
function hostCall<T>(callback: () => T): T {
  try { return callback(); } catch (error) { throw new UnifiedHostFailure(error); }
}

const COOKIE_WINDOW_MILLISECONDS = 10000;
const MAX_PEERS_PER_ADDRESS = 8;
const MAX_INBOUND_MESSAGE_BYTES = 256 * 1024;
const UNREADY_TIMEOUT_MILLISECONDS = 60000;
interface Peer<TAddress> {
  readonly address: TAddress;
  readonly token: string;
  readonly nonce: string;
  readonly channel: UnifiedChannel;
  readonly resources: Set<string>;
  player: UnifiedApplicationPlayer | null;
  ready: boolean;
  lastReceived: number;
  readonly created: number;
  readonly budget: MovementBudget;
  lastQueuedInput: number;
  lastConsumedInput: number;
  lastSubmittedInput: number;
  requiredReliable: number;
  components: UnifiedComponentPublisher;
  closing: number | null;
}
export interface UnifiedServerOptions<TAddress extends NetworkAddress> {
  readonly transport: DatagramTransport<TAddress>;
  readonly host: UnifiedApplicationServerHost;
  readonly composition: CompositionIdentity;
  print(text: string): void;
}

/** A unified channel feeds the same authoritative input/publish boundary as native peers. */
export class UnifiedServerNetwork<TAddress extends NetworkAddress> implements ApplicationNetwork {
  readonly role = 'server';
  private ended = false;
  private epoch = 1;
  private now = 0;
  private host: UnifiedApplicationServerHost;
  private composition: CompositionIdentity;
  private readonly secret = randomBytes(32);
  private readonly peers = new Map<string, Peer<TAddress>>();
  private readonly commands = new EventRing<ActorCommand>(16384);
  private readonly commandCursor: EventCursor = this.commands.openCursor();
  constructor(private readonly options: UnifiedServerOptions<TAddress>) {
    this.host = options.host; this.composition = options.composition;
  }
  get phase(): 'active' | 'closed' { return this.ended ? 'closed' : 'active'; }
  get wire(): WireSelection { return { kind: 'unified', version: 1, composition: this.composition.digest, snapshotSchema: this.composition.composition.snapshotSchema }; }
  get clients(): readonly UnifiedApplicationPlayer[] { return [...this.peers.values()].flatMap(peer => peer.player === null ? [] : [peer.player]); }
  private queue(peer: Peer<TAddress>, control: UnifiedControl): number {
    const sequence = peer.channel.queueReliable(encodeUnifiedControl(control));
    peer.requiredReliable = sequence;
    return sequence;
  }
  private offer(peer: Peer<TAddress>): void {
    peer.components = new UnifiedComponentPublisher();
    peer.ready = false; peer.resources.clear(); peer.lastQueuedInput = -1; peer.lastConsumedInput = -1; peer.lastSubmittedInput = -1;
    this.queue(peer, { kind: 'offer', epoch: this.epoch, composition: this.composition, mode: this.host.mode, maxClients: this.host.maxClients });
  }
  private flush(peer: Peer<TAddress>, now: number): void {
    for (const bytes of peer.channel.flush(now)) {
      if (!this.options.transport.send(peer.address, bytes)) throw new Error('Unified transport rejected an outgoing datagram');
    }
  }
  private drop(peer: Peer<TAddress>, reason: string, now: number): void {
    if (peer.closing !== null) return;
    peer.closing = now; peer.ready = false;
    const player = peer.player; peer.player = null;
    if (player !== null) {
      this.commands.filterLive(command => !command.actor.equals(player.actor));
      hostCall(() => this.host.disconnect(player));
    }
    this.options.print(`Unified peer ${addressKey(peer.address)} disconnected: ${printablePeerText(reason)}\n`);
    try { this.queue(peer, { kind: 'disconnect', reason: reason.slice(0, 1024) }); this.flush(peer, now); }
    catch { peer.channel.close(); this.peers.delete(peer.token); }
  }
  disconnectClient(client: ClientId, reason: string): boolean {
    const peer = [...this.peers.values()].find(value => value.player?.client.equals(client));
    if (peer === undefined) return false;
    this.drop(peer, reason, this.now); return true;
  }
  private acceptControl(peer: Peer<TAddress>, bytes: Uint8Array, now: number): void {
    const control = decodeUnifiedControl(bytes);
    if (control.kind === 'disconnect') { this.drop(peer, control.reason, now); return; }
    if (control.epoch !== this.epoch) return;
    if (control.kind === 'ready') {
      if (control.composition !== this.composition.digest) throw new Error('Client content composition differs from the server');
      if (peer.ready) return;
      if (peer.player === null) {
        const admission = hostCall(() => this.host.admit(peer.address, control.userinfo));
        if (admission.kind === 'rejected') throw new Error(admission.reason);
        peer.player = admission.player;
      } else { const player = peer.player; hostCall(() => this.host.userinfo(player, control.userinfo)); }
      const player = peer.player;
      this.queue(peer, { kind: 'admitted', epoch: this.epoch, client: { slot: player.client.slot, generation: player.client.generation }, actor: { slot: player.actor.slot, generation: player.actor.generation }, sourceEntity: player.sourceEntity });
      const initial = hostCall(() => this.host.initialPresentation(player));
      if (initial.length > 0) this.queue(peer, { kind: 'events', epoch: this.epoch, frame: 0, payload: encodeUnifiedPresentationEvents(initial, count => { this.options.print(`Unified server dropped ${count} presentation event(s) with non-finite numbers\n`); }), simulation: encodeCheckpointValue([]) });
      peer.ready = true;
      return;
    }
    if (peer.player === null || !peer.ready) throw new Error('Client command arrived before world admission');
    const player = peer.player;
    if (control.kind === 'component-command') {
      const receive = this.host.componentCommand;
      if (receive === undefined) throw new Error('No component command receiver');
      if (!hostCall(() => receive(player, control.owner, control.generation, control.args))) throw new Error("Component command source or recipient is not admitted");
    }
    else if (control.kind === 'command') hostCall(() => this.host.command(player, control.name, control.args));
    else if (control.kind === 'userinfo') hostCall(() => this.host.userinfo(player, control.value));
    else throw new Error('Client sent a server-only control message');
  }
  private acceptInputs(peer: Peer<TAddress>, bytes: Uint8Array): void {
    if (peer.player === null || !peer.ready) return;
    const batch = decodeUnifiedInputs(bytes);
    if (batch.epoch !== this.epoch) return;
    for (const input of batch.commands) {
      if (input.sequence <= peer.lastQueuedInput) continue;
      if (!peer.budget.admit('milliseconds' in input.command ? input.command.milliseconds : 0, this.now)) { peer.lastQueuedInput = input.sequence; continue; }
      const command = this.host.input(peer.player, input.sequence, input.command, input.arsenal);
      this.commands.admit(command); peer.lastQueuedInput = input.sequence;
    }
  }
  private cookie(address: TAddress, nonce: string, now: number, windowsBack: number): string {
    const window = Math.floor(now / COOKIE_WINDOW_MILLISECONDS) - windowsBack;
    return createHmac('sha256', this.secret).update(`${addressKey(address)}|${nonce}|${window}`).digest('hex').slice(0, 32);
  }
  async poll(now: number): Promise<readonly ActorCommand[]> {
    if (this.ended) return [];
    this.now = now;
    for (let count = 0; count < 4096; count++) {
      const event = this.options.transport.poll();
      if (event === null) break;
      if (event.kind === 'error') { this.options.print(`Unified transport: ${event.error.message}\n`); continue; }
      if (event.kind !== 'packet') continue;
      const packet = decodeUnifiedPacket(event.payload);
      if (packet !== null) {
        const peer = this.peers.get(packet.token);
        if (peer === undefined || !sameAddress(peer.address, event.from)) continue;
        peer.lastReceived = now;
        try {
          for (const message of peer.channel.receive(event.payload, now)) {
            if (peer.closing !== null) break;
            if (message.kind === 'reliable') this.acceptControl(peer, message.payload, now);
            else this.acceptInputs(peer, message.payload);
          }
        } catch (error) {
          // A fault raised by one peer's message costs that peer its connection. If the game itself is broken,
          // the disconnect callback fails too and the application's frame boundary takes over.
          const fault = error instanceof UnifiedHostFailure ? error.cause : error;
          this.drop(peer, fault instanceof Error ? fault.message : String(fault), now);
        }
        continue;
      }
      const handshake = decodeUnifiedHandshake(event.payload);
      if (handshake === null || handshake.kind === 'challenge') continue;
      if (handshake.kind === 'hello') {
        // The challenge is a keyed hash of the source and a time window, so spoofed hellos allocate nothing.
        this.options.transport.send(event.from, encodeUnifiedHandshake({ kind: 'challenge', nonce: handshake.nonce, token: this.cookie(event.from, handshake.nonce, now, 0) }));
      } else {
        const existing = this.peers.get(handshake.token);
        if (existing !== undefined && existing.nonce === handshake.nonce && sameAddress(existing.address, event.from)) {
          try { this.flush(existing, now); }
          catch (error) { this.drop(existing, error instanceof Error ? error.message : String(error), now); }
          continue;
        }
        if (this.peers.size >= this.host.maxClients + 8 || [...this.peers.values()].filter(peer => sameAddress(peer.address, event.from, false)).length >= MAX_PEERS_PER_ADDRESS) continue;
        if (handshake.token !== this.cookie(event.from, handshake.nonce, now, 0) && handshake.token !== this.cookie(event.from, handshake.nonce, now, 1)) continue;
        const peer: Peer<TAddress> = { address: event.from, token: handshake.token, nonce: handshake.nonce,
          channel: new UnifiedChannel(handshake.token, { datagramBytes: Math.min(1200, this.options.transport.maxDatagramBytes ?? 1200), inboundMessageBytes: MAX_INBOUND_MESSAGE_BYTES }), resources: new Set(), player: null, ready: false, lastReceived: now, created: now, budget: new MovementBudget(), lastQueuedInput: -1, lastConsumedInput: -1, lastSubmittedInput: -1, requiredReliable: 0, components: new UnifiedComponentPublisher(), closing: null };
        this.peers.set(peer.token, peer); this.offer(peer);
      }
    }
    for (const peer of this.peers.values()) {
      if (peer.closing !== null && (now - peer.closing > 1000 || peer.channel.acknowledgedReliableSequence >= peer.requiredReliable)) {
        peer.channel.close(); this.peers.delete(peer.token); continue;
      }
      if (peer.closing === null && !peer.ready && now - peer.created > UNREADY_TIMEOUT_MILLISECONDS) { this.drop(peer, 'Signon timed out', now); continue; }
      if (peer.closing === null && now - peer.lastReceived > 30000) { this.drop(peer, 'Connection timed out', now); continue; }
      try { this.flush(peer, now); }
      catch (error) { this.drop(peer, error instanceof Error ? error.message : String(error), now); }
    }
    const pending = this.commands.take(this.commandCursor), latest = new Map<number, ActorCommand>(); this.commands.retire();
    for (const command of pending) {
      const previous = latest.get(command.actor.slot);
      if (command.command.kind !== 'q1-netquake' || previous?.command.kind !== 'q1-netquake') {
        latest.set(command.actor.slot, command); continue;
      }
      let arsenal = command.arsenal;
      if (previous.arsenal !== undefined && (arsenal === undefined || arsenal.provider === previous.arsenal.provider)) {
        const current = arsenal ?? previous.arsenal, impulse = current.impulse || previous.arsenal.impulse;
        arsenal = { ...current, weapon: current.weapon ?? previous.arsenal.weapon, useHoldable: current.useHoldable || previous.arsenal.useHoldable,
          ...(impulse === undefined ? {} : { impulse }) };
      }
      latest.set(command.actor.slot, { ...command, command: { ...command.command, impulse: command.command.impulse || previous.command.impulse },
        ...(arsenal === undefined ? {} : { arsenal }) });
    }
    // NetQuake applies one command for the server frame; replaying a burst repeats that frame's elapsed time.
    const commands = pending.flatMap(command => {
      if (command.command.kind !== 'q1-netquake') return [command];
      const selected = latest.get(command.actor.slot);
      return selected?.sequence === command.sequence ? [selected] : [];
    });
    for (const peer of this.peers.values()) {
      const command = peer.player === null ? undefined : latest.get(peer.player.actor.slot);
      if (command !== undefined && peer.player?.actor.equals(command.actor)) peer.lastSubmittedInput = Math.max(peer.lastSubmittedInput, command.sequence);
    }
    return commands;
  }
  submit(_commands: readonly ActorCommand[], _now: number): void { throw new Error('Server input belongs to its authoritative simulation'); }
  publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[], now: number): void {
    if (this.ended) return;
    for (const peer of this.peers.values()) {
      const player = peer.player;
      if (player === null || !peer.ready || peer.closing !== null) continue;
      peer.lastConsumedInput = peer.lastSubmittedInput;
      try {
        const resources = hostCall(() => this.host.resources(player, output)).filter(resource => !peer.resources.has(unifiedResourceId(resource)));
        if (resources.length > 0) {
          this.queue(peer, { kind: 'resources', epoch: this.epoch, resources });
          for (const resource of resources) peer.resources.add(unifiedResourceId(resource));
        }
        const presentation = hostCall(() => this.host.presentationEvents(player, events));
        const frame = hostCall(() => this.host.frame(player, output, this.epoch, peer.lastConsumedInput));
        if (presentation.length > 0 || frame.output.events.length > 0) this.queue(peer, { kind: 'events', epoch: this.epoch, frame: output.snapshot.frame.frame,
          payload: encodeUnifiedPresentationEvents(presentation, count => { this.options.print(`Unified server dropped ${count} presentation event(s) with non-finite numbers\n`); }), simulation: encodeCheckpointValue(frame.output.events.map(writeUnifiedSimulationEvent)) });
        const components = peer.components.project(hostCall(() => this.host.components?.(player) ?? []), hostCall(() => this.host.nativeComponents?.(player) ?? []));
        if (components.update !== null) this.queue(peer, { kind: 'components', epoch: this.epoch, update: components.update });
        peer.channel.queueFrame(encodeUnifiedFrame(zeroNonFinite({ ...frame, components: components.frame, output: { snapshot: frame.output.snapshot, events: [] } })), peer.requiredReliable);
        this.flush(peer, now);
      } catch (error) { if (error instanceof UnifiedHostFailure) throw error.cause; this.drop(peer, error instanceof Error ? error.message : String(error), now); }
    }
  }
  changeWorld(host: UnifiedApplicationServerHost, composition: CompositionIdentity): void {
    if (this.ended) throw new Error('Unified server is closed');
    if (this.epoch === 4294967295) throw new Error('Unified world sequence exhausted');
    this.host = host; this.composition = composition; this.epoch++; this.commands.reset();
    for (const peer of this.peers.values()) {
      if (peer.closing !== null) continue;
      if (peer.player !== null) peer.player = host.carriedPlayer(peer.player.client);
      this.offer(peer);
    }
  }
  close(): void {
    if (this.ended) return;
    this.ended = true;
    const failures: unknown[] = [];
    for (const peer of this.peers.values()) {
      try { if (peer.player !== null) this.host.disconnect(peer.player); } catch (error) { failures.push(error); }
      peer.channel.close();
    }
    this.peers.clear(); this.commands.reset();
    try { this.options.transport.close(); } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new AggregateError(failures, 'Unified server shutdown failed');
  }
}
