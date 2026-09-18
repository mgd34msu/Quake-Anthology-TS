import { id1ProgramBinding, type Id1ProgramBinding } from "./id1-program.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { ArmorState, DamageRequest } from "../../../contracts/gameplay.ts";
import type { QcCallSite, QcEntityStoreObservation, QcFunctionBoundary, QcMachine } from "../../../compat/qc/machine.ts";
import { QcWords } from "../../../compat/qc/memory.ts";
import { QcProgramError } from "../../../compat/qc/program.ts";
import type { QcWorldHostOptions } from "../../../compat/qc/world-host.ts";
import type { GameplayAuthority, SourceDamageObserver, SourceDamageResult } from "../../../world/gameplay/authority.ts";

export interface Id1DamageCall {
  readonly call: QcCallSite;
  readonly target: ActorId;
  readonly inflictor: ActorId;
  readonly attacker: ActorId;
  readonly amount: number;
}

/** Observes validated source damage operations inside the shared authority. */
export class Id1DamageBinding {
  readonly functionBoundary: QcFunctionBoundary;
  private readonly active: { readonly targetReference: number; readonly observer: SourceDamageObserver; readonly movementProvider: DamageRequest["attack"]["movementProvider"]; result: SourceDamageResult; reactionDepth: number; healthWritten: boolean }[] = [];
  private readonly binding: Id1ProgramBinding;
  private readonly health: number;
  private readonly velocity: number;
  private readonly armorValue: number;
  private readonly armorType: number;
  private readonly items: number;
  private readonly pain: number;
  private readonly die: number;
  constructor(private readonly source: Pick<QcWorldHostOptions, "program" | "entities" | "actors" | "slots">,
    authority: GameplayAuthority, private readonly machine: () => QcMachine,
    resolveRequest: (call: Id1DamageCall) => DamageRequest) {
    const { program } = source;
    this.binding = id1ProgramBinding(program);
    const layout = this.binding.damage, damage = program.functionNamed("T_Damage");
    if (damage.index !== layout.index || damage.firstStatement !== layout.firstStatement || damage.parameterStart !== layout.parameterStart || damage.localWords !== layout.localWords
      || layout.kind === "sites" && (damage.parameterSizes.length !== 4 || damage.parameterSizes.some(size => size !== 1))) throw new QcProgramError("id1 damage function layout mismatch");
    for (const [index, opcode, a, b, c] of layout.kind === "sites" ? layout.statements : []) {
      const value = program.statements[index];
      if (value?.opcode !== opcode || value.a !== a || value.b !== b || value.c !== c) throw new QcProgramError(`id1 damage statement ${index} mismatch`);
    }
    const field = (name: string): number => {
      const value = program.fieldsByName.get(name);
      if (value === undefined) throw new QcProgramError(`missing id1 field ${name}`);
      return value.offset;
    };
    this.health = field("health"); this.velocity = field("velocity"); this.armorValue = field("armorvalue"); this.armorType = field("armortype"); this.items = field(this.binding.armorField); this.pain = field("th_pain"); this.die = field("th_die");
    this.functionBoundary = { functions: new Set(layout.kind === "sites" ? [layout.index]
      : program.functions.filter(fn => fn.index > 0 && fn.firstStatement > 0 && !fn.namedBuiltin).map(fn => fn.index)), run: (call, execute) => {
      if (call.functionIndex !== layout.index) return this.observeNativeFunction(call, execute);
      const vm = this.vm(), reference = vm.argInt(0);
      const actor = (reference: number): ActorId => {
        const value = source.slots.at(source.entities.slot(reference));
        if (value === null || !source.actors.isLive(value.id)) throw new QcProgramError("id1 damage references a free source actor");
        return value.id;
      };
      const captured = { call, target: actor(reference), inflictor: actor(vm.argInt(1)), attacker: actor(vm.argInt(2)), amount: vm.argFloat(3) };
      const request = resolveRequest(captured);
      if (!request.target.equals(captured.target) || request.amount !== captured.amount || request.attack.attacker?.equals(captured.attacker) !== true
        || request.attack.inflictor?.equals(captured.inflictor) !== true) throw new QcProgramError("id1 damage provenance changed source arguments");
      authority.runSourceDamage(request, observer => {
        const frame: (typeof this.active)[number] = { targetReference: reference, observer, movementProvider: request.attack.movementProvider, result: { appliedDamage: 0, reaction: "none" }, reactionDepth: 0, healthWritten: false };
        this.active.push(frame);
        try {
          execute();
          if (layout.kind === "calls" && frame.healthWritten && frame.result.reaction === "none"
            && source.actors.isLive(captured.target) && source.entities.fromReference(reference).float(this.health) <= 0) {
            frame.result = { ...frame.result, reaction: "death" };
            observer.beforeReaction(frame.result);
          }
          return frame.result;
        }
        finally { this.active.pop(); }
      });
      return undefined;
    } };
  }
  private observeNativeFunction(call: QcCallSite, execute: () => undefined): undefined {
    const frame = this.active.at(-1), layout = this.binding.damage;
    if (layout.kind !== "calls" || frame === undefined || frame.reactionDepth > 0 || frame.result.reaction !== "none") return execute();
    const vm = this.vm(), target = this.source.entities.fromReference(frame.targetReference);
    const reaction = layout.reactions.get(call.statement);
    if (reaction === undefined) return execute();
    if (vm.globals.int(vm.globalOffset("self")) !== frame.targetReference
      || call.functionIndex !== target.int(reaction === "death" ? this.die : this.pain)) return execute();
    if ((target.float(this.health) <= 0) !== (reaction === "death")) throw new QcProgramError("Native damage reaction disagrees with target health");
    if (!frame.healthWritten) throw new QcProgramError("Native damage reaction precedes target health mutation");
    frame.result = { ...frame.result, reaction };
    frame.observer.beforeReaction(frame.result);
    frame.reactionDepth++;
    try { return execute(); } finally { frame.reactionDepth--; }
  }
  private vm(): QcMachine {
    const vm = this.machine();
    if (vm.program !== this.source.program || vm.entities !== this.source.entities) throw new QcProgramError("id1 damage binding belongs to another machine");
    return vm;
  }
  readArmor(words: QcWords): ArmorState {
    const items = Math.trunc(words.float(this.items));
    const [green, yellow, red] = this.binding.armorMasks;
    const item = (items & red) !== 0 ? "q1:item_armorInv" : (items & yellow) !== 0 ? "q1:item_armor2" : (items & green) !== 0 ? "q1:item_armor1" : null;
    return item === null ? { kind: "none" } : { kind: "q1", points: words.float(this.armorValue), absorption: words.float(this.armorType), item };
  }
  observeCall(call: QcCallSite): undefined {
    const frame = this.active.at(-1);
    const layout = this.binding.damage;
    if (layout.kind === "calls") return undefined;
    if (frame === undefined || call.caller !== layout.index || (call.statement !== layout.death[0] && call.statement !== layout.pain[0])) return undefined;
    const vm = this.vm();
    if (this.binding.attribution === "native") {
      const target = this.source.entities.fromReference(frame.targetReference);
      const death = call.statement === layout.death[0];
      if (death ? vm.argInt(0) !== frame.targetReference || target.float(this.health) > 0
        : vm.globals.int(vm.globalOffset("self")) !== frame.targetReference || target.float(this.health) <= 0 || vm.argFloat(1) !== frame.result.appliedDamage)
        throw new QcProgramError("Unsupported native damage reaction context");
    }
    if (call.functionIndex !== vm.globals.int(call.statement === layout.death[0] ? layout.death[1] : layout.pain[1])) return undefined;
    const result: SourceDamageResult = { appliedDamage: this.binding.attribution === "native" ? frame.result.appliedDamage : vm.globals.float(layout.take), reaction: call.statement === layout.death[0] ? "death" : "pain" };
    frame.result = result;
    frame.observer.beforeReaction(result);
    return undefined;
  }
  observeEntityStore(store: QcEntityStoreObservation): undefined {
    const frame = this.active.at(-1);
    if (frame === undefined) return undefined;
    const layout = this.binding.damage;
    const native = layout.kind === "calls";
    const combatStore = [this.health, this.velocity, this.armorValue, this.armorType, this.items].includes(store.word);
    if (native && frame.reactionDepth > 0) return undefined;
    if (native && combatStore && store.reference !== frame.targetReference)
      throw new QcProgramError("Unsupported native damage redirects a combat store to another actor");
    if (store.reference !== frame.targetReference) return undefined;
    if (native && combatStore && frame.result.reaction !== "none")
      throw new QcProgramError("Native damage combat store follows its reaction continuation");
    if (!native && store.functionIndex !== this.binding.damage.index) return undefined;
    const vm = this.vm(), before = new DataView(store.before.buffer, store.before.byteOffset, store.before.byteLength), after = new DataView(store.after.buffer, store.after.byteOffset, store.after.byteLength);
    if (store.word === this.health) {
      if (layout.kind === "sites" && store.statement !== layout.healthStore)
        throw new QcProgramError("Unsupported native damage health store");
      frame.observer.stored({ kind: "health", before: before.getFloat32(0, true), after: after.getFloat32(0, true) });
      frame.healthWritten = true;
      frame.result = { appliedDamage: layout.kind === "calls" ? frame.result.appliedDamage + before.getFloat32(0, true) - after.getFloat32(0, true)
        : vm.globals.float(layout.take), reaction: "none" };
    } else if (store.word === this.armorValue || store.word === this.armorType || store.word === this.items) {
      const current = this.source.entities.fromReference(store.reference), previous = new QcWords(current.bytes.slice());
      previous.bytes.set(store.before, store.word * 4);
      frame.observer.stored({ kind: "armor", before: this.readArmor(previous), after: this.readArmor(current) });
    } else if (store.word === this.velocity) {
      const vector = (view: DataView) => ({ x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) });
      frame.observer.stored({ kind: "source-velocity", movementProvider: frame.movementProvider, before: vector(before), after: vector(after) });
    }
    return undefined;
  }
}
