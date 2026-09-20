import type { ArmorState, CombatState, DamageOutcome, DamageRequest } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { QvmModActorRecord, QvmModCallbackDeclaration, QvmModSourceCall } from "../../contracts/qvm-mod-callbacks.ts";
import type { DeathReaction, PainReaction, TouchContact } from "../../contracts/world.ts";
import type { SourceDamageObserver, SourceDamageResult } from "../../world/gameplay/authority.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { QvmFunctionCall } from "./interpreter.ts";
import { QvmOpcode } from "./image.ts";
import type { QvmModule, QvmModuleOptions } from "./module.ts";
import { QVM_TRACE_BYTES, writeQvmTrace } from "./trace-record.ts";

type ReactionKind = "touch" | "use" | "pain" | "die";
const callbackKinds: readonly ReactionKind[] = ["touch", "use", "pain", "die"];
const zero: Vec3 = { x: 0, y: 0, z: 0 };
interface Options {
  readonly module: QvmModule;
  readonly declaration: QvmModCallbackDeclaration;
  readonly services: ModHostServices;
  readonly owned: ReadonlyMap<ActorId, OwnedActor>;
  pointer(actor: ActorId | null): number;
  actor(pointer: number): ActorId | null;
  invoke(call: QvmModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): number;
  scratch<T>(size: number, execute: (address: number) => T): T;
}
interface DamageFrame {
  readonly request: DamageRequest;
  readonly observer: SourceDamageObserver;
  before: CombatState;
  velocity: Vec3 | null;
  finished: boolean;
  result: SourceDamageResult;
}

export function validateQvmModActors(artifact: QvmModuleOptions["artifact"], declaration: QvmModCallbackDeclaration): void {
  const callbacks = declaration.sourceActors?.callbacks, combat = declaration.combat;
  if (callbacks === undefined && combat === undefined) return;
  const record = declaration.actorRecords.find(record => record.id === declaration.entityRecord);
  if (declaration.sourceActors === undefined || record === undefined) throw new Error("QVM actor callbacks and combat require declared source actors");
  const field = (record: QvmModActorRecord, offset: number): void => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % 4 !== 0 || offset + 4 > record.stride) throw new Error("QVM actor semantic field exceeds its declared record");
  };
  for (const offset of Object.values(callbacks ?? {})) if (offset !== null) field(record, offset);
  if (combat === undefined) return;
  if (artifact.image.instructions[combat.entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("QVM damage entry is not a source function");
  for (const offset of [combat.health, combat.takedamage, combat.flags]) field(record, offset);
  for (const mask of [combat.godmode, combat.noKnockback]) if (!Number.isInteger(mask) || mask <= 0 || mask > 0x7fffffff) throw new Error("Invalid QVM combat flag mask");
  if (callbacks === undefined) throw new Error("QVM source damage requires declared reaction fields");
  if (combat.client !== null) {
    field(record, combat.client.pointer);
    const client = declaration.actorRecords.find(record => record.id === combat.client?.record);
    if (client === undefined) throw new Error("QVM combat client has no declared record");
    for (const offset of [combat.client.health, combat.client.armor, combat.client.team]) field(client, offset);
    if (!Number.isFinite(combat.client.protection) || combat.client.protection < 0 || combat.client.protection > 1) throw new Error("Invalid QVM armor protection");
  }
}

/** Guest fields remain authoritative; common operations enter their original source functions. */
export class QvmModActors {
  private readonly hooks = new Map<number, () => void>();
  private readonly damageFrames: DamageFrame[] = [];
  private readonly pointers = new Map<number, OwnedActor>();
  private readonly actorPointers = new Map<ActorId, number>();
  private readonly removeResolver: () => void;
  private readonly removeRelease: () => undefined;
  constructor(private readonly options: Options) {
    if (options.services.callbacks === undefined) throw new Error("QVM actor semantics require shared actor callbacks");
    const callback = (call: QvmFunctionCall) => this.sourceCallback(call.instructionIndex, call);
    this.removeResolver = options.module.bindFunctionResolver((entry, pointer) => {
      if (!this.pointers.has(pointer)) return undefined;
      for (const kind of callbackKinds) {
        const offset = options.declaration.sourceActors?.callbacks?.[kind];
        if (offset !== undefined && offset !== null && this.word(pointer + offset) === entry) return callback;
      }
      return undefined;
    });
    this.removeRelease = options.services.actors.onRelease(actor => {
      const pointer = this.actorPointers.get(actor.id);
      if (pointer !== undefined && this.pointers.get(pointer) === actor) this.pointers.delete(pointer);
      this.actorPointers.delete(actor.id); return undefined;
    });
    const combat = options.declaration.combat;
    if (combat !== undefined) this.hooks.set(combat.entry, options.module.bindFunction(this.reference(combat.entry), call => {
      const request = this.sourceRequest(call);
      if (!options.owned.has(request.target)) { options.services.combat.apply(request); return 0; }
      this.damage(request, effective => {
        call.words.setInt32(5 * 4, Math.trunc(effective.amount), true);
        return call.proceed();
      });
      return 0;
    }));
  }
  private reference(instructionIndex: number) { return { kind: "qvm", module: this.options.module.profile.module, instructionIndex } satisfies Parameters<QvmModule["bindFunction"]>[0]; }
  private word(address: number): number { return this.options.module.memory.view(address, 4).getInt32(0, true); }
  private store(address: number, value: number): void { this.options.module.memory.view(address, 4).setInt32(0, value, true); }
  private vector(address: number): Vec3 {
    if (address === 0) return zero;
    const data = this.options.module.memory.view(address, 12); return { x: data.getFloat32(0, true), y: data.getFloat32(4, true), z: data.getFloat32(8, true) };
  }
  private writeVector(address: number, value: Vec3): void {
    const data = this.options.module.memory.view(address, 12); data.setFloat32(0, value.x, true); data.setFloat32(4, value.y, true); data.setFloat32(8, value.z, true);
  }
  private seconds(): number { const time = this.options.services.time(); return time.kind === "seconds" ? time.value : time.value / 1000; }
  private client(pointer: number): number | null {
    const definition = this.options.declaration.combat?.client; if (definition === undefined || definition === null) return null;
    const address = this.word(pointer + definition.pointer); if (address === 0) return null;
    const record = this.options.declaration.actorRecords.find(record => record.id === definition.record);
    if (record === undefined || address < record.address || address >= record.address + record.stride * record.capacity || (address - record.address) % record.stride !== 0)
      throw new Error("QVM combat client pointer is outside its source declaration");
    return address;
  }
  private armor(pointer: number): ArmorState {
    const client = this.client(pointer), definition = this.options.declaration.combat?.client;
    return client === null || definition === undefined || definition === null ? { kind: "none" }
      : { kind: "q3", points: this.word(client + definition.armor), protection: definition.protection };
  }
  private read(actor: ActorId): CombatState {
    const definition = this.options.declaration.combat; if (definition === undefined) throw new Error("Missing QVM combat declaration");
    const pointer = this.options.pointer(actor), flags = this.word(pointer + definition.flags), client = this.client(pointer);
    const team = client === null || definition.client === null ? 0 : this.word(client + definition.client.team);
    return { health: this.word(pointer + definition.health), canTakeDamage: this.word(pointer + definition.takedamage) !== 0,
      armor: this.armor(pointer), mass: 200, invulnerable: (flags & definition.godmode) !== 0, noKnockback: (flags & definition.noKnockback) !== 0,
      team: team === 1 || team === 2 ? `q3:${team}` : null };
  }
  admit(actor: OwnedActor): void {
    const { services, declaration } = this.options, definition = declaration.combat;
    const pointer = this.options.pointer(actor.id); this.pointers.set(pointer, actor); this.actorPointers.set(actor.id, pointer);
    if (definition !== undefined) services.combat.rebind(actor, {
      read: () => this.read(actor.id), sourceDamage: request => this.damage(request, effective => this.invokeDamage(effective)),
      writeHealth: health => {
        const pointer = this.options.pointer(actor.id); this.store(pointer + definition.health, health);
        const client = this.client(pointer); if (client !== null && definition.client !== null) this.store(client + definition.client.health, health);
        return undefined;
      }, writeArmor: armor => {
        const client = this.client(this.options.pointer(actor.id));
        if (client === null || definition.client === null) { if (armor.kind !== "none") throw new Error("QVM actor has no declared armor store"); return undefined; }
        if (armor.kind !== "none" && armor.kind !== "q3") throw new Error("QVM source armor requires Q3 armor values");
        this.store(client + definition.client.armor, armor.kind === "none" ? 0 : armor.points); return undefined;
      },
    });
    services.callbacks?.bind(actor, {
      think: null,
      touch: contact => this.touch(contact), use: (self, other, activator) => { this.callActor(self, "use", [this.options.pointer(self.id), this.options.pointer(other), this.options.pointer(activator)]); return undefined; },
      pain: reaction => { this.callActor(reaction.self, "pain", [this.options.pointer(reaction.self.id), this.options.pointer(reaction.attacker), Math.trunc(reaction.damage)]); return undefined; },
      die: reaction => { this.callActor(reaction.self, "die", [this.options.pointer(reaction.self.id), this.options.pointer(reaction.inflictor), this.options.pointer(reaction.attacker), Math.trunc(reaction.damage), reaction.attack?.cause.kind === "q3" ? reaction.attack.cause.meansOfDeath : 0]); return undefined; },
    });
  }
  private entry(actor: ActorId, kind: ReactionKind): number {
    const offset = this.options.declaration.sourceActors?.callbacks?.[kind]; return offset === undefined || offset === null ? 0 : this.word(this.options.pointer(actor) + offset);
  }
  clearActors(): void { this.pointers.clear(); this.actorPointers.clear(); }
  private invoke(entry: number, words: readonly number[], globals: QvmModSourceCall["globals"] = []): number {
    return this.options.invoke({ entry, arguments: words.map(value => ({ kind: "int32", value: { kind: "float", value } })), globals, returns: "int32" },
      new Map<ModCallbackInput, ModRuntimeValue>([["time", { kind: "float", value: this.seconds() }]]));
  }
  private callActor(actor: OwnedActor, kind: ReactionKind, words: readonly number[]): void {
    const entry = this.entry(actor.id, kind); if (entry !== 0) this.invoke(entry, words, this.options.declaration.combat?.globals);
  }
  private touch(contact: TouchContact): undefined {
    this.options.scratch(QVM_TRACE_BYTES, address => {
      const normal = contact.plane?.normal ?? zero;
      writeQvmTrace(this.options.module.memory.view(address, QVM_TRACE_BYTES), { allSolid: false, startSolid: false, fraction: 0,
        end: this.options.services.bodies.read(contact.self.id)?.origin ?? zero,
        plane: { normal, distance: contact.plane?.distance ?? 0, type: normal.x === 1 ? 0 : normal.y === 1 ? 1 : normal.z === 1 ? 2 : 3,
          signbits: Number(normal.x < 0) | Number(normal.y < 0) * 2 | Number(normal.z < 0) * 4 }, surfaceFlags: 0, contents: 0, entityNum: 1023 });
      this.callActor(contact.self, "touch", [this.options.pointer(contact.self.id), this.options.pointer(contact.other), address]);
    });
    return undefined;
  }
  private sourceCallback(entry: number, call: QvmFunctionCall): number {
    const owner = this.pointers.get(call.words.getInt32(0, true));
    if (owner === undefined) return call.proceed();
    const kinds = callbackKinds.filter(kind => this.entry(owner.id, kind) === entry);
    if (kinds.length === 0) return call.proceed();
    if (kinds.length !== 1) throw new Error("QVM callback entry has ambiguous source signatures");
    const callbacks = this.options.services.callbacks; if (callbacks === undefined) throw new Error("Missing shared QVM actor callbacks");
    const other = this.options.actor(call.words.getInt32(4, true)), kind = kinds[0];
    if (kind === "use") {
      const activator = this.options.actor(call.words.getInt32(8, true));
      callbacks.sourceUse(owner, other, activator, (self, effectiveOther, effectiveActivator) => {
        call.words.setInt32(0, this.options.pointer(self.id), true);
        if (effectiveOther !== other) call.words.setInt32(4, this.options.pointer(effectiveOther), true);
        if (effectiveActivator !== activator) call.words.setInt32(8, this.options.pointer(effectiveActivator), true);
        call.proceed(); return undefined;
      }); return 0;
    }
    if (kind === "touch") {
      if (other === null) return call.proceed();
      const trace = call.words.getInt32(8, true);
      const contact: TouchContact = { self: owner, other, plane: trace === 0 ? null : { normal: this.vector(trace + 24), distance: this.options.module.memory.view(trace + 36, 4).getFloat32(0, true) }, surface: null };
      callbacks.sourceTouch(contact, effective => {
        if (effective.plane !== contact.plane || effective.surface !== contact.surface) throw new Error("QVM source trace changes require callback replacement");
        call.words.setInt32(0, this.options.pointer(effective.self.id), true); call.words.setInt32(4, this.options.pointer(effective.other), true);
        call.proceed(); return undefined;
      }); return 0;
    }
    if (kind !== "pain" && kind !== "die") return call.proceed();
    let frame: DamageFrame | undefined;
    for (let index = this.damageFrames.length - 1; index >= 0; index--) { const candidate = this.damageFrames[index]; if (candidate?.request.target === owner.id) { frame = candidate; break; } }
    const amount = call.words.getInt32(kind === "pain" ? 8 : 12, true);
    if (frame !== undefined && !frame.finished) {
      this.flush(frame); frame.finished = true;
      frame.result = { appliedDamage: amount, reaction: kind === "die" ? "death" : "pain" }; frame.observer.beforeReaction(frame.result);
    }
    const reaction: PainReaction = { self: owner, attack: frame?.request.attack ?? null, attacker: kind === "pain" ? other : this.options.actor(call.words.getInt32(8, true)), damage: amount, kick: frame?.request.knockback ?? 0 };
    if (kind === "pain") callbacks.sourcePain(reaction, effective => {
      call.words.setInt32(0, this.options.pointer(effective.self.id), true);
      if (effective.attacker !== reaction.attacker) call.words.setInt32(4, this.options.pointer(effective.attacker), true);
      call.words.setInt32(8, Math.trunc(effective.damage), true); call.proceed(); return undefined;
    });
    else {
      const death: DeathReaction = { ...reaction, inflictor: other, point: frame?.request.point ?? zero };
      callbacks.sourceDie(death, effective => {
        call.words.setInt32(0, this.options.pointer(effective.self.id), true);
        if (effective.inflictor !== death.inflictor) call.words.setInt32(4, this.options.pointer(effective.inflictor), true);
        if (effective.attacker !== death.attacker) call.words.setInt32(8, this.options.pointer(effective.attacker), true);
        call.words.setInt32(12, Math.trunc(effective.damage), true); call.proceed(); return undefined;
      });
    }
    return 0;
  }
  private sourceRequest(call: QvmFunctionCall): DamageRequest {
    const actor = (index: number) => this.options.actor(call.words.getInt32(index * 4, true)), target = actor(0);
    if (target === null) throw new Error("QVM damage target is not a canonical actor");
    const context = this.options.services.damageContext?.(this.options.module.profile.module.id);
    if (context === undefined) throw new Error("QVM source damage requires canonical attack provenance");
    const flags = call.words.getInt32(24, true), amount = call.words.getInt32(20, true);
    return { target, amount, knockback: amount, direction: this.vector(call.words.getInt32(12, true)), point: this.vector(call.words.getInt32(16, true)), normal: zero,
      delivery: (flags & 1) === 0 ? "direct" : "radius", attack: { ...context, time: this.options.services.time(), attacker: actor(2), inflictor: actor(1), weapon: null,
        cause: { kind: "q3", damageFlags: flags, meansOfDeath: call.words.getInt32(28, true) } } };
  }
  private flush(frame: DamageFrame): void {
    if (frame.finished) return;
    const before = frame.before, velocity = frame.velocity, after = this.read(frame.request.target), currentVelocity = this.options.services.bodies.read(frame.request.target)?.velocity ?? null;
    for (const active of this.damageFrames) if (active.request.target === frame.request.target) { active.before = after; active.velocity = currentVelocity; }
    if (before.armor.kind === "q3" && after.armor.kind === "q3" && before.armor.points !== after.armor.points)
      frame.observer.stored({ kind: "armor", before: before.armor, after: after.armor });
    if (before.health !== after.health) frame.observer.stored({ kind: "health", before: before.health, after: after.health });
    if (velocity !== null && currentVelocity !== null && (velocity.x !== currentVelocity.x || velocity.y !== currentVelocity.y || velocity.z !== currentVelocity.z))
      frame.observer.stored({ kind: "source-velocity", before: velocity, after: currentVelocity, movementProvider: frame.request.attack.movementProvider });
    frame.result = { appliedDamage: frame.result.appliedDamage + before.health - after.health, reaction: "none" };
  }
  private damage(input: DamageRequest, execute: (effective: DamageRequest) => number): DamageOutcome {
    for (let index = this.damageFrames.length - 1; index >= 0; index--) { const active = this.damageFrames[index]; if (active?.request.target === input.target) this.flush(active); }
    return this.options.services.combat.runSourceDamage(input, (observer, request) => {
      const frame: DamageFrame = { request, observer, before: this.read(request.target), velocity: this.options.services.bodies.read(request.target)?.velocity ?? null,
        finished: false, result: { appliedDamage: 0, reaction: "none" } };
      this.damageFrames.push(frame);
      try { execute(request); this.flush(frame); return frame.result; } finally { this.damageFrames.pop(); }
    });
  }
  private invokeDamage(request: DamageRequest): number {
    const definition = this.options.declaration.combat; if (definition === undefined) throw new Error("Missing QVM combat declaration");
    return this.options.scratch(24, address => {
      this.writeVector(address, request.direction); this.writeVector(address + 12, request.point);
      const flags = attackDamageFlags(request), cause = request.attack.cause;
      return this.invoke(definition.entry, [this.options.pointer(request.target), this.options.pointer(request.attack.inflictor), this.options.pointer(request.attack.attacker),
        address, address + 12, Math.trunc(request.amount), cause.kind === "q3" ? cause.damageFlags
          : Number(request.delivery === "radius") | Number(flags.noArmor) * 2 | Number(flags.noKnockback) * 4 | Number(flags.noProtection) * 8,
        cause.kind === "q3" ? cause.meansOfDeath : 0], definition.globals);
    });
  }
  beforeRelease(actor: ActorId): void {
    for (let index = this.damageFrames.length - 1; index >= 0; index--) { const frame = this.damageFrames[index]; if (frame?.request.target === actor) { this.flush(frame); frame.finished = true; } }
  }
  close(): void { this.removeResolver(); this.removeRelease(); this.clearActors(); for (const remove of this.hooks.values()) remove(); this.hooks.clear(); }
}
