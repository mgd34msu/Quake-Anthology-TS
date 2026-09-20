/* Quake edict public fields projected into the shared body physics service. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { BodyState } from "../../contracts/world.ts";
import type { BodyStateBinding } from "../../world/actors/body.ts";
import type { Q2Motion } from "../../content/q2/foundation/host.ts";
import type { SharedSolid, SharedPhysicsFlags } from "../../app/bootstrap/simulation/physics.ts";
import type { QcMachine } from "./machine.ts";
import type { QcEntityMemory } from "./memory.ts";
import type { QcProgram } from "./program.ts";

export interface QcActorStateOptions {
  readonly machine: QcMachine;
  readonly rerelease: boolean;
  sourceSlot(actor: ActorId): number | null;
  reference(reference: number): ActorId | null;
  isClient(actor: ActorId): boolean;
}

export class QcActorState {
  constructor(private readonly options: QcActorStateOptions) {}
  private field(name: string): number { return this.options.machine.fieldOffset(name); }
  collision(actor: OwnedActor): SharedSolid | null {
    const slot = this.options.sourceSlot(actor.id); if (slot === null) return null;
    const words = this.options.machine.entities.at(slot), solid = words.float(this.field("solid")), flags = Math.trunc(words.float(this.field("flags")));
    const name = this.options.machine.strings.get(words.int(this.field("model"))), model = name.startsWith("*") ? Number(name.slice(1)) : slot === 0 ? 0 : null;
    const corpse = solid === 5 && this.options.rerelease;
    return { family: "q1", ...(corpse ? { q1Corpse: true } : {}), solid: solid === 0 || solid === 5 && !corpse ? "none" : solid === 1 ? "trigger" : solid === 4 ? "brush" : "box", model,
      owner: words.int(this.field("owner")) === 0 ? null : this.options.reference(words.int(this.field("owner"))),
      monster: (flags & 32) !== 0, item: (flags & 256) !== 0 };
  }
  motion(actor: OwnedActor, body: BodyState): Q2Motion | null {
    const slot = this.options.sourceSlot(actor.id); if (slot === null) return null;
    const words = this.options.machine.entities.at(slot), move = words.float(this.field("movetype"));
    let kind: Q2Motion["kind"];
    switch (move) {
      case 0: case 8: kind = "stationary"; break;
      case 3: case 4: kind = "step"; break;
      case 5: kind = "fly"; break;
      case 6: kind = "toss"; break;
      case 7: kind = "push"; break;
      case 9: kind = "fly-missile"; break;
      case 10: kind = "bounce"; break;
      case 11:
        if (!this.options.rerelease) throw new Error(`Unsupported id1 movetype ${move}`);
        kind = "bounce"; break;
      default: throw new Error(`Unsupported id1 movetype ${move}`);
    }
    return { actor, kind, velocity: body.velocity, angularVelocity: words.vector(this.field("avelocity")), gravity: this.options.machine.program.fieldsByName.has("gravity") ? words.float(this.field("gravity")) || 1 : 1,
      gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 3, owner: this.collision(actor)?.owner ?? null };
  }
  flags(actor: OwnedActor): SharedPhysicsFlags {
    const slot = this.options.sourceSlot(actor.id); if (slot === null) return {};
    const words = this.options.machine.entities.at(slot), flags = Math.trunc(words.float(this.field("flags")));
    return { fly: (flags & 1) !== 0, swim: (flags & 2) !== 0, partialGround: (flags & 1024) !== 0, player: this.options.isClient(actor.id),
      waterLevel: words.float(this.field("waterlevel")), waterType: words.float(this.field("watertype")), dead: words.float(this.field("health")) <= 0 };
  }
  writeFlags(actor: OwnedActor, changes: SharedPhysicsFlags): undefined {
    const slot = this.options.sourceSlot(actor.id); if (slot === null) return undefined;
    const words = this.options.machine.entities.at(slot); let flags = Math.trunc(words.float(this.field("flags")));
    for (const [value, bit] of [[changes.fly, 1], [changes.swim, 2], [changes.partialGround, 1024]] satisfies readonly (readonly [boolean | undefined, number])[]) {
      if (value !== undefined) flags = value ? flags | bit : flags & ~bit;
    }
    words.setFloat(this.field("flags"), flags);
    if (changes.waterLevel !== undefined) words.setFloat(this.field("waterlevel"), changes.waterLevel);
    if (changes.waterType !== undefined) words.setFloat(this.field("watertype"), changes.waterType);
    return undefined;
  }
  writeAngularVelocity(actor: OwnedActor, value: Vec3): undefined {
    const slot = this.options.sourceSlot(actor.id);
    if (slot !== null) this.options.machine.entities.at(slot).setVector(this.field("avelocity"), value);
    return undefined;
  }
}

export function createQcBodyBinding(program: QcProgram, entities: QcEntityMemory, slot: number,
  references: { reference(actor: ActorId): number; actor(reference: number): ActorId | null }): BodyStateBinding {
  const field = (name: string): number => { const value = program.fieldsByName.get(name); if (value === undefined) throw new Error(`Missing QC body field ${name}`); return value.offset; };
    const fields = entities.at(slot);
    const origin = field("origin"), angles = field("angles"), velocity = field("velocity"), mins = field("mins"), maxs = field("maxs");
    const flags = field("flags"), ground = field("groundentity");
    return {
      read: () => ({ origin: fields.vector(origin), angles: fields.vector(angles), velocity: fields.vector(velocity),
        bounds: { min: fields.vector(mins), max: fields.vector(maxs) },
        ground: (Math.trunc(fields.float(flags)) & 512) === 0 ? null : references.actor(fields.int(ground)) }),
      write: state => {
        fields.setVector(origin, state.origin); fields.setVector(angles, state.angles); fields.setVector(velocity, state.velocity);
        fields.setVector(mins, state.bounds.min); fields.setVector(maxs, state.bounds.max);
        fields.setFloat(flags, state.ground === null ? Math.trunc(fields.float(flags)) & ~512 : Math.trunc(fields.float(flags)) | 512);
        // Source airborne motion clears onground without erasing the previous ground word.
        if (state.ground !== null) fields.setInt(ground, references.reference(state.ground));
        return undefined;
      },
      linked: body => {
        fields.setVector(field("absmin"), body.absoluteBounds.min);
        fields.setVector(field("absmax"), body.absoluteBounds.max);
        return undefined;
      },
    };
  }
