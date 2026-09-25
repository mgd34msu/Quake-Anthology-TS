import { isDeepStrictEqual } from "node:util";
import type { ArmorState, CombatState, DamageOutcome, DamageRequest } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { QvmModActorRecord, QvmModCallbackDeclaration, QvmModSourceCall, QvmModCombatCalls } from "../../contracts/qvm-mod-callbacks.ts";
import type { DeathReaction, PainReaction, TouchContact } from "../../contracts/world.ts";
import type { SourceDamageObserver, SourceDamageResult } from "../../world/gameplay/authority.ts";
import { qvmCombatWords, qvmCanonicalDamageFlags, qvmSourceDamageFlags, validateQvmCombatCall } from "./game-combat.ts";
import type { QvmCombatCall, QvmDamageFlags } from "../../contracts/qvm-combat.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import type { QvmFunctionCall } from "./interpreter.ts";
import { QvmOpcode } from "./image.ts";
import type { QvmModule, QvmModuleOptions } from "./module.ts";
import { QVM_TRACE_BYTES, writeQvmTrace } from "./trace-record.ts";

type ReactionKind = "touch" | "use" | "pain" | "die";
const callbackKinds: readonly ReactionKind[] = ["touch", "use", "pain", "die"];
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const legacyCalls: QvmModCombatCalls = {
  damage: { roles: { target: 0, inflictor: 1, attacker: 2, direction: 3, point: 4, amount: 5, flags: 6, method: 7 }, extras: [] },
  touch: { roles: { target: 0, other: 1, trace: 2 }, extras: [] }, use: { roles: { target: 0, other: 1, activator: 2 }, extras: [] },
  pain: { roles: { target: 0, attacker: 1, amount: 2 }, extras: [] }, die: { roles: { target: 0, inflictor: 1, attacker: 2, amount: 3, method: 4 }, extras: [] },
};
const legacyFlags: QvmDamageFlags = { radius: 1, noArmor: 2, noKnockback: 4, noProtection: 8, noTeamProtection: 16 };
function argumentBytes(call: QvmCombatCall<string>): number { return (Object.keys(call.roles).length + call.extras.length) * 4; }
function requireArguments(bytes: number, words: DataView): void {
  if (words.byteLength < bytes) throw new Error("QVM combat declaration exceeds the actual source caller frame");
}
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
  for (const mask of [combat.godmode, combat.noKnockback]) if (!Number.isInteger(mask) || mask <= 0 || mask > (combat.abi === "declared" ? 0xffffffff : 0x7fffffff)) throw new Error("Invalid QVM combat flag mask");
  if (callbacks === undefined) throw new Error("QVM source damage requires declared reaction fields");
  if (combat.abi === "declared") {
    const image = artifact.image;
    for (const call of [combat.calls.damage, combat.calls.touch, combat.calls.use, combat.calls.pain, combat.calls.die]) validateQvmCombatCall(call, image.dataLength + image.literalLength + image.bssLength);
    let used = 0;
    for (const mask of Object.values(combat.damageFlags)) {
      if (!Number.isInteger(mask) || mask <= 0 || mask > 0xffffffff || (mask & (mask - 1)) !== 0 || (used & mask) !== 0) throw new Error("QVM source damage flag masks overlap or are not single positive bits");
      used |= mask;
    }
    if (combat.mass.kind === "entity") field(record, combat.mass.offset);
    else if (!Number.isFinite(combat.mass.value) || combat.mass.value < 0) throw new Error("Invalid QVM source mass");
    if (combat.client === null && combat.teams.length !== 0) throw new Error("QVM source team mapping requires a client team field");
    const teams = new Set<number>();
    for (const team of combat.teams) {
      if (!Number.isInteger(team.value) || team.value < -0x80000000 || team.value > 0x7fffffff || teams.has(team.value) || !/^[^:]+:.+$/.test(team.team)) throw new Error("Invalid QVM source team mapping");
      teams.add(team.value);
    }
  }
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
  private readonly calls: QvmModCombatCalls;
  private readonly flags: QvmDamageFlags;
  private readonly callBytes: Readonly<Record<ReactionKind | "damage", number>>;
  private readonly hooks = new Map<number, () => void>();
  private readonly damageFrames: DamageFrame[] = [];
  private readonly pointers = new Map<number, OwnedActor>();
  private readonly actorPointers = new Map<ActorId, number>();
  private readonly removeResolver: () => void;
  private readonly removeRelease: () => undefined;
  constructor(private readonly options: Options) {
    if (options.services.callbacks === undefined) throw new Error("QVM actor semantics require shared actor callbacks");
    const definition = options.declaration.combat;
    this.calls = definition?.abi === "declared" ? definition.calls : legacyCalls;
    this.flags = definition?.abi === "declared" ? definition.damageFlags : legacyFlags;
    this.callBytes = { damage: argumentBytes(this.calls.damage), touch: argumentBytes(this.calls.touch), use: argumentBytes(this.calls.use), pain: argumentBytes(this.calls.pain), die: argumentBytes(this.calls.die) };
    const callback = (call: QvmFunctionCall) => this.sourceCallback(call.instructionIndex, call);
    this.removeResolver = options.module.bindFunctionResolver((entry, _first, words) => this.callback(entry, words) === null ? undefined : callback);
    this.removeRelease = options.services.actors.onRelease(actor => {
      const pointer = this.actorPointers.get(actor.id);
      if (pointer !== undefined && this.pointers.get(pointer) === actor) this.pointers.delete(pointer);
      this.actorPointers.delete(actor.id); return undefined;
    });
    const combat = options.declaration.combat;
    if (combat !== undefined) this.hooks.set(combat.entry, options.module.bindFunction(this.reference(combat.entry), call => {
      const request = this.sourceRequest(call);
      if (!options.owned.has(request.target)) { options.services.combat.apply(request); return 0; }
      options.services.combat.apply(request, composed => this.damage(composed, effective => this.replayDamage(call, request, effective)));
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
    return { regular: client === null || definition === undefined || definition === null ? { kind: "none" }
      : { kind: "q3", points: this.word(client + definition.armor), protection: definition.protection }, powered: { kind: "none" } };
  }
  private read(actor: ActorId): CombatState {
    const definition = this.options.declaration.combat; if (definition === undefined) throw new Error("Missing QVM combat declaration");
    const pointer = this.options.pointer(actor), flags = this.word(pointer + definition.flags), client = this.client(pointer);
    const team = client === null || definition.client === null ? 0 : this.word(client + definition.client.team);
    return { health: this.word(pointer + definition.health), canTakeDamage: this.word(pointer + definition.takedamage) !== 0,
      armor: this.armor(pointer), mass: definition.abi === "q3-g-damage" ? 200 : definition.mass.kind === "constant" ? definition.mass.value
        : definition.mass.storage === "int32" ? this.word(pointer + definition.mass.offset) : this.options.module.memory.view(pointer + definition.mass.offset, 4).getFloat32(0, true), invulnerable: (flags & definition.godmode) !== 0, noKnockback: (flags & definition.noKnockback) !== 0,
      team: definition.abi === "q3-g-damage" ? team === 1 || team === 2 ? `q3:${team}` : null : definition.teams.find(value => value.value === team)?.team ?? null };
  }
  admit(actor: OwnedActor): void {
    const { services, declaration } = this.options, definition = declaration.combat;
    const pointer = this.options.pointer(actor.id); this.pointers.set(pointer, actor); this.actorPointers.set(actor.id, pointer);
    if (definition !== undefined) services.combat.rebind(actor, {
      read: () => this.read(actor.id), sourceDamage: request => this.damage(request, effective => this.invokeDamage(effective)),
      validateArmor: (armor: ArmorState): undefined => {
        if (armor.powered.kind !== "none" || armor.regular.kind !== "none" && armor.regular.kind !== "q3") throw new Error("Native Q3 armor requires Q3 armor values");
        return undefined;
      },
      writeHealth: health => {
        const pointer = this.options.pointer(actor.id); this.store(pointer + definition.health, health);
        const client = this.client(pointer); if (client !== null && definition.client !== null) this.store(client + definition.client.health, health);
        return undefined;
      }, writeArmor: armor => {
        const client = this.client(this.options.pointer(actor.id));
        if (client === null || definition.client === null) { if (armor.regular.kind !== "none" || armor.powered.kind !== "none") throw new Error("QVM actor has no declared armor store"); return undefined; }
        if (armor.powered.kind !== "none" || armor.regular.kind !== "none" && armor.regular.kind !== "q3") throw new Error("QVM source armor requires Q3 armor values");
        this.store(client + definition.client.armor, armor.regular.kind === "none" ? 0 : armor.regular.points); return undefined;
      },
    });
    services.callbacks?.bind(actor, {
      think: null,
      touch: contact => this.touch(contact), use: (self, other, activator) => { this.callActor(self, "use", qvmCombatWords(this.calls.use, { target: this.options.pointer(self.id), other: this.options.pointer(other), activator: this.options.pointer(activator) })); return undefined; },
      pain: reaction => { this.callActor(reaction.self, "pain", qvmCombatWords(this.calls.pain, { target: this.options.pointer(reaction.self.id), attacker: this.options.pointer(reaction.attacker), amount: Math.trunc(reaction.damage) })); return undefined; },
      die: reaction => { this.callActor(reaction.self, "die", qvmCombatWords(this.calls.die, { target: this.options.pointer(reaction.self.id), inflictor: this.options.pointer(reaction.inflictor), attacker: this.options.pointer(reaction.attacker), amount: Math.trunc(reaction.damage), method: reaction.attack?.cause.kind === "q3" ? reaction.attack.cause.meansOfDeath : 0 })); return undefined; },
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
      this.callActor(contact.self, "touch", qvmCombatWords(this.calls.touch, { target: this.options.pointer(contact.self.id), other: this.options.pointer(contact.other), trace: address }));
    });
    return undefined;
  }
  private callback(entry: number, words: DataView): { readonly owner: OwnedActor; readonly kind: ReactionKind } | null {
    let match: { readonly owner: OwnedActor; readonly kind: ReactionKind } | null = null;
    for (const kind of callbackKinds) {
      const definition = this.calls[kind], offset = definition.roles.target * 4;
      if (offset + 4 > words.byteLength) continue;
      const owner = this.pointers.get(words.getInt32(offset, true));
      if (owner === undefined || this.entry(owner.id, kind) !== entry) continue;
      requireArguments(this.callBytes[kind], words);
      if (match !== null) throw new Error("QVM callback entry has ambiguous source signatures");
      match = { owner, kind };
    }
    return match;
  }
  private proceed(call: QvmFunctionCall, edits: readonly { readonly index: number; readonly word: number }[]): number {
    const saved = edits.map(edit => ({ index: edit.index, word: call.words.getInt32(edit.index * 4, true) }));
    try { for (const edit of edits) call.words.setInt32(edit.index * 4, edit.word, true); return call.proceed(); }
    finally { for (const edit of saved) call.words.setInt32(edit.index * 4, edit.word, true); }
  }
  private sourceCallback(entry: number, call: QvmFunctionCall): number {
    const match = this.callback(entry, call.words); if (match === null) return call.proceed();
    const { owner, kind } = match;
    const callbacks = this.options.services.callbacks; if (callbacks === undefined) throw new Error("Missing shared QVM actor callbacks");
    const word = (index: number) => call.words.getInt32(index * 4, true), actor = (index: number) => this.options.actor(word(index));
    if (kind === "use") {
      const roles = this.calls.use.roles, other = actor(roles.other), activator = actor(roles.activator);
      callbacks.sourceUse(owner, other, activator, (self, effectiveOther, effectiveActivator) => {
        this.proceed(call, [{ index: roles.target, word: self === owner ? word(roles.target) : this.options.pointer(self.id) },
          { index: roles.other, word: effectiveOther === other ? word(roles.other) : this.options.pointer(effectiveOther) },
          { index: roles.activator, word: effectiveActivator === activator ? word(roles.activator) : this.options.pointer(effectiveActivator) }]); return undefined;
      }); return 0;
    }
    if (kind === "touch") {
      const roles = this.calls.touch.roles, other = actor(roles.other); if (other === null) return call.proceed();
      const trace = word(roles.trace);
      const contact: TouchContact = { self: owner, other, plane: trace === 0 ? null : { normal: this.vector(trace + 24), distance: this.options.module.memory.view(trace + 36, 4).getFloat32(0, true) }, surface: null };
      callbacks.sourceTouch(contact, effective => {
        if (effective.plane !== contact.plane || effective.surface !== contact.surface) throw new Error("QVM source trace changes require callback replacement");
        this.proceed(call, [{ index: roles.target, word: effective.self === owner ? word(roles.target) : this.options.pointer(effective.self.id) },
          { index: roles.other, word: effective.other === other ? word(roles.other) : this.options.pointer(effective.other) }]); return undefined;
      }); return 0;
    }
    let frame: DamageFrame | undefined;
    for (let index = this.damageFrames.length - 1; index >= 0; index--) { const candidate = this.damageFrames[index]; if (candidate?.request.target === owner.id) { frame = candidate; break; } }
    const roles = this.calls[kind].roles, amount = word(roles.amount);
    if (frame !== undefined && !frame.finished) {
      this.flush(frame); frame.finished = true;
      frame.result = { appliedDamage: amount, reaction: kind === "die" ? "death" : "pain" }; frame.observer.beforeReaction(frame.result);
    }
    const reaction: PainReaction = { self: owner, attack: frame?.request.attack ?? null, attacker: actor(roles.attacker), damage: amount, kick: frame?.request.knockback ?? 0 };
    if (kind === "pain") callbacks.sourcePain(reaction, effective => {
      this.proceed(call, [{ index: roles.target, word: effective.self === owner ? word(roles.target) : this.options.pointer(effective.self.id) },
        { index: roles.attacker, word: effective.attacker === reaction.attacker ? word(roles.attacker) : this.options.pointer(effective.attacker) },
        { index: roles.amount, word: Math.trunc(effective.damage) }]); return undefined;
    });
    else {
      const deathRoles = this.calls.die.roles;
      const death: DeathReaction = { ...reaction, inflictor: actor(deathRoles.inflictor), point: frame?.request.point ?? zero };
      callbacks.sourceDie(death, effective => {
        this.proceed(call, [{ index: roles.target, word: effective.self === owner ? word(roles.target) : this.options.pointer(effective.self.id) },
          { index: deathRoles.inflictor, word: effective.inflictor === death.inflictor ? word(deathRoles.inflictor) : this.options.pointer(effective.inflictor) },
          { index: roles.attacker, word: effective.attacker === death.attacker ? word(roles.attacker) : this.options.pointer(effective.attacker) },
          { index: roles.amount, word: Math.trunc(effective.damage) }]); return undefined;
      });
    }
    return 0;
  }
  private sourceRequest(call: QvmFunctionCall): DamageRequest {
    requireArguments(this.callBytes.damage, call.words);
    const roles = this.calls.damage.roles, word = (index: number) => call.words.getInt32(index * 4, true);
    const actor = (index: number) => this.options.actor(word(index)), target = actor(roles.target);
    if (target === null) throw new Error("QVM damage target is not a canonical actor");
    const context = this.options.services.damageContext?.(this.options.module.profile.module.id);
    if (context === undefined) throw new Error("QVM source damage requires canonical attack provenance");
    const flags = word(roles.flags), amount = word(roles.amount);
    return { target, amount, knockback: (flags & this.flags.noKnockback) !== 0 || word(roles.direction) === 0 ? 0 : amount,
      direction: this.vector(word(roles.direction)), point: this.vector(word(roles.point)), normal: zero,
      delivery: (flags & this.flags.radius) === 0 ? "direct" : "radius", attack: { ...context, time: this.options.services.time(), attacker: actor(roles.attacker), inflictor: actor(roles.inflictor), weapon: null,
        cause: { kind: "q3", damageFlags: qvmCanonicalDamageFlags(this.flags, flags), meansOfDeath: word(roles.method) } } };
  }
  private replayDamage(call: QvmFunctionCall, original: DamageRequest, effective: DamageRequest): number {
    if (isDeepStrictEqual(original, effective)) return call.proceed();
    const roles = this.calls.damage.roles;
    return this.options.scratch(24, address => {
      const words = this.damageWords(effective, address, call.words.getInt32(roles.flags * 4, true));
      const edits = Object.values(roles).filter(index => !(index === roles.direction && isDeepStrictEqual(effective.direction, original.direction)
        || index === roles.point && isDeepStrictEqual(effective.point, original.point)
        || index === roles.attacker && effective.attack.attacker === original.attack.attacker || index === roles.inflictor && effective.attack.inflictor === original.attack.inflictor))
        .map(index => { const word = words[index]; if (word === undefined) throw new Error("Missing declared QVM damage argument"); return { index, word }; });
      return this.proceed(call, edits);
    });
  }
  private flush(frame: DamageFrame): void {
    if (frame.finished) return;
    const before = frame.before, velocity = frame.velocity, after = this.read(frame.request.target), currentVelocity = this.options.services.bodies.read(frame.request.target)?.velocity ?? null;
    for (const active of this.damageFrames) if (active.request.target === frame.request.target) { active.before = after; active.velocity = currentVelocity; }
    if (before.armor.regular.kind === "q3" && after.armor.regular.kind === "q3" && before.armor.regular.points !== after.armor.regular.points)
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
  private damageWords(request: DamageRequest, address: number, originalFlags = 0): number[] {
    this.writeVector(address, request.direction); this.writeVector(address + 12, request.point);
    const cause = request.attack.cause;
    return qvmCombatWords(this.calls.damage, { target: this.options.pointer(request.target), inflictor: this.options.pointer(request.attack.inflictor), attacker: this.options.pointer(request.attack.attacker),
      direction: address, point: address + 12, amount: Math.trunc(request.amount), flags: qvmSourceDamageFlags(this.flags, request, originalFlags), method: cause.kind === "q3" ? cause.meansOfDeath : 0 });
  }
  private invokeDamage(request: DamageRequest): number {
    const definition = this.options.declaration.combat; if (definition === undefined) throw new Error("Missing QVM combat declaration");
    return this.options.scratch(24, address => this.invoke(definition.entry, this.damageWords(request, address), definition.globals));
  }
  beforeRelease(actor: ActorId): void {
    for (let index = this.damageFrames.length - 1; index >= 0; index--) { const frame = this.damageFrames[index]; if (frame?.request.target === actor) { this.flush(frame); frame.finished = true; } }
  }
  close(): void { this.removeResolver(); this.removeRelease(); this.clearActors(); for (const remove of this.hooks.values()) remove(); this.hooks.clear(); }
}
