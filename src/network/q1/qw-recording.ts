import type { QuakeWorldMessage } from './quakeworld.ts';
import { writeQuakeWorldMessage } from './quakeworld.ts';
import { SizeBuf } from './message.ts';
import type { QuakeWorldDemoRecord } from './demos.ts';

type SeedMessage = Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>;
export class QuakeWorldRecordingState {
  private readonly fields = new Map<string, SeedMessage>();
  private readonly statics: SeedMessage[] = [];
  observe(messages: readonly QuakeWorldMessage[]): void {
    for (const message of messages) {
      switch (message.kind) {
        case 'server-data': this.fields.clear(); this.statics.length = 0; break;
        case 'static': case 'static-sound': this.statics.push(message); break;
        case 'baseline': this.fields.set(`baseline:${message.state.number}`, message); break;
        case 'light-style': case 'stat': this.fields.set(`${message.kind}:${message.index}`, message); break;
        case 'userinfo':
          for (const key of this.fields.keys()) if (key.startsWith(`set-info:${message.slot}:`)) this.fields.delete(key);
          this.fields.set(`userinfo:${message.slot}`, message); break;
        case 'set-info': this.fields.set(`set-info:${message.slot}:${message.key}`, message); break;
        case 'server-info': this.fields.set(`server-info:${message.key}`, message); break;
        case 'frags': case 'ping': case 'enter-time': case 'packet-loss': this.fields.set(`${message.kind}:${message.slot}`, message); break;
        case 'set-angle': case 'set-view': case 'pause': case 'intermission': case 'finale': case 'cd-track':
        case 'max-speed': case 'entity-gravity': this.fields.set(message.kind, message); break;
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
    messages.push(...this.statics, ...this.fields.values());
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
