import { normalizeLegacyPowerOnlyArmor } from "../../../world/gameplay/authority.ts";
import type { GuestAddress, GuestCallValue, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { ArmorState, DamageRequest, ItemId } from "../../../contracts/gameplay.ts";
import type { CombatStateBinding, SourceDamageResult, SourcePoweredArmorStage } from "../../../world/gameplay/authority.ts";
import { infoValueForKey } from "../../../core/info-string.ts";
import { classicSignature, q2Int, q2Pointer } from "./layout.ts";
import { readClassicString, readClassicVector, writeClassicVector } from "./records.ts";
import type { ClassicQ2GuestHost } from "./host.ts";
import { classicCombatProfile, type ClassicCombatProfile } from "./combat-profile.ts";
import { RemovedNativeDamage, q2NativeArmorFlags, q2NativeDamageArguments } from "../native-damage.ts";
import { captureAbiProcessorState, restoreAbiProcessorState } from "../../../guest/abi/runner.ts";
import { classicNumber, classicRequiredPointer } from "./host.ts";
import { canonicalCauseFromNative } from "../../../content/q2/missionpacks/damage.ts";
import { isDeepStrictEqual } from "node:util";

const pointer = (value: GuestAddress | null) => ({ kind: "pointer", value } satisfies import("../../../contracts/execution.ts").GuestCallValue);
const integer = (value: number) => ({ kind: "int32", value: Math.trunc(value) } satisfies import("../../../contracts/execution.ts").GuestCallValue);
const damageSignature = classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Pointer, q2Pointer, q2Pointer, q2Int, q2Int, q2Int, q2Int]);
const powerSignature = classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Int, q2Int], q2Int);
type PowerIntercept = Parameters<SourcePoweredArmorStage["bind"]>[0];
interface DamageFrame { readonly request: DamageRequest; readonly view: RawEntityView; stack: bigint | null; }

/** Source ABI declarations allow shared damage without replacing the DLL's combat rules. */
export class ClassicCombatBindings {
  private readonly frames: DamageFrame[] = [];
  private readonly powerBindings = new Map<OwnedActor, PowerIntercept>();
  private readonly powerHooks: (() => void)[] = [];
  private powerBypass: bigint | "pending" | null = null;
  private constructor(private readonly host: ClassicQ2GuestHost, private readonly image: GuestAddress, private readonly profile: ClassicCombatProfile) {}
  static create(host: ClassicQ2GuestHost, image: GuestAddress): ClassicCombatBindings | null {
    const profile = classicCombatProfile(host.memory.module.digest);
    if (profile === null) return null;
    for (const entry of Object.values(profile.entries)) host.memory.check(host.memory.offset(image, BigInt(entry)), 1, "execute");
    return new ClassicCombatBindings(host, image, profile);
  }
  private at(view: RawEntityView, offset: number): GuestAddress { return this.host.memory.offset(view.address, BigInt(offset)); }
  private entry(offset: number): GuestAddress { return this.host.memory.offset(this.image, BigInt(offset)); }
  notarget(view: RawEntityView): boolean { return (this.host.memory.readUint32(this.at(view, this.profile.fields.flags)) & 32) !== 0; }
  private client(view: RawEntityView): GuestAddress | null { return this.host.memory.readPointer(this.at(view, 84)); }
  private count(client: GuestAddress, index: number): number { return this.host.memory.readInt32(this.host.memory.offset(client, BigInt(this.profile.client.inventory + index * 4))); }
  private armor(view: RawEntityView): ArmorState {
    const { memory } = this.host, client = this.client(view), { items, globals } = this.profile;
    if (client === null) return { regular: { kind: "none" }, powered: { kind: "none" } };
    const index = [items.jacket, items.combat, items.body].find(index => this.count(client, index) > 0);
    const powered = (memory.readInt32(this.at(view, this.profile.fields.flags)) & 4096) !== 0;
    const power = !powered ? null : this.count(client, items.shield) > 0 ? "shield" : this.count(client, items.screen) > 0 ? "screen" : null;
    if (index === undefined && power === null) return { regular: { kind: "none" }, powered: { kind: "none" } };
    const item = index === undefined ? null : this.entry(globals.itemList + index * globals.itemBytes);
    const classname = item === null ? "none" : readClassicString(memory, memory.readPointer(item));
    const info = item === null ? null : memory.readPointer(memory.offset(item, 64n));
    return { regular: index === undefined ? { kind: "none" } : { kind: "q2", item: `q2:${classname}`, points: this.count(client, index),
      normalProtection: info === null ? 0 : memory.readFloat32(memory.offset(info, 8n)), energyProtection: info === null ? 0 : memory.readFloat32(memory.offset(info, 12n)) },
      powered: power === null ? { kind: "none" } : { kind: power, cells: this.count(client, items.cells) } };
  }
  bind(view: RawEntityView, actor: OwnedActor): undefined {
    const { host, profile } = this, { memory } = host, engine = host.options.services.engine;
    if (view.strideBytes !== profile.entityBytes) throw new Error("Native combat declaration differs from the source edict stride");
    const validateArmor = (armor: ArmorState): undefined => {
      if (armor.regular.kind !== "none" && armor.regular.kind !== "q2") throw new Error("Source armor requires Q2 armor values");
      if (armor.powered.kind !== this.armor(view).powered.kind) throw new Error("Native power activation requires its original source equipment operation");
      return undefined;
    };
    const binding: CombatStateBinding = { validateArmor, poweredProtectionOwner: memory.module.id,
      ...(host.options.services.damageProvenance === undefined ? {} : { poweredArmorStage: this.powerStage(actor) }),
      normalizeLegacyArmor: armor => normalizeLegacyPowerOnlyArmor(armor, this.armor(view), "q2:none"), sourceDamage: request => this.damage(request, view), read: () => {
      const client = this.client(view), flags = memory.readInt32(this.at(view, profile.fields.flags)), cvars = host.options.services.cvars;
      const skin = client === null ? "" : infoValueForKey(readClassicString(memory, memory.offset(client, BigInt(profile.client.userinfo)), 512), "skin"), rules = cvars.variableValue("dmflags") | 0;
      const team = client === null ? null : cvars.variableValue("coop") !== 0 ? "q2:coop" : (rules & 64) !== 0 ? `q2:model:${skin.split("/")[0] ?? ""}` : (rules & 128) !== 0 ? `q2:skin:${skin.split("/")[1] ?? ""}` : null;
      return { health: memory.readInt32(this.at(view, profile.fields.health)), canTakeDamage: memory.readInt32(this.at(view, profile.fields.damageable)) !== 0,
        mass: memory.readInt32(this.at(view, profile.fields.mass)), armor: this.armor(view), team, noKnockback: (flags & 2048) !== 0,
        invulnerable: (flags & 16) !== 0 || client !== null && memory.readFloat32(memory.offset(client, BigInt(profile.client.invincibleFrame))) > memory.readInt32(this.entry(profile.globals.levelFrame)) };
    }, writeHealth: health => memory.writeInt32(this.at(view, profile.fields.health), health), writeArmor: armor => {
      validateArmor(armor);
      const client = this.client(view); if (client === null) { if (armor.regular.kind !== "none" || armor.powered.kind !== "none") throw new Error("Source non-client has no inventory armor"); return undefined; }
      if (armor.regular.kind !== "none" && armor.regular.kind !== "q2") throw new Error("Source armor requires Q2 armor values");
      const current = this.armor(view).regular;
      for (const [name, index] of [["q2:item_armor_jacket", profile.items.jacket], ["q2:item_armor_combat", profile.items.combat], ["q2:item_armor_body", profile.items.body]] satisfies readonly (readonly [ItemId, number])[]) {
        if (armor.regular.kind === "q2" && current.kind === "q2" && armor.regular.item === current.item && name !== current.item) continue;
        const address = memory.offset(client, BigInt(profile.client.inventory + index * 4)), count = armor.regular.kind === "q2" && armor.regular.item === name ? armor.regular.points : 0;
        if (memory.readInt32(address) !== count) memory.writeInt32(address, count);
      }
      if (armor.powered.kind !== "none") memory.writeInt32(memory.offset(client, BigInt(profile.client.inventory + profile.items.cells * 4)), armor.powered.cells);
      return undefined;
    } };
    engine.combat.bind(actor, binding); return undefined;
  }
  private powerStage(actor: OwnedActor): SourcePoweredArmorStage {
    return { bind: intercept => {
      if (this.powerBindings.has(actor)) throw new Error("Classic source power stage already has an owner");
      this.powerBindings.set(actor, intercept);
      try { if (this.powerHooks.length === 0) this.installPowerHooks(); }
      catch (error) { this.powerBindings.delete(actor); for (const remove of this.powerHooks.splice(0)) remove(); throw error; }
      return () => {
        if (this.powerBindings.get(actor) === intercept) this.powerBindings.delete(actor);
        if (this.powerBindings.size === 0) for (const remove of this.powerHooks.splice(0)) remove();
        return undefined;
      };
    } };
  }
  private installPowerHooks(): void {
    const { host, profile } = this, { callbacks, cpu } = host.options.runner.options, memory = host.memory;
    const stack = () => cpu.state.registers.read("rsp", 32);
    const targetAtEntry = (): OwnedActor | null => {
      const frame = memory.pointer(stack()); if (frame === null) throw new Error("Classic power entry has no source stack");
      const address = memory.pointer(BigInt(memory.readUint32(memory.offset(frame, 4n))));
      return address === null ? null : host.edicts.observe(address);
    };
    this.powerHooks.push(callbacks.observeEntry(this.entry(profile.entries.damage), () => {
      const frame = this.frames.at(-1); if (frame !== undefined && frame.stack === null) frame.stack = stack();
    }));
    this.powerHooks.push(callbacks.bindEntry(this.entry(profile.entries.damage), {
      id: `${memory.module.id}:powered-damage`, signature: damageSignature,
      invoke: (_context, args) => { this.incomingDamage(args); return { kind: "void" }; },
    }, () => {
      if (this.frames.at(-1)?.stack === stack()) return false;
      const actor = targetAtEntry(); return actor !== null && this.powerBindings.has(actor);
    }));
    this.powerHooks.push(callbacks.observeEntry(this.entry(profile.entries.powerArmor), () => {
      if (this.powerBypass === "pending") this.powerBypass = stack();
    }));
    this.powerHooks.push(callbacks.bindEntry(this.entry(profile.entries.powerArmor), {
      id: `${memory.module.id}:powered-armor`, signature: powerSignature,
      invoke: (_context, args) => {
        const frame = this.frames.at(-1), actor = host.edicts.observe(classicRequiredPointer(args, 0));
        const intercept = actor === null ? undefined : this.powerBindings.get(actor);
        if (frame === undefined || actor === null || intercept === undefined || !frame.request.target.equals(actor.id))
          throw new Error("Classic power stage has no active source damage request");
        const original = (): number => {
          const previous = this.powerBypass; this.powerBypass = "pending";
          try {
            const result = host.invoke(this.entry(profile.entries.powerArmor), powerSignature, args, frame.view);
            if (result.kind !== "int32") throw new Error("Classic power stage returned a non-integer result");
            return result.value;
          } finally { this.powerBypass = previous; }
        };
        const saved = intercept({ request: frame.request, amount: classicNumber(args, 3),
          geometry: { direction: frame.request.direction, point: readClassicVector(memory, classicRequiredPointer(args, 1)),
            normal: readClassicVector(memory, classicRequiredPointer(args, 2)) },
          flags: q2NativeArmorFlags(classicNumber(args, 4)) }, original);
        if (!host.options.services.engine.actors.isLive(actor.id)) throw new RemovedNativeDamage(frame.request);
        return integer(saved);
      },
    }, () => {
      if (this.powerBypass === stack()) return false;
      const actor = targetAtEntry(); return actor !== null && this.powerBindings.has(actor);
    }));
  }
  private incomingDamage(args: readonly GuestCallValue[]): void {
    const { host } = this, provenance = host.options.services.damageProvenance;
    if (provenance === undefined) throw new Error("Classic source damage requires captured provenance");
    const actor = (index: number): ActorId => {
      const owned = host.edicts.observe(classicRequiredPointer(args, index));
      if (owned === null) throw new Error("Classic damage references a retired source actor"); return owned.id;
    };
    const target = actor(0), inflictor = actor(1), attacker = actor(2), flags = classicNumber(args, 8);
    const native = { edition: "classic", game: this.profile.game, value: classicNumber(args, 9) } satisfies import("../../../contracts/gameplay.ts").Q2NativeCause;
    const meansOfDeath = canonicalCauseFromNative(native); if (meansOfDeath === null) throw new Error("Unclassified classic damage cause");
    host.options.services.engine.combat.apply({ target, amount: classicNumber(args, 6), knockback: classicNumber(args, 7),
      direction: readClassicVector(host.memory, classicRequiredPointer(args, 3)), point: readClassicVector(host.memory, classicRequiredPointer(args, 4)),
      normal: readClassicVector(host.memory, classicRequiredPointer(args, 5)), delivery: (flags & 1) !== 0 ? "radius" : "direct",
      attack: { ...provenance(attacker, inflictor, target), attacker, inflictor, cause: { kind: "q2", meansOfDeath, damageFlags: flags, native } } });
  }
  private damage(input: DamageRequest, view: RawEntityView) {
    const { host, profile } = this, { memory } = host, engine = host.options.services.engine;
    return engine.combat.runSourceDamage(input, (observer, request) => {
      const frame: DamageFrame = { request, view, stack: null }; this.frames.push(frame);
      let health = memory.readInt32(this.at(view, profile.fields.health)), armor = this.armor(view), velocity = readClassicVector(memory, this.at(view, profile.fields.velocity));
      let result: SourceDamageResult = { appliedDamage: 0, reaction: "none" }, reacting = false;
      const writes: (() => void)[] = [], reactions: (() => void)[] = [], temporary: GuestAddress[] = [];
      const stopWrites = () => { for (const remove of writes.splice(0)) remove(); };
      const current = () => this.frames.at(-1) === frame && !reacting;
      const address = (actor: ActorId | null): GuestAddress => {
        if (actor === null) return host.edicts.at(0).address;
        const native = engine.actors.sourceOf(actor);
        if (native?.provider === memory.module.id) return host.edicts.at(native.slot).address;
        const body = engine.bodies.read(actor); if (body === null) throw new Error("Foreign damage actor has no body to project");
        const allocated = host.invoke(this.entry(profile.entries.spawn), classicSignature([], q2Pointer), []);
        if (allocated.kind !== "pointer" || allocated.value === null) throw new Error("Source G_Spawn returned no damage projection");
        const value = allocated.value; temporary.push(value);
        writeClassicVector(memory, memory.offset(value, 4n), body.origin); writeClassicVector(memory, memory.offset(value, 16n), body.angles);
        writeClassicVector(memory, memory.offset(value, 188n), body.bounds.min); writeClassicVector(memory, memory.offset(value, 200n), body.bounds.max);
        writeClassicVector(memory, memory.offset(value, BigInt(profile.fields.velocity)), body.velocity);
        return value;
      };
      const vectors = memory.allocate({ byteLength: 36, alignment: 4n, label: "Q2 classic damage arguments" });
      try {
        writes.push(memory.observeWrites(this.at(view, profile.fields.health), 4, () => { const before = health; health = memory.readInt32(this.at(view, profile.fields.health)); if (current() && before !== health) { observer.stored({ kind: "health", before, after: health }); result = { ...result, appliedDamage: result.appliedDamage + before - health }; } }));
        writes.push(memory.observeWrites(this.at(view, profile.fields.velocity), 12, () => { const before = velocity; velocity = readClassicVector(memory, this.at(view, profile.fields.velocity)); if (current()) observer.stored({ kind: "source-velocity", before, after: velocity, movementProvider: request.attack.movementProvider }); }));
        const client = this.client(view);
        if (client !== null) writes.push(memory.observeWrites(memory.offset(client, BigInt(profile.client.inventory)), profile.client.inventoryCount * 4, () => {
          const before = armor; armor = this.armor(view);
          const target = engine.actors.resolveOwned(request.target);
          if (!current() || target === null || this.powerBindings.has(target) && isDeepStrictEqual(before.regular, armor.regular)) return;
          observer.stored({ kind: "armor", before, after: armor });
        }));
        const { callbacks, cpu } = host.options.runner.options;
        for (const reaction of ["pain", "death"] satisfies readonly ("pain" | "death")[]) {
          const callback = memory.readPointer(this.at(view, reaction === "pain" ? profile.fields.pain : profile.fields.die)); if (callback === null) continue;
          reactions.push(callbacks.observeEntry(callback, () => {
            const stack = memory.pointer(cpu.state.registers.read("rsp", 32));
            if (!current() || stack === null || memory.readUint32(memory.offset(stack, 4n)) !== Number(view.address.byteOffset)) return;
            reacting = true; result = { reaction, appliedDamage: memory.readInt32(memory.offset(stack, 16n)) }; stopWrites(); observer.beforeReaction(result);
          }));
        }
        [request.direction, request.point, request.normal].forEach((value, index) => writeClassicVector(memory, memory.offset(vectors, BigInt(index * 12)), value));
        const lowered = q2NativeDamageArguments(request, { edition: "classic", game: profile.game });
        if (lowered.native?.edition !== "classic") throw new Error("Missing declared classic damage cause");
        const attacker = address(request.attack.attacker), inflictor = request.attack.inflictor !== null && request.attack.attacker !== null && request.attack.inflictor.equals(request.attack.attacker) ? attacker : address(request.attack.inflictor);
        const savedProcessor = captureAbiProcessorState(cpu.state);
        try { host.invoke(this.entry(profile.entries.damage), damageSignature, [pointer(view.address), pointer(inflictor), pointer(attacker), pointer(vectors), pointer(memory.offset(vectors, 12n)), pointer(memory.offset(vectors, 24n)),
          integer(request.amount), integer(request.knockback), integer(lowered.damageFlags), integer(lowered.native.value)], view); }
        catch (error) {
          if (!(error instanceof RemovedNativeDamage) || error.request !== request) throw error;
          restoreAbiProcessorState(cpu.state, savedProcessor);
        }
        return result;
      } finally {
        stopWrites(); for (const remove of reactions) remove();
        try { for (const value of temporary) host.invoke(this.entry(profile.entries.free), classicSignature([q2Pointer]), [pointer(value)]); }
        finally { memory.unmap(vectors, 36); this.frames.pop(); host.edicts.reconcile(); }
      }
    });
  }
}
