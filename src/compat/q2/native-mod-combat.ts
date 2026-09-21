import type { GuestAddress, GuestCallResult, GuestCallValue, GuestValueLayout } from "../../contracts/execution.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { AttackProvenance, DamageOutcome, DamageRequest, Q2NativeCause } from "../../contracts/gameplay.ts";
import type { NativeModDeclaration, NativeModScalarField, NativeModSourceActors } from "../../contracts/native-mod-callbacks.ts";
import type { ActorCallbacks, DeathReaction, PainReaction, TouchContact } from "../../contracts/world.ts";
import type { BspPlane, Q2SurfaceInfo, TraceResult } from "../../contracts/scene.ts";
import type { GuestCallSignature, GuestWrittenRange } from "../../guest/core/contracts.ts";
import type { SourceDamageObserver, SourceDamageResult } from "../../world/gameplay/authority.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { NativeModHost } from "../../app/bootstrap/simulation/native-mod-host.ts";
import { canonicalCauseFromNative, nativeCauseFromCanonical } from "../../content/q2/missionpacks/damage.ts";
import { q2NativeDamageArguments } from "./native-damage.ts";
import { rereleaseModLayout } from "./rerelease/native-entries.ts";
import { readClassicString, readClassicVector, writeClassicVector } from "./classic/records.ts";
import { bindNativeModEntry, type NativeModEntryBinding } from "./native-mod-entries.ts";
import { integer, requiredPointer } from "../../guest/runtime/common/memory.ts";
import { NativeModDeferredDamageState, type SavedNativeDeferredDamage } from "./native-mod-deferred.ts";
import { NativeModArmorState } from "./native-mod-armor.ts";

const P: GuestValueLayout = { kind: "scalar", storage: "pointer" }, I: GuestValueLayout = { kind: "scalar", storage: "int32" }, F: GuestValueLayout = { kind: "scalar", storage: "float32" }, B: GuestValueLayout = { kind: "scalar", storage: "uint8" };
const pointer = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });
const int = (value: number): GuestCallValue => ({ kind: "int32", value: Math.trunc(value) });
type Kind = "use" | "touch" | "pain" | "die";
interface DamageFrame { readonly request: DamageRequest; readonly observer: SourceDamageObserver; result: SourceDamageResult | null; applied: number; }
export interface NativeModCombatCalls {
  eligible(actor: ActorId): boolean;
  actor(address: GuestAddress): ActorId;
  address(actor: ActorId): GuestAddress;
  owner(slot: number): OwnedActor | null;
  scalar(address: GuestAddress, field: NativeModScalarField, value?: number): number;
  transfer<Result>(invoke: () => Result): Result;
  synchronize(): void;
}

/** Original damage and callback bodies remain guest-owned; only their shared boundaries compose. */
export class NativeModCombat {
  private readonly entries = new Map<bigint, { readonly kind: Kind; readonly binding: NativeModEntryBinding }>();
  private readonly damage: NativeModEntryBinding | null;
  private readonly deferred: NativeModDeferredDamageState | null;
  private readonly process: NativeModEntryBinding | null;
  private readonly armor: NativeModArmorState;
  private readonly frames: DamageFrame[] = [];
  private watched: { readonly base: GuestAddress; readonly bytes: number; readonly close: () => void } | null = null;
  private suspended = false;
  constructor(readonly definition: NativeModSourceActors, readonly declaration: NativeModDeclaration, readonly host: NativeModHost,
    readonly services: ModHostServices, readonly instance: ProviderId, readonly calls: NativeModCombatCalls) {
    const combat = definition.combat;
    this.armor = new NativeModArmorState(combat?.armor ?? { kind: "none" }, declaration, host, calls.scalar);
    if (combat === undefined) this.damage = null;
    else {
      const entry = combat.damage.entry, address = entry.kind === "export" ? host.entry(entry.name) : host.memory.offset(host.imageBase, BigInt(entry.rva));
      const signature = this.signature([P, P, P, P, P, P, I, I, I, combat.damage.abi === "q2-classic" ? I : { kind: "aggregate", layout: rereleaseModLayout }]);
      this.damage = bindNativeModEntry(host, address, `${instance}:damage`, signature, values => {
        const request = this.request(values), target = services.actors.resolveOwned(request.target);
        if (target === null || !this.eligible(request.target, request.attack.attacker, request.attack.inflictor)) return { kind: "void" };
        if (target.owner === instance) this.apply(request); else { calls.transfer(() => services.combat.apply(request)); calls.synchronize(); }
        return { kind: "void" };
      }, () => !this.suspended);
    }
    if (combat?.deferred === undefined) { this.deferred = null; this.process = null; }
    else {
      const deferred = new NativeModDeferredDamageState(combat.deferred, combat.health, host, services, calls, () => this.frames.at(-1)?.request ?? null);
      this.deferred = deferred;
      const entry = combat.deferred.process, address = entry.kind === "export" ? host.entry(entry.name) : host.memory.offset(host.imageBase, BigInt(entry.rva));
      try {
        this.process = bindNativeModEntry(host, address, `${instance}:deferred-damage`, this.signature([P]), (values, original) => {
          const slot = this.slot(requiredPointer(values, 0)), actor = calls.owner(slot);
          return actor === null ? original(values) : deferred.process(actor.id, slot, () => original(values));
        }, () => !this.suspended);
      } catch (error) { this.damage?.close(); throw error; }
    }
  }
  private signature(parameters: readonly GuestValueLayout[]): GuestCallSignature { return { abi: this.declaration.target.abi, parameters, result: "void", variadic: false }; }
  private offset(kind: Kind): number | null { return kind === "use" ? this.definition.fields.use : this.definition.callbacks?.[kind] ?? null; }
  private at(slot: number, offset: number): GuestAddress { return this.host.memory.offset(this.host.entity(slot).address, BigInt(offset)); }
  private slot(address: GuestAddress): number {
    const table = this.host.entities(), difference = address.byteOffset - table.base.byteOffset;
    if (difference < 0n || difference % BigInt(table.stride) !== 0n || difference / BigInt(table.stride) >= BigInt(table.count)) throw new Error("Native callback actor is outside its source table");
    return Number(difference / BigInt(table.stride));
  }
  private nullable(value: GuestCallValue | undefined): ActorId | null {
    if (value?.kind !== "pointer") throw new Error("Native callback requires an actor pointer");
    return value.value === null ? null : this.calls.actor(value.value);
  }
  private pointer(actor: ActorId | null): GuestCallValue { return pointer(actor === null ? null : this.calls.address(actor)); }
  private eligible(...actors: readonly (ActorId | null | undefined)[]): boolean { return actors.every(actor => actor === null || actor === undefined || this.calls.eligible(actor)); }
  private allowsPain(reaction: PainReaction): boolean { return this.eligible(reaction.self.id, reaction.attacker, reaction.attack?.attacker, reaction.attack?.inflictor); }
  private allowsDie(reaction: DeathReaction): boolean { return this.allowsPain(reaction) && this.eligible(reaction.inflictor); }
  private allowsTouch(contact: TouchContact): boolean {
    const hit = contact.sourceTrace?.trace.hit;
    return this.eligible(contact.self.id, contact.other, contact.sourceTrace?.ent, hit?.kind === "actor" ? hit.actor : null);
  }
  private parameters(kind: Kind): readonly GuestValueLayout[] {
    const rr = this.definition.callbacks?.abi === "q2-rerelease";
    switch (kind) { case "use": return [P,P,P]; case "touch": return rr ? [P,P,P,B] : [P,P,P,P]; case "pain": return rr ? [P,P,F,I,P] : [P,P,F,I]; case "die": return rr ? [P,P,P,I,P,P] : [P,P,P,I,P]; }
  }
  private ensure(kind: Kind, slot: number): NativeModEntryBinding | null {
    const offset = this.offset(kind); if (offset === null) return null;
    const address = this.host.memory.readPointer(this.at(slot, offset)); if (address === null) return null;
    const prior = this.entries.get(address.byteOffset);
    if (prior !== undefined) { if (prior.kind !== kind) throw new Error("One native callback entry has incompatible declared ABIs"); return prior.binding; }
    const binding = bindNativeModEntry(this.host, address, `${this.instance}:actor-${kind}-${address.byteOffset}`, this.signature(this.parameters(kind)), (args, original) => {
      const self = this.calls.owner(this.slot(requiredPointer(args, 0)));
      if (self === null) return original(args);
      const actual = this.host.memory.readPointer(this.at(this.slot(requiredPointer(args, 0)), offset));
      if (actual?.byteOffset !== address.byteOffset) return original(args);
      return this.source(kind, self, args, original);
    }, () => !this.suspended);
    this.entries.set(address.byteOffset, { kind, binding }); return binding;
  }
  private watch(): void {
    const table = this.host.entities(), bytes = table.stride * table.capacity;
    if (this.watched?.base.byteOffset === table.base.byteOffset && this.watched.bytes === bytes) return;
    this.watched?.close();
    this.watched = { base: table.base, bytes, close: this.host.memory.observeWrites(table.base, bytes, ranges => this.changed(ranges)) };
  }
  private changed(ranges: readonly GuestWrittenRange[]): void {
    if (this.suspended) return;
    const table = this.host.entities();
    for (const range of ranges) for (let slot = Math.floor(range.byteOffset / table.stride); slot <= Math.floor((range.byteOffset + range.byteLength - 1) / table.stride); slot++) {
      if (this.calls.owner(slot) === null) continue;
      this.deferred?.changed(slot, { byteOffset: range.byteOffset - slot * table.stride, byteLength: range.byteLength });
      for (const kind of ["use", "touch", "pain", "die"] satisfies readonly Kind[]) {
        const offset = this.offset(kind); if (offset === null) continue;
        const start = slot * table.stride + offset;
        if (range.byteOffset < start + this.host.memory.pointerBytes && start < range.byteOffset + range.byteLength) this.ensure(kind, slot);
      }
    }
  }
  bind(slot: number, actor: OwnedActor): ActorCallbacks {
    this.validate(); this.watch(); for (const kind of ["use", "touch", "pain", "die"] satisfies readonly Kind[]) this.ensure(kind, slot);
    const combat = this.definition.combat;
    if (combat !== undefined) {
      const scalar = (field: NativeModScalarField, value?: number) => this.calls.scalar(this.host.entity(slot).address, field, value);
      const flags = () => BigInt(scalar(combat.flags));
      this.services.combat.rebind(actor, { sourceDamage: request => this.apply(request), read: () => ({ health: scalar(combat.health), mass: scalar(combat.mass),
        armor: this.armor.read(slot), canTakeDamage: scalar(combat.takedamage) !== 0, invulnerable: (flags() & BigInt(combat.flags.invulnerable)) !== 0n,
        noKnockback: (flags() & BigInt(combat.flags.noKnockback)) !== 0n, team: null }),
        writeHealth: value => { scalar(combat.health, value); return undefined; },
        writeArmor: armor => this.armor.write(slot, armor) });
    }
    return { think: null, use: (_self, other, activator) => this.eligible(actor.id, other, activator) ? this.call("use", slot, [this.pointer(actor.id), this.pointer(other), this.pointer(activator)]) : undefined,
      touch: contact => this.withTouch(contact, args => this.call("touch", slot, args)), pain: reaction => this.withPain(reaction, args => this.call("pain", slot, args)),
      die: reaction => this.withDie(reaction, args => this.call("die", slot, args)) };
  }
  private call(kind: Kind, slot: number, args: readonly GuestCallValue[]): undefined {
    const entry = this.ensure(kind, slot); if (entry !== null) this.calls.transfer(() => entry.original(args)); return undefined;
  }
  private source(kind: Kind, self: OwnedActor, args: readonly GuestCallValue[], original: NativeModEntryBinding["original"]): GuestCallResult {
    const callbacks = this.services.callbacks; if (callbacks === undefined) throw new Error("Native callbacks require shared actor operations");
    const proceed = (values: readonly GuestCallValue[]): undefined => { this.calls.synchronize(); original(values); return undefined; };
    if (kind === "use") {
      const other = this.nullable(args[1]), activator = this.nullable(args[2]);
      callbacks.sourceUse(self, other, activator, (actor, nextOther, nextActivator) => {
        if (actor.id !== self.id) throw new Error("Native source callback target changes require replacement");
        if (!this.eligible(actor.id, nextOther, nextActivator)) return undefined;
        return proceed(nextOther === other && nextActivator === activator ? args : [this.pointer(actor.id), this.pointer(nextOther), this.pointer(nextActivator)]);
      });
    } else if (kind === "touch") {
      const contact = this.touch(self, args);
      callbacks.sourceTouch(contact, effective => {
        if (effective.self.id !== self.id) throw new Error("Native source callback target changes require replacement");
        if (!this.allowsTouch(effective)) return undefined;
        return effective === contact ? proceed(args) : this.withTouch(effective, proceed);
      });
    }
    else {
      const current = this.frames.at(-1), amount = Number(integer(args, 3)), attacker = this.nullable(args[kind === "pain" ? 1 : 2]);
      const result: SourceDamageResult = { reaction: kind === "pain" ? "pain" : "death", appliedDamage: amount };
      if (current?.request.target === self.id && current.result === null) { current.result = result; current.observer.beforeReaction(result); }
      const request = current?.request.target === self.id ? current.request : this.deferred?.attack(self.id);
      const attack = request?.attack ?? this.reactionAttack(kind, args, attacker);
      const kickValue = args[2], kick = kind === "pain" && kickValue?.kind === "float32" ? kickValue.value : request?.knockback ?? 0;
      const reaction: PainReaction = { self, attack, attacker, kick, damage: amount };
      if (kind === "pain") callbacks.sourcePain(reaction, effective => {
        if (effective.self.id !== self.id) throw new Error("Native source callback target changes require replacement");
        if (!this.allowsPain(effective)) return undefined;
        return effective === reaction ? proceed(args) : this.withPain(effective, proceed);
      });
      else {
        const death = { ...reaction, inflictor: this.nullable(args[1]), point: readClassicVector(this.host.memory, requiredPointer(args, 4)) };
        callbacks.sourceDie(death, effective => {
          if (effective.self.id !== self.id) throw new Error("Native source callback target changes require replacement");
          if (!this.allowsDie(effective)) return undefined;
          return effective === death ? proceed(args) : this.withDie(effective, proceed);
        });
      }
    }
    return { kind: "void" };
  }
  private provenance(attacker: ActorId | null, inflictor: ActorId | null, native: Q2NativeCause): AttackProvenance {
    const context = this.services.damageContext?.(this.instance), meansOfDeath = canonicalCauseFromNative(native);
    if (context === undefined || meansOfDeath === null) throw new Error("Native damage requires declared source cause and shared attack provenance");
    return { ...context, time: this.services.time(), attacker, inflictor, weapon: null, cause: { kind: "q2", meansOfDeath, damageFlags: 0, native } };
  }
  private native(value: GuestCallValue | undefined): Q2NativeCause {
    const causes = this.definition.combat?.causes;
    if (causes === undefined) throw new Error("Native damage causes have not been declared");
    if (causes.edition === "classic") { if (value?.kind !== "int32") throw new Error("Classic damage requires integer MOD"); return { ...causes, value: value.value }; }
    if (value?.kind !== "aggregate" || value.bytes.length !== 3 || value.bytes[0] === undefined) throw new Error("Rerelease damage requires its declared mod_t aggregate");
    return { edition: "rerelease", id: value.bytes[0], friendlyFire: value.bytes[1] !== 0, noPointLoss: value.bytes[2] !== 0 };
  }
  private reactionAttack(kind: "pain" | "die", args: readonly GuestCallValue[], attacker: ActorId | null): AttackProvenance | null {
    if (this.definition.combat === undefined) return null;
    if (this.definition.callbacks?.abi !== "q2-rerelease") return null;
    const mod = requiredPointer(args, kind === "pain" ? 4 : 5), bytes = this.host.memory.copy(mod, 3);
    return this.provenance(attacker, kind === "die" ? this.nullable(args[1]) : attacker, this.native({ kind: "aggregate", layout: rereleaseModLayout, bytes }));
  }
  private request(args: readonly GuestCallValue[]): DamageRequest {
    const target = this.calls.actor(requiredPointer(args, 0)), inflictor = this.nullable(args[1]), attacker = this.nullable(args[2]), flags = Number(integer(args, 8));
    const attack = this.provenance(attacker, inflictor, this.native(args[9]));
    if (attack.cause.kind !== "q2") throw new Error("Native cause was not classified");
    return { target, amount: Number(integer(args, 6)), knockback: Number(integer(args, 7)), direction: readClassicVector(this.host.memory, requiredPointer(args, 3)),
      point: readClassicVector(this.host.memory, requiredPointer(args, 4)), normal: readClassicVector(this.host.memory, requiredPointer(args, 5)), delivery: (flags & 1) !== 0 ? "radius" : "direct",
      attack: { ...attack, cause: { ...attack.cause, damageFlags: flags } } };
  }
  private apply(input: DamageRequest): DamageOutcome {
    const definition = this.definition.combat, damage = this.damage;
    if (definition === undefined || damage === null) throw new Error("Native damage body has not been declared");
    return this.services.combat.runSourceDamage(input, (observer, request) => {
      if (!this.eligible(request.target, request.attack.attacker, request.attack.inflictor)) return { reaction: "none", appliedDamage: 0 };
      const world = this.services.engine?.world(); if (world === undefined) throw new Error("Native damage requires its destination world actor");
      const target = this.calls.address(request.target), inflictor = this.pointer(request.attack.inflictor ?? world), attacker = this.pointer(request.attack.attacker ?? world);
      return this.calls.transfer(() => {
        const slot = this.slot(target), memory = this.host.memory;
        const frame: DamageFrame = { request, observer, result: null, applied: 0 }, removals: (() => void)[] = [];
        let health = this.calls.scalar(target, definition.health), velocity = readClassicVector(memory, this.at(slot, this.definition.fields.velocity));
        const current = () => this.frames.at(-1) === frame && frame.result === null && this.host.active(slot) && this.services.actors.isLive(request.target);
        const vectors = memory.allocate({ byteLength: 36, alignment: 4n, label: "Native mod damage vectors" }); this.frames.push(frame);
        try {
          removals.push(this.armor.observe(slot, (before, after) => { if (current()) observer.stored({ kind: "armor", before, after }); }));
          removals.push(memory.observeWrites(this.at(slot, definition.health.offset), this.scalarBytes(definition.health), () => {
            const before = health, after = this.calls.scalar(target, definition.health); health = after;
            if (current() && before !== after) { frame.applied += before - after; observer.stored({ kind: "health", before, after }); }
          }));
          removals.push(memory.observeWrites(this.at(slot, this.definition.fields.velocity), 12, () => {
            const before = velocity, after = readClassicVector(memory, this.at(slot, this.definition.fields.velocity)); velocity = after;
            if (current()) observer.stored({ kind: "source-velocity", before, after, movementProvider: request.attack.movementProvider });
          }));
          [request.direction, request.point, request.normal].forEach((value, index) => writeClassicVector(memory, memory.offset(vectors, BigInt(index * 12)), value));
          const cause = q2NativeDamageArguments(request, definition.causes), native = cause.native;
          if (native === null) throw new Error("Shared attack has no declared native cause representation");
          damage.original([pointer(target), inflictor, attacker,
            pointer(vectors), pointer(memory.offset(vectors, 12n)), pointer(memory.offset(vectors, 24n)), int(request.amount), int(request.knockback), int(cause.damageFlags),
            native.edition === "classic" ? int(native.value) : { kind: "aggregate", layout: rereleaseModLayout, bytes: new Uint8Array([native.id, Number(native.friendlyFire), Number(native.noPointLoss)]) }]);
          return frame.result ?? { reaction: "none", appliedDamage: frame.applied };
        } finally { this.frames.pop(); for (const remove of removals) remove(); memory.unmap(vectors, 36); }
      });
    });
  }
  private scalarBytes(field: NativeModScalarField): number { return field.encoding.endsWith("64") ? 8 : field.encoding.endsWith("16") ? 2 : field.encoding.endsWith("8") ? 1 : 4; }
  validate(): void {
    const stride = this.host.entities().stride, combat = this.definition.combat;
    for (const kind of ["use", "touch", "pain", "die"] satisfies readonly Kind[]) { const offset = this.offset(kind); if (offset !== null && offset + this.host.memory.pointerBytes > stride) throw new Error("Native callback field exceeds its source actor"); }
    if (combat !== undefined) for (const field of [combat.health, combat.mass, combat.takedamage, combat.flags]) if (field.offset + this.scalarBytes(field) > stride) throw new Error("Native combat field exceeds its source actor");
    const deferred = combat?.deferred;
    if (deferred !== undefined) {
      for (const [offset, bytes] of [[deferred.attacker, this.host.memory.pointerBytes], [deferred.inflictor, this.host.memory.pointerBytes], [deferred.blood.offset, this.scalarBytes(deferred.blood)], [deferred.knockback.offset, this.scalarBytes(deferred.knockback)], [deferred.point, 12], [deferred.mod, 3], [deferred.receipt, 1]]) {
        if (offset === undefined || bytes === undefined || !Number.isSafeInteger(offset) || offset < 0 || offset + bytes > stride) throw new Error("Native deferred damage field exceeds its source actor");
      }
    }
  }
  release(actor: ActorId): void { this.deferred?.release(actor); }
  checkpoint(): readonly SavedNativeDeferredDamage[] { return this.deferred?.checkpoint() ?? []; }
  validateSaved(records: readonly SavedNativeDeferredDamage[]): void { this.deferred?.validateSaved(records); }
  restore(records: readonly SavedNativeDeferredDamage[]): void { this.deferred?.restore(records); }
  suspend(value: boolean): void { this.suspended = value; if (value) { this.watched?.close(); this.watched = null; } }
  close(): void { this.watched?.close(); this.watched = null; for (const entry of this.entries.values()) entry.binding.close(); this.entries.clear(); this.damage?.close(); this.process?.close(); this.deferred?.clear(); }

  private withBytes<Result>(bytes: Uint8Array, run: (address: GuestAddress) => Result): Result {
    const memory = this.host.memory, address = memory.allocate({ byteLength: bytes.length, alignment: 8n, label: "Native mod callback value" });
    try { memory.write(address, bytes); return run(address); } finally { memory.unmap(address, bytes.length); }
  }
  private withMod<Result>(attack: AttackProvenance | null, run: (mod: GuestCallValue[]) => Result): Result {
    if (this.definition.callbacks?.abi !== "q2-rerelease") return run([]);
    const native = attack?.cause.kind === "q2" && attack.cause.native?.edition === "rerelease" ? attack.cause.native : nativeCauseFromCanonical({ edition: "rerelease" }, attack?.cause.kind === "q2" ? attack.cause.meansOfDeath : 0);
    if (native === null || native.edition !== "rerelease") throw new Error("Reaction has no native mod_t representation");
    return this.withBytes(new Uint8Array([native.id, Number(native.friendlyFire), Number(native.noPointLoss)]), address => run([pointer(address)]));
  }
  private withPain(reaction: PainReaction, run: (values: readonly GuestCallValue[]) => undefined): undefined {
    if (!this.allowsPain(reaction)) return undefined;
    return this.withMod(reaction.attack, mod => run([this.pointer(reaction.self.id), this.pointer(reaction.attacker), { kind: "float32", value: reaction.kick }, int(reaction.damage), ...mod]));
  }
  private withDie(reaction: DeathReaction, run: (values: readonly GuestCallValue[]) => undefined): undefined {
    if (!this.allowsDie(reaction)) return undefined;
    const bytes = new Uint8Array(12), view = new DataView(bytes.buffer); [reaction.point.x,reaction.point.y,reaction.point.z].forEach((value,index) => view.setFloat32(index * 4, value, true));
    return this.withBytes(bytes, point => this.withMod(reaction.attack, mod => run([this.pointer(reaction.self.id), this.pointer(reaction.inflictor), this.pointer(reaction.attacker), int(reaction.damage), pointer(point), ...mod])));
  }
  private plane(address: GuestAddress): BspPlane {
    const memory = this.host.memory; return { normal: readClassicVector(memory,address), distance: memory.readFloat32(memory.offset(address,12n)), type: memory.readUint8(memory.offset(address,16n)), signbits: memory.readUint8(memory.offset(address,17n)) };
  }
  private surface(address: GuestAddress | null, rerelease: boolean): Q2SurfaceInfo | null {
    if (address === null) return null; const memory = this.host.memory, size = rerelease ? 32 : 16;
    return { name: readClassicString(memory,address,size), flags: memory.readInt32(memory.offset(address,BigInt(size))), value: memory.readInt32(memory.offset(address,BigInt(size+4))), material: rerelease ? readClassicString(memory,memory.offset(address,44n),16) : "" };
  }
  private touch(self: OwnedActor, args: readonly GuestCallValue[]): TouchContact {
    const memory = this.host.memory, other = this.calls.actor(requiredPointer(args,1));
    if (this.definition.callbacks?.abi === "q2-rerelease") {
      const address = requiredPointer(args,2), sourcePlane = this.plane(memory.offset(address,20n)), surface = this.surface(memory.readPointer(memory.offset(address,40n)),true);
      const entAddress = memory.readPointer(memory.offset(address,56n)), ent = entAddress === null ? other : this.calls.actor(entAddress);
      const fraction = memory.readFloat32(memory.offset(address,4n)), plane2 = this.plane(memory.offset(address,64n)), surface2 = this.surface(memory.readPointer(memory.offset(address,88n)),true);
      const trace: Extract<TraceResult,{readonly kind:"q2"}> = { kind:"q2",allSolid:memory.readUint8(address)!==0,startSolid:memory.readUint8(memory.offset(address,1n))!==0,fraction,end:readClassicVector(memory,memory.offset(address,8n)),
        sourcePlane,contact:fraction<1?{kind:"plane",plane:sourcePlane}:{kind:"none"},contents:memory.readUint32(memory.offset(address,48n)),surface,hit:{kind:"actor",actor:ent},secondary:{plane:plane2,surface:surface2} };
      return {self,other,plane:sourcePlane,surface:surface===null?null:{name:surface.name,nativeFlags:surface.flags,nativeValue:surface.value},sourceTrace:{kind:"q2-rerelease",trace,ent,inverted:Number(integer(args,3))!==0}};
    }
    const plane = args[2], surface = args[3]; if (plane?.kind!=="pointer"||surface?.kind!=="pointer") throw new Error("Classic touch requires plane and surface pointers");
    const value=this.surface(surface.value,false);
    return {self,other,plane:plane.value===null?null:this.plane(plane.value),surface:value===null?null:{name:value.name,nativeFlags:value.flags,nativeValue:value.value}};
  }
  private withTouch(contact: TouchContact, run: (values: readonly GuestCallValue[]) => undefined): undefined {
    if (!this.allowsTouch(contact)) return undefined;
    if(this.definition.callbacks?.abi==="q2-rerelease") {
      if(contact.sourceTrace===undefined)throw new Error("Native rerelease touch requires the shared source trace");
      return this.withBytes(this.host.encodeTrace(contact.sourceTrace.trace),trace=>run([this.pointer(contact.self.id),this.pointer(contact.other),pointer(trace),{kind:"uint32",value:Number(contact.sourceTrace?.inverted ?? false)}]));
    }
    const plane = new Uint8Array(20), view = new DataView(plane.buffer), value = contact.plane;
    if(value!==null){[value.normal.x,value.normal.y,value.normal.z].forEach((n,i)=>view.setFloat32(i*4,n,true));view.setFloat32(12,value.distance,true);view.setUint8(16,value.normal.x===1?0:value.normal.y===1?1:value.normal.z===1?2:3);view.setUint8(17,(value.normal.x<0?1:0)|(value.normal.y<0?2:0)|(value.normal.z<0?4:0));}
    const surface = new Uint8Array(24), info=contact.surface, raw=new DataView(surface.buffer);if(info!==null){surface.set(new TextEncoder().encode(info.name).slice(0,16));raw.setInt32(16,info.nativeFlags,true);raw.setInt32(20,info.nativeValue,true);}
    return this.withBytes(plane,p=>this.withBytes(surface,s=>run([this.pointer(contact.self.id),this.pointer(contact.other),pointer(value===null?null:p),pointer(info===null?null:s)])));
  }
}
