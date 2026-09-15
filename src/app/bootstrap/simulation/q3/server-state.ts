import { SaveReader } from "../../../../persistence/value.ts";
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

function readCommand(reader: SaveReader): WireUserCommand {
  const angles = reader.field("angles").list(value => value.integer());
  const [pitch, yaw, roll] = angles;
  if (angles.length !== 3 || pitch === undefined || yaw === undefined || roll === undefined) return reader.fail("command requires three angles");
  return { serverTime: reader.field("serverTime").integer(), angles: [pitch, yaw, roll],
    forwardmove: reader.field("forwardmove").integer(), rightmove: reader.field("rightmove").integer(), upmove: reader.field("upmove").integer(),
    buttons: reader.field("buttons").integer(), weapon: reader.field("weapon").integer() };
}

function readSlots<T>(reader: SaveReader, maximum: number, read: (reader: SaveReader) => T): Map<number, T> {
  const entries = reader.list(entry => ({ slot: entry.field("slot").integer(0), value: read(entry.field("value")) }));
  const result = new Map<number, T>();
  for (const entry of entries) {
    if (entry.slot >= maximum || result.has(entry.slot)) reader.fail("invalid or duplicate source storage slot");
    result.set(entry.slot, entry.value);
  }
  return result;
}

/** Engine-owned storage shared by the selected game and its network host. */
export class Q3ServerState {
  captureSaveState() {
    return { cvars: this.cvars.captureSaveState(),
      configstrings: [...this.values].map(([slot, value]) => ({ slot, value })),
      userinfo: [...this.userinfo].map(([slot, value]) => ({ slot, value })),
      commands: [...this.commands].map(([slot, value]) => ({ slot, value: { serverTime: value.serverTime, angles: [...value.angles],
        forwardmove: value.forwardmove, rightmove: value.rightmove, upmove: value.upmove, buttons: value.buttons, weapon: value.weapon } })) };
  }

  restoreSaveState(value: unknown): void {
    const reader = new SaveReader(value, "q3.server");
    const configstrings = readSlots(reader.field("configstrings"), 1024, entry => entry.string());
    const userinfo = readSlots(reader.field("userinfo"), 64, entry => entry.string());
    const commands = readSlots(reader.field("commands"), 64, readCommand);
    this.cvars.restoreSaveState(reader.field("cvars").value);
    this.values.clear(); for (const [slot, value] of configstrings) this.values.set(slot, value);
    this.userinfo.clear(); for (const [slot, value] of userinfo) this.userinfo.set(slot, value);
    this.commands.clear(); for (const [slot, value] of commands) this.commands.set(slot, value);
  }

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
    this.cvars.register('sv_maxclients', String(settings.maxClients), CvarFlag.ServerInfo | CvarFlag.Latch);
    this.cvars.set('sv_mapname', settings.mapName, true);
    this.cvars.register('mapname', settings.mapName, CvarFlag.ServerInfo | CvarFlag.ReadOnly);
    this.cvars.applyArchive(settings.sourceArchive ?? []);
    this.cvars.set('sv_maxclients', String(settings.maxClients), true);
    this.cvars.set('sv_mapname', settings.mapName, true);
    this.cvars.set('mapname', settings.mapName, true);
    for (const variable of settings.cvars ?? []) this.cvars.set(variable.name, variable.value, true);
    this.refreshServerInfo();
  }
  refreshServerInfo(): string | null {
    const value = this.serverInfo();
    if (this.values.get(0) === value) return null;
    this.values.set(0, value);
    return value;
  }
  serverInfo(): string { return this.cvars.infoString(CvarFlag.ServerInfo); }
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
