import type { QuakeWorldMessage } from './quakeworld.ts';
import { writeQuakeWorldMessage } from './quakeworld.ts';
import { SizeBuf } from './message.ts';
import type { QuakeWorldDemoRecord } from './demos.ts';
import { IdIndex, StringTable } from '../../foundation/index.ts';

type SeedMessage = Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>;

const FIELD_BASELINE = 0;
const FIELD_LIGHT_STYLE = 1;
const FIELD_STAT = 2;
const FIELD_USERINFO = 3;
const FIELD_SET_INFO = 4;
const FIELD_SERVER_INFO = 5;
const FIELD_FRAGS = 6;
const FIELD_PING = 7;
const FIELD_ENTER_TIME = 8;
const FIELD_PACKET_LOSS = 9;
const FIELD_SET_ANGLE = 10;
const FIELD_SET_VIEW = 11;
const FIELD_PAUSE = 12;
const FIELD_INTERMISSION = 13;
const FIELD_FINALE = 14;
const FIELD_CD_TRACK = 15;
const FIELD_MAX_SPEED = 16;
const FIELD_ENTITY_GRAVITY = 17;

/**
 * Retained demo-seed fields in first-admission order. Field identity is a
 * (category, discriminator) pair resolved through the foundation ID index;
 * info keys are interned once, so observing traffic builds no key strings.
 */
export class QuakeWorldRecordingState {
  private readonly keys = new StringTable(() => 0);
  private readonly fields = new IdIndex();
  private readonly pairs = new IdIndex();
  private readonly pairSlots: number[] = [];
  private readonly rows: (SeedMessage | null)[] = [];
  private readonly statics: SeedMessage[] = [];

  private setField(category: number, discriminator: number, message: SeedMessage): void {
    const row = this.fields.find(category, discriminator);
    if (row >= 0) { this.rows[row] = message; return; }
    this.fields.reserve(1);
    this.fields.insert(category, discriminator, this.rows.length);
    this.rows.push(message);
  }

  private pairId(slot: number, key: string): number {
    const keyId = this.keys.intern(key);
    const existing = this.pairs.find(keyId, slot);
    if (existing >= 0) return existing;
    this.pairs.reserve(1);
    this.pairs.insert(keyId, slot, this.pairSlots.length);
    this.pairSlots.push(slot);
    return this.pairSlots.length - 1;
  }

  private deleteSetInfo(slot: number): void {
    for (const [pair, owner] of this.pairSlots.entries()) {
      if (owner !== slot) continue;
      const row = this.fields.find(FIELD_SET_INFO, pair);
      if (row < 0) continue;
      this.rows[row] = null;
      this.fields.removeValue(FIELD_SET_INFO, pair, row);
    }
  }

  observe(messages: readonly QuakeWorldMessage[]): void {
    for (const message of messages) {
      switch (message.kind) {
        case 'server-data': this.fields.clear(); this.rows.length = 0; this.statics.length = 0; break;
        case 'static': case 'static-sound': this.statics.push(message); break;
        case 'baseline': this.setField(FIELD_BASELINE, message.state.number, message); break;
        case 'light-style': this.setField(FIELD_LIGHT_STYLE, message.index, message); break;
        case 'stat': this.setField(FIELD_STAT, message.index, message); break;
        case 'userinfo':
          this.deleteSetInfo(message.slot);
          this.setField(FIELD_USERINFO, message.slot, message); break;
        case 'set-info': this.setField(FIELD_SET_INFO, this.pairId(message.slot, message.key), message); break;
        case 'server-info': this.setField(FIELD_SERVER_INFO, this.keys.intern(message.key), message); break;
        case 'frags': this.setField(FIELD_FRAGS, message.slot, message); break;
        case 'ping': this.setField(FIELD_PING, message.slot, message); break;
        case 'enter-time': this.setField(FIELD_ENTER_TIME, message.slot, message); break;
        case 'packet-loss': this.setField(FIELD_PACKET_LOSS, message.slot, message); break;
        case 'set-angle': this.setField(FIELD_SET_ANGLE, 0, message); break;
        case 'set-view': this.setField(FIELD_SET_VIEW, 0, message); break;
        case 'pause': this.setField(FIELD_PAUSE, 0, message); break;
        case 'intermission': this.setField(FIELD_INTERMISSION, 0, message); break;
        case 'finale': this.setField(FIELD_FINALE, 0, message); break;
        case 'cd-track': this.setField(FIELD_CD_TRACK, 0, message); break;
        case 'max-speed': this.setField(FIELD_MAX_SPEED, 0, message); break;
        case 'entity-gravity': this.setField(FIELD_ENTITY_GRAVITY, 0, message); break;
        default: break;
      }
    }
  }
  seed(data: Extract<QuakeWorldMessage, { kind: 'server-data' }>, models: readonly string[], sounds: readonly string[], seconds: number,
    outgoing: number, incoming: number): readonly QuakeWorldDemoRecord[] {
    const messages: SeedMessage[] = [data];
    for (const [kind, names] of [['model-list', models], ['sound-list', sounds]] satisfies readonly (readonly ['model-list' | 'sound-list', readonly string[]])[]) {
      if (names.length === 0) messages.push({ kind, first: 0, names: [], next: 0 });
      for (const [first, name] of names.entries()) messages.push({ kind, first, names: [name], next: first + 1 === names.length ? 0 : first + 1 });
    }
    messages.push(...this.statics);
    for (const row of this.rows) if (row !== null) messages.push(row);
    const records: QuakeWorldDemoRecord[] = messages.map((message, index) => {
      const payload = new SizeBuf(1442); writeQuakeWorldMessage(payload, data.protocol, message);
      const bytes = new Uint8Array(payload.cursize + 8), header = new DataView(bytes.buffer);
      header.setInt32(0, index + 1, true); header.setInt32(4, outgoing - 1, true); bytes.set(payload.bytes(), 8);
      return { kind: 'packet', seconds, message: bytes };
    });
    records.push({ kind: 'sequences', seconds, outgoing, incoming });
    return records;
  }
}
