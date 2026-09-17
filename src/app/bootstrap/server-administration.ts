import type { CommandDialect } from "../../contracts/common.ts";
import { CvarFlag, Q2CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { addressKey, ipv4Address, resolveAddress, type NetworkAddress } from "../../network/common/endpoint.ts";
import { isUnknownArray } from "../../network/common/value.ts";
import type { ConfigStore } from "../../settings/config.ts";
import { q2OutOfBand } from "../../network/q2/handshake.ts";
import { IpFilterList, sourceIpv4Filter, type Ipv4Filter, type ServerAdministration } from "../../network/services/admin.ts";

type Print = (text: string) => void;
export interface ServerOperatorHost {
  readonly dialect: CommandDialect;
  readonly cvars: CvarRegistry;
  readonly dedicated: boolean;
  print(text: string): void;
  send(to: NetworkAddress, bytes: Uint8Array): boolean;
  writeConfig(name: string, text: string): Promise<void>;
  heartbeat(): void;
}
function filterText(filter: Ipv4Filter): string {
  return [0, 8, 16, 24].map(shift => (filter.compare >>> shift) & 255).join(".");
}

function rateUnsigned(text: string, offset: number): { readonly value: number; readonly end: number } {
  const match = /^[\t\n\v\f\r ]*([+-]?)([0-9]+)/.exec(text.slice(offset));
  const digits = match?.[2];
  if (match === null || digits === undefined) return { value: 0, end: offset };
  const magnitude = BigInt(digits), maximum = 0xffffffffffffffffn;
  const value = magnitude > maximum ? maximum : match[1] === "-" ? -magnitude : magnitude;
  return { value: Number(BigInt.asUintN(32, value)), end: offset + match[0].length };
}
function rateCredits(rate: number): number {
  return (rate > 0xffffffff / 32000 ? Math.trunc(rate / 10000) * 32000 : Math.trunc(rate * 32000 / 10000)) >>> 0;
}

/** Session state survives world replacement; native Q3 retains its own game filter list. */
export class ServerOperatorState {
  private readonly filters = new IpFilterList();
  private readonly masterAddresses = new Map<"qw" | "q2" | "q3", readonly NetworkAddress[]>();
  private masterNames = "";
  private generation = 0;
  private closed = false;
  private masterFailure: { readonly error: unknown } | null = null;
  private readonly limitedPrefixes: string[] = [];
  private rconRateOwner: CvarRegistry | null = null;
  private rconRateRevision = -1;
  private rconRateText: string | null = null;
  private rconRateTime = 0;
  private rconCredit = 0;
  private rconCreditCap = 0;
  private rconCost = 0;
  private constructor(private readonly store: ConfigStore, private readonly scope: string) {}
  static async open(store: ConfigStore, scope: string): Promise<ServerOperatorState> {
    const state = new ServerOperatorState(store, scope), text = await store.loadText(scope);
    if (text === null) return state;
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1
      || !("filters" in value) || !isUnknownArray(value.filters) || value.filters.length > 1024) throw new Error("Invalid server filter profile");
    for (const entry of value.filters) {
      const filter = typeof entry === "string" ? sourceIpv4Filter(entry) : null;
      if (filter === null) throw new Error("Invalid saved server filter");
      state.filters.add(filter);
    }
    return state;
  }
  private saveFilters(): Promise<void> { return this.store.dump(this.scope, `${JSON.stringify({ version: 1, filters: this.filters.snapshot().map(filterText) })}\n`); }
  limitedRcon(cvars: CvarRegistry): { readonly password: string; readonly prefixes: readonly string[] } {
    return { password: cvars.variableString("lrcon_password"), prefixes: [...this.limitedPrefixes] };
  }
  limitedRconCommand(name: string, rawArgs: string, print: Print): boolean {
    if (name !== "addlrconcmd" && name !== "dellrconcmd" && name !== "listlrconcmds") return false;
    if (name === "listlrconcmds") {
      print(this.limitedPrefixes.length === 0 ? "No lrconcmds registered.\n" : "id command\n-- -------\n"
        + this.limitedPrefixes.map((prefix, index) => `${String(index + 1).padEnd(2)} ${prefix}\n`).join(""));
      return true;
    }
    if (rawArgs === "") { print(`Usage: ${name} ${name === "addlrconcmd" ? "<command>" : "<id|cmd|all>"}\n`); return true; }
    const value = rawArgs.startsWith('"') && rawArgs.endsWith('"') && rawArgs.length >= 2 ? rawArgs.slice(1, -1) : rawArgs;
    if (name === "addlrconcmd") {
      if (this.limitedPrefixes.includes(value)) print(`Lrconcmd already exists: ${value}\n`);
      else this.limitedPrefixes.push(value);
      return true;
    }
    if (this.limitedPrefixes.length === 0) { print("No lrconcmds registered.\n"); return true; }
    if (value === "all") { this.limitedPrefixes.length = 0; return true; }
    const numbered = /^[0-9]+$/.test(value), index = numbered ? nativeAtoi(value) - 1 : this.limitedPrefixes.indexOf(value);
    if (index < 0 || index >= this.limitedPrefixes.length) print(numbered ? `No such lrconcmd index: ${nativeAtoi(value)}\n` : `No such lrconcmd string: ${value}\n`);
    else this.limitedPrefixes.splice(index, 1);
    return true;
  }
  private initializeRconRate(text: string, now: number, print: Print): void {
    const limit = rateUnsigned(text, 0); let cursor = limit.end, period = 1, multiplier = 1;
    if (text[cursor] === "/") {
      const parsed = rateUnsigned(text, cursor + 1); period = parsed.value || 1; cursor = parsed.end;
      const unit = text[cursor]?.toLowerCase();
      if (unit === "s" || unit === "m" || unit === "h") { multiplier = unit === "h" ? 3600 : unit === "m" ? 60 : 1; cursor++; }
    }
    if (limit.value === 0) { this.rconRateTime = 0; this.rconCredit = 0; this.rconCreditCap = 0; this.rconCost = 0; return; }
    if (period > 0xffffffff / (10000 * multiplier)) { print(`Period too large: ${period}\n`); return; }
    const rate = Math.trunc(10000 * period * multiplier / limit.value);
    if (rate === 0) { print(`Limit too large: ${limit.value}\n`); return; }
    const star = text.indexOf("*", cursor), burst = star < 0 ? 5 : rateUnsigned(text, star + 1).value;
    if (burst > 0xffffffff / rate) { print(`Burst too large: ${burst}\n`); return; }
    this.rconRateTime = now >>> 0; this.rconCredit = rateCredits(rate * burst);
    this.rconCreditCap = this.rconCredit; this.rconCost = rateCredits(rate);
  }
  rconRateAllowed(cvars: CvarRegistry, now: number, print: Print): boolean {
    const setting = cvars.find("sv_rcon_limit");
    if (setting === undefined) throw new Error("Register source administration cvars before accepting rcon");
    if (this.rconRateText !== setting.value || this.rconRateOwner === cvars && this.rconRateRevision !== setting.modificationCount)
      this.initializeRconRate(setting.value, now, print);
    this.rconRateOwner = cvars; this.rconRateRevision = setting.modificationCount; this.rconRateText = setting.value;
    const time = now >>> 0;
    this.rconCredit = (this.rconCredit + Math.imul((time - this.rconRateTime) >>> 0, 32)) >>> 0;
    this.rconRateTime = time;
    if (this.rconCredit > this.rconCreditCap) this.rconCredit = this.rconCreditCap;
    if (this.rconCredit < this.rconCost) return false;
    this.rconCredit -= this.rconCost; return true;
  }
  rechargeRconRate(): void { this.rconCredit = Math.min((this.rconCredit + this.rconCost) >>> 0, this.rconCreditCap); }
  masters(dialect: CommandDialect): readonly NetworkAddress[] {
    if (dialect === "q1-netquake") return [];
    if (dialect === "q2-classic" || dialect === "q2-rerelease") return [ipv4Address([192, 246, 40, 37], 27900), ...this.masterAddresses.get("q2") ?? []];
    return this.masterAddresses.get(dialect === "q3" ? "q3" : "qw") ?? [];
  }
  rejects(address: NetworkAddress, filterban: number): boolean {
    if (address.kind !== "ipv4") return false;
    const incoming = new DataView(Uint8Array.from(address.host).buffer).getUint32(0, true);
    const matches = this.filters.snapshot().some(filter => ((incoming & filter.mask) >>> 0) === filter.compare);
    return matches ? Math.trunc(filterban) !== 0 : filterban === 0;
  }
  async filterCommand(host: ServerOperatorHost, name: string, args: readonly string[]): Promise<boolean> {
    if (host.dialect === "q3") return false;
    if (name === "sv" && (host.dialect === "q2-classic" || host.dialect === "q2-rerelease")) {
      name = args[0] ?? ""; args = args.slice(1);
    }
    if (name !== "addip" && name !== "removeip" && name !== "listip" && name !== "writeip") return false;
    if (name === "listip") { host.print(`Filter list:\n${this.filters.snapshot().map(filterText).join("\n")}\n`); return true; }
    if (name === "writeip") {
      const prefix = host.dialect === "q2-classic" || host.dialect === "q2-rerelease" ? "sv " : "";
      await host.writeConfig("listip.cfg", `set filterban ${Math.trunc(host.cvars.variableValue("filterban"))}\n`
        + this.filters.snapshot().map(filter => `${prefix}addip ${filterText(filter)}\n`).join(""));
      host.print("Wrote listip.cfg\n"); return true;
    }
    const text = args[0];
    if (text === undefined) { host.print(`Usage: ${name} <ip-mask>\n`); return true; }
    const filter = sourceIpv4Filter(text);
    if (filter === null) { host.print(`Bad filter address: ${text}\n`); return true; }
    if (name === "removeip") { const removed = this.filters.remove(filter); if (removed) await this.saveFilters(); host.print(removed ? "Removed.\n" : "Didn't find.\n"); return true; }
    if (this.filters.snapshot().length >= 1024) { host.print("IP filter list is full\n"); return true; }
    this.filters.add(filter); await this.saveFilters(); return true;
  }
  async setMasters(host: ServerOperatorHost, names: readonly string[]): Promise<void> {
    if (this.closed) return;
    if (host.dialect !== "q1-quakeworld" && host.dialect !== "q2-classic" && host.dialect !== "q2-rerelease") throw new Error("This source uses master cvars instead of setmaster");
    if (host.dialect !== "q1-quakeworld" && !host.dedicated) { host.print("Only dedicated servers use masters.\n"); return; }
    const generation = ++this.generation, addresses: NetworkAddress[] = [];
    for (const name of names.slice(0, host.dialect === "q1-quakeworld" ? 8 : 7)) {
      if (host.dialect === "q1-quakeworld" && name === "none") break;
      try {
        const address = await resolveAddress(name, host.dialect === "q1-quakeworld" ? 27000 : 27900, 4);
        if (generation !== this.generation) return;
        addresses.push(address);
        host.print(`Master server at ${addressKey(address)}\nSending a ping.\n`);
        host.send(address, host.dialect === "q1-quakeworld" ? Uint8Array.of(107, 0) : q2OutOfBand("ping"));
      } catch (error) { if (generation !== this.generation) return; host.print(`Bad master address ${name}: ${error instanceof Error ? error.message : String(error)}\n`); }
    }
    if (generation !== this.generation) return;
    this.masterAddresses.set(host.dialect === "q1-quakeworld" ? "qw" : "q2", addresses); host.heartbeat();
  }
  refreshQ3Masters(cvars: CvarRegistry, print: Print): void {
    if (this.closed) return;
    if (this.masterFailure !== null) { const failure = this.masterFailure; this.masterFailure = null; throw failure.error; }
    const names = [1, 2, 3, 4, 5].map(index => cvars.variableString(`sv_master${index}`)).filter(name => name !== "");
    const key = names.join("\n"); if (key === this.masterNames) return;
    this.masterNames = key;
    const generation = ++this.generation;
    const resolve = async (): Promise<void> => {
      const addresses: NetworkAddress[] = [];
      for (const name of names) {
        try {
          const address = await resolveAddress(name, 27950, 4);
          if (generation !== this.generation) return;
          addresses.push(address);
        } catch (error) {
          if (generation !== this.generation) return;
          print(`Bad master address ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
      if (generation === this.generation) this.masterAddresses.set("q3", addresses);
    };
    void resolve().catch((error: unknown) => { if (generation === this.generation) this.masterFailure = { error }; });
  }
  close(): void { this.closed = true; this.generation++; this.masterFailure = null; }

}

export interface SourceAdministrationOptions {
  readonly dialect: CommandDialect;
  readonly state: ServerOperatorState;
  readonly cvars: CvarRegistry;
  readonly dedicated: boolean;
  readonly execute: ServerAdministration["execute"];
  readonly record: ServerAdministration["record"];
}

export function sourceAdministrationCommandNames(dialect: CommandDialect): readonly string[] {
  switch (dialect) {
    case "q1-netquake": return [];
    case "q1-quakeworld": return ["setmaster", "heartbeat", "addip", "removeip", "listip", "writeip"];
    case "q2-classic": case "q2-rerelease": return ["setmaster", "heartbeat", "sv", "addlrconcmd", "dellrconcmd", "listlrconcmds"];
    case "q3": return ["heartbeat", "addip", "removeip", "listip"];
  }
}

export function registerSourceAdministrationCvars(cvars: CvarRegistry): void {
  const q2 = cvars.dialect === "q2-classic" || cvars.dialect === "q2-rerelease";
  const register = (name: string, value: string, flags: number): void => {
    if (cvars.find(name) === undefined || cvars.isConsoleCreated(name)) cvars.register(name, value, flags);
    else cvars.addFlags(name, flags);
  };
  register(cvars.dialect === "q3" ? "rconPassword" : "rcon_password", "", q2 ? Q2CvarFlag.Private : cvars.dialect === "q3" ? CvarFlag.Temporary : 0);
  if (cvars.dialect !== "q3") register("filterban", "1", 0);
  if (q2) register("public", "0", Q2CvarFlag.Latch);
  if (q2) { register("lrcon_password", "", Q2CvarFlag.Private); register("sv_rcon_limit", "1", 0); }
  if (cvars.dialect === "q3") for (let index = 1; index <= 5; index++)
    register(`sv_master${index}`, index === 1 ? "master.quake3arena.com" : "", index === 1 ? 0 : CvarFlag.Archive);
}

export function sourceServerAdministration(options: SourceAdministrationOptions): ServerAdministration {
  const q2 = options.dialect === "q2-classic" || options.dialect === "q2-rerelease";
  const password = options.dialect === "q3" ? "rconPassword" : "rcon_password";
  registerSourceAdministrationCvars(options.cvars);
  return { rconPassword: () => options.cvars.variableString(password), execute: options.execute,
    // Q3 bans belong to game ClientConnect, not packet filtering of established clients or queries.
    rejects: address => options.dialect === "q3" ? false
      : options.state.rejects(address, options.cvars.variableValue("filterban")),
    masters: () => !options.dedicated || (q2 && options.cvars.variableValue("public") === 0)
      || (options.dialect === "q3" && options.cvars.variableValue("dedicated") !== 2) ? [] : options.state.masters(options.dialect), record: options.record };
}
