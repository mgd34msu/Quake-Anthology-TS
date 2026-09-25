import type { QvmInventoryWord } from "./game-inventory.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { OwnedActor } from "../../contracts/identity.ts";
import type { OriginalPickupOffer, PickupResource, SourcePickupSelection } from "../../contracts/original-pickups.ts";
import type { PickupSupplyOffer } from "../../contracts/pickups.ts";
import { qualifyQvmRegion, qualifyQvmRegionEvaluation, type QvmRegionEvaluation } from "./regions.ts";
import type { SourceTime } from "../../contracts/time.ts";
import type { QvmGame } from "./game.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmCancellationScope, QvmFunctionCall, QvmSystemCallResult } from "./interpreter.ts";
import { QvmOpcode } from "./image.ts";
import { readQvmItemRecords, type QvmCatalogRecord, type QvmItemLayout } from "./item-catalog.ts";

export interface QvmPickupEligibility {
  readonly call: QvmFunctionCall;
  readonly item: DataView;
  readonly player: DataView;
}
export interface QvmPickupGrant {
  readonly itemType: number;
  readonly entry: number;
  readonly calls: readonly number[];
  readonly operation:
    | { readonly kind: "return"; readonly acceptedReturn: number }
    | { readonly kind: "region"; readonly entry: number; readonly join: number; readonly quantity: number;
      readonly weapon?: { readonly quantity: QvmRegionEvaluation } & ({ readonly storage: "inventory" } | { readonly storage?: undefined; readonly bitsOffset: number; readonly ammoOffset: number }) };
  eligible(context: QvmPickupEligibility): boolean | Promise<boolean>;
}
export interface QvmPickupProfile {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly entityStride: number;
  readonly clientStride: number;
  readonly fields: { readonly inuse: number; readonly client: number; readonly health: number; readonly item: number; readonly count: number; readonly flags: number };
  readonly droppedFlag: number;
  readonly items: QvmItemLayout;
  readonly touch: number;
  readonly gate: { readonly entry: number; readonly calls: readonly number[]; readonly itemArgument: number; readonly playerArgument: number };
  readonly targets: { readonly entry: number; readonly calls: readonly number[] };
  readonly free: number;
  readonly objectiveTypes: readonly number[];
  readonly grants: readonly QvmPickupGrant[];
}
interface Options {
  readonly game: Pick<QvmGame, "module" | "data">;
  readonly artifact: QvmModuleOptions["artifact"];
  readonly profile: QvmPickupProfile;
  readonly catalog?: { records(): readonly QvmCatalogRecord[] };
  actor(slot: number): OwnedActor | null;
  current(actor: OwnedActor, slot: number): boolean;
  resolveItem(record: QvmCatalogRecord): { readonly item: ItemId; readonly resource: PickupResource | null };
  time(): SourceTime;
  readonly supply?: {
    ammo(record: QvmCatalogRecord): ItemId | null;
    owns(actor: OwnedActor, item: ItemId): boolean;
    project?(actor: OwnedActor, item: ItemId, count: number): readonly QvmInventoryWord[];
  };
  /** The host keeps the item lock and captured ownership until the returned promise settles. */
  runSource(offer: OriginalPickupOffer, execute: (selection: SourcePickupSelection) => QvmSystemCallResult): QvmSystemCallResult;
  readonly lifetime: { readonly kind: "shared-free-hook" } | { readonly kind: "own-free-hook"; retire(actor: OwnedActor): void };
}
interface Frame {
  readonly call: QvmFunctionCall;
  readonly offer: OriginalPickupOffer;
  supply: { readonly offer: PickupSupplyOffer; readonly quantity?: (count: number) => number } | null;
  readonly cancellation: QvmCancellationScope;
  readonly item: OwnedActor;
  readonly recipient: OwnedActor;
  readonly itemSlot: number;
  readonly recipientSlot: number;
  readonly itemPointer: number;
  readonly playerPointer: number;
  readonly recipientPointer: number;
  readonly itemRecord: QvmCatalogRecord;
  readonly grant: QvmPickupGrant | undefined;
  readonly selection: SourcePickupSelection;
  invalid: boolean;
  granted: boolean;
  cancelled: { readonly error: unknown } | null;
}
function proceed(call: QvmFunctionCall): QvmSystemCallResult { return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed(); }

/** Original Touch_Item keeps its caller stack, feedback, targets and item lifecycle. */
export class QvmPrimaryPickups {
  private readonly frames: Frame[] = [];
  private readonly removals: (() => void)[] = [];
  private readonly items: readonly QvmCatalogRecord[] | null;
  private readonly returns = new Map<QvmPickupGrant, number>();
  private readonly returnPCs = new Map<number, number>();
  private closed = false;
  private readonly evaluating: { readonly frame: Frame; readonly region: QvmRegionEvaluation; entered: boolean }[] = [];
  constructor(private readonly options: Options) {
    const { game, artifact, profile } = options, module = game.module.profile.module;
    if (artifact.module.id !== module.id || artifact.module.digest !== module.digest || profile.module.id !== module.id
      || profile.module.digest !== module.digest || profile.module.revision !== module.revision || profile.module.artifactPath !== module.artifactPath
      || profile.abiProfile !== game.module.abiProfile) throw new Error("Original pickup profile differs from its QVM executable");
    for (const field of Object.values(profile.fields)) if (!Number.isInteger(field) || field < 0 || field % 4 !== 0 || field + 4 > profile.entityStride)
      throw new Error("Original pickup field is outside its entity record");
    const entry = (index: number): void => { if (artifact.image.instructions[index]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Original pickup requires a source function entry"); };
    const calls = (target: number, indices: readonly number[]): void => {
      entry(target);
      for (const index of indices) {
        const instruction = artifact.image.instructions[index], previous = artifact.image.instructions[index - 1];
        if (instruction?.opcode !== QvmOpcode.OP_CALL || previous?.opcode !== QvmOpcode.OP_CONST || previous.operand !== target)
          throw new Error("Original pickup call site differs from its qualified target");
        this.returnPCs.set(index, instruction.byteOffset + 1);
      }
    };
    entry(profile.touch); entry(profile.free); calls(profile.gate.entry, profile.gate.calls); calls(profile.targets.entry, profile.targets.calls);
    const types = new Set<number>();
    for (const grant of profile.grants) {
      if (types.has(grant.itemType)) throw new Error("Original pickup has duplicate grant types"); types.add(grant.itemType);
      calls(grant.entry, grant.calls);
      const operation = grant.operation;
      if (operation.kind === "region") {
        qualifyQvmRegion(artifact.image.instructions, grant.entry, operation.entry, operation.join);
        if (operation.weapon !== undefined) qualifyQvmRegionEvaluation(artifact.image.instructions, grant.entry, operation.weapon.quantity);
      } else {
        const value = artifact.image.instructions[operation.acceptedReturn], leave = artifact.image.instructions[operation.acceptedReturn + 1];
        if (value?.opcode !== QvmOpcode.OP_CONST || leave?.opcode !== QvmOpcode.OP_LEAVE || value.operand === 0)
          throw new Error("Original pickup lifecycle return is not a qualified source constant");
        let owner = operation.acceptedReturn;
        while (owner >= 0 && artifact.image.instructions[owner]?.opcode !== QvmOpcode.OP_ENTER) owner--;
        if (owner !== grant.entry) throw new Error("Original pickup lifecycle return belongs to another source function");
        this.returns.set(grant, value.operand);
      }
    }
    if (profile.items.source === "live" && options.catalog === undefined) throw new Error("Live original pickups require their source catalog owner");
    this.items = options.catalog === undefined ? readQvmItemRecords(artifact.image.initializedData, profile.items) : null;
    const bind = (index: number, hook: (call: QvmFunctionCall) => QvmSystemCallResult): void => {
      this.removals.push(game.module.bindInvocation({ kind: "qvm", module, instructionIndex: index }, hook));
    };
    try {
      bind(profile.touch, call => this.touch(call));
      bind(profile.gate.entry, call => this.gate(call));
      for (const grant of profile.grants) bind(grant.entry, call => this.grant(call, grant));
      bind(profile.targets.entry, call => this.targets(call));
      if (options.lifetime.kind === "own-free-hook") bind(profile.free, call => {
        const pointer = call.words.getInt32(0, true), slot = game.data.numberFromPointer(pointer), actor = options.actor(slot);
        const finish = (result: number): number => {
          if (actor !== null && this.entity(slot).getInt32(profile.fields.inuse, true) === 0 && options.lifetime.kind === "own-free-hook") options.lifetime.retire(actor);
          this.afterFree(pointer, call); return result;
        };
        const result = proceed(call); return typeof result === "number" ? finish(result) : result.then(finish);
      });
    } catch (error) { this.close(); throw error; }
  }
  private entity(slot: number): DataView {
    const { data } = this.options.game;
    if (data.entityStrideBytes !== this.options.profile.entityStride || data.clientStrideBytes !== this.options.profile.clientStride)
      throw new Error("Original pickup source records differ from their profile");
    return data.entityBytes(slot);
  }
  private from(call: QvmFunctionCall, sites: readonly number[]): boolean {
    // QVM OP_CALL writes its return byte PC eight bytes before the live argument words.
    const offset = call.words.byteOffset - call.memory.byteOffset - 8;
    if (offset < 0) return false;
    const pc = call.guest.dataView(offset, 4).getInt32(0, true);
    return sites.some(site => this.returnPCs.get(site) === pc);
  }
  private live(frame: Frame): boolean {
    return !this.closed && !frame.invalid && this.options.current(frame.item, frame.itemSlot) && this.options.current(frame.recipient, frame.recipientSlot)
      && this.entity(frame.itemSlot).getInt32(this.options.profile.fields.inuse, true) !== 0
      && this.entity(frame.recipientSlot).getInt32(this.options.profile.fields.inuse, true) !== 0
      && this.entity(frame.itemSlot).getInt32(this.options.profile.fields.item, true) === frame.itemRecord.address
      && this.entity(frame.itemSlot).getInt32(160, true) === frame.itemRecord.index
      && this.entity(frame.recipientSlot).getInt32(this.options.profile.fields.client, true) === frame.playerPointer
      && (frame.selection.kind !== "replacement" || frame.selection.current());
  }
  private cancel(frame: Frame, call: Pick<QvmFunctionCall, "cancelFunction">): never {
    try { return call.cancelFunction(frame.cancellation); } catch (error) { frame.cancelled = { error }; throw error; }
  }
  private touch(call: QvmFunctionCall): QvmSystemCallResult {
    if (this.closed) return proceed(call);
    const { game, profile } = this.options, itemPointer = call.words.getInt32(0, true), recipientPointer = call.words.getInt32(4, true);
    const itemSlot = game.data.numberFromPointer(itemPointer), recipientSlot = game.data.numberFromPointer(recipientPointer), recipient = this.entity(recipientSlot);
    const playerPointer = recipient.getInt32(profile.fields.client, true);
    if (playerPointer === 0 || recipient.getInt32(profile.fields.health, true) < 1) return proceed(call);
    const entity = this.entity(itemSlot), itemRecord = (this.options.catalog?.records() ?? this.items ?? []).find(item => item.address === entity.getInt32(profile.fields.item, true));
    if (itemRecord === undefined || itemRecord.index !== entity.getInt32(160, true)) throw new Error("Original pickup has an undeclared source item descriptor");
    const item = this.options.actor(itemSlot), actor = this.options.actor(recipientSlot);
    if (item === null || actor === null) throw new Error("Original pickup requires live canonical source actors");
    const resolved = this.options.resolveItem(itemRecord), count = entity.getInt32(profile.fields.count, true);
    const offer: OriginalPickupOffer = { recipient: actor.id, pickup: item.id, source: profile.module.id, item: resolved.item, defaultResource: resolved.resource,
      count: count === 0 ? { kind: "default" } : { kind: "override", amount: count }, dropped: (entity.getInt32(profile.fields.flags, true) & profile.droppedFlag) !== 0,
      time: this.options.time(), ...(profile.objectiveTypes.includes(itemRecord.type) ? { grant: "map-coupled" } : {}) };
    const cancellation = call.cancellationScope();
    return this.options.runSource(offer, selection => {
      const frame: Frame = { call, offer, supply: null, cancellation, item, recipient: actor, itemSlot, recipientSlot, itemPointer, playerPointer, recipientPointer, itemRecord,
        grant: profile.grants.find(grant => grant.itemType === itemRecord.type), selection, invalid: false, granted: false, cancelled: null };
      if (selection.kind === "blocked" || selection.kind === "stale") return 0;
      if (selection.kind === "replacement" && frame.grant === undefined) throw new Error("Original pickup replacement has no qualified grant boundary");
      this.frames.push(frame);
      const stop = game.module.memory.observeWrites([itemPointer, recipientPointer].map(pointer => ({ byteOffset: pointer + profile.fields.inuse, byteLength: 4 })), () => {
        if (entity.getInt32(profile.fields.inuse, true) === 0 || recipient.getInt32(profile.fields.inuse, true) === 0) frame.invalid = true;
        return undefined;
      });
      const finish = (): void => { stop(); const index = this.frames.indexOf(frame); if (index >= 0) this.frames.splice(index, 1); if (this.closed && this.frames.length === 0) this.dispose(); };
      try {
        const result = proceed(call);
        if (typeof result !== "number") return result.catch((error: unknown) => { if (frame.cancelled === null || error !== frame.cancelled.error) throw error; return 0; }).finally(finish);
        finish(); return result;
      } catch (error) { finish(); if (frame.cancelled === null || error !== frame.cancelled.error) throw error; return 0; }
    });
  }
  private gate(call: QvmFunctionCall): QvmSystemCallResult {
    const frame = this.frames.at(-1), { profile } = this.options;
    if (frame === undefined || !this.from(call, profile.gate.calls) || call.words.getInt32(profile.gate.itemArgument * 4, true) !== frame.itemPointer
      || call.words.getInt32(profile.gate.playerArgument * 4, true) !== frame.playerPointer) return proceed(call);
    if (!this.live(frame)) this.cancel(frame, call);
    if (frame.selection.kind !== "replacement" || frame.grant === undefined) return proceed(call);
    const eligible = frame.grant.eligible({ call, item: this.entity(frame.itemSlot), player: this.options.game.module.memory.dataView(frame.playerPointer, this.options.profile.clientStride) });
    const finish = (value: boolean): number => { call.effect(() => { if (!this.live(frame)) this.cancel(frame, call); return undefined; }); return value ? 1 : 0; };
    return typeof eligible === "boolean" ? finish(eligible) : eligible.then(finish);
  }
  supply(offer: OriginalPickupOffer): { readonly offer: PickupSupplyOffer; readonly quantity?: (count: number) => number } {
    const frame = this.frames.at(-1);
    if (frame === undefined || !frame.granted || frame.supply === null || frame.offer.item !== offer.item
      || !frame.item.id.equals(offer.pickup) || !frame.recipient.id.equals(offer.recipient) || !this.live(frame))
      throw new Error("Selected QVM supply requires its held original grant");
    return frame.supply;
  }
  private quantity(frame: Frame, grant: QvmPickupGrant, weapon: NonNullable<Extract<QvmPickupGrant["operation"], { readonly kind: "region" }>["weapon"]>, count: number): number {
    if (this.frames.at(-1) !== frame || frame.supply === null || !this.live(frame)) throw new Error("Original pickup quantity has expired");
    const word = Math.trunc(count);
    if (!Number.isFinite(count) || word < -0x80000000 || word > 0x7fffffff) throw new Error("Original QVM pickup counter exceeds its int32 ABI");
    const ammo = this.options.supply?.ammo(frame.itemRecord), project = this.options.supply?.project;
    if (weapon.storage === "inventory" && project === undefined) throw new Error("Original pickup requires its declared inventory projection");
    const writes = weapon.storage === "inventory" ? ammo == null ? [] : project?.(frame.recipient, ammo, word) ?? []
      : [{ address: frame.playerPointer + weapon.ammoOffset + frame.itemRecord.tag * 4, value: word }];
    const restore = this.project(writes), evaluation = { frame, region: weapon.quantity, entered: false }; this.evaluating.push(evaluation);
    try { return this.options.game.module.call([frame.itemPointer, frame.recipientPointer], grant.entry); }
    finally { restore(); this.evaluating.pop(); }
  }
  private project(writes: readonly QvmInventoryWord[]): () => void {
    const bytes = this.options.game.module.memory.bytes;
    const fields = writes.map(value => ({ view: new DataView(bytes.buffer, bytes.byteOffset + value.address, 4), value: value.value }));
    const before = fields.map(field => field.view.getInt32(0, true));
    for (const field of fields) field.view.setInt32(0, field.value, true);
    let active = true;
    return () => { if (active) { active = false; fields.forEach((field, index) => { const value = before[index]; if (value === undefined) throw new Error("Original pickup projection lost its word"); field.view.setInt32(0, value, true); }); } };
  }
  private grant(call: QvmFunctionCall, grant: QvmPickupGrant): QvmSystemCallResult {
    const evaluation = this.evaluating.at(-1);
    if (evaluation !== undefined && !evaluation.entered) {
      if (evaluation.frame.grant !== grant || !this.live(evaluation.frame) || call.words.getInt32(0, true) !== evaluation.frame.itemPointer
        || call.words.getInt32(4, true) !== evaluation.frame.recipientPointer) throw new Error("Original pickup evaluation lost its source caller");
      evaluation.entered = true;
      return call.evaluateRegion(evaluation.region, []);
    }
    const frame = this.frames.at(-1);
    if (frame === undefined || frame.grant !== grant || !this.from(call, grant.calls)
      || call.words.getInt32(0, true) !== frame.itemPointer || call.words.getInt32(4, true) !== frame.recipientPointer) return proceed(call);
    if (!this.live(frame)) this.cancel(frame, call);
    if (frame.selection.kind !== "replacement") return proceed(call);
    const take = (): void => {
      if (frame.granted) throw new Error("Original pickup source caller attempted a second grant");
      frame.granted = true;
      if (frame.selection.kind !== "replacement" || frame.selection.grant() !== "accepted" || !this.live(frame)) this.cancel(frame, call);
    };
    const operation = grant.operation;
    if (operation.kind === "return") {
      take();
      const result = this.returns.get(grant); if (result === undefined) throw new Error("Missing original pickup lifecycle return"); return result;
    }
    const supply = this.options.supply, weapon = operation.weapon;
    let writes: readonly QvmInventoryWord[] = [];
    if (weapon !== undefined && supply !== undefined) {
      const owned = supply.owns(frame.recipient, frame.offer.item);
      if (weapon.storage === "inventory") {
        if (supply.project === undefined) throw new Error("Original pickup requires its declared inventory projection");
        writes = supply.project(frame.recipient, frame.offer.item, Number(owned));
      } else {
        const address = frame.playerPointer + weapon.bitsOffset, before = this.options.game.module.memory.dataView(address, 4).getInt32(0, true), mask = 1 << frame.itemRecord.tag;
        writes = [{ address, value: owned ? before | mask : before & ~mask }];
      }
    }
    const restore = this.project(writes);
    call.regions([{ entry: operation.entry, join: operation.join, run: control => {
      restore();
      if (!this.live(frame)) this.cancel(frame, control);
      if (supply !== undefined) {
        const ammo = supply.ammo(frame.itemRecord), amount = control.localWord(operation.quantity);
        if (weapon === undefined && ammo === null) throw new Error("Original ammo pickup has no admitted source counter");
        frame.supply = { offer: weapon === undefined && ammo !== null ? { kind: "ammo", offer: { item: ammo, amount } }
          : { kind: "weapon", offer: { item: frame.offer.item, ammo: ammo === null ? [] : [{ item: ammo, amount }] } },
          ...(weapon === undefined ? {} : { quantity: (count: number) => this.quantity(frame, grant, weapon, count) }) };
      }
      try { take(); return "skip"; } finally { frame.supply = null; }
    } }]);
    try {
      const result = proceed(call);
      if (typeof result !== "number") return result.finally(restore);
      restore(); return result;
    } catch (error) { restore(); throw error; }
  }
  private targets(call: QvmFunctionCall): QvmSystemCallResult {
    const frame = this.frames.at(-1);
    if (frame === undefined || !this.from(call, this.options.profile.targets.calls)) return proceed(call);
    if (!this.live(frame)) this.cancel(frame, call);
    const finish = (result: number): number => { call.effect(() => { if (!this.live(frame)) this.cancel(frame, call); return undefined; }); return result; };
    const result = proceed(call); return typeof result === "number" ? finish(result) : result.then(finish);
  }
  afterFree(pointer: number, control: Pick<QvmFunctionCall, "cancelFunction">): void {
    this.options.game.data.numberFromPointer(pointer);
    if (this.options.game.module.memory.dataView(pointer + this.options.profile.fields.inuse, 4).getInt32(0, true) !== 0) return;
    for (const frame of [...this.frames].reverse()) if (frame.itemPointer === pointer || frame.recipientPointer === pointer) { frame.invalid = true; this.cancel(frame, control); }
  }
  assertIdle(): void { if (this.frames.length !== 0) throw new Error("Cannot save during original QVM pickup execution"); }
  private dispose(): void { for (const remove of this.removals.splice(0)) remove(); }
  close(): void { this.closed = true; if (this.frames.length === 0) this.dispose(); }
}
