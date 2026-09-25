import type { QvmInventoryWord } from "./game-inventory.ts";
import { QvmEquipmentMovement, type QvmEquipmentMotion, type QvmEquipmentMovementProfile } from "./game-equipment-movement.ts";
import { sourceEquipmentItem, type SourceEquipmentContext } from "../../contracts/source-items.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../contracts/execution.ts";
import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { QvmWeaponActor } from "../../contracts/qvm-mod-items.ts";
import type { QvmGame } from "./game.ts";
import type { QvmFunctionCall } from "./interpreter.ts";
import type { QvmModuleOptions } from "./module.ts";
import { QvmWeaponDispatcher, validateQvmWeaponDispatcher, type QvmWeaponDispatcherDefinition } from "./mod-weapon-stage.ts";
import { qualifyQvmRegion, qualifyQvmRegionEvaluation, type QvmRegionEvaluation } from "./regions.ts";
import type { QvmSystemCallResult } from "./interpreter.ts";
import { QvmOpcode } from "./image.ts";

export interface QvmPrimaryWeaponProfile {
  readonly module: ModuleIdentity;
  readonly abiProfile: QvmAbiProfile;
  readonly equipmentMovement: QvmEquipmentMovementProfile;
  readonly entityStride: number;
  readonly clientStride: number;
  readonly clientPointer: number;
  readonly stage: QvmWeaponDispatcherDefinition;
  readonly damageFactor: { readonly entry: number; readonly result: number; readonly stop: { readonly entry: number; readonly join: number } };
  readonly equipmentContexts: readonly SourceEquipmentContext[];
  readonly delay: QvmRegionEvaluation;
  readonly delayPlayer: { readonly movementGlobal: number; readonly playerOffset: number };
  readonly teleport: { readonly entry: number; readonly region: QvmRegionEvaluation; readonly objectives: QvmRegionEvaluation; readonly spawn: number; readonly view: number };
  readonly maxHealth: number;
  readonly persistentMaxHealth: number;
  readonly availability: { readonly movementType: number; readonly excluded: readonly number[]; readonly health: number; readonly team: number; readonly spectatorTeam: number; readonly flags: number; readonly respawnFlag: number };
  readonly powerups: { readonly quad: number; readonly haste: number; readonly flight: number };
  readonly torsoAnimation: { readonly entry: number; readonly attack: number; readonly melee: number };
  readonly waterLevel: { readonly entityOffset: number; readonly movementOffset: number };
  readonly drop: { readonly entry: number; readonly argument: number; readonly weapon: number; readonly ammo: number | "inventory"; readonly region: { readonly entry: number; readonly join: number } };
  readonly give: { readonly entry: number; readonly argument: number; readonly weapons: number; readonly ammo: number; readonly named: { readonly entry: number; readonly join: number; readonly name: number; readonly item: number } };
}
interface Services {
  actor(slot: number): ActorId | null;
  slot(actor: ActorId): number | null;
  selected(actor: ActorId): boolean;
  equipmentMovement?(actor: ActorId): QvmEquipmentMotion | null;
  attempted(actor: ActorId, weapon: number): void;
  accepted(actor: ActorId, weapon: number): void;
  completed(actor: ActorId, reachedAttackDecision: boolean): void;
  give(actor: ActorId, category: "weapons" | "ammo"): void;
  giveItem(actor: ActorId, name: string): boolean;
  drop(actor: ActorId): { readonly weapon: number; readonly ammo: number; readonly ammoWords?: readonly QvmInventoryWord[] } | null;
}

/** The primary dispatcher borrows its actual located player, with original Pmove left in control. */
export class QvmPrimaryWeapons {
  private readonly dispatcher: QvmWeaponDispatcher;
  private equipment: QvmEquipmentMovement | null = null;
  private closed = false;
  private readonly scratch: number;
  private readonly removals: (() => void)[] = [];
  private readonly evaluations: { readonly actor: ActorId; readonly kind: "damage-factor" | "teleport" | "objectives"; entered: boolean; result: number | null }[] = [];
  constructor(private readonly game: Pick<QvmGame, "module" | "data">, artifact: QvmModuleOptions["artifact"],
    private readonly profile: QvmPrimaryWeaponProfile, private readonly services: Services) {
    const identity = game.module.profile.module;
    if (identity.id !== profile.module.id || identity.digest !== profile.module.digest || identity.revision !== profile.module.revision
      || identity.artifactPath !== profile.module.artifactPath || artifact.module.digest !== identity.digest
      || game.module.abiProfile !== profile.abiProfile) throw new Error("Primary QVM weapon profile belongs to another executable");
    if (artifact.image.instructions[profile.torsoAnimation.entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Primary QVM torso animation entry is not an original function");
    validateQvmWeaponDispatcher(profile.stage, artifact.image);
    qualifyQvmRegion(artifact.image.instructions, profile.damageFactor.entry, profile.damageFactor.stop.entry, profile.damageFactor.stop.join);
    qualifyQvmRegionEvaluation(artifact.image.instructions, profile.stage.dispatcher.entry, profile.delay);
    qualifyQvmRegionEvaluation(artifact.image.instructions, profile.teleport.entry, profile.teleport.region);
    qualifyQvmRegionEvaluation(artifact.image.instructions, profile.teleport.entry, profile.teleport.objectives);
    if ([profile.teleport.spawn, profile.teleport.view].some(entry => artifact.image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER)) throw new Error("Original QVM spawn selector is not a function");
    const image = artifact.image;
    this.scratch = Math.ceil((image.dataLength + image.literalLength + image.bssLength) / 16) * 16;
    if (this.scratch + 36 > image.allocatedDataLength - 65536) throw new Error("Source player services require scratch outside source data and stack");
    qualifyQvmRegion(artifact.image.instructions, profile.give.entry, profile.give.named.entry, profile.give.named.join);
    qualifyQvmRegion(artifact.image.instructions, profile.drop.entry, profile.drop.region.entry, profile.drop.region.join);
    for (const pc of [profile.give.weapons, profile.give.ammo]) {
      const instruction = artifact.image.instructions[pc];
      if (pc <= profile.give.entry || instruction === undefined || instruction.opcode < QvmOpcode.OP_EQ || instruction.opcode > QvmOpcode.OP_GEF)
        throw new Error("Primary QVM give grant lacks its original completion decision");
    }
    this.dispatcher = new QvmWeaponDispatcher(profile.stage, { module: game.module,
      actor: (source, call) => this.actor(source, call), pointer: (actor, record) => {
        if (record !== "client") throw new Error("Primary QVM weapon field is not a located client record");
        return this.pointer(actor);
      }, live: actor => this.live(actor), selected: actor => services.selected(actor),
      cancellation: (_actor, call) => call.cancellationScope(),
      attempted: (actor, value) => services.attempted(actor, value), accepted: (actor, value) => services.accepted(actor, value),
      completed: (actor, reached) => services.completed(actor, reached), prepare: (actor, call) => this.equipment?.prepareWeapon(actor, call),
    });
    try {
      if (services.equipmentMovement !== undefined) {
        const equipment = new QvmEquipmentMovement(game, artifact, profile.equipmentMovement, { actor: services.actor, live: actor => this.live(actor), equipment: services.equipmentMovement });
        this.equipment = equipment; this.removals.push(() => equipment.close());
      }
      this.removals.push(game.module.bindInvocation({ kind: "qvm", module: identity, instructionIndex: profile.give.entry }, call => this.giveCall(call)));
      this.removals.push(game.module.bindInvocation({ kind: "qvm", module: identity, instructionIndex: profile.drop.entry }, call => this.dropCall(call)));
      for (const [kind, entry] of [["damage-factor", profile.damageFactor.entry], ["teleport", profile.teleport.entry]] satisfies readonly (readonly ["damage-factor" | "teleport" | "objectives", number])[]) {
        this.removals.push(game.module.bindInvocation({ kind: "qvm", module: identity, instructionIndex: entry }, call => this.evaluateCall(kind, call)));
      }
    } catch (error) { this.close(); throw error; }
  }
  equipmentMovement(call: QvmFunctionCall, kind: "client-command" | "movement-slice", run: () => QvmSystemCallResult): QvmSystemCallResult {
    return this.equipment === null ? run() : this.equipment.movement(call, kind, run);
  }
  private dropCall(call: QvmFunctionCall): QvmSystemCallResult {
    const profile = this.profile.drop, entity = call.words.getInt32(profile.argument * 4, true), actor = this.services.actor(this.game.data.numberFromPointer(entity));
    if (actor === null || !this.live(actor)) return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
    const view = (address: number): DataView => new DataView(call.memory.buffer, call.memory.byteOffset + address, 4);
    let saved: readonly { readonly address: number; readonly value: number }[] = [];
    const restore = (): undefined => {
      const previous = saved; saved = [];
      if (this.live(actor)) for (const value of previous) view(value.address).setInt32(0, value.value, true);
      return undefined;
    };
    call.regions([{ ...profile.region, run: () => {
      const projection = this.services.drop(actor);
      if (projection !== null) {
        if (projection.weapon !== 0 && !this.profile.stage.selection.values.some(value => value.value === projection.weapon)
          || !Number.isInteger(projection.ammo) || projection.ammo < -0x80000000 || projection.ammo > 0x7fffffff)
          throw new Error("Selected death drop has no original weapon or int32 ammo counter");
        if (profile.ammo === "inventory" && projection.ammoWords === undefined) throw new Error("Original drop requires its declared inventory projection");
        const writes = [{ address: entity + profile.weapon, value: projection.weapon },
          ...(profile.ammo === "inventory" ? projection.ammoWords ?? [] : [{ address: this.pointer(actor) + profile.ammo + projection.weapon * 4, value: projection.ammo }])];
        saved = writes.map(value => ({ address: value.address, value: view(value.address).getInt32(0, true) }));
        for (const value of writes) view(value.address).setInt32(0, value.value, true);
      }
      return "execute";
    }, completed: restore }]);
    try {
      const result = call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
      if (typeof result !== "number") return result.finally(() => call.effect(restore));
      restore(); return result;
    } catch (error) { restore(); throw error; }
  }
  private giveCall(call: QvmFunctionCall): QvmSystemCallResult {
    const profile = this.profile.give, pointer = call.words.getInt32(profile.argument * 4, true), slot = this.game.data.numberFromPointer(pointer);
    const actor = this.services.actor(slot);
    if (actor === null || !this.live(actor)) return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
    this.pointer(actor);
    call.branches((["weapons", "ammo"] satisfies readonly ("weapons" | "ammo")[]).map(category => ({ instructionIndex: profile[category], decide: original => {
      if (this.live(actor)) this.services.give(actor, category);
      return original;
    } })));
    const cancellation = call.cancellationScope();
    call.regions([{ entry: profile.named.entry, join: profile.named.join, run: () => "execute", completed: control => {
      if (control.localWord(profile.named.item) === 0 && this.live(actor)
        && this.services.giveItem(actor, call.guest.readString(control.localWord(profile.named.name)))) control.cancelFunction(cancellation);
    } }]);
    return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
  }
  private live(actor: ActorId): boolean {
    const slot = this.services.slot(actor);
    return !this.closed && slot !== null && this.services.actor(slot)?.equals(actor) === true;
  }
  private pointer(actor: ActorId): number {
    const slot = this.services.slot(actor), located = this.game.data.checkpoint();
    if (!this.live(actor) || slot === null) throw new Error("Primary QVM weapon actor is no longer current");
    if (located.entityStride !== this.profile.entityStride || located.clientStride !== this.profile.clientStride)
      throw new Error("Primary QVM weapon records differ from their qualified layout");
    const pointer = this.game.data.entityBytes(slot).getInt32(this.profile.clientPointer, true);
    this.game.data.publicPlayerBytes(slot);
    if (pointer !== located.clientsWord + slot * located.clientStride) throw new Error("Primary QVM actor does not own its original player state");
    return pointer;
  }
  private actor(source: QvmWeaponActor, call: QvmFunctionCall): ActorId | null {
    if (this.closed) return null;
    const reference = source.pointer;
    let pointer = reference.kind === "argument" ? call.words.getInt32(reference.index * 4, true) : call.guest.dataView(reference.address, 4).getInt32(0, true);
    for (const offset of reference.indirections) pointer = call.guest.dataView(pointer + offset, 4).getInt32(0, true);
    pointer += reference.offset;
    const located = this.game.data.checkpoint(), slot = (pointer - located.clientsWord) / located.clientStride;
    if (source.record !== "client" || !Number.isInteger(slot) || slot < 0) throw new Error("Primary weapon dispatcher has no located source client");
    const actor = this.services.actor(slot);
    if (actor === null) return null;
    if (this.pointer(actor) !== pointer) throw new Error("Primary weapon dispatcher has a different source actor");
    return actor;
  }
  settled(actor: ActorId): boolean { return this.dispatcher.settled(actor); }
  active(actor: ActorId): ItemId | null {
    if (!this.live(actor)) throw new Error("Primary QVM weapon actor is no longer current");
    return this.dispatcher.active(actor);
  }
  private evaluateCall(kind: "damage-factor" | "teleport" | "objectives", call: QvmFunctionCall): QvmSystemCallResult {
    const frame = this.evaluations.at(-1);
    if (frame === undefined || (frame.kind !== kind && !(kind === "teleport" && frame.kind === "objectives")) || frame.entered) return call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
    frame.entered = true;
    const slot = this.services.slot(frame.actor);
    if (slot === null || !this.live(frame.actor) || this.game.data.numberFromPointer(call.words.getInt32(0, true)) !== slot)
      throw new Error("Primary QVM source effect lost its original actor");
    if (kind === "teleport") return call.evaluateRegion(frame.kind === "objectives" ? this.profile.teleport.objectives : this.profile.teleport.region, []);
    const cancellation = call.cancellationScope();
    call.regions([{ ...this.profile.damageFactor.stop, run: control => {
      frame.result = this.game.module.memory.dataView(this.profile.damageFactor.result, 4).getFloat32(0, true);
      return control.cancelFunction(cancellation);
    } }]);
    return call.proceed();
  }
  private effect(actor: ActorId, kind: "damage-factor" | "teleport" | "objectives"): number | null {
    const slot = this.services.slot(actor);
    if (slot === null || !this.live(actor)) throw new Error("Primary QVM source effect requires its original actor");
    this.pointer(actor);
    const frame: { readonly actor: ActorId; readonly kind: "damage-factor" | "teleport" | "objectives"; entered: boolean; result: number | null } = { actor, kind, entered: false, result: null }; this.evaluations.push(frame);
    try {
      const entry = kind === "damage-factor" ? this.profile.damageFactor.entry : this.profile.teleport.entry;
      const located = this.game.data.checkpoint();
      this.game.module.call([located.entitiesWord + slot * located.entityStride], entry);
      return frame.result;
    } finally { this.evaluations.pop(); }
  }
  dropObjectives(actor: ActorId): void { this.effect(actor, "objectives"); }
  spawnPoint(actor: ActorId): { readonly origin: Vec3; readonly angles: Vec3 } {
    const slot = this.services.slot(actor);
    if (slot === null || !this.live(actor)) throw new Error("Original QVM spawn selection requires its live player");
    this.pointer(actor);
    const memory = this.game.module.memory, saved = memory.bytes.slice(this.scratch, this.scratch + 36), view = memory.view(this.scratch, 36);
    const origin = this.game.data.copyPlayerState(slot).origin;
    view.setFloat32(0, origin.x, true); view.setFloat32(4, origin.y, true); view.setFloat32(8, origin.z, true);
    const vector = (offset: number): Vec3 => ({ x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) });
    try {
      this.game.module.call([this.scratch, this.scratch + 12, this.scratch + 24], this.profile.teleport.spawn);
      if (!this.live(actor)) throw new Error("Original QVM spawn selection retired its player");
      return { origin: vector(12), angles: vector(24) };
    } finally { memory.writeBytes(this.scratch, saved); }
  }
  teleportState(actor: ActorId, origin: Vec3, velocity: Vec3, angles: Vec3, holdMilliseconds: number): void {
    const slot = this.services.slot(actor);
    if (slot === null || !this.live(actor)) throw new Error("Original QVM teleport requires its live player");
    this.pointer(actor);
    const state = this.game.data.copyPlayerState(slot);
    this.game.data.writePlayerState(slot, { ...state, origin, velocity, groundEntityNumber: 1023,
      flags: state.flags ^ 4, movementFlags: state.movementFlags | 64, movementTimeMilliseconds: holdMilliseconds });
    const memory = this.game.module.memory, saved = memory.bytes.slice(this.scratch, this.scratch + 12), view = memory.view(this.scratch, 12);
    view.setFloat32(0, angles.x, true); view.setFloat32(4, angles.y, true); view.setFloat32(8, angles.z, true);
    try { const located = this.game.data.checkpoint(); this.game.module.call([located.entitiesWord + slot * located.entityStride, this.scratch], this.profile.teleport.view); }
    finally { memory.writeBytes(this.scratch, saved); }
  }
  damageFactor(actor: ActorId): number {
    const view = this.game.module.memory.dataView(this.profile.damageFactor.result, 4), previous = view.getInt32(0, true);
    try {
      const result = this.effect(actor, "damage-factor");
      if (result === null || !Number.isFinite(result) || result < 0) throw new Error("Original QVM damage factor did not produce a finite result");
      return result;
    } finally { view.setInt32(0, previous, true); }
  }
  equipmentContext(provider: ProviderId): ItemId | null {
    const item = sourceEquipmentItem(this.profile.equipmentContexts, provider);
    if (item !== null && this.profile.stage.selection.field.record !== "client")
      throw new Error(`Equipment ${provider} requires an original client selection field`);
    if (item !== null && !this.profile.stage.selection.values.some(value => value.item === item))
      throw new Error(`Equipment ${provider} names an unavailable original cadence item ${item}`);
    return item;
  }
  equipmentDelay(actor: ActorId, provider: ProviderId, milliseconds: number): number {
    const item = this.equipmentContext(provider);
    if (item === null) return this.weaponDelay(actor, milliseconds);
    const selection = this.profile.stage.selection, value = selection.values.find(value => value.item === item);
    if (value === undefined || selection.field.record !== "client") throw new Error("Equipment cadence has no original client selection field");
    const pointer = this.pointer(actor), view = this.game.module.memory.dataView(pointer + selection.field.offset, 4), previous = view.getInt32(0, true);
    try { view.setInt32(0, value.value, true); return this.weaponDelay(actor, milliseconds); }
    finally { if (this.live(actor) && this.pointer(actor) === pointer) view.setInt32(0, previous, true); }
  }
  weaponDelay(actor: ActorId, milliseconds: number): number {
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 0x7fffffff) throw new Error("Original QVM weapon delay requires its int32 input");
    const movement = this.game.module.memory.dataView(this.profile.delayPlayer.movementGlobal, 4).getInt32(0, true);
    if (movement <= 0) throw new Error("Original QVM delay has no established Pmove context");
    const player = this.game.module.memory.dataView(movement + this.profile.delayPlayer.playerOffset, 4), previous = player.getInt32(0, true);
    try { player.setInt32(0, this.pointer(actor), true); return this.dispatcher.evaluate(actor, this.profile.delay, [milliseconds]); }
    finally { player.setInt32(0, previous, true); }
  }
  attackAnimation(actor: ActorId, melee: boolean): void {
    const movement = this.game.module.memory.dataView(this.profile.delayPlayer.movementGlobal, 4).getInt32(0, true);
    if (movement <= 0) throw new Error("Original QVM animation has no established Pmove context");
    const player = this.game.module.memory.dataView(movement + this.profile.delayPlayer.playerOffset, 4), previous = player.getInt32(0, true);
    try {
      player.setInt32(0, this.pointer(actor), true);
      this.game.module.call([melee ? this.profile.torsoAnimation.melee : this.profile.torsoAnimation.attack], this.profile.torsoAnimation.entry);
    } finally { player.setInt32(0, previous, true); }
  }
  waterLevel(actor: ActorId): number {
    const slot = this.services.slot(actor); if (slot === null || !this.live(actor)) throw new Error("Original QVM water state lost its actor");
    const movement = this.game.module.memory.dataView(this.profile.delayPlayer.movementGlobal, 4).getInt32(0, true);
    if (movement > 0 && this.game.module.memory.dataView(movement + this.profile.delayPlayer.playerOffset, 4).getInt32(0, true) === this.pointer(actor))
      return this.game.module.memory.dataView(movement + this.profile.waterLevel.movementOffset, 4).getInt32(0, true);
    return this.game.data.entityBytes(slot).getInt32(this.profile.waterLevel.entityOffset, true);
  }
  maxHealth(actor: ActorId): number { return this.game.module.memory.dataView(this.pointer(actor) + this.profile.maxHealth, 4).getInt32(0, true); }
  setMaxHealth(actor: ActorId, health: number): void {
    if (!Number.isInteger(health) || health <= 0 || health > 0x7fffffff) throw new Error("Original QVM maximum health must be a positive int32");
    const pointer = this.pointer(actor);
    for (const offset of [this.profile.maxHealth, this.profile.persistentMaxHealth]) this.game.module.memory.dataView(pointer + offset, 4).setInt32(0, health, true);
  }
  available(actor: ActorId, attacking = false): boolean {
    const pointer = this.pointer(actor), policy = this.profile.availability;
    const word = (offset: number): number => this.game.module.memory.dataView(pointer + offset, 4).getInt32(0, true);
    return word(policy.health) > 0 && word(policy.team) !== policy.spectatorTeam && !policy.excluded.includes(word(policy.movementType))
      && (!attacking || (word(policy.flags) & policy.respawnFlag) === 0);
  }
  powerupUntil(actor: ActorId, powerup: keyof QvmPrimaryWeaponProfile["powerups"]): number {
    return this.game.module.memory.dataView(this.pointer(actor) + this.profile.powerups[powerup], 4).getInt32(0, true);
  }
  teleport(actor: ActorId): void { this.effect(actor, "teleport"); }
  close(): void { this.closed = true; for (const remove of this.removals.splice(0).reverse()) remove(); this.dispatcher.close(); }
}
