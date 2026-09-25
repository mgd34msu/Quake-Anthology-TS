import { float32ToBits } from "../../core/numeric.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { BodyState } from "../../contracts/world.ts";
import type { QvmGame } from "./game.ts";
import type { QvmModuleOptions } from "./module.ts";
import { QvmOpcode, QVM_MAX_PRIVATE_ARGUMENT_WORDS } from "./image.ts";
import { qvmSharedEntityBytes } from "./shared-entity-record.ts";

export type { QvmDamageRole, QvmArmorRole, QvmCombatCall, QvmReactionCall } from "../../contracts/qvm-combat.ts";
import type { QvmDamageRole, QvmArmorRole, QvmCombatCall, QvmDamageFlags } from "../../contracts/qvm-combat.ts";
import type { DamageRequest } from "../../contracts/gameplay.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";

export function qvmCombatWords<Role extends string>(call: QvmCombatCall<Role>, values: Readonly<Record<Role, number>>): number[] {
  const words: number[] = Array.from({ length: Object.keys(call.roles).length + call.extras.length }, () => 0);
  for (const extra of call.extras) words[extra.index] = extra.kind === "float32" ? float32ToBits(extra.value) | 0 : extra.value;
  for (const role in values) words[call.roles[role]] = values[role];
  return words;
}
export function qvmCanonicalDamageFlags(masks: QvmDamageFlags, flags: number): number {
  return ((flags & masks.radius) !== 0 ? 1 : 0) | ((flags & masks.noArmor) !== 0 ? 2 : 0) | ((flags & masks.noKnockback) !== 0 ? 4 : 0)
    | ((flags & masks.noProtection) !== 0 ? 8 : 0) | ((flags & masks.noTeamProtection) !== 0 ? 16 : 0);
}
export function qvmSourceDamageFlags(masks: QvmDamageFlags, request: DamageRequest, original = 0): number {
  const flags = attackDamageFlags(request), declared = masks.radius | masks.noArmor | masks.noKnockback | masks.noProtection | masks.noTeamProtection;
  return (original & ~declared) | (request.delivery === "radius" ? masks.radius : 0) | (flags.noArmor ? masks.noArmor : 0)
    | (flags.noKnockback ? masks.noKnockback : 0) | (flags.noProtection ? masks.noProtection : 0) | (flags.noTeamProtection ? masks.noTeamProtection : 0);
}

export function validateQvmCombatPositions(positions: readonly number[], words: number): void {
  if (!Number.isInteger(words) || words < positions.length || words > QVM_MAX_PRIVATE_ARGUMENT_WORDS) throw new Error("Source combat call exceeds the QVM OP_ARG capacity or omits required arguments");
  if (new Set(positions).size !== positions.length || positions.some(index => !Number.isInteger(index) || index < 0 || index >= words))
    throw new Error("Source combat argument positions must cover each declared role exactly once within the original call");
}

/** Every source argument has one explicit owner; new calls can lower every word. */
export function validateQvmCombatCall(call: QvmCombatCall<string>, dataBytes: number): void {
  const positions = [...Object.values(call.roles), ...call.extras.map(extra => extra.index)];
  validateQvmCombatPositions(positions, positions.length);
  for (const extra of call.extras) {
    if (extra.kind === "float32") {
      if (!Number.isFinite(extra.value) || !Number.isFinite(Math.fround(extra.value))) throw new Error("Source combat extra requires a finite binary32 value");
    } else if (extra.kind === "address") {
      if (!Number.isInteger(extra.value) || extra.value < 0 || extra.value >= dataBytes) throw new Error("Source combat extra address is outside its artifact data");
    } else if (!Number.isInteger(extra.value) || extra.value < -0x80000000 || extra.value > 0x7fffffff)
      throw new Error("Source combat extra requires a signed integer word");
  }
}

export interface QvmGameArmorDefinition {
  readonly checkArmor: number;
  readonly call: QvmCombatCall<QvmArmorRole>;
  readonly pointsStat: number;
  readonly protection: number;
  readonly tiers: {
    readonly stat: number;
    readonly whenAny: readonly { readonly offset: number; readonly comparison: "equal" | "not-equal"; readonly value: number }[];
    readonly values: readonly { readonly tier: number; readonly protection: number }[];
    readonly fallback: number;
  } | null;
}

export interface QvmGameCombatDefinition {
  readonly damageCall: QvmCombatCall<QvmDamageRole>;
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly entityStride: number;
  readonly clientStride: number;
  readonly fields: { readonly inuse: number; readonly health: number; readonly takedamage: number; readonly parent: number };
  readonly callbacks: { readonly allocate: number; readonly free: number; readonly damage: number };
}
export interface QvmGameDamage {
  readonly target: number;
  readonly attacker: number | null;
  readonly inflictor: { readonly kind: "entity"; readonly slot: number } | { readonly kind: "foreign"; readonly body: BodyState } | null;
  readonly direction: Vec3;
  readonly point: Vec3;
  readonly amount: number;
  readonly flags: number;
  readonly method: number;
}

/** Declared source fields and callbacks consume damage inside the owning executable. */
export class QvmGameCombat {
  private readonly scratch: number;
  private readonly arguments_: readonly number[];
  constructor(readonly game: QvmGame, artifact: QvmModuleOptions["artifact"], readonly definition: QvmGameCombatDefinition) {
    const expected = definition.module, actual = game.module.profile.module;
    if (expected.id !== actual.id || expected.digest !== actual.digest || expected.revision !== actual.revision || expected.artifactPath !== actual.artifactPath
      || artifact.module.digest !== actual.digest || artifact.module.id !== actual.id || definition.abiProfile !== game.module.abiProfile)
      throw new Error("Source combat declaration differs from its executable");
    const fields = definition.fields, callbacks = definition.callbacks;
    for (const offset of [fields.inuse, fields.health, fields.takedamage, fields.parent]) if (!Number.isInteger(offset) || offset % 4 !== 0 || offset < qvmSharedEntityBytes(definition.abiProfile) || offset + 4 > definition.entityStride)
      throw new Error("Source combat field is outside its declared entity record");
    for (const entry of [callbacks.allocate, callbacks.free, callbacks.damage]) if (artifact.image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER)
      throw new Error("Source combat callback is not a function entry");
    const image = artifact.image;
    const call = definition.damageCall;
    validateQvmCombatCall(call, image.dataLength + image.literalLength + image.bssLength);
    this.arguments_ = qvmCombatWords(call, { target: 0, inflictor: 0, attacker: 0, direction: 0, point: 0, amount: 0, flags: 0, method: 0 });
    this.scratch = Math.ceil((image.dataLength + image.literalLength + image.bssLength) / 16) * 16;
    if (this.scratch + 24 > image.allocatedDataLength - 65536) throw new Error("Source combat requires scratch outside source data and stack");
  }
  private entity(slot: number): DataView {
    if (this.game.data.entityStrideBytes !== this.definition.entityStride || this.game.data.clientStrideBytes !== this.definition.clientStride)
      throw new Error("Source combat declaration differs from located records");
    return this.game.data.entityBytes(slot);
  }
  private pointer(slot: number): number {
    this.entity(slot);
    return this.game.data.checkpoint().entitiesWord + slot * this.definition.entityStride;
  }
  state(slot: number): { readonly health: number; readonly damageable: boolean } | null {
    const view = this.entity(slot), fields = this.definition.fields;
    return view.getInt32(fields.inuse, true) === 0 ? null : { health: view.getInt32(fields.health, true), damageable: view.getInt32(fields.takedamage, true) !== 0 };
  }
  damage(hit: QvmGameDamage, invoke: (words: readonly number[]) => void = words => {
    this.game.module.call(words, this.definition.callbacks.damage);
  }): void {
    for (const word of [hit.amount, hit.flags, hit.method]) if (!Number.isInteger(word) || word < -0x80000000 || word > 0x7fffffff)
      throw new RangeError("Source damage arguments require signed integer words");
    const state = this.state(hit.target);
    if (state === null || !state.damageable) return;
    const memory = this.game.module.memory, saved = memory.bytes.slice(this.scratch, this.scratch + 24), scratch = memory.view(this.scratch, 24);
    const vector = (offset: number, value: Vec3): void => { scratch.setFloat32(offset, value.x, true); scratch.setFloat32(offset + 4, value.y, true); scratch.setFloat32(offset + 8, value.z, true); };
    vector(0, hit.direction); vector(12, hit.point);
    let temporary: number | null = null;
    try {
      const attacker = hit.attacker === null ? 0 : this.pointer(hit.attacker);
      let inflictor = 0;
      if (hit.inflictor?.kind === "entity") inflictor = this.pointer(hit.inflictor.slot);
      else if (hit.inflictor?.kind === "foreign") {
        temporary = this.game.module.call([], this.definition.callbacks.allocate);
        const slot = this.game.data.numberFromPointer(temporary), entity = this.game.data.entity(slot), body = hit.inflictor.body;
        this.entity(slot).setInt32(this.definition.fields.parent, attacker, true);
        entity.r.currentOrigin = body.origin; entity.r.currentAngles = body.angles; entity.r.mins = body.bounds.min; entity.r.maxs = body.bounds.max;
        entity.s.pos = { ...entity.s.pos, base: body.origin, delta: body.velocity };
        inflictor = temporary;
      }
      const roles = this.definition.damageCall.roles, words = this.arguments_.slice();
      words[roles.target] = this.pointer(hit.target); words[roles.inflictor] = inflictor; words[roles.attacker] = attacker;
      words[roles.direction] = this.scratch; words[roles.point] = this.scratch + 12;
      words[roles.amount] = hit.amount; words[roles.flags] = hit.flags; words[roles.method] = hit.method;
      invoke(words);
    } finally {
      try { if (temporary !== null) this.game.module.call([temporary], this.definition.callbacks.free); }
      finally { memory.writeBytes(this.scratch, saved); }
    }
  }
}
