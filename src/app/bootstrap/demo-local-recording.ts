import type { Vec3 } from '../../contracts/math.ts';
import type { SimulationOutput } from '../../contracts/session.ts';
import type { Q2ProtocolIdentity } from '../../contracts/protocol.ts';
import type { Q1ApplicationServerHost, Q1ApplicationPlayer, Q1ApplicationGameState } from './network/q1-types.ts';
import type { Q2ApplicationServerHost, Q2ApplicationPlayer, Q2ApplicationGameState } from './network/types.ts';
import type { Q3ApplicationServerHost, Q3ApplicationPlayer } from './network/q3-types.ts';
import type { QwApplicationServerHost, QwApplicationPlayer } from './network/qw-server-types.ts';
import type { SimulationPresentationEvent } from './simulation/types.ts';
import type { DemoRecordingSeed, DemoRecordingPacket, DemoRecordingSink } from './demo-recording.ts';
import { SizeBuf } from '../../network/q1/message.ts';
import { writeNetQuakeMessage, writeNetQuakeEntity, entityState } from '../../network/q1/netquake.ts';
import { EntityStateT } from '../../network/q1/wire-types.ts';
import { Q2WireCodec, encodeQ2ServerEvent, encodeQ2Frame } from '../../network/q2/index.ts';
import { encodeServerMessage } from '../../network/q3/server-message.ts';
import type { Gamestate, ServerOperation } from '../../network/q3/server-message.ts';
import { q3ConfigstringCommands } from '../../network/q3/configstrings.ts';
import { QuakeWorldRecordingState } from '../../network/q1/qw-recording.ts';
import { qwWireEntity, writeQuakeWorldEntities, writeQuakeWorldMessage } from '../../network/q1/quakeworld.ts';
import { U_SOLID } from '../../network/q1/qw-constants.ts';

export type LocalRecordingSource = { readonly world: object } & (
  | { readonly kind: 'q1'; readonly host: Q1ApplicationServerHost; readonly player: Q1ApplicationPlayer; readonly viewAngles: Vec3 }
  | { readonly kind: 'qw'; readonly host: QwApplicationServerHost; readonly player: QwApplicationPlayer; readonly viewAngles: Vec3; readonly seconds: number }
  | { readonly kind: 'q2'; readonly host: Q2ApplicationServerHost; readonly player: Q2ApplicationPlayer; readonly protocol: Q2ProtocolIdentity }
  | { readonly kind: 'q3'; readonly host: Q3ApplicationServerHost; readonly player: Q3ApplicationPlayer; readonly serverId: number; readonly snapshotServerBit: 0 | 4 }
);
type Prepared = { readonly source: LocalRecordingSource; readonly seed: DemoRecordingSeed } & (
  | { readonly kind: 'q1'; readonly state: Q1ApplicationGameState }
  | { readonly kind: 'qw'; readonly baselines: ReadonlyMap<number, ReturnType<typeof qwWireEntity>> }
  | { readonly kind: 'q2'; readonly state: Q2ApplicationGameState; readonly wire: Q2WireCodec }
  | { readonly kind: 'q3'; readonly state: Gamestate }
);

/** The application borrows its actual source host and publishes after that host's observation. */
export class LocalDemoRecording {
  private sink: DemoRecordingSink | null = null;
  private prepared: Prepared | null = null;
  private sequence = 0;
  private commandSequence = 0;
  constructor(private readonly read: () => LocalRecordingSource) {}
  seed(): DemoRecordingSeed {
    const source = this.read(), admission = source.host.supportsSourceWire();
    if (admission.kind !== 'supported') throw new Error(admission.reasons.join('; '));
    const packets: DemoRecordingPacket[] = [];
    if (source.kind === 'qw') {
      const host = source.host.signon(source.player), data = host.serverData();
      const signon = source.host.recordingSignon?.(source.player);
      if (signon === undefined) throw new Error('QW source has no read-only recording signon');
      packets.push({ kind: 'qw', record: { kind: 'sequences', seconds: source.seconds, outgoing: 0, incoming: 0 } });
      const initial = new QuakeWorldRecordingState().seed(data, host.models(), host.sounds(), source.seconds, 0, 0);
      for (const record of initial) if (record.kind === 'packet') packets.push({ kind: 'qw', record });
      this.sequence = initial.filter(record => record.kind === 'packet').length;
      for (const bytes of [...host.signonBuffers(), ...signon]) packets.push(this.qwPacket(bytes, source.seconds));
      const baselines = new Map(source.host.baselines(source.player).map(entity => [entity.number, qwWireEntity(entity)]));
      const seed: DemoRecordingSeed = { identity: { kind: 'qw', protocol: 28 }, packets };
      this.prepared = { kind: 'qw', source, baselines, seed }; return seed;
    }
    if (source.kind === 'q1') {
      const state = source.host.gameState(source.player);
      const messages = [state.info, { kind: 'set-view', entity: source.player.sourceEntity }, { kind: 'signon', stage: 1 },
        ...state.signon, ...[...state.baselines.values()].map(value => ({ kind: 'baseline', state: value } satisfies Parameters<typeof writeNetQuakeMessage>[2])),
        { kind: 'signon', stage: 2 }, ...source.host.spawn(source.player), { kind: 'signon', stage: 3 }] satisfies Parameters<typeof writeNetQuakeMessage>[2][];
      for (const message of messages) {
        const bytes = new SizeBuf(65536); writeNetQuakeMessage(bytes, source.host.protocol, message);
        packets.push({ kind: 'q1', viewAngles: source.viewAngles, message: bytes.bytes() });
      }
      const seed: DemoRecordingSeed = { identity: { kind: 'q1', protocol: source.host.protocol.version, track: -1 }, packets };
      this.prepared = { kind: 'q1', source, state, seed }; return seed;
    }
    if (source.kind === 'q2') {
      const state = source.host.gameState(source.player, source.protocol), wire = new Q2WireCodec(source.protocol);
      const add = (message: Uint8Array): void => { packets.push({ kind: 'q2', message }); };
      add(encodeQ2ServerEvent(wire, { kind: 'server-data', data: { ...state.data, attractloop: true } }));
      for (const [index, value] of state.configStrings) add(encodeQ2ServerEvent(wire, { kind: 'config-string', index, value }));
      for (const entity of state.baselines.values()) add(encodeQ2ServerEvent(wire, { kind: 'baseline', entity }));
      add(encodeQ2ServerEvent(wire, { kind: 'command-text', text: 'precache\n' }));
      const seed: DemoRecordingSeed = { identity: { kind: 'q2', protocol: source.protocol }, packets };
      this.prepared = { kind: 'q2', source, state, wire, seed }; return seed;
    }
    const state = source.host.gameState(source.player, source.serverId);
    this.commandSequence = state.commandSequence;
    const message = this.q3Message(source, state, [state]);
    const seed: DemoRecordingSeed = { identity: { kind: 'q3', protocol: 68 }, packets: [{ kind: 'q3', sequence: this.sequence++, message }] };
    this.prepared = { kind: 'q3', source, state, seed }; return seed;
  }
  attach(sink: DemoRecordingSink): () => void {
    if (this.sink !== null || this.prepared === null) throw new Error('Local recording requires an unattached prepared seed');
    this.sink = sink;
    return () => { if (this.sink === sink) this.sink = null; };
  }
  private qwPacket(payload: Uint8Array, seconds: number): Extract<DemoRecordingPacket, { kind: 'qw' }> {
    if (payload.length > 1442) throw new RangeError('QWD message exceeds native packet capacity');
    const message = new Uint8Array(payload.length + 8);
    new DataView(message.buffer).setInt32(0, ++this.sequence, true); message.set(payload, 8);
    return { kind: 'qw', record: { kind: 'packet', seconds, message } };
  }
  private q3Message(source: Extract<LocalRecordingSource, { kind: 'q3' }>, state: Gamestate, operations: readonly ServerOperation[]): Uint8Array {
    return encodeServerMessage(0, operations, { product: source.host.product, messageNumber: this.sequence, reliableSequence: 0,
      serverCommandSequence: this.commandSequence, parseEntitiesNumber: 0,
      baseline: number => { const entry = state.entries.find(entry => entry.kind === 'baseline' && entry.number === number); return entry?.kind === 'baseline' ? entry.entity : null; }, history: () => null });
  }
  async publish(output: SimulationOutput, events: readonly SimulationPresentationEvent[]): Promise<void> {
    const sink = this.sink;
    if (sink === null) return;
    const source = this.read(); let prepared = this.prepared;
    if (prepared === null) throw new Error('Local recording lost its seed');
    if (prepared.source.world !== source.world) {
      const identity = JSON.stringify(prepared.seed.identity), seed = this.seed();
      if (JSON.stringify(seed.identity) !== identity) throw new Error('Local recording source protocol changed');
      for (const packet of seed.packets) await sink.append(packet);
      prepared = this.prepared;
    }
    if (source.kind === 'q1' && prepared?.kind === 'q1') {
      const frame = source.host.frame(source.player, output), bytes = new SizeBuf(64000);
      for (const message of [{ kind: 'time', seconds: frame.seconds } satisfies Parameters<typeof writeNetQuakeMessage>[2], ...frame.reliable, ...frame.messages, ...frame.datagram]) writeNetQuakeMessage(bytes, source.host.protocol, message);
      for (const entity of frame.entities) {
        const baseline = prepared.state.baselines.get(entity.number) ?? entityState(entity.number, new EntityStateT());
        writeNetQuakeEntity(bytes, source.host.protocol, entity, baseline, frame.seconds);
      }
      await sink.append({ kind: 'q1', viewAngles: source.viewAngles, message: bytes.bytes() });
    } else if (source.kind === 'qw' && prepared?.kind === 'qw') {
      const frame = source.host.frame(source.player, output), protocol = { kind: 'q1-quakeworld', version: 28 } satisfies Parameters<typeof writeQuakeWorldMessage>[1];
      for (const message of [...frame.reliable, ...frame.messages, { kind: 'set-angle', angles: source.viewAngles } satisfies Parameters<typeof writeQuakeWorldMessage>[2]]) {
        const bytes = new SizeBuf(1442); writeQuakeWorldMessage(bytes, protocol, message); await sink.append(this.qwPacket(bytes.bytes(), source.seconds));
      }
      const bytes = new SizeBuf(1442);
      writeQuakeWorldEntities(bytes, protocol, frame.entities.map(entity => qwWireEntity(entity, (entity.quakeWorldFlags & U_SOLID) !== 0)), prepared.baselines, null);
      await sink.append(this.qwPacket(bytes.bytes(), source.seconds));
    } else if (source.kind === 'q2' && prepared?.kind === 'q2') {
      const raw = source.host.rawMessages?.(source.player) ?? [];
      for (const message of raw) if (message.reliable) await sink.append({ kind: 'q2', message: message.bytes });
      for (const event of source.host.events(source.player, output, events)) await sink.append({ kind: 'q2', message: encodeQ2ServerEvent(prepared.wire, event) });
      await sink.append({ kind: 'q2', message: encodeQ2Frame(prepared.wire, source.host.frame(source.player, output, source.protocol), null, prepared.state.baselines, source.host.maxClients) });
      for (const message of raw) if (!message.reliable) await sink.append({ kind: 'q2', message: message.bytes });
    } else if (source.kind === 'q3' && prepared?.kind === 'q3') {
      const operations: ServerOperation[] = [];
      for (const item of events) if (item.kind === 'q3-source') {
        const event = item.event;
        const commands = event.kind === 'server-command' && (event.client === -1 || event.client === source.player.sourceEntity) ? [event.text]
          : event.kind === 'configstring' ? q3ConfigstringCommands(event.index, event.value) : [];
        for (const text of commands) operations.push({ kind: 'command', sequence: ++this.commandSequence, text });
      }
      const frame = source.host.snapshot(source.player);
      operations.push({ kind: 'snapshot', validity: { kind: 'valid' }, snapshot: { messageNumber: this.sequence, serverTime: source.host.time(), deltaNumber: -1,
        flags: source.snapshotServerBit, serverCommandNumber: this.commandSequence, parseEntitiesNumber: 0, areaMask: frame.areaMask, playerState: frame.player, entities: frame.entities } });
      const message = this.q3Message(source, prepared.state, operations);
      await sink.append({ kind: 'q3', sequence: this.sequence++, message });
    } else throw new Error('Local recording source changed without a world boundary');
  }
}
