import type { ModActorField, ModCallbackInput, ModRuntimeValue, ModQcInputOutput, ModClientInputOutput } from "../../contracts/mod-callbacks.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import { modClientInputValues } from "../../world/session/mod-client-input-values.ts";
import type { QcMachine, QcCallSite } from "./machine.ts";
import { isDeepStrictEqual } from "node:util";

export interface QcModInputField {
  readonly offset: number;
  readonly words: 1 | 3;
  readonly declaration: Extract<ModActorField, { readonly binding: "client-input" }>;
}
interface Frame {
  readonly application: ModClientApplication;
}

export class QcModInput {
  private readonly frames: Frame[] = [];
  private readonly captures: { readonly application: ModClientApplication; readonly reference: number;
    readonly handlers: ReadonlyMap<number, Extract<ModQcInputOutput, { kind: "handler" }>>; readonly entered: Set<number> }[] = [];
  constructor(private readonly machine: QcMachine, private readonly fields: readonly QcModInputField[],
    private readonly reference: (actor: ActorId) => number, private readonly live: (actor: ActorId) => boolean) {}

  open(application: ModClientApplication): () => void {
    const actor = application.identity.actor, values = modClientInputValues(application);
    const words = this.machine.entities.fromReference(this.reference(actor));
    const nested = this.frames.some(frame => frame.application.identity.actor.equals(actor));
    const saved = this.fields.map(field => ({ offset: field.offset * 4,
      bytes: words.bytes.slice(field.offset * 4, (field.offset + field.words) * 4) }));
    try {
      for (const field of this.fields) {
        const value = values.get(field.declaration.input);
        if (value?.kind === "vector") words.setVector(field.offset, value.value);
        else if (value?.kind === "float") {
          if (field.declaration.update === "always" || value.value !== 0) {
            const scalar = value.value * (field.declaration.scale ?? 1);
            if (!Number.isFinite(Math.fround(scalar))) throw new RangeError("Source input exceeds the QC scalar ABI");
            words.setFloat(field.offset, scalar);
          }
        } else throw new Error("Missing validated QuakeC client input");
      }
    } catch (error) { for (const field of saved) words.bytes.set(field.bytes, field.offset); throw error; }
    const frame: Frame = { application }; this.frames.push(frame);
    return () => {
      const index = this.frames.indexOf(frame);
      if (index < 0) return;
      this.frames.splice(index, 1);
      if (nested && this.frames.some(parent => parent.application.identity.actor.equals(actor)))
        for (const field of saved) words.bytes.set(field.bytes, field.offset);
    };
  }

  values(application: ModClientApplication): ReadonlyMap<ModCallbackInput, ModRuntimeValue> {
    const frame = this.frames.at(-1);
    if (frame === undefined || frame.application !== application) throw new Error("QuakeC client input scope is not active");
    return modClientInputValues(application);
  }
  observeCall(call: QcCallSite): undefined {
    const capture = this.captures.at(-1);
    if (capture !== undefined && this.frames.at(-1)?.application === capture.application
      && this.machine.globals.int(this.machine.globalOffset("self")) === capture.reference && capture.handlers.has(call.functionIndex)) capture.entered.add(call.functionIndex);
    return undefined;
  }
  output(outputs: readonly ModQcInputOutput[], application: ModClientApplication, run: () => void): readonly ModClientInputOutput[] {
    const reference = this.reference(application.identity.actor), words = this.machine.entities.fromReference(reference);
    const handlers = new Map<number, Extract<ModQcInputOutput, { kind: "handler" }>>();
    const fields = outputs.flatMap(output => {
      if (output.kind === "handler") { handlers.set(this.machine.program.functionNamed(output.function).index, output); return []; }
      const field = this.fields.find(field => field.declaration.field === output.field);
      if (field === undefined) throw new Error("QC output lacks its declared input field");
      return [{ field, before: field.words === 3 ? words.vector(field.offset) : words.float(field.offset) }];
    });
    const capture = { application, reference, handlers, entered: new Set<number>() };
    this.captures.push(capture);
    try {
      run();
      if (!this.live(application.identity.actor) || !this.frames.some(frame => frame.application === application)) return [];
      const result: ModClientInputOutput[] = [];
      for (const { field, before } of fields) {
        const input = field.declaration.input;
        if (input === "view-angles") {
          const value = words.vector(field.offset); if (!isDeepStrictEqual(before, value)) result.push({ kind: "set", input, value });
        } else {
          const after = words.float(field.offset); if (before !== after) result.push({ kind: "set", input, value: after / (field.declaration.scale ?? 1) });
        }
      }
      for (const index of capture.entered) { const handler = handlers.get(index); if (handler !== undefined) result.push({ kind: "consume", inputs: handler.inputs }); }
      return result;
    } finally { this.captures.pop(); }
  }
  get active(): boolean { return this.frames.length !== 0; }
}
