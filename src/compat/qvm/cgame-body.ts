import type { QvmModule, QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { QvmMemory } from "./memory.ts";
import type { QvmHostCall } from "./syscalls.ts";
import { QVM_REF_ENTITY_BYTES } from "./render-record.ts";
import { QvmCgameImport } from "./abi.ts";

export interface QvmBodySubmission {
  readonly entry: number;
  readonly actorArgument: number;
  readonly entityNumberOffset: number;
  readonly reference: { readonly kind: "locals" } | { readonly kind: "argument"; readonly index: number };
  readonly when?: { readonly argument: number; readonly equals: number };
}

interface BodyRange { readonly start: number; readonly end: number; }

/** The authored body refEntity lives in its function frame; nested effects retain their own storage. */
export class QvmBodySubmissions {
  private readonly ranges: BodyRange[] = [];
  private removals: (() => void)[] = [];
  constructor(private readonly module: QvmModule, private readonly artifact: QvmModuleOptions["artifact"], private readonly declarations: readonly QvmBodySubmission[],
    private readonly hidden: (entity: number) => boolean) {
    if (artifact.kind !== "bytecode" || artifact.role !== "cgame") throw new Error("Body submissions require authored cgame bytecode");
    const seen = new Set<number>();
    for (const declaration of declarations) {
      const instruction = artifact.image.instructions[declaration.entry];
      if (instruction?.opcode !== QvmOpcode.OP_ENTER || instruction.operand < 8 || seen.has(declaration.entry))
        throw new Error("Cgame body declaration requires a unique source function entry");
      seen.add(declaration.entry);
      for (const argument of [declaration.actorArgument, ...(declaration.when === undefined ? [] : [declaration.when.argument]),
        ...(declaration.reference.kind === "argument" ? [declaration.reference.index] : [])])
        if (!Number.isInteger(argument) || argument < 0 || argument >= 10) throw new Error("Cgame body argument is outside the source ABI");
      if (!Number.isSafeInteger(declaration.entityNumberOffset) || declaration.entityNumberOffset < 0 || declaration.entityNumberOffset % 4 !== 0)
        throw new Error("Cgame body entity number requires an aligned field offset");
    }
  }
  enable(active: boolean): void {
    if (this.ranges.length !== 0) throw new Error("Cannot change body submissions during source rendering");
    if (!active) { for (const remove of this.removals.splice(0)) remove(); return; }
    if (this.removals.length !== 0) return;
    const artifact = this.artifact;
    if (artifact.kind !== "bytecode") throw new Error("Cgame source artifact changed");
    try {
      for (const declaration of this.declarations) {
        const instruction = artifact.image.instructions[declaration.entry];
        if (instruction?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Cgame body entry changed");
        const frameBytes = instruction.operand;
        this.removals.push(this.module.bindFunction({ kind: "qvm", module: this.module.profile.module, instructionIndex: declaration.entry }, async call => {
          if (declaration.when !== undefined && call.words.getInt32(declaration.when.argument * 4, true) !== declaration.when.equals) return call.proceedAsync();
          const memory = new QvmMemory(call.memory), entity = memory.view(call.words.getInt32(declaration.actorArgument * 4, true), 4, declaration.entityNumberOffset).getInt32(0, true);
          if (!this.hidden(entity)) return call.proceedAsync();
          const callerStack = call.words.byteOffset - call.memory.byteOffset - 8;
          const start = declaration.reference.kind === "locals" ? callerStack - frameBytes
            : memory.span(call.words.getInt32(declaration.reference.index * 4, true), QVM_REF_ENTITY_BYTES).byteOffset - call.memory.byteOffset;
          const range = { start, end: declaration.reference.kind === "locals" ? callerStack : start + QVM_REF_ENTITY_BYTES };
          this.ranges.push(range);
          try { return await call.proceedAsync(); }
          finally { if (this.ranges.pop() !== range) throw new Error("Cgame body submission scopes unwound out of order"); }
        }));
      }
    } catch (error) { for (const remove of this.removals.splice(0)) remove(); throw error; }
  }
  suppress(call: QvmHostCall): boolean {
    if (this.ranges.length === 0 || call.kind !== "engine" || call.role !== "cgame" || call.code !== QvmCgameImport.CG_R_ADDREFENTITYTOSCENE) return false;
    const bytes = call.guest.span(call.words.getInt32(4, true), QVM_REF_ENTITY_BYTES), start = bytes.byteOffset - call.guest.bytes.byteOffset;
    return this.ranges.some(range => start >= range.start && start + QVM_REF_ENTITY_BYTES <= range.end);
  }
  close(): void { this.enable(false); }
}
