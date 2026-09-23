import type { OwnedActor } from "../../../contracts/identity.ts";
import type { OriginalPickupAdmission, OriginalPickupOffer, SourcePickupSelection, SourcePickupLifetime, PickupCargoEntry } from "../../../contracts/original-pickups.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { PickupSupplyOffer } from "../../../contracts/pickups.ts";
import type { QcEntityStoreObservation, QcFunctionBoundary, QcFunctionExecution, QcInlineBoundary, QcMachine, QcInlineRegion } from "../../../compat/qc/machine.ts";
import { QcProgramError } from "../../../compat/qc/program.ts";
import type { QcWorldHostOptions } from "../../../compat/qc/world-host.ts";
import { qcPickupStages, type QcPickupStage, type QcPickupDescriptor } from "./pickup-stage.ts";

interface SourceActor { readonly actor: OwnedActor; readonly slot: number; }
export interface QcPickupPolicy {
  current(actor: OwnedActor): ItemId | null;
  select(actor: OwnedActor, item: ItemId): undefined;
  counter(actor: OwnedActor, item: ItemId, original: (count: number) => number | null): undefined;
}
interface PickupCall {
  readonly stage: QcPickupStage;
  readonly descriptor: QcPickupDescriptor;
  readonly pickup: SourceActor;
  readonly recipient: SourceActor;
  readonly selection: SourcePickupSelection;
  readonly execute: QcFunctionExecution;
  readonly lifetime: SourcePickupLifetime;
  readonly newWeapon: boolean;
  readonly sourceEffect: boolean;
  accepted: boolean;
  consuming: boolean;
  consumed: boolean;
}

/** Holds the selected resource owner through the complete original touch and target continuation. */
export class Id1PickupBinding {
  private readonly stages: readonly QcPickupStage[];
  private readonly active: (PickupCall | null)[] = [];
  private projection: { readonly region: QcInlineRegion; readonly reference: number; readonly word: number; value: number | null } | null = null;
  constructor(private readonly source: Pick<QcWorldHostOptions, "program" | "entities" | "actors" | "slots">,
    private readonly admission: OriginalPickupAdmission, private readonly machine: () => QcMachine,
    private readonly primaryWeaponSelected: (actor: OwnedActor) => boolean = () => true,
    private readonly ownsWeapon?: (actor: OwnedActor, item: ItemId) => boolean, private readonly policy?: () => QcPickupPolicy | null) {
    this.stages = qcPickupStages(source.program);
  }
  assertIdle(): void { if (this.active.length !== 0) throw new QcProgramError("Cannot save during an original pickup caller"); }
  observeStore(store: QcEntityStoreObservation): undefined {
    const projected = this.projection;
    if (projected === null) return undefined;
    if (store.reference !== projected.reference || store.word !== projected.word || store.after.byteLength !== 4
      || store.functionIndex !== projected.region.functionIndex || store.statement < projected.region.entry || store.statement >= projected.region.exit)
      throw new QcProgramError("Original pickup counter region wrote outside its qualified field");
    if (projected.value !== null) throw new QcProgramError("Original pickup counter region stored more than once");
    projected.value = new DataView(store.after.buffer, store.after.byteOffset, 4).getFloat32(0, true);
    return undefined;
  }
  selectionDeferred(offer: OriginalPickupOffer): boolean {
    const frame = this.active.at(-1);
    if (frame == null || !frame.pickup.actor.id.equals(offer.pickup) || !frame.recipient.actor.id.equals(offer.recipient))
      throw new QcProgramError("Pickup selection requires its held source caller");
    this.validate();
    return frame.stage.sourceSelection !== undefined;
  }
  supply(offer: OriginalPickupOffer): { readonly offer: PickupSupplyOffer; readonly leave: boolean } {
    const frame = this.active.at(-1);
    if (frame == null || !frame.pickup.actor.id.equals(offer.pickup) || !frame.recipient.actor.id.equals(offer.recipient)
      || frame.descriptor.item !== offer.item || frame.descriptor.supply === undefined) throw new QcProgramError("Selected supply requires its current original pickup caller");
    this.validate();
    const vm = this.vm(), supply = frame.descriptor.supply;
    const amount = supply.quantity.kind === "field" ? this.source.entities.at(frame.pickup.slot).float(vm.fieldOffset(supply.quantity.name)) : vm.globals.float(supply.quantity.word);
    return { offer: supply.leave === undefined ? { kind: "ammo", offer: { item: supply.item, amount } }
      : { kind: "weapon", offer: { item: frame.descriptor.item, ammo: [{ item: supply.item, amount }] } },
      leave: supply.leave !== undefined && vm.globals.float(supply.leave) !== 0 };
  }
  private vm(): QcMachine {
    const vm = this.machine();
    if (vm.program !== this.source.program || vm.entities !== this.source.entities) throw new QcProgramError("Original pickups belong to another machine");
    return vm;
  }
  private actor(reference: number): SourceActor | null {
    const slot = this.source.entities.slot(reference), actor = this.source.slots.at(slot);
    return actor === null || this.source.slots.options.storage.read(slot).free ? null : { actor, slot };
  }
  private live(value: SourceActor): boolean {
    return this.source.actors.resolveOwned(value.actor.id) === value.actor && this.source.slots.at(value.slot) === value.actor
      && !this.source.slots.options.storage.read(value.slot).free;
  }
  /** Called before source calls and entity accesses, including those made by target functions. */
  validate(): undefined {
    for (const frame of this.active) {
      if (frame === null) continue;
      if ((!frame.consuming && !frame.consumed && !this.live(frame.pickup)) || !this.live(frame.recipient)
        || !frame.consuming && frame.selection.kind === "replacement" && !frame.selection.current())
        frame.execute.cancel([0, 0, 0]);
    }
    return undefined;
  }
  composeFunctions(inner: QcFunctionBoundary): QcFunctionBoundary {
    if (this.stages.some(stage => inner.functions.has(stage.functionIndex))) throw new QcProgramError("Original pickup caller already has a function boundary");
    const selectionFunctions = this.stages.flatMap(stage => stage.sourceSelection === undefined ? [] : [stage.sourceSelection.functionIndex]);
    return { functions: new Set([...inner.functions, ...this.stages.map(stage => stage.functionIndex), ...selectionFunctions]), run: (call, execute) => {
      if (selectionFunctions.includes(call.functionIndex)) {
        const frame = this.active.at(-1), source = frame?.stage.sourceSelection;
        if (frame != null && source?.functionIndex === call.functionIndex && call.caller === frame.stage.functionIndex
          && source.calls.includes(call.statement) && frame.selection.kind !== "original" && !this.primaryWeaponSelected(frame.recipient.actor)) {
          this.validate();
          const vm = this.vm(), item = source.weapons.find(weapon => vm.globals.float(weapon.word) === vm.argFloat(1))?.item;
          if (!frame.accepted || vm.globals.int(vm.globalOffset("self")) !== this.source.entities.reference(frame.recipient.slot))
            throw new QcProgramError("Original pickup selection lost its accepted recipient");
          if (item !== undefined) {
            const policy = this.policy?.();
            if (policy == null) throw new QcProgramError("Original pickup has no selected weapon continuation");
            policy.select(frame.recipient.actor, item); this.validate();
          }
          return execute.skip([0, 0, 0]);
        }
        return inner.functions.has(call.functionIndex) ? inner.run(call, execute) : execute();
      }
      const stage = this.stages.find(stage => stage.functionIndex === call.functionIndex);
      if (stage === undefined) return inner.run(call, execute);
      const vm = this.vm(), pickup = this.actor(vm.globals.int(vm.globalOffset("self"))), recipient = this.actor(vm.globals.int(vm.globalOffset("other")));
      if (pickup === null || recipient === null) return execute.skip([0, 0, 0]);
      const words = this.source.entities.at(pickup.slot), declaration = stage.descriptor;
      const value = declaration.kind === "cargo" ? null : declaration.kind === "string" ? vm.strings.get(words.int(vm.fieldOffset(declaration.field))) : words.float(vm.fieldOffset(declaration.field));
      const descriptor = declaration.kind === "cargo" ? declaration.value : declaration.values.find(descriptor => descriptor.value === value);
      if (descriptor === undefined) {
        if (this.active.some(frame => frame !== null && frame.pickup.actor === pickup.actor)) return execute.skip([0, 0, 0]);
        this.active.push(null);
        try { return execute(); } finally { this.active.pop(); }
      }
      const sourceEffect = stage.sourceEffect !== undefined && vm.globals.float(stage.sourceEffect.word) === stage.sourceEffect.value;
      const cargo: PickupCargoEntry[] = [];
      let newWeapon = false;
      if (declaration.kind === "cargo" && !sourceEffect) {
        for (const counter of declaration.counters) cargo.push({ kind: "counter", item: counter.item, count: words.float(vm.fieldOffset(counter.field)) });
        const bits = words.float(vm.fieldOffset("items"));
        if (bits !== 0) {
          const weapon = declaration.weapons.find(weapon => vm.globals.float(weapon.word) === bits);
          if (weapon === undefined) throw new QcProgramError("Original backpack carried weapon is not qualified");
          cargo.push({ kind: "weapon", item: weapon.item, count: 1 });
          newWeapon = this.ownsWeapon === undefined ? (Math.trunc(this.source.entities.at(recipient.slot).float(vm.fieldOffset("items"))) & bits) === 0
            : !this.ownsWeapon(recipient.actor, weapon.item);
        }
      }
      const result = this.admission.runSource({ recipient: recipient.actor.id, pickup: pickup.actor.id, source: this.source.slots.options.provider,
        item: descriptor.item, defaultResource: descriptor.resource, count: { kind: "default" }, dropped: declaration.kind === "cargo",
        ...(sourceEffect ? { grant: "source-effect" } : declaration.kind === "cargo" ? { cargo } : {}),
        time: { kind: "seconds", value: vm.globals.float(vm.globalOffset("time")) } }, (selection, lifetime) => {
        if (selection.kind === "stale") return execute.skip([0, 0, 0]);
        this.active.push({ stage, descriptor, pickup, recipient, selection, execute, lifetime, newWeapon, sourceEffect, accepted: false, consuming: false, consumed: false });
        try { return execute(); } finally { this.active.pop(); }
      });
      if (result instanceof Promise) throw new QcProgramError("Original QuakeC pickup admission must complete synchronously");
      return result;
    } };
  }
  composeRegions(inner: QcInlineBoundary): QcInlineBoundary {
    const regions = this.stages.flatMap(stage => stage.regions);
    return { regions: [...inner.regions, ...regions.map(entry => entry.region)], run: (region, execute) => {
      const entry = regions.find(entry => entry.region.entry === region.entry && entry.region.functionIndex === region.functionIndex);
      if (entry === undefined) return inner.run(region, execute);
      const frame = this.active.at(-1);
      if (frame == null || frame.stage.functionIndex !== region.functionIndex) return execute();
      if (this.projection?.region.entry === region.entry) return execute();
      this.validate();
      const vm = this.vm();
      const callerCurrent = (): boolean => vm.globals.int(vm.globalOffset("self")) === this.source.entities.reference(frame.consumed || entry.self === "recipient" ? frame.recipient.slot : frame.pickup.slot)
        && vm.globals.int(vm.globalOffset("other")) === this.source.entities.reference(frame.recipient.slot);
      if (!callerCurrent()) frame.execute.cancel([0, 0, 0]);
      if (entry.operation.kind === "source-effect") {
        if (!frame.sourceEffect || frame.selection.kind !== "original") frame.execute.cancel([0, 0, 0]);
        execute(); this.validate(); frame.accepted = true;
        return undefined;
      }
      if (entry.operation.kind === "consume") {
        if (frame.sourceEffect && !frame.accepted) throw new QcProgramError("Original source effect did not reach its grant");
        frame.consuming = true;
        try { frame.lifetime.consumePickup(execute); frame.consumed = true; }
        finally { frame.consuming = false; }
        this.validate();
        return undefined;
      }
      const policy = this.policy?.();
      if (entry.operation.kind === "counter" && !this.primaryWeaponSelected(frame.recipient.actor) && policy != null) {
        const operation = entry.operation;
        policy.counter(frame.recipient.actor, operation.item, count => {
          this.validate();
          if (!Number.isFinite(Math.fround(count)) || this.projection !== null) throw new QcProgramError("Invalid original pickup counter projection");
          const fields = this.source.entities.at(frame.recipient.slot), word = vm.fieldOffset(operation.field), saved = fields.int(word);
          const projected: NonNullable<Id1PickupBinding["projection"]> = { region, reference: this.source.entities.reference(frame.recipient.slot), word, value: null };
          this.projection = projected;
          try { fields.setFloat(word, count); vm.executeRegion(region, 0); }
          finally { fields.setInt(word, saved); this.projection = null; }
          this.validate();
          return projected.value;
        });
        this.validate();
        return execute.skipToJoin();
      }
      if (frame.selection.kind === "original") return execute();
      if (entry.operation.kind === "weapon-selection" && this.primaryWeaponSelected(frame.recipient.actor)) return execute();
      if (entry.operation.kind === "decision" || entry.operation.kind === "admission") {
        if (frame.accepted) throw new QcProgramError("Original pickup reached more than one recipient decision");
        if (frame.selection.kind !== "replacement" || frame.selection.grant() !== "accepted") frame.execute.cancel([0, 0, 0]);
        this.validate();
        if (!callerCurrent()) frame.execute.cancel([0, 0, 0]);
        frame.accepted = true;
        if (entry.operation.kind === "admission") return execute();
        if (entry.operation.kind === "decision") vm.globals.setFloat(entry.operation.word, entry.operation.accepted);
      } else if (!frame.accepted) throw new QcProgramError("Original pickup grant has no accepted recipient decision");
      if (entry.operation.kind === "cargo-ownership") vm.globals.setFloat(entry.operation.word, frame.newWeapon ? 1 : 0);
      if (entry.operation.kind === "cargo-current") {
        const current = policy?.current(frame.recipient.actor), source = frame.stage.sourceSelection?.weapons.find(weapon => weapon.item === current);
        vm.globals.setFloat(entry.operation.word, source === undefined ? 0 : vm.globals.float(source.word));
      }
      return execute.skipToJoin();
    } };
  }
}
