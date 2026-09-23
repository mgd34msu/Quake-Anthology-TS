import type { OwnedActor } from "../../../contracts/identity.ts";
import type { OriginalPickupAdmission, SourcePickupSelection } from "../../../contracts/original-pickups.ts";
import type { QcFunctionBoundary, QcFunctionExecution, QcInlineBoundary, QcMachine } from "../../../compat/qc/machine.ts";
import { QcProgramError } from "../../../compat/qc/program.ts";
import type { QcWorldHostOptions } from "../../../compat/qc/world-host.ts";
import { qcPickupStages, type QcPickupStage } from "./pickup-stage.ts";

interface SourceActor { readonly actor: OwnedActor; readonly slot: number; }
interface PickupCall {
  readonly stage: QcPickupStage;
  readonly pickup: SourceActor;
  readonly recipient: SourceActor;
  readonly selection: SourcePickupSelection;
  readonly execute: QcFunctionExecution;
  accepted: boolean;
}

/** Holds the selected resource owner through the complete original touch and target continuation. */
export class Id1PickupBinding {
  private readonly stages: readonly QcPickupStage[];
  private readonly active: (PickupCall | null)[] = [];
  constructor(private readonly source: Pick<QcWorldHostOptions, "program" | "entities" | "actors" | "slots">,
    private readonly admission: OriginalPickupAdmission, private readonly machine: () => QcMachine) {
    this.stages = qcPickupStages(source.program);
  }
  assertIdle(): void { if (this.active.length !== 0) throw new QcProgramError("Cannot save during an original pickup caller"); }
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
      if (!this.live(frame.pickup) || !this.live(frame.recipient) || frame.selection.kind === "replacement" && !frame.selection.current())
        frame.execute.cancel([0, 0, 0]);
    }
    return undefined;
  }
  composeFunctions(inner: QcFunctionBoundary): QcFunctionBoundary {
    if (this.stages.some(stage => inner.functions.has(stage.functionIndex))) throw new QcProgramError("Original pickup caller already has a function boundary");
    return { functions: new Set([...inner.functions, ...this.stages.map(stage => stage.functionIndex)]), run: (call, execute) => {
      const stage = this.stages.find(stage => stage.functionIndex === call.functionIndex);
      if (stage === undefined) return inner.run(call, execute);
      const vm = this.vm(), pickup = this.actor(vm.globals.int(vm.globalOffset("self"))), recipient = this.actor(vm.globals.int(vm.globalOffset("other")));
      if (pickup === null || recipient === null) return execute.skip([0, 0, 0]);
      const words = this.source.entities.at(pickup.slot), field = vm.fieldOffset(stage.descriptor.field);
      const value = stage.descriptor.kind === "string" ? vm.strings.get(words.int(field)) : words.float(field);
      const descriptor = stage.descriptor.values.find(descriptor => descriptor.value === value);
      if (descriptor === undefined) {
        if (this.active.some(frame => frame !== null && frame.pickup.actor === pickup.actor)) return execute.skip([0, 0, 0]);
        this.active.push(null);
        try { return execute(); } finally { this.active.pop(); }
      }
      const result = this.admission.runSource({ recipient: recipient.actor.id, pickup: pickup.actor.id, source: this.source.slots.options.provider,
        item: descriptor.item, defaultResource: descriptor.resource, count: { kind: "default" }, dropped: false,
        time: { kind: "seconds", value: vm.globals.float(vm.globalOffset("time")) } }, selection => {
        if (selection.kind === "stale") return execute.skip([0, 0, 0]);
        this.active.push({ stage, pickup, recipient, selection, execute, accepted: false });
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
      this.validate();
      const vm = this.vm();
      const callerCurrent = (): boolean => vm.globals.int(vm.globalOffset("self")) === this.source.entities.reference(frame.pickup.slot)
        && vm.globals.int(vm.globalOffset("other")) === this.source.entities.reference(frame.recipient.slot);
      if (!callerCurrent()) frame.execute.cancel([0, 0, 0]);
      if (frame.selection.kind === "original") return execute();
      if (entry.operation.kind === "decision") {
        if (frame.accepted) throw new QcProgramError("Original pickup reached more than one recipient decision");
        if (frame.selection.kind !== "replacement" || frame.selection.grant() !== "accepted") frame.execute.cancel([0, 0, 0]);
        this.validate();
        if (!callerCurrent()) frame.execute.cancel([0, 0, 0]);
        frame.accepted = true;
        vm.globals.setFloat(entry.operation.word, entry.operation.accepted);
      } else if (!frame.accepted) throw new QcProgramError("Original pickup grant has no accepted recipient decision");
      return execute.skipToJoin();
    } };
  }
}
