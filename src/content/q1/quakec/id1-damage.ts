import { id1ProgramBinding, type Id1ProgramBinding } from "./id1-program.ts";
import { isDeepStrictEqual } from "node:util";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { ModQcArmorStage } from "../../../contracts/mod-callbacks.ts";
import type { ArmorState, DamageOutcome, DamageRequest, ProtectionChannel } from "../../../contracts/gameplay.ts";
import type { QcCallSite, QcEntityStoreObservation, QcFunctionBoundary, QcFunctionExecution, QcInlineBoundary, QcInlineContinuation, QcMachine } from "../../../compat/qc/machine.ts";
import { QcWords } from "../../../compat/qc/memory.ts";
import { QcProgramError } from "../../../compat/qc/program.ts";
import type { QcWorldHostOptions } from "../../../compat/qc/world-host.ts";
import type { GameplayAuthority, SourceDamageObserver, SourceDamageResult, SourceArmorStage } from "../../../world/gameplay/authority.ts";
import { qcArmorStage, type QcArmorStage } from "./armor-stage.ts";
import { attackDamageFlags } from "../../../world/gameplay/armor.ts";

export interface Id1DamageCall {
  readonly call: QcCallSite;
  readonly target: ActorId;
  readonly inflictor: ActorId;
  readonly attacker: ActorId;
  readonly amount: number;
}

export interface Id1DamageProjection {
  actor(reference: number): ActorId;
  reference(actor: ActorId | null): number;
  reaction?(request: DamageRequest, result: SourceDamageResult, execute: QcFunctionExecution): undefined;
  completed?(request: DamageRequest, outcome: DamageOutcome): undefined;
}

/** Observes validated source damage operations inside the shared authority. */
export class Id1DamageBinding {
  readonly functionBoundary: QcFunctionBoundary;
  readonly inlineBoundary: QcInlineBoundary;
  private readonly armorStage: QcArmorStage | null;
  private readonly protection = { regular: new Map<OwnedActor, Parameters<SourceArmorStage["bind"]>[0]>(), powered: new Map<OwnedActor, Parameters<SourceArmorStage["bind"]>[0]>() };
  private readonly active: { readonly request: DamageRequest; readonly targetReference: number; readonly observer: SourceDamageObserver; readonly movementProvider: DamageRequest["attack"]["movementProvider"]; readonly cancel: QcFunctionExecution["cancel"]; readonly regularScale: number; result: SourceDamageResult; reactionDepth: number; healthWritten: boolean }[] = [];
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
    resolveRequest: (call: Id1DamageCall) => DamageRequest, private readonly projection?: Id1DamageProjection, declaredArmor?: ModQcArmorStage) {
    const { program } = source;
    this.binding = id1ProgramBinding(program);
    this.armorStage = qcArmorStage(program, declaredArmor);
    this.inlineBoundary = { regions: this.armorStage === null ? [] : [this.armorStage.region], run: (_region, execute) => this.runArmor(execute) };
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
    this.functionBoundary = { functions: new Set(layout.kind === "sites" && projection?.reaction === undefined ? [layout.index]
      : program.functions.filter(fn => fn.index > 0 && fn.firstStatement > 0 && !fn.namedBuiltin).map(fn => fn.index)), run: (call, execute) => {
      if (call.functionIndex !== layout.index) return this.observeNativeFunction(call, execute);
      const vm = this.vm(), reference = vm.argInt(0);
      const actor = (reference: number): ActorId => {
        if (projection !== undefined) return projection.actor(reference);
        const value = source.slots.at(source.entities.slot(reference));
        if (value === null || !source.actors.isLive(value.id)) throw new QcProgramError("id1 damage references a free source actor");
        return value.id;
      };
      const captured = { call, target: actor(reference), inflictor: actor(vm.argInt(1)), attacker: actor(vm.argInt(2)), amount: vm.argFloat(3) };
      const request = resolveRequest(captured);
      const sameReference = (actor: ActorId | null, captured: ActorId, reference: number): boolean => actor === null ? reference === 0 : actor.equals(captured);
      if (!request.target.equals(captured.target) || request.amount !== captured.amount || !sameReference(request.attack.attacker, captured.attacker, vm.argInt(2))
        || !sameReference(request.attack.inflictor, captured.inflictor, vm.argInt(1))) throw new QcProgramError("id1 damage provenance changed source arguments");
      let executed = false;
      const outcome = authority.runSourceDamage(request, (observer, effective) => {
        if (authority.damageOperation.active && (!isDeepStrictEqual(
          { knockback: request.knockback, direction: request.direction, point: request.point, normal: request.normal, delivery: request.delivery,
            attack: { ...request.attack, attacker: null, inflictor: null } },
          { knockback: effective.knockback, direction: effective.direction, point: effective.point, normal: effective.normal, delivery: effective.delivery,
            attack: { ...effective.attack, attacker: null, inflictor: null } })))
          throw new QcProgramError("QuakeC T_Damage accepts actor and amount changes; independent damage metadata requires a replacement");
        if (!Number.isFinite(Math.fround(effective.amount))) throw new QcProgramError("QuakeC damage amount exceeds binary32 range");
        const referenceFor = (actor: ActorId | null): number => {
          if (projection !== undefined) return projection.reference(actor);
          if (actor === null) return source.entities.reference(0);
          const slot = source.actors.sourceOf(actor);
          if (slot === null || slot.provider !== source.slots.options.provider) throw new QcProgramError("QuakeC damage actor has no source projection");
          return source.entities.reference(slot.slot);
        };
        const targetReference = referenceFor(effective.target), inflictorReference = referenceFor(effective.attack.inflictor), attackerReference = referenceFor(effective.attack.attacker);
        const frame: (typeof this.active)[number] = { request: effective, targetReference, observer, movementProvider: effective.attack.movementProvider, cancel: execute.cancel,
          regularScale: this.armorStage?.regularScale?.find(site => site.statement === call.statement && program.functionNamed(site.caller).index === call.caller)?.scale ?? 1,
          result: { appliedDamage: 0, reaction: "none" }, reactionDepth: 0, healthWritten: false };
        this.active.push(frame);
        try {
          executed = true;
          execute(machine => {
            machine.globals.setInt(4, targetReference); machine.globals.setInt(7, inflictorReference); machine.globals.setInt(10, attackerReference);
            machine.globals.setFloat(13, effective.amount);
            return undefined;
          });
          if (layout.kind === "calls" && frame.healthWritten && frame.result.reaction === "none"
            && source.actors.isLive(effective.target) && source.entities.fromReference(targetReference).float(this.health) <= 0) {
            frame.result = { ...frame.result, reaction: "death" };
            observer.beforeReaction(frame.result);
          }
          return frame.result;
        }
        finally { this.active.pop(); }
      });
      projection?.completed?.(request, outcome);
      if (!executed) execute.skip([0, 0, 0]);
      return undefined;
    } };
  }
  protectionStage(actor: OwnedActor, channel: ProtectionChannel): SourceArmorStage | null {
    if (this.armorStage === null || channel === "regular" && this.armorStage.region.replaceable !== true) return null;
    const owners = this.protection[channel];
    return { bind: intercept => {
      this.source.actors.assertOwned(actor);
      if (owners.has(actor)) throw new QcProgramError(`QC ${channel} armor stage already has an owner`);
      owners.set(actor, intercept);
      return () => { if (owners.get(actor) === intercept) owners.delete(actor); return undefined; };
    } };
  }
  private runArmor(execute: QcInlineContinuation): undefined {
    const frame = this.active.at(-1), plan = this.armorStage;
    if (frame === undefined || plan === null || frame.reactionDepth > 0) return execute();
    const vm = this.vm(), actor = this.source.actors.resolveOwned(frame.request.target);
    if (actor === null) return frame.cancel([0, 0, 0]);
    if (vm.globals.int(plan.target) !== frame.targetReference) throw new QcProgramError("QC armor stage changed its damage target");
    const power = this.protection.powered.get(actor), regular = this.protection.regular.get(actor);
    if (power === undefined && regular === undefined) return execute();
    const live = (): void => { if (this.source.actors.resolveOwned(actor.id) !== actor) frame.cancel([0, 0, 0]); };
    const word = plan.flags.kind === "bits" ? Math.trunc(vm.globals.float(plan.flags.word)) : 0;
    const capturedFlags = attackDamageFlags(frame.request);
    const originating = { ...capturedFlags, regularProtectionScale: vm.numeric.multiply(capturedFlags.regularProtectionScale ?? 1, frame.regularScale) };
    const flags = plan.flags.kind === "none" ? originating
      : { ...originating, noArmor: plan.flags.noArmor === 0 ? originating.noArmor : (word & plan.flags.noArmor) !== 0,
        noPowerArmor: plan.flags.noPowerArmor === 0 ? originating.noPowerArmor : (word & plan.flags.noPowerArmor) !== 0,
        noRegularArmor: plan.flags.noRegularArmor === 0 ? originating.noRegularArmor : (word & plan.flags.noRegularArmor) !== 0,
        energy: plan.flags.energy === 0 ? originating.energy : (word & plan.flags.energy) !== 0 };
    const input = { request: frame.request, amount: vm.globals.float(plan.damage), flags,
      geometry: { direction: { ...frame.request.direction }, point: { ...frame.request.point }, normal: { ...frame.request.normal } } };
    const powerSaved = power?.(input, () => 0) ?? 0;
    live();
    if (!Number.isFinite(Math.fround(powerSaved))) throw new QcProgramError("Armor savings exceed QC binary32 range");
    const original = vm.globals.int(plan.damage);
    try {
      const amount = vm.numeric.subtract(input.amount, powerSaved);
      vm.globals.setFloat(plan.damage, amount);
      let executed = false;
      const originalRegular = (): number => { execute(); executed = true; return vm.globals.float(plan.saved); };
      // Power may remove the regular owner while this frame is suspended.
      const current = this.protection.regular.get(actor);
      const regularSaved = current === undefined ? originalRegular() : current({ ...input, amount }, originalRegular);
      live();
      if (!Number.isFinite(Math.fround(regularSaved))) throw new QcProgramError("Armor savings exceed QC binary32 range");
      if (!executed) execute.skipToJoin();
      vm.globals.setFloat(plan.saved, vm.numeric.add(regularSaved, powerSaved));
    } finally { vm.globals.setInt(plan.damage, original); }
    return undefined;
  }
  private observeNativeFunction(call: QcCallSite, execute: QcFunctionExecution): undefined {
    const frame = this.active.at(-1), layout = this.binding.damage;
    if (frame === undefined || frame.reactionDepth > 0) return execute();
    if (layout.kind === "sites") {
      if (frame.result.reaction === "none" || call.caller !== layout.index || call.statement !== (frame.result.reaction === "death" ? layout.death[0] : layout.pain[0])) return execute();
      frame.reactionDepth++;
      try { return this.projection?.reaction === undefined ? execute() : this.projection.reaction(frame.request, frame.result, execute); } finally { frame.reactionDepth--; }
    }
    if (frame.result.reaction !== "none") return execute();
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
    try { return this.projection?.reaction === undefined ? execute() : this.projection.reaction(frame.request, frame.result, execute); } finally { frame.reactionDepth--; }
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
    return { regular: item === null ? { kind: "none" } : { kind: "q1", points: words.float(this.armorValue), absorption: words.float(this.armorType), item }, powered: { kind: "none" } };
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
