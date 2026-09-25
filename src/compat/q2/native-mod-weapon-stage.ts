import { captureAbiProcessorState, restoreAbiProcessorState } from "../../guest/abi/runner.ts";
import type { GuestAddress, NativeAbi } from "../../contracts/execution.ts";
import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { NativeItemField, NativeItemPointer, NativeItemTest, NativeWeaponStage } from "../../contracts/native-mod-items.ts";
import type { NativeModAddress, NativeModSourceCall } from "../../contracts/native-mod-callbacks.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { bindNativeModEntry } from "./native-mod-entries.ts";

export interface NativeWeaponOperations {
  actor(record: string, address: GuestAddress): ActorId | null;
  current(actor: ActorId): boolean;
  selected(actor: ActorId): boolean;
  committedInput?(actor: ActorId): boolean;
  pointer(actor: ActorId, field: NativeItemPointer): GuestAddress;
  resolve(address: NativeModAddress): GuestAddress;
  read(actor: ActorId, field: NativeItemField): number;
  write(actor: ActorId, field: NativeItemField, value: number): void;
  invoke(actor: ActorId, call: NativeModSourceCall): void;
  completed(actor: ActorId, reachedDecision: boolean): void;
  cancellation?(actor: ActorId): { accepts(error: unknown): boolean; sourceCurrent(): boolean };
}

/** The original dispatcher retains firing, latch, animation and callback timing. */
export class NativeWeaponDispatcher {
  private readonly removals: (() => void)[] = [];
  private readonly dispatchers: { readonly actor: ActorId; readonly committedInput: boolean; reachedDecision: boolean }[] = [];
  constructor(definition: Pick<NativeWeaponStage, "dispatcher" | "decisions">, abi: NativeAbi, host: Pick<NativeModHost, "memory" | "entries" | "invoke" | "imageBase" | "entry" | "bindInlineRegion">, provider: ProviderId,
    operations: Pick<NativeWeaponOperations, "actor" | "current" | "selected" | "read" | "write" | "completed" | "cancellation" | "committedInput">) {
    const dispatcher = definition.dispatcher, entry = dispatcher.entry.kind === "rva" ? host.memory.offset(host.imageBase, BigInt(dispatcher.entry.rva)) : host.entry(dispatcher.entry.name);
    try {
      const binding = bindNativeModEntry(host, entry, `${provider}:weapon-dispatcher`, { abi, parameters: Array.from({ length: dispatcher.arguments }, () => ({ kind: "scalar", storage: "pointer" })), result: "void", variadic: false }, (values, original) => {
        const argument = values[dispatcher.argument];
        if (argument?.kind !== "pointer" || argument.value === null) return original(values);
        const actor = operations.actor(dispatcher.record, argument.value);
        if (actor === null) return original(values);
        const frame = { actor, committedInput: operations.committedInput?.(actor) === true, reachedDecision: false }, cancellation = operations.cancellation?.(actor), processor = cancellation === undefined ? null : captureAbiProcessorState(host.entries.cpu.state); this.dispatchers.push(frame);
        try { const result = original(values); if (operations.current(actor)) operations.completed(actor, frame.reachedDecision); return result; }
        catch (error) {
          if (cancellation === undefined || processor === null || !cancellation.accepts(error) || !cancellation.sourceCurrent()) throw error;
          restoreAbiProcessorState(host.entries.cpu.state, processor); return { kind: "void" };
        } finally { this.dispatchers.pop(); }
      });
      this.removals.push(() => binding.close());
      for (const region of definition.decisions) this.removals.push(host.bindInlineRegion(host.memory.offset(host.imageBase, BigInt(region.entry)), host.memory.offset(host.imageBase, BigInt(region.join)), continuation => {
        const frame = this.dispatchers.at(-1), actor = frame?.actor;
        if (frame !== undefined) frame.reachedDecision = true;
        if (actor === undefined || frame?.committedInput === true || operations.selected(actor)) return continuation.execute();
        if (!operations.current(actor)) throw new Error("Native weapon input outlived its source actor");
        const projected = region.fields.map(value => ({ ...value, original: operations.read(actor, value.field) }));
        try {
          for (const value of projected) operations.write(actor, value.field, value.original & ~value.clearMask);
          return continuation.execute();
        } finally {
          // Regions contain source reads, never source writes; preserve unrelated bits defensively.
          for (const value of projected) operations.write(actor, value.field, (operations.read(actor, value.field) & ~value.clearMask) | (value.original & value.clearMask));
        }
      }));
    } catch (error) { this.close(); throw error; }
  }
  currentActor(): ActorId | null { return this.dispatchers.at(-1)?.actor ?? null; }
  close(): void { for (const remove of this.removals.splice(0).reverse()) remove(); this.dispatchers.length = 0; }
}

export class NativeModWeaponStage {
  private readonly dispatcher: NativeWeaponDispatcher;
  constructor(private readonly definition: NativeWeaponStage, abi: NativeAbi,
    private readonly host: Pick<NativeModHost, "memory" | "entries" | "invoke" | "imageBase" | "entry" | "bindInlineRegion">,
    provider: ProviderId, private readonly operations: NativeWeaponOperations) {
    this.dispatcher = new NativeWeaponDispatcher(definition, abi, host, provider, { ...operations,
      committedInput: actor => this.operations.current(actor) && (definition.committedInput?.some(tests => tests.every(test => this.matches(actor, test))) ?? false) });
  }
  private matches(actor: ActorId, test: NativeItemTest): boolean {
    if (test.kind === "pointer") {
      const current = this.host.memory.readPointer(this.operations.pointer(actor, test.field));
      return current?.byteOffset === (test.value === null ? undefined : this.operations.resolve(test.value).byteOffset);
    }
    const raw = this.operations.read(actor, test.field), value = test.mask === null ? raw : raw & test.mask;
    return test.comparison === "equals" ? value === test.value : value <= test.value;
  }
  continuing(actor: ActorId): boolean { return this.operations.current(actor) && this.definition.continuations.some(tests => tests.every(test => this.matches(actor, test))); }
  settled(actor: ActorId): boolean { return this.operations.current(actor) && this.definition.settled.some(tests => tests.every(test => this.matches(actor, test))); }
  private selected(actor: ActorId, field: NativeItemPointer): ItemId | null {
    const pointer = this.host.memory.readPointer(this.operations.pointer(actor, field));
    if (pointer === null) return null;
    const item = this.definition.selection.values.find(value => this.operations.resolve(value.address).byteOffset === pointer.byteOffset);
    if (item === undefined) throw new Error("Original native selected an undeclared source weapon");
    return item.item;
  }
  active(actor: ActorId): ItemId | null { return this.selected(actor, this.definition.selection.active); }
  pending(actor: ActorId): ItemId | null { return this.definition.selection.pending === null ? null : this.selected(actor, this.definition.selection.pending); }
  request(actor: ActorId, item: ItemId): boolean {
    const value = this.definition.selection.values.find(value => value.item === item);
    if (value === undefined || !this.operations.current(actor)) return false;
    this.operations.invoke(actor, value.request);
    return this.operations.current(actor) && (this.active(actor) === item || this.pending(actor) === item);
  }
  close(): void { this.dispatcher.close(); }
}
