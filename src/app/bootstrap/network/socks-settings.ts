import type { CommandContext } from '../../../contracts/common.ts';
import type { CommandCvarRouting } from '../../../core/commands/index.ts';
import { CvarFlag, CvarRegistry } from '../../../core/cvars/index.ts';
import type { UdpTransport } from '../../../network/common/transport.ts';

/** Imported Q3 network settings retain Q3 archive/latch semantics for every remote family. */
export class ClientSocksSettings {
  readonly cvars: CvarRegistry;
  constructor(context: CommandContext, print: (text: string) => void) {
    this.cvars = new CvarRegistry({ dialect: 'q3', context, print });
    const flags = CvarFlag.Archive | CvarFlag.Latch;
    this.cvars.register('net_socksEnabled', '0', flags);
    this.cvars.register('net_socksServer', '', flags);
    this.cvars.register('net_socksPort', '1080', flags);
    this.cvars.register('net_socksUsername', '', flags);
    this.cvars.register('net_socksPassword', '', flags);
  }
  route(base: CommandCvarRouting): CommandCvarRouting {
    return {
      owner: (name, source) => {
        const fallback = base.owner(name, source);
        return this.cvars.find(name) === undefined ? fallback : this.cvars;
      },
      visible: source => [...base.visible(source), this.cvars],
    };
  }
  async connect(transport: UdpTransport, cvars = this.cvars): Promise<void> {
    cvars.applyLatched();
    if ((cvars.get('net_socksEnabled')?.integerValue ?? 0) === 0) return;
    await transport.connectSocks({ server: cvars.variableString('net_socksServer'),
      port: (cvars.get('net_socksPort')?.integerValue ?? 1080) & 65535,
      username: cvars.variableString('net_socksUsername'), password: cvars.variableString('net_socksPassword') });
  }
}
