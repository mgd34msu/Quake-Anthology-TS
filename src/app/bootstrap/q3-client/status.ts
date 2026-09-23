import type { CvarSnapshot } from "../../../core/cvars/index.ts";
import type { QvmCvarServices } from "../../../compat/qvm/cvar-syscalls.ts";
import { qvmCvarSyscall } from "../../../compat/qvm/cvar-syscalls.ts";
import type { QvmMemory } from "../../../compat/qvm/memory.ts";

/** Cgame sees its effective status permission; archived engine cvars remain untouched. */
export function effectiveStatusCvar(value: CvarSnapshot, visible: boolean): CvarSnapshot {
  return value.name.toLowerCase() !== "cg_drawstatus" || visible ? value : { ...value, value: "0", numericValue: 0, integerValue: 0 };
}

export function cgameStatusCvars(source: QvmCvarServices, visible: () => boolean): QvmCvarServices {
  let previous: { readonly source: CvarSnapshot; readonly visible: boolean } | null = null, revision = 0;
  const read = (value: CvarSnapshot | undefined): CvarSnapshot | undefined => {
    if (value === undefined || value.name.toLowerCase() !== "cg_drawstatus") return value;
    const permission = visible();
    if (previous === null || previous.source.modificationCount !== value.modificationCount || previous.visible !== permission
      || previous.source.value !== value.value || previous.source.numericValue !== value.numericValue || previous.source.integerValue !== value.integerValue) {
      if (revision === 0x7fffffff) throw new Error("Cgame status cvar version exhausted");
      revision++; previous = { source: value, visible: permission };
    }
    return { ...effectiveStatusCvar(value, permission), modificationCount: revision };
  };
  return { bindVm: (...args) => source.bindVm(...args), readVm: handle => read(source.readVm(handle)), get: name => read(source.get(name)),
    set: (...args) => source.set(...args), setValue: (...args) => source.setValue(...args), reset: (...args) => source.reset(...args),
    register: (...args) => source.register(...args), infoString: (...args) => source.infoString(...args) };
}

/** Tracks only original vmCvar registrations so a frame-scoped mask can release its guest cache. */
export class CgameStatusView {
  readonly cvars: QvmCvarServices;
  private readonly records = new Map<number, { readonly memory: QvmMemory; readonly handle: number }>();
  constructor(source: QvmCvarServices, visible: () => boolean) { this.cvars = cgameStatusCvars(source, visible); }
  syscall(words: DataView, memory: QvmMemory): number | null {
    const result = qvmCvarSyscall("cgame", words, memory, this.cvars), trap = words.getInt32(0, true);
    if (result !== null && (trap === 3 || trap === 4)) {
      const pointer = words.getInt32(4, true);
      if (memory.pointer(pointer) !== null) {
        const handle = memory.view(pointer, 272).getInt32(0, true);
        if (this.cvars.readVm(handle)?.name.toLowerCase() === "cg_drawstatus") this.records.set(pointer, { memory, handle });
        else this.records.delete(pointer);
      }
    }
    return result;
  }
  refresh(): void {
    const words = new DataView(new ArrayBuffer(8)); words.setInt32(0, 4, true);
    for (const [pointer, record] of this.records) {
      if (record.memory.view(pointer, 272).getInt32(0, true) !== record.handle) { this.records.delete(pointer); continue; }
      words.setInt32(4, pointer, true);
      qvmCvarSyscall("cgame", words, record.memory, this.cvars);
    }
  }
}
