import type { QvmModule, QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { QvmMemory } from "./memory.ts";
import type { QvmHostCall } from "./syscalls.ts";
import { QVM_REF_ENTITY_BYTES, readQvmRefEntity } from "./render-record.ts";
import { QvmCgameImport } from "./abi.ts";
import { qualifyQvmBodyCalls } from "./body-scope.ts";
import type { QvmBodyPart, QvmScenePresentation } from "../../contracts/qvm-mod-presentation.ts";
import type { SourceRefEntityRecord } from "../../content/q3/presentation/ref-entity.ts";

export interface QvmBodySubmission {
  readonly entry: number;
  readonly actorArgument: number;
  readonly entityNumberOffset: number;
  readonly reference: { readonly kind: "locals" } | { readonly kind: "argument"; readonly index: number };
  readonly when?: { readonly argument: number; readonly equals: number };
  readonly mesh?: QvmScenePresentation["body"]["mesh"];
}

export interface QvmBodyCapture {
  selected(entity: number): boolean;
  submit(entity: number, part: QvmBodyPart, source: Extract<SourceRefEntityRecord, { readonly kind: "model" }>, base: boolean): boolean;
}
interface BodyRange {
  readonly start: number; readonly end: number; readonly entity: number; readonly state: number; readonly hidden: boolean;
  readonly declaration: QvmBodySubmission; readonly calls: ReadonlyMap<number, QvmBodyPart>;
}

/** The authored body refEntity lives in its function frame; nested effects retain their own storage. */
export class QvmBodySubmissions {
  private readonly ranges: BodyRange[] = [];
  private readonly meshes: { readonly range: BodyRange; readonly pointer: number; readonly part: QvmBodyPart; readonly shader: number }[] = [];
  private removals: (() => void)[] = [];
  private readonly calls = new Map<number, ReadonlyMap<number, QvmBodyPart>>();
  constructor(private readonly module: QvmModule, private readonly artifact: QvmModuleOptions["artifact"], private readonly declarations: readonly QvmBodySubmission[],
    private readonly hidden: (entity: number) => boolean, private readonly capture?: QvmBodyCapture) {
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
      this.calls.set(declaration.entry, declaration.mesh === undefined ? new Map<number, QvmBodyPart>() : qualifyQvmBodyCalls(artifact.image, { player: { entry: declaration.entry, centityArgument: declaration.actorArgument }, mesh: declaration.mesh }));
    }
  }
  get capturesPlayerMeshes(): boolean { return this.declarations.some(declaration => declaration.mesh !== undefined); }
  enable(active: boolean): void {
    if (this.ranges.length !== 0) throw new Error("Cannot change body submissions during source rendering");
    if (!active) { for (const remove of this.removals.splice(0)) remove(); return; }
    if (this.removals.length !== 0) return;
    const artifact = this.artifact;
    if (artifact.kind !== "bytecode") throw new Error("Cgame source artifact changed");
    try {
      const meshEntries = new Set<number>();
      for (const declaration of this.declarations) {
        const instruction = artifact.image.instructions[declaration.entry];
        if (instruction?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Cgame body entry changed");
        const frameBytes = instruction.operand;
        const calls = this.calls.get(declaration.entry);
        if (calls === undefined) throw new Error("Cgame body declaration lost its qualified calls");
        this.removals.push(this.module.bindFunction({ kind: "qvm", module: this.module.profile.module, instructionIndex: declaration.entry }, async call => {
          if (declaration.when !== undefined && call.words.getInt32(declaration.when.argument * 4, true) !== declaration.when.equals) return call.proceedAsync();
          const memory = new QvmMemory(call.memory), entity = memory.view(call.words.getInt32(declaration.actorArgument * 4, true), 4, declaration.entityNumberOffset).getInt32(0, true);
          const hidden = this.hidden(entity), selected = this.capture?.selected(entity) === true;
          if (!hidden && !selected) return call.proceedAsync();
          if (selected && declaration.mesh === undefined && !hidden) return call.proceedAsync();
          const callerStack = call.words.byteOffset - call.memory.byteOffset - 8;
          const start = declaration.reference.kind === "locals" ? callerStack - frameBytes
            : memory.span(call.words.getInt32(declaration.reference.index * 4, true), QVM_REF_ENTITY_BYTES).byteOffset - call.memory.byteOffset;
          const range: BodyRange = { start, end: declaration.reference.kind === "locals" ? callerStack : start + QVM_REF_ENTITY_BYTES,
            entity, state: call.words.getInt32(declaration.actorArgument * 4, true) + declaration.entityNumberOffset, hidden, declaration,
            calls };
          this.ranges.push(range);
          try { return await call.proceedAsync(); }
          finally { if (this.ranges.pop() !== range) throw new Error("Cgame body submission scopes unwound out of order"); }
        }));
        const mesh = declaration.mesh;
        if (mesh !== undefined && !meshEntries.has(mesh.entry)) {
          meshEntries.add(mesh.entry);
          this.removals.push(this.module.bindFunction({ kind: "qvm", module: this.module.profile.module, instructionIndex: mesh.entry }, async call => {
            const range = this.ranges.at(-1), part = call.callerInstruction === null ? undefined : range?.calls.get(call.callerInstruction);
            if (range === undefined || part === undefined || range.declaration.mesh?.entry !== mesh.entry
              || call.words.getInt32(mesh.stateArgument * 4, true) !== range.state) return call.proceedAsync();
            const pointer = call.words.getInt32(mesh.entityArgument * 4, true);
            const active = { range, pointer, part, shader: call.guest.view(pointer + mesh.shaderOffset, 4).getInt32(0, true) };
            this.meshes.push(active);
            try { return await call.proceedAsync(); }
            finally { if (this.meshes.pop() !== active) throw new Error("Cgame body mesh scopes unwound out of order"); }
          }));
        }
      }
    } catch (error) { for (const remove of this.removals.splice(0)) remove(); throw error; }
  }
  suppress(call: QvmHostCall): boolean {
    if (this.ranges.length === 0 || call.kind !== "engine" || call.role !== "cgame" || call.code !== QvmCgameImport.CG_R_ADDREFENTITYTOSCENE) return false;
    const bytes = call.guest.span(call.words.getInt32(4, true), QVM_REF_ENTITY_BYTES), start = bytes.byteOffset - call.guest.bytes.byteOffset;
    let range: BodyRange | undefined;
    for (let index = this.ranges.length - 1; index >= 0; index--) {
      const candidate = this.ranges[index];
      if (candidate !== undefined && start >= candidate.start && start + QVM_REF_ENTITY_BYTES <= candidate.end) { range = candidate; break; }
    }
    if (range === undefined) return false;
    const part = this.meshes.at(-1);
    if (!range.hidden && part?.range === range && part.pointer === call.words.getInt32(4, true) && this.capture?.selected(range.entity) === true) {
      const source = readQvmRefEntity(call.guest.view(call.words.getInt32(4, true), QVM_REF_ENTITY_BYTES));
      if (source.kind === "model" && this.capture.submit(range.entity, part.part, source, source.customShader === part.shader)) return true;
    }
    return range.hidden;
  }
  close(): void { this.enable(false); }
}
