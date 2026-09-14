import type { SessionId } from '../../../../contracts/identity.ts';
import type { WireUserCommand } from '../../../../network/q3/message.ts';
import { CvarFlag, CvarRegistry } from '../../../../core/cvars/index.ts';
import type { Q3HostSettings } from './host.ts';

export interface Q3ServerStateOptions {
  readonly session: SessionId;
  readonly settings: Q3HostSettings;
  now(): number;
  print(text: string): void;
}

/** Engine-owned storage shared by the selected game and its network host. */
export class Q3ServerState {
  readonly cvars: CvarRegistry;
  private readonly values = new Map<number, string>();
  private readonly userinfo = new Map<number, string>();
  private readonly commands = new Map<number, WireUserCommand>();
  readonly configstrings = {
    get: (index: number): string => { this.configIndex(index); return this.values.get(index) ?? ''; },
    set: (index: number, value: string): void => { this.configIndex(index); this.values.set(index, value); },
  };

  constructor(private readonly options: Q3ServerStateOptions) {
    const settings = options.settings;
    this.cvars = new CvarRegistry({ dialect: 'q3', context: { session: options.session, origin: { kind: 'server-console' } }, print: text => options.print(text) });
    this.cvars.set('sv_maxclients', String(settings.maxClients), true);
    this.cvars.set('sv_mapname', settings.mapName, true);
    this.cvars.register('mapname', settings.mapName, CvarFlag.ServerInfo | CvarFlag.ReadOnly);
    for (const variable of settings.cvars ?? []) this.cvars.set(variable.name, variable.value, true);
  }
  private configIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= 1024) throw new RangeError('Q3 configstring outside source range');
  }
  hasConfigstring(index: number): boolean { this.configIndex(index); return this.values.has(index); }
  print(text: string): void { this.options.print(text); }
  getUserinfo(slot: number): string | undefined { return this.userinfo.get(slot); }
  setUserinfo(slot: number, value: string): void { this.userinfo.set(slot, value); }
  getUserCommand(slot: number): WireUserCommand | undefined {
    const command = this.commands.get(slot);
    return command === undefined ? undefined : { ...command, angles: [...command.angles] };
  }
  setUserCommand(slot: number, value: WireUserCommand): void { this.commands.set(slot, { ...value, angles: [...value.angles] }); }
  clearClient(slot: number): void { this.userinfo.delete(slot); this.commands.delete(slot); }
}
