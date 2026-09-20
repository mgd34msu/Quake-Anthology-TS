import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { QvmCheckpoint } from "../../contracts/execution.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { QvmGame } from "./game.ts";
import type { QvmModuleOptions } from "./module.ts";
import { readQvmGrappleProfile, qvmGrappleProfileDeclaration, type QvmGrappleProfile } from "./grapple-profile.ts";

export interface QvmGrappleProjection {
  readonly hook: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly target: ActorId | null;
  readonly mover: ActorId | null;
  readonly pulling: boolean;
  readonly point: Vec3;
  readonly ownerVelocity: Vec3;
}
export interface QvmGrappleBridge {
  /** Refreshes mirrored actors and collision inputs without overwriting source-private tether fields. */
  synchronize(): void;
  entity(actor: ActorId): number | null;
  actor(pointer: number): ActorId | null;
  restoreActor(saved: SavedActorId): ActorId;
  /** Publishes one shared tether and owner velocity, or retires that tether for null. */
  publish(owner: ActorId, projection: QvmGrappleProjection | null): void;
  velocity(owner: ActorId, velocity: Vec3): void;
  /** A host-reserved span, outside source data and active guest stacks. */
  readonly scratch: { readonly word: number; readonly byteLength: number };
}
export interface QvmGrappleCheckpoint {
  readonly version: 1;
  readonly profile: string;
  readonly module: QvmCheckpoint;
  readonly owners: readonly SavedActorId[];
}

/** Authored launch, collision, tether, mover and pull routines share one source VM and checkpoint. */
export class QvmGrappleProvider {
  readonly profile: QvmGrappleProfile;
  private readonly owners = new Set<ActorId>();
  private readonly declaration: string;
  constructor(readonly game: QvmGame, artifact: QvmModuleOptions["artifact"], profile: QvmGrappleProfile, private readonly bridge: QvmGrappleBridge) {
    this.profile = readQvmGrappleProfile(qvmGrappleProfileDeclaration(profile), artifact);
    this.declaration = JSON.stringify(qvmGrappleProfileDeclaration(this.profile));
    const actual = game.module.profile.module, expected = this.profile.module;
    if (actual.id !== expected.id || actual.digest !== expected.digest || actual.artifactPath !== expected.artifactPath || actual.revision !== expected.revision
      || game.module.abiProfile !== this.profile.abiProfile) throw new Error("Grapple module differs from its declared artifact");
    this.validateLayout();
    const scratch = bridge.scratch, sourceEnd = artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength;
    if (!Number.isSafeInteger(scratch.word) || scratch.word % 4 !== 0 || scratch.word < sourceEnd || scratch.byteLength < Math.max(16, profile.movement.byteLength))
      throw new Error("Grapple scratch must be a reserved span beyond declared source data");
    game.module.memory.view(scratch.word, scratch.byteLength);
  }
  private validateLayout(): void {
    if (this.game.data.entityStrideBytes !== this.profile.entityStride || this.game.data.clientStrideBytes !== this.profile.clientStride)
      throw new Error("Grapple profile differs from located entity or client records");
  }
  private word(pointer: number, offset = 0): number { return this.game.module.memory.view(pointer, offset + 4).getInt32(offset, true); }
  private write(pointer: number, value: number): void { this.game.module.memory.view(pointer, 4).setInt32(0, value, true); }
  private vector(pointer: number): Vec3 {
    const view = this.game.module.memory.view(pointer, 12);
    return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) };
  }
  private writeVector(pointer: number, value: Vec3): void {
    const view = this.game.module.memory.view(pointer, 12);
    view.setFloat32(0, value.x, true); view.setFloat32(4, value.y, true); view.setFloat32(8, value.z, true);
  }
  private owner(actor: ActorId): { readonly entity: number; readonly client: number } {
    const entity = this.bridge.entity(actor);
    if (entity === null || this.word(entity, this.profile.fields.inuse) === 0) throw new Error("Grapple owner has no live source entity");
    this.game.data.numberFromPointer(entity);
    const client = this.word(entity, this.profile.fields.client);
    if (client === 0) throw new Error("Grapple owner has no source player record");
    this.game.module.memory.view(client, this.profile.clientStride);
    return { entity, client };
  }
  private hook(owner: ActorId): number | null {
    const player = this.owner(owner), hook = this.word(player.client, this.profile.fields.hook);
    if (hook === 0) return null;
    this.game.data.numberFromPointer(hook);
    if (this.word(hook, this.profile.fields.inuse) === 0 || this.word(hook, this.profile.fields.parent) !== player.entity)
      throw new Error("Source grapple points at an inactive or differently owned hook");
    return hook;
  }
  private projection(actor: ActorId): QvmGrappleProjection | null {
    const hook = this.hook(actor);
    if (hook === null) return null;
    const player = this.owner(actor), entity = this.game.data.entityFromPointer(hook);
    return { hook, origin: entity.r.currentOrigin, velocity: entity.s.pos.delta,
      target: this.bridge.actor(this.word(hook, this.profile.fields.target)), mover: this.profile.fields.mover === null ? null : this.bridge.actor(this.word(hook, this.profile.fields.mover)),
      pulling: (this.word(player.client, 12) & this.profile.pullingFlag) !== 0, point: this.vector(player.client + 92), ownerVelocity: this.vector(player.client + 32) };
  }
  private publish(actor: ActorId): void {
    this.bridge.publish(actor, this.projection(actor));
    this.bridge.velocity(actor, this.vector(this.owner(actor).client + 32));
  }
  beginFrame(timeMilliseconds: number, frame: number): void {
    if (!Number.isInteger(timeMilliseconds) || timeMilliseconds < this.word(this.profile.globals.time) || timeMilliseconds > 0x7fffffff
      || !Number.isInteger(frame) || frame < this.word(this.profile.globals.frame) || frame > 0x7fffffff) throw new Error("Invalid grapple source frame");
    this.write(this.profile.globals.time, timeMilliseconds); this.write(this.profile.globals.frame, frame);
    this.bridge.synchronize();
  }
  fire(actor: ActorId): void {
    this.bridge.synchronize();
    const owner = this.owner(actor);
    this.owners.add(actor);
    if (this.hook(actor) === null) this.game.module.call([owner.entity, ...this.profile.fireArguments], this.profile.callbacks.fire);
    this.publish(actor);
  }
  release(actor: ActorId, force = false): void {
    if (!this.owners.has(actor)) return;
    const hook = this.hook(actor);
    if (hook !== null) this.game.module.call([hook], force ? this.profile.callbacks.forceRelease : this.profile.callbacks.release);
    this.publish(actor);
    if (this.hook(actor) === null) this.owners.delete(actor);
  }
  step(): void {
    this.bridge.synchronize();
    for (const actor of [...this.owners]) {
      if (this.word(this.owner(actor).entity, this.profile.fields.health) <= 0) { this.release(actor, true); continue; }
      const hook = this.hook(actor);
      if (hook !== null) {
        if (this.game.data.entityFromPointer(hook).s.eType === 3) this.game.module.call([hook], this.profile.callbacks.missile);
        else {
          if (this.profile.callbacks.follow !== null) this.game.module.call([hook], this.profile.callbacks.follow);
          if (this.hook(actor) !== null) this.game.module.call([hook], this.profile.callbacks.think);
        }
      }
      this.publish(actor);
      if (this.hook(actor) === null) this.owners.delete(actor);
    }
  }
  pull(actor: ActorId, forward: Vec3): Vec3 | null {
    if (!this.owners.has(actor)) return null;
    const projection = this.projection(actor);
    if (projection === null || !projection.pulling) return null;
    const globals = this.profile.globals, memory = this.game.module.memory, scratch = this.bridge.scratch.word;
    const movement = this.word(globals.movement), savedForward = memory.span(globals.forward, 12).slice(), groundPlane = this.word(globals.groundPlane);
    const savedScratch = memory.span(scratch, this.profile.movement.byteLength).slice(), player = this.owner(actor);
    try {
      memory.span(scratch, this.profile.movement.byteLength).fill(0);
      for (const word of this.profile.movement.words) this.write(scratch + word.offset, word.value);
      this.write(scratch, player.client); this.write(globals.movement, scratch); this.writeVector(globals.forward, forward);
      this.game.module.call([], this.profile.callbacks.pull);
      this.publish(actor);
      return this.vector(player.client + 32);
    } finally {
      this.write(globals.movement, movement); memory.span(globals.forward, 12).set(savedForward); this.write(globals.groundPlane, groundPlane);
      memory.span(scratch, savedScratch.length).set(savedScratch);
    }
  }
  moverMoved(actor: ActorId, translation: Vec3): void {
    if (this.profile.callbacks.moveMoverHooks === null) return;
    const mover = this.bridge.entity(actor);
    if (mover === null) throw new Error("Grapple mover has no source entity");
    const scratch = this.bridge.scratch.word, saved = this.game.module.memory.span(scratch, 12).slice();
    try {
      this.writeVector(scratch, translation); this.game.module.call([mover, scratch], this.profile.callbacks.moveMoverHooks);
      for (const owner of this.owners) this.publish(owner);
    } finally { this.game.module.memory.span(scratch, 12).set(saved); }
  }
  /** Called before the shared actor and its mirrored source record are released or teleported. */
  actorReleased(actor: ActorId): void {
    for (const owner of [...this.owners]) {
      const state = this.projection(owner);
      if (owner.equals(actor) || state?.target?.equals(actor) || state?.mover?.equals(actor)) this.release(owner, true);
    }
  }
  capture(): QvmGrappleCheckpoint {
    return { version: 1, profile: this.declaration, module: this.game.module.checkpoint(),
      owners: [...this.owners].map(actor => ({ slot: actor.slot, generation: actor.generation })) };
  }
  restore(checkpoint: QvmGrappleCheckpoint): void {
    if (checkpoint.version !== 1 || checkpoint.profile !== this.declaration) throw new Error("Saved grapple profile differs from its source declaration");
    const owners = checkpoint.owners.map(actor => this.bridge.restoreActor(actor));
    if (new Set(owners).size !== owners.length) throw new Error("Saved grapple has duplicate owners");
    this.game.module.restore(checkpoint.module); this.validateLayout();
    for (const owner of this.owners) this.bridge.publish(owner, null);
    this.owners.clear();
    for (const owner of owners) { this.owners.add(owner); this.publish(owner); }
  }
  close(): void { for (const owner of [...this.owners]) this.release(owner, true); }
}
