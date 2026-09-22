import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { BodyState } from "../../contracts/world.ts";
import type { QvmGame } from "./game.ts";
import type { QvmModuleOptions } from "./module.ts";
import { QvmOpcode } from "./image.ts";
import { qvmSharedEntityBytes } from "./shared-entity-record.ts";

export interface QvmGameArmorDefinition {
  readonly checkArmor: number;
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
      invoke([this.pointer(hit.target), inflictor, attacker, this.scratch, this.scratch + 12, hit.amount, hit.flags, hit.method]);
    } finally {
      try { if (temporary !== null) this.game.module.call([temporary], this.definition.callbacks.free); }
      finally { memory.writeBytes(this.scratch, saved); }
    }
  }
}
