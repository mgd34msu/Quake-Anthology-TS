import { CvarFlag, Q2CvarFlag, type CvarRegistry, type CvarSnapshot } from "../../../core/cvars/index.ts";
import { setInfoValue } from "../../../core/cvars/info.ts";
import type { QvmCvarServices } from "../../../compat/qvm/cvar-syscalls.ts";

export class Q3ClientCvars implements QvmCvarServices {
  private readonly handles: { readonly owner: CvarRegistry; readonly name: string; previousOwner: CvarRegistry; previous: CvarSnapshot | undefined; revision: number }[] = [];
  constructor(private readonly options: {
    owner(name: string): CvarRegistry;
    visible(): readonly CvarRegistry[];
    current(owner: CvarRegistry): CvarRegistry;
    print(text: string): void;
  }) {}
  get: QvmCvarServices["get"] = name => this.options.owner(name).get(name);
  set: QvmCvarServices["set"] = (name, value, force) => this.options.owner(name).set(name, value, force);
  setValue: QvmCvarServices["setValue"] = (name, value) => this.options.owner(name).setValue(name, value);
  reset: QvmCvarServices["reset"] = (name, force) => this.options.owner(name).reset(name, force);
  register: QvmCvarServices["register"] = (name, value, flags) => {
    const owner = this.options.owner(name);
    if (owner.dialect !== "q3") {
      if (owner.canonicalName(name) !== name && ((flags ?? 0) & (CvarFlag.UserInfo | CvarFlag.ServerInfo | CvarFlag.SystemInfo)) !== 0)
        throw new Error(`Cvar alias ${name} requires an explicit protocol info-key mapping`);
      const existing = owner.get(name);
      if (existing === undefined) throw new Error("Unknown guest cvars require a Q3 seat owner");
      return existing;
    }
    return owner.register(name, value, flags);
  };
  bindVm: QvmCvarServices["bindVm"] = (name, value, flags) => {
    const owner = this.options.owner(name);
    const registered = this.register(name, value, flags);
    if (registered === undefined) throw new Error("VM cvar registration failed");
    const previous = this.handles.findIndex(entry => this.options.current(entry.owner) === owner && entry.name === registered.name);
    if (previous >= 0) return previous;
    if (this.handles.length === 1024) throw new RangeError("MAX_CVARS");
    this.handles.push({ owner, name: registered.name, previousOwner: owner, previous: undefined, revision: 0 });
    return this.handles.length - 1;
  };
  readVm: QvmCvarServices["readVm"] = handle => {
    if (!Number.isInteger(handle) || handle < 0 || handle >= this.handles.length) throw new RangeError("Cvar_Update: handle out of range");
    const entry = this.handles[handle];
    if (entry === undefined) return undefined;
    const owner = this.options.current(entry.owner), value = owner.get(entry.name);
    if (value === undefined) return undefined;
    const previous = entry.previous;
    if (owner !== entry.previousOwner || previous === undefined || value.value !== previous.value || value.numericValue !== previous.numericValue
      || value.integerValue !== previous.integerValue || value.modificationCount !== previous.modificationCount) entry.revision++;
    entry.previousOwner = owner; entry.previous = value;
    return { ...value, modificationCount: entry.revision };
  };
  infoString: QvmCvarServices["infoString"] = (flags, maximumLength = 1024) => {
    let result = "";
    for (const owner of this.options.visible()) for (const value of owner.canonicalSnapshots()) {
      const projectedFlags = owner.dialect === "q3" ? value.flags : value.flags & (CvarFlag.UserInfo | CvarFlag.ServerInfo);
      if (this.options.owner(value.name) !== owner || (projectedFlags & flags) === 0
        || owner.dialect.startsWith("q2") && (value.flags & Q2CvarFlag.Private) !== 0) continue;
      result = setInfoValue(result, value.name, value.value, { dialect: "q3", maximumLength,
        target: (flags & CvarFlag.UserInfo) !== 0 ? "client-userinfo" : "server-info", serverHighCharacters: false, print: this.options.print });
    }
    return result;
  };
}
