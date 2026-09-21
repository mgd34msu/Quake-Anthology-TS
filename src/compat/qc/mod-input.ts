import type { ModActorField, ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { ModClientApplication } from "../../world/session/mod-clients.ts";
import { modClientInputValues } from "../../world/session/mod-client-input-values.ts";
import type { QcMachine } from "./machine.ts";

export interface QcModInputField {
  readonly offset: number;
  readonly words: 1 | 3;
  readonly declaration: Extract<ModActorField, { readonly binding: "client-input" }>;
}
interface Frame {
  readonly application: ModClientApplication;
  readonly values: ReadonlyMap<ModCallbackInput, ModRuntimeValue>;
}

export class QcModInput {
  private readonly frames: Frame[] = [];
  constructor(private readonly machine: QcMachine, private readonly fields: readonly QcModInputField[],
    private readonly reference: (actor: ActorId) => number) {}

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
          if (field.declaration.update === "always" || value.value !== 0) words.setFloat(field.offset, value.value);
        } else throw new Error("Missing validated QuakeC client input");
      }
    } catch (error) { for (const field of saved) words.bytes.set(field.bytes, field.offset); throw error; }
    const frame: Frame = { application, values }; this.frames.push(frame);
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
    return frame.values;
  }
  get active(): boolean { return this.frames.length !== 0; }
}
