import type { Q1ProtocolIdentity } from '../../contracts/protocol.ts';
import { SizeBuf } from './message.ts';
import { writeNetQuakeMessage } from './netquake.ts';
import type { NetQuakeMessage } from './netquake.ts';

type SeedMessage = Exclude<NetQuakeMessage, { kind: 'entity' }>;
/** Retains map signon and current persistent client fields, never a packet history. */
export class NetQuakeRecordingState {
  private info: Extract<NetQuakeMessage, { kind: 'server-info' }> | null = null;
  private readonly statics: SeedMessage[] = [];
  private readonly fields = new Map<string, SeedMessage>();
  observe(messages: readonly NetQuakeMessage[]): void {
    for (const message of messages) {
      switch (message.kind) {
        case 'server-info': this.info = message; this.statics.length = 0; this.fields.clear(); break;
        case 'static': case 'static-sound': this.statics.push(message); break;
        case 'baseline': this.fields.set(`baseline:${message.state.number}`, message); break;
        case 'name': case 'social': case 'player-info': case 'frags': case 'colors': case 'ping':
          this.fields.set(`${message.kind}:${message.slot}`, message); break;
        case 'stat': case 'light-style': this.fields.set(`${message.kind}:${message.index}`, message); break;
        case 'set-view': case 'set-angle': case 'client-data': case 'cd-track': case 'time':
        case 'skybox': case 'finale': case 'cutscene': case 'intermission': this.fields.set(message.kind, message); break;
        default: break;
      }
    }
  }
  seed(protocol: Q1ProtocolIdentity): readonly Uint8Array[] {
    if (this.info === null) throw new Error('NetQuake recording has no server info');
    const messages: SeedMessage[] = [this.info, { kind: 'signon', stage: 1 }, ...this.statics,
      ...this.fields.values(), { kind: 'signon', stage: 2 }, { kind: 'signon', stage: 3 }];
    return messages.map(message => {
      const bytes = new SizeBuf(65536);
      writeNetQuakeMessage(bytes, protocol, message);
      return bytes.bytes();
    });
  }
}
