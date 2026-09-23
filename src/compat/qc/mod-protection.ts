import { isDeepStrictEqual } from "node:util";
import type { ActorId, ClientId, ProviderId } from "../../contracts/identity.ts";
import type { ArmorStageInput, ArmorStageResult, ProtectionChannel, ProtectionObserver, RegularArmorState, PoweredProtectionState } from "../../contracts/gameplay.ts";
import type { OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { ModCallbackDeclaration, ModCallbackInput, ModQcProtection, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { ProtectionReservation } from "../../world/gameplay/authority.ts";
import { qcArmorStage, type QcArmorStage } from "../../content/q1/quakec/armor-stage.ts";
import type { QcProgram } from "./program.ts";
import type { QcEntityStoreObservation, QcMachine } from "./machine.ts";
import type { QcWords } from "./memory.ts";

type Regular = Extract<ModQcProtection, { readonly channel: "regular" }>;
type Powered = Extract<ModQcProtection, { readonly channel: "powered" }>;
type Lane = { readonly channel: "regular"; readonly definition: Regular; readonly reservation: ProtectionReservation<"regular"> }
  | { readonly channel: "powered"; readonly definition: Powered; readonly reservation: ProtectionReservation<"powered"> };
interface Entry { readonly client: ClientId; readonly lanes: readonly Lane[]; bound: boolean; }
interface Projection { readonly regular?: RegularArmorState; readonly powered?: PoweredProtectionState; }
interface Stage { readonly actor: ActorId; readonly observer: ProtectionObserver; before: Projection; }
interface Operations {
  readonly machine: QcMachine;
  reference(actor: ActorId): number;
  actor(reference: number): ActorId;
  invoke(call: ModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>, region?: QcArmorStage): number;
  pickups?(actor: ActorId, channel: ProtectionChannel): readonly OriginalPickupRule[];
}

export function qcProtectionRegions(program: QcProgram, declaration: ModCallbackDeclaration): readonly QcArmorStage[] {
  const channels = new Set<string>(), regions: QcArmorStage[] = [];
  for (const definition of declaration.protection ?? []) {
    if (declaration.clients === undefined || channels.has(definition.channel)) throw new Error("QC protection requires clients and one declaration per channel");
    channels.add(definition.channel);
    const storage = definition.storage, count = definition.channel === "regular" ? definition.storage.points : definition.storage.cells;
    for (const name of [count, ...(storage.selection === undefined ? [] : [storage.selection.field])]) {
      if (program.fieldsByName.get(name)?.type !== "float" || !declaration.actorFields.some(field => field.field === name && field.binding === "private"))
        throw new Error(`QC protection requires private float storage ${name}`);
    }
    if (storage.selection !== undefined) {
      if (storage.selection.field === count || storage.selection.values.length === 0
        || new Set(storage.selection.values.map(value => value.value)).size !== storage.selection.values.length
        || storage.selection.values.some(value => !Number.isFinite(value.value) || Math.fround(value.value) !== value.value))
        throw new Error("QC protection selection is not representable");
      const mask = storage.selection.mask;
      if (mask !== undefined && (!Number.isInteger(mask) || mask <= 0 || mask > 0x7fffff
        || storage.selection.values.some(value => !Number.isInteger(value.value) || (value.value & mask) !== value.value)))
        throw new Error("QC protection selection mask is invalid");
    }
    if (Object.values(definition.flags).some(mask => !Number.isInteger(mask) || mask < 0 || mask > 0x7fffff))
      throw new Error("QC protection flags exceed source integer precision");
    if (definition.absorb.kind === "region") {
      const region = qcArmorStage(program, definition.absorb.stage);
      if (region?.region.standalone === undefined || definition.absorb.call.function !== region.function)
        throw new Error("QC donor region lacks a qualified standalone frame");
      const fn = program.functionNamed(region.function), inputs = new Map<number, ModSourceCall["arguments"][number]>();
      let word = fn.parameterStart;
      for (const [index, size] of fn.parameterSizes.entries()) {
        const value = definition.absorb.call.arguments[index]; if (value !== undefined) inputs.set(word, value);
        word += size;
      }
      for (const [word, name] of [[region.target, "self"], [region.damage, "amount"],
        ...(region.flags.kind === "bits" ? [[region.flags.word, "damage-flags"]] satisfies readonly (readonly [number, ModCallbackInput])[] : [])] satisfies readonly (readonly [number, ModCallbackInput])[]) {
        const input = inputs.get(word);
        if (input?.kind !== "input" || input.name !== name) throw new Error(`QC donor region must initialize ${name} from its current stage`);
      }
      regions.push(region);
    }
  }
  return regions;
}

/** A component's original client words own protection; source stores report once. */
export class QcModProtection {
  private readonly entries = new Map<ActorId, Entry>();
  private readonly stages: Stage[] = [];
  private readonly regions: readonly QcArmorStage[];
  constructor(private readonly declaration: ModCallbackDeclaration, private readonly provider: ProviderId,
    private readonly services: ModHostServices, private readonly operations: Operations) {
    this.regions = qcProtectionRegions(operations.machine.program, declaration);
  }
  reserve(actor: ActorId): void {
    if (this.entries.has(actor)) { this.require(actor); return; }
    const owner = this.services.actors.resolveOwned(actor), client = this.services.clients?.forActor(actor);
    if (owner === null || client == null || this.services.clients?.actor(client)?.equals(actor) !== true) throw new Error("QC protection requires a live canonical client");
    const lanes: Lane[] = [];
    try {
      for (const definition of this.declaration.protection ?? []) {
        const claim = { owner: this.provider, rule: definition.id, admission: definition.admission ?? { kind: "claim" } satisfies NonNullable<ModQcProtection["admission"]> };
        lanes.push(definition.channel === "regular"
          ? { channel: "regular", definition, reservation: this.services.combat.reserveProtection(owner, "regular", claim) }
          : { channel: "powered", definition, reservation: this.services.combat.reserveProtection(owner, "powered", claim) });
      }
      this.entries.set(actor, { client, lanes, bound: false });
    } catch (error) { for (const lane of lanes) lane.reservation.close(); throw error; }
  }
  private require(actor: ActorId): Entry {
    const entry = this.entries.get(actor);
    if (entry === undefined || !this.services.actors.isLive(actor) || this.services.clients?.forActor(actor)?.equals(entry.client) !== true
      || this.services.clients.actor(entry.client)?.equals(actor) !== true) throw new Error("QC protection client is retired");
    return entry;
  }
  private words(actor: ActorId): QcWords { this.require(actor); return this.operations.machine.entities.fromReference(this.operations.reference(actor)); }
  private count(actor: ActorId, name: string, next?: number): number {
    const words = this.words(actor), offset = this.operations.machine.fieldOffset(name);
    if (next !== undefined) words.setFloat(offset, next);
    return words.float(offset);
  }
  private selected(actor: ActorId, selection: NonNullable<ModQcProtection["storage"]["selection"]>): number {
    const value = this.count(actor, selection.field); return selection.mask === undefined ? value : Math.trunc(value) & selection.mask;
  }
  private regular(actor: ActorId, definition: Regular): RegularArmorState {
    const points = this.count(actor, definition.storage.points), selection = definition.storage.selection;
    const item = selection === undefined ? definition.storage.item : selection.values.find(value => value.value === this.selected(actor, selection))?.item;
    if (item === undefined) throw new Error("QC regular armor selection is undeclared");
    return { kind: "source", points, item };
  }
  private powered(actor: ActorId, definition: Powered): PoweredProtectionState {
    const selection = definition.storage.selection;
    const kind = selection === undefined ? definition.storage.kind : selection.values.find(value => value.value === this.selected(actor, selection))?.kind;
    if (kind === undefined) throw new Error("QC powered armor selection is undeclared");
    return kind === "none" ? { kind } : { kind, cells: this.count(actor, definition.storage.cells) };
  }
  private validCount(count: number): void {
    if (count < 0 || !Number.isFinite(count) || Math.fround(count) !== count) throw new Error("QC protection count is not representable");
  }
  private validateRegular(actor: ActorId, definition: Regular, next: RegularArmorState): undefined {
    this.require(actor);
    if (next.kind !== "source") throw new Error("QC independent regular armor requires its source projection");
    this.validCount(next.points);
    if (definition.storage.selection === undefined ? next.item !== definition.storage.item
      : !definition.storage.selection.values.some(value => value.item === next.item)) throw new Error("QC regular armor item is undeclared");
    return undefined;
  }
  private validatePowered(actor: ActorId, definition: Powered, next: PoweredProtectionState): undefined {
    this.require(actor); this.validCount(next.kind === "none" ? 0 : next.cells);
    if (definition.storage.selection === undefined ? next.kind !== definition.storage.kind
      : !definition.storage.selection.values.some(value => value.kind === next.kind)) throw new Error("QC powered armor kind is undeclared");
    return undefined;
  }
  private select(actor: ActorId, selection: NonNullable<ModQcProtection["storage"]["selection"]>, next: number): void {
    this.count(actor, selection.field, selection.mask === undefined ? next : (Math.trunc(this.count(actor, selection.field)) & ~selection.mask) | next);
  }
  private projection(actor: ActorId): Projection {
    const entry = this.require(actor);
    let result: Projection = {};
    for (const lane of entry.lanes) result = lane.channel === "regular" ? { ...result, regular: this.regular(actor, lane.definition) }
      : { ...result, powered: this.powered(actor, lane.definition) };
    return result;
  }
  private rebase(actor: ActorId): void {
    const state = this.projection(actor);
    for (const stage of this.stages) if (stage.actor.equals(actor)) stage.before = state;
  }
  activate(actor: ActorId): void {
    const entry = this.require(actor); if (entry.bound) return;
    try {
      for (const lane of entry.lanes) {
        const base = { owner: this.provider, rule: lane.definition.id, admission: lane.definition.admission ?? { kind: "claim" } satisfies NonNullable<ModQcProtection["admission"]>, inventoryItems: [],
          pickups: this.operations.pickups?.(actor, lane.channel) ?? [] };
        if (lane.channel === "regular") {
          const definition = lane.definition;
          lane.reservation.bind({ ...base, channel: "regular", read: () => this.regular(actor, definition),
            validateWrite: next => this.validateRegular(actor, definition, next), write: next => {
              this.validateRegular(actor, definition, next);
              const selection = definition.storage.selection;
              if (selection !== undefined && next.kind === "source") {
                const selected = selection.values.find(value => value.item === next.item); if (selected === undefined) throw new Error("Missing validated QC armor selection");
                this.select(actor, selection, selected.value);
              }
              this.count(actor, definition.storage.points, next.kind === "none" ? 0 : next.points); this.rebase(actor); return undefined;
            }, absorb: (input, observer) => this.absorb(actor, definition, input, observer) });
        } else {
          const definition = lane.definition;
          lane.reservation.bind({ ...base, channel: "powered", read: () => this.powered(actor, definition),
            validateWrite: next => this.validatePowered(actor, definition, next), write: next => {
              this.validatePowered(actor, definition, next);
              const selection = definition.storage.selection;
              if (selection !== undefined) {
                const selected = selection.values.find(value => value.kind === next.kind); if (selected === undefined) throw new Error("Missing validated QC power selection");
                this.select(actor, selection, selected.value);
              }
              this.count(actor, definition.storage.cells, next.kind === "none" ? 0 : next.cells); this.rebase(actor); return undefined;
            }, absorb: (input, observer) => this.absorb(actor, definition, input, observer) });
        }
      }
      entry.bound = true;
    } catch (error) { this.release(actor); throw error; }
  }
  observe(store: QcEntityStoreObservation): undefined {
    if (this.stages.length === 0) return undefined;
    const actor = this.operations.actor(store.reference), matching = this.stages.filter(stage => stage.actor.equals(actor));
    const current = matching.at(-1);
    const after = matching.length === 0 ? {} : this.projection(actor);
    for (const stage of matching) {
      const before = stage.before; stage.before = after;
      if (stage !== current) continue;
      const regular = before.regular !== undefined && after.regular !== undefined && !isDeepStrictEqual(before.regular, after.regular)
        ? { before: before.regular, after: after.regular } : undefined;
      const powered = before.powered !== undefined && after.powered !== undefined && !isDeepStrictEqual(before.powered, after.powered)
        ? { before: before.powered, after: after.powered } : undefined;
      if (regular !== undefined) stage.observer.stored({ regular, ...(powered === undefined ? {} : { powered }) });
      else if (powered !== undefined) stage.observer.stored({ powered });
    }
    return undefined;
  }
  watch<T>(actor: ActorId, observer: ProtectionObserver, run: () => T): T {
    if (!this.entries.has(actor)) return run();
    const stage: Stage = { actor, observer, before: this.projection(actor) };
    this.stages.push(stage);
    try { return run(); }
    finally { this.stages.pop(); }
  }
  private absorb(actor: ActorId, definition: ModQcProtection, input: ArmorStageInput, observer: ProtectionObserver): ArmorStageResult {
    this.require(actor);
    const flags = definition.flags;
    const scale = input.flags.regularProtectionScale ?? 1;
    if (definition.channel === "regular" && scale !== 1
      && ![...definition.absorb.call.arguments, ...definition.absorb.call.globals.map(global => global.value)]
        .some(value => value.kind === "input" && value.name === "regular-protection-scale"))
      throw new Error("QC regular protection scale requires an explicit source input");
    const damageFlags = (input.flags.noArmor ? flags.noArmor : 0) | (input.flags.noPowerArmor ? flags.noPowerArmor : 0)
      | (input.flags.noRegularArmor ? flags.noRegularArmor : 0) | (input.flags.energy ? flags.energy : 0) | (input.request.delivery === "radius" ? flags.radius : 0);
    const now = this.services.time();
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([
      ["self", { kind: "actor", value: actor }], ["attacker", { kind: "actor", value: input.request.attack.attacker }],
      ["inflictor", { kind: "actor", value: input.request.attack.inflictor }], ["amount", { kind: "float", value: input.amount }],
      ["damage-flags", { kind: "float", value: damageFlags }], ["knockback", { kind: "float", value: input.request.knockback }], ["direction", { kind: "vector", value: input.geometry.direction }],
      ["regular-protection-scale", { kind: "float", value: scale }],
      ["point", { kind: "vector", value: input.geometry.point }], ["normal", { kind: "vector", value: input.geometry.normal }],
      ["time", { kind: "float", value: now.kind === "seconds" ? now.value : now.value / 1000 }],
    ]);
    return this.watch(actor, observer, () => {
      const source = definition.absorb;
      const region = source.kind === "region" ? this.regions.find(region => region.entry === source.stage.entry) : undefined;
      const saved = this.operations.invoke(source.call, inputs, region);
      if (this.services.actors.isLive(actor) && this.entries.has(actor)) this.require(actor);
      return { saved };
    });
  }
  release(actor: ActorId): void {
    const entry = this.entries.get(actor); if (entry === undefined) return;
    const errors: unknown[] = [];
    for (const lane of entry.lanes) try { lane.reservation.close(); } catch (error) { errors.push(error); }
    this.entries.delete(actor);
    if (errors.length !== 0) throw new AggregateError(errors, "QC protection release failed");
  }
  close(): void {
    const errors: unknown[] = [];
    for (const actor of this.entries.keys()) try { this.release(actor); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "QC protection close failed");
  }
  assertIdle(): void { if (this.stages.length !== 0) throw new Error("QC protection requires an idle source stage"); }
}
