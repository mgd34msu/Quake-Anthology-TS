import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { ArmorState, AttackProvenance, DamageRequest, ProtectionChannel } from "../../contracts/gameplay.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmGame } from "./game.ts";
import type { SharedBodyTable } from "../../world/actors/body.ts";
import type { GameplayAuthority, SourceDamageObserver, SourceDamageResult, SourceArmorStage } from "../../world/gameplay/authority.ts";
import type { SessionActorRegistry } from "../../world/actors/registry.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";
import { QvmGameCombat, validateQvmCombatCall, validateQvmCombatPositions, type QvmReactionCall, type QvmGameArmorDefinition, type QvmGameCombatDefinition, type QvmGameDamage } from "./game-combat.ts";
import type { QvmFunctionCall } from "./interpreter.ts";
import { qvmSharedEntityBytes } from "./shared-entity-record.ts";
import { QvmOpcode } from "./image.ts";
import { QvmDamageScopes } from "./game-combat-scope.ts";
import { isDeepStrictEqual } from "node:util";

export interface QvmPrimaryCombatProfile extends QvmGameCombatDefinition {
  readonly fields: QvmGameCombatDefinition["fields"] & { readonly client: number };
  readonly armor: QvmGameArmorDefinition;
  readonly reactions: { readonly flags: number; readonly pain: number; readonly die: number; readonly painCall: QvmReactionCall; readonly dieCall: QvmReactionCall };
  readonly grappleDamageMethod: number;
  readonly state: {
    readonly healthStat: number;
    readonly team: { readonly persistentStat: number; readonly values: readonly { readonly value: number; readonly team: `${string}:${string}` }[] };
    readonly flags: { readonly notarget: number; readonly invulnerable: number; readonly noKnockback: number };
    readonly mass: { readonly kind: "constant"; readonly value: number } | { readonly kind: "entity"; readonly offset: number; readonly storage: "int32" | "float32" };
  };
  readonly damageFlags: { readonly radius: number; readonly noArmor: number; readonly noKnockback: number; readonly noProtection: number; readonly noTeamProtection: number };
}
interface NativeCombatOptions {
  readonly game: QvmGame;
  readonly artifact: QvmModuleOptions["artifact"];
  readonly definition: QvmPrimaryCombatProfile;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly source?: {
    readonly actors: SessionActorRegistry;
    actor(slot: number): OwnedActor | null;
    provenance(attacker: ActorId | null, inflictor: ActorId | null, target: ActorId): Omit<AttackProvenance, "attacker" | "inflictor" | "cause">;
    afterFree?(pointer: number, call: Pick<QvmFunctionCall, "cancelFunction">): void;
  };
  slot(actor: ActorId): number | null;
}
type ArmorIntercept = Parameters<SourceArmorStage["bind"]>[0];
interface IncomingDamage { readonly request: DamageRequest; readonly observer: SourceDamageObserver; result: SourceDamageResult; }

/** Qualified G_Damage calls retain their original stores, armor and reactions. */
export class QvmCombatBindings {
  private readonly source: QvmGameCombat;
  private readonly scopes: QvmDamageScopes;
  private readonly admitted = new Map<number, OwnedActor>();
  private readonly protection = { powered: new Map<OwnedActor, ArmorIntercept>(), regular: new Map<OwnedActor, ArmorIntercept>() };
  private readonly removals: (() => void)[] = [];
  private removeArmor: (() => void) | null = null;
  private incoming: IncomingDamage | null = null;
  private closed = false;
  constructor(private readonly options: NativeCombatOptions) {
    this.source = new QvmGameCombat(options.game, options.artifact, options.definition);
    for (const field of [options.definition.reactions.flags, options.definition.reactions.pain, options.definition.reactions.die]) if (!Number.isInteger(field) || field < 0 || field % 4 !== 0 || field + 4 > options.definition.entityStride)
      throw new Error("Source combat reaction field is outside its entity record");
    const { armor } = options.definition, image = options.artifact.image;
    if (image.instructions[armor.checkArmor]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Source CheckArmor declaration is not a function entry");
    const definition = options.definition, client = definition.fields.client;
    if (!Number.isInteger(client) || client % 4 !== 0 || client < qvmSharedEntityBytes(definition.abiProfile)
      || client + 4 > definition.entityStride) throw new Error("Source combat requires its declared Q3 client pointer");
    validateQvmCombatCall(armor.call, image.dataLength + image.literalLength + image.bssLength);
    for (const call of [definition.reactions.painCall, definition.reactions.dieCall]) validateQvmCombatPositions(Object.values(call.roles), call.arguments);
    const stat = (index: number): void => {
      if (!Number.isInteger(index) || index < 0 || index >= 16) throw new Error("Source armor stat is outside the public player record");
    };
    const protection = (value: number): void => {
      if (!Number.isFinite(value) || value < 0 || value > 1 || Math.fround(value) !== value) throw new Error("Source armor protection must be a binary32 fraction");
    };
    stat(armor.pointsStat); protection(armor.protection); stat(definition.state.healthStat); stat(definition.state.team.persistentStat);
    const mask = (value: number): void => {
      if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff || (value & (value - 1)) !== 0) throw new Error("Source combat flags require individual 32-bit masks");
    };
    for (const values of [Object.values(definition.state.flags), Object.values(definition.damageFlags)]) {
      for (const value of values) mask(value);
      if (new Set(values).size !== values.length) throw new Error("Source combat flags overlap");
    }
    const teams = new Set<number>();
    for (const value of definition.state.team.values) {
      if (!Number.isInteger(value.value) || value.value < -0x80000000 || value.value > 0x7fffffff || teams.has(value.value)
        || !/^[^:]+:.+$/.test(value.team)) throw new Error("Source team mappings require unique values and explicit identities");
      teams.add(value.value);
    }
    const mass = definition.state.mass;
    if (mass.kind === "constant") { if (!Number.isFinite(mass.value) || mass.value < 0) throw new Error("Source mass must be finite and nonnegative"); }
    else if (!Number.isInteger(mass.offset) || mass.offset % 4 !== 0 || mass.offset < qvmSharedEntityBytes(definition.abiProfile)
      || mass.offset + 4 > definition.entityStride) throw new Error("Source mass field is outside its entity record");
    const tiers = armor.tiers;
    if (tiers !== null) {
      stat(tiers.stat); protection(tiers.fallback);
      if (tiers.stat === armor.pointsStat || tiers.whenAny.length === 0 || tiers.values.length === 0) throw new Error("Source armor tier declaration is incomplete or aliases its points");
      const values = new Set<number>();
      for (const entry of tiers.values) {
        if (!Number.isInteger(entry.tier) || entry.tier < -0x80000000 || entry.tier > 0x7fffffff || values.has(entry.tier)) throw new Error("Source armor tiers require unique signed integer values");
        values.add(entry.tier); protection(entry.protection);
      }
      for (const condition of tiers.whenAny) {
        if (!Number.isInteger(condition.offset) || condition.offset < 0 || condition.offset % 4 !== 0
          || condition.offset + 4 > image.dataLength + image.literalLength + image.bssLength) throw new Error("Source armor mode word is outside source data");
        if (!Number.isInteger(condition.value) || condition.value < -0x80000000 || condition.value > 0x7fffffff) throw new Error("Source armor mode comparison requires a signed integer");
      }
    }
    this.scopes = new QvmDamageScopes({ game: options.game, targetArgument: definition.damageCall.roles.target, health: options.definition.fields.health, pointsStat: armor.pointsStat,
      tierStat: armor.tiers?.stat ?? null, modeWords: armor.tiers?.whenAny.map(condition => condition.offset) ?? [],
      reactions: options.definition.reactions, armor: slot => this.armor(slot), live: actor => this.live(actor) });
    try {
      this.removals.push(options.game.module.bindInvocation({ kind: "qvm", module: options.definition.module, instructionIndex: options.definition.callbacks.damage }, call => this.enterDamage(call)));
      if (options.source !== undefined) {
        const actors = options.source.actors;
        this.removals.push(options.game.module.bindInvocation({ kind: "qvm", module: options.definition.module, instructionIndex: options.definition.callbacks.free }, call => {
          const pointer = call.words.getInt32(0, true), slot = options.game.data.numberFromPointer(pointer), actor = this.admitted.get(slot);
          const result = call.proceed();
          if (actor !== undefined && actors.resolveOwned(actor.id) === actor && this.source.state(slot) === null) actors.release(actor);
          options.source?.afterFree?.(pointer, call);
          return result;
        }));
        this.removals.push(actors.onRelease(actor => {
          this.protection.powered.delete(actor); this.protection.regular.delete(actor);
          for (const [slot, current] of this.admitted) if (current === actor) this.admitted.delete(slot);
          this.removeUnusedArmorHook();
          return undefined;
        }));
      }
    } catch (error) { this.close(); throw error; }
  }
  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true; this.protection.powered.clear(); this.protection.regular.clear(); this.admitted.clear(); this.removeUnusedArmorHook();
    for (const remove of this.removals.splice(0)) remove();
    return undefined;
  }
  private live(actor: OwnedActor): boolean {
    if (this.closed) return false;
    const slot = this.options.slot(actor.id);
    return slot !== null && this.source.state(slot) !== null && (this.options.source === undefined || this.options.source.actors.resolveOwned(actor.id) === actor);
  }
  private owned(actor: ActorId): OwnedActor | null {
    const slot = this.options.slot(actor);
    if (slot === null) return null;
    const owned = this.admitted.get(slot);
    return owned !== undefined && owned.id.equals(actor) && this.live(owned) ? owned : null;
  }
  notarget(actor: ActorId): boolean | null {
    const slot = this.options.slot(actor);
    return slot === null ? null : (this.options.game.data.entityBytes(slot).getInt32(this.options.definition.reactions.flags, true) & this.options.definition.state.flags.notarget) !== 0;
  }
  normalizeLegacyArmor(actor: ActorId, saved: ArmorState): ArmorState {
    const slot = this.options.slot(actor);
    if (slot === null || slot >= 1022) throw new Error("Legacy QVM armor has no source actor");
    // The pre-profile save schema stored stat 3 and the JavaScript 0.66 literal.
    const matches = slot < this.options.game.data.numClients
      ? saved.regular.kind === "q3" && saved.regular.points === (this.options.game.data.copyPlayerState(slot).stats[3] ?? 0) && saved.regular.protection === 0.66
      : saved.regular.kind === "none";
    if (!matches || saved.powered.kind !== "none") throw new Error("Legacy QVM armor disagrees with the original source projection");
    return this.armor(slot);
  }
  private activeTiers(): QvmGameArmorDefinition["tiers"] {
    const tiers = this.options.definition.armor.tiers;
    return tiers !== null && tiers.whenAny.some(condition => {
      const value = this.options.game.module.memory.view(condition.offset, 4).getInt32(0, true);
      return condition.comparison === "equal" ? value === condition.value : value !== condition.value;
    }) ? tiers : null;
  }
  private protectionFraction(stats: readonly number[], tiers: QvmGameArmorDefinition["tiers"]): number {
    return tiers === null ? this.options.definition.armor.protection : tiers.values.find(entry => entry.tier === stats[tiers.stat])?.protection ?? tiers.fallback;
  }
  private armor(slot: number): ArmorState {
    if (slot >= this.options.game.data.numClients) return { regular: { kind: "none" }, powered: { kind: "none" } };
    const stats = this.options.game.data.copyPlayerState(slot).stats;
    return { regular: { kind: "q3", points: stats[this.options.definition.armor.pointsStat] ?? 0, protection: this.protectionFraction(stats, this.activeTiers()) }, powered: { kind: "none" } };
  }
  private armorWrite(slot: number, armor: ArmorState): { readonly points: number; readonly tier: { readonly stat: number; readonly value: number } | null } | null {
    if (armor.powered.kind !== "none" || armor.regular.kind !== "none" && armor.regular.kind !== "q3") throw new Error("Native Q3 armor requires Q3 armor values");
    if (slot >= this.options.game.data.numClients) {
      if (armor.regular.kind !== "none") throw new Error("Source non-client has no player armor");
      return null;
    }
    const points = armor.regular.kind === "none" ? 0 : armor.regular.points;
    if (!Number.isInteger(points) || points < 0 || points > 0x7fffffff) throw new Error("Source armor points require a nonnegative signed integer");
    if (armor.regular.kind === "none") return { points, tier: null };
    const stats = this.options.game.data.copyPlayerState(slot).stats, tiers = this.activeTiers(), requested = Math.fround(armor.regular.protection);
    if (requested === this.protectionFraction(stats, tiers)) return { points, tier: null };
    const selected = tiers?.values.find(entry => entry.protection === requested);
    if (tiers === null || selected === undefined) throw new Error("Requested protection is not representable by the source armor mode");
    return { points, tier: { stat: tiers.stat, value: selected.tier } };
  }
  admit(actor: OwnedActor): undefined {
    const { game, definition, combat } = this.options, slot = this.options.slot(actor.id);
    if (slot === null || slot >= 1022) return undefined;
    this.admitted.set(slot, actor);
    const view = (): DataView => game.data.entityBytes(slot);
    const read = () => {
      const state = this.source.state(slot), flags = view().getInt32(definition.reactions.flags, true);
      const team = slot < game.data.numClients ? game.data.publicPlayerBytes(slot).getInt32(248 + definition.state.team.persistentStat * 4, true) : undefined;
      const declared = definition.state.mass, mass = declared.kind === "constant" ? declared.value
        : declared.storage === "float32" ? view().getFloat32(declared.offset, true) : view().getInt32(declared.offset, true);
      if (!Number.isFinite(mass) || mass < 0) throw new Error("Source mass is not representable by shared combat");
      return { health: state?.health ?? 0, canTakeDamage: state?.damageable ?? false, mass, armor: this.armor(slot),
        team: definition.state.team.values.find(value => value.value === team)?.team ?? null,
        invulnerable: (flags & definition.state.flags.invulnerable) !== 0, noKnockback: (flags & definition.state.flags.noKnockback) !== 0 };
    };
    const binding = { read, sourceDamage: (request: DamageRequest) => this.damage(request),
      protection: {
        regular: { owner: definition.module.id, ...(this.options.source === undefined ? {} : { stage: this.armorStage(actor, "regular") }) },
        powered: { owner: null, ...(this.options.source === undefined ? {} : { stage: this.armorStage(actor, "powered") }) },
      },
      validateArmor: (armor: ArmorState): undefined => {
        this.armorWrite(slot, armor);
        return undefined;
      },
      writeHealth: (health: number): undefined => {
        view().setInt32(definition.fields.health, health, true);
        if (slot < game.data.numClients) game.data.publicPlayerBytes(slot).setInt32(184 + definition.state.healthStat * 4, health, true);
        return undefined;
      }, writeArmor: (armor: ArmorState): undefined => {
        const write = this.armorWrite(slot, armor); if (write === null) return undefined;
        const state = game.data.publicPlayerBytes(slot); state.setInt32(184 + definition.armor.pointsStat * 4, write.points, true);
        if (write.tier !== null) state.setInt32(184 + write.tier.stat * 4, write.tier.value, true);
        return undefined;
      } };
    if (combat.read(actor.id) === null) combat.bind(actor, binding); else combat.rebind(actor, binding);
    return undefined;
  }
  private armorStage(actor: OwnedActor, channel: ProtectionChannel): SourceArmorStage {
    return { bind: intercept => {
      const bindings = this.protection[channel];
      if (!this.live(actor)) throw new Error("Source armor owner is retired");
      if (bindings.has(actor)) throw new Error(`Source ${channel} armor stage already has an owner`);
      bindings.set(actor, intercept);
      try {
        this.removeArmor ??= this.options.game.module.bindFunction({ kind: "qvm", module: this.options.definition.module,
          instructionIndex: this.options.definition.armor.checkArmor }, call => this.checkArmor(call));
      } catch (error) { bindings.delete(actor); throw error; }
      return () => {
        if (bindings.get(actor) === intercept) bindings.delete(actor);
        this.removeUnusedArmorHook(); return undefined;
      };
    } };
  }
  private removeUnusedArmorHook(): void {
    if (this.protection.powered.size !== 0 || this.protection.regular.size !== 0) return;
    this.removeArmor?.(); this.removeArmor = null;
  }
  private vector(word: number): Vec3 {
    if (word === 0) return { x: 0, y: 0, z: 0 };
    const view = this.options.game.module.memory.view(word, 12);
    return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) };
  }
  private checkArmor(call: QvmFunctionCall): number {
    const roles = this.options.definition.armor.call.roles, damage = this.options.definition.damageCall.roles;
    const frame = this.scopes.current(call.words.getInt32(roles.target * 4, true));
    if (frame === null) return call.proceed();
    const power = this.protection.powered.get(frame.actor);
    if (power === undefined && !this.protection.regular.has(frame.actor)) return call.proceed();
    if (!this.live(frame.actor)) return this.scopes.cancel(frame, call);
    const amount = call.words.getInt32(roles.amount * 4, true), flags = call.words.getInt32(roles.flags * 4, true), originating = attackDamageFlags(frame.request);
    const geometry = () => ({ direction: this.vector(frame.call.words.getInt32(damage.direction * 4, true)), point: this.vector(frame.call.words.getInt32(damage.point * 4, true)), normal: frame.request.normal });
    const saved = power?.({ request: frame.request, amount, geometry: geometry(),
      // Q3 owns its live armor flag; foreign power-only flags have no Q3 argument encoding.
      flags: { stage: "power", noArmor: (flags & this.options.definition.damageFlags.noArmor) !== 0, noPowerArmor: originating.noPowerArmor, noRegularArmor: false, energy: originating.energy } }, () => 0) ?? 0;
    if (!this.live(frame.actor)) return this.scopes.cancel(frame, call);
    if (!Number.isFinite(saved) || saved < 0 || saved > Math.max(0, amount)) throw new Error("QVM powered armor savings exceed the current source damage");
    const powerSaved = Math.trunc(saved), remaining = amount - powerSaved;
    call.words.setInt32(roles.amount * 4, remaining, true);
    try {
      const regular = this.protection.regular.get(frame.actor);
      const regularSaved = regular === undefined ? call.proceed() : regular({ request: frame.request, amount: remaining, geometry: geometry(),
        flags: { stage: "regular", noArmor: (call.words.getInt32(roles.flags * 4, true) & this.options.definition.damageFlags.noArmor) !== 0, noPowerArmor: originating.noPowerArmor, noRegularArmor: originating.noRegularArmor,
          energy: originating.energy, regularProtectionScale: originating.regularProtectionScale ?? 1 } }, () => call.proceed());
      if (!this.live(frame.actor)) return this.scopes.cancel(frame, call);
      if (!Number.isFinite(regularSaved) || regularSaved < 0 || regularSaved > Math.max(0, remaining)) throw new Error("QVM regular armor savings exceed the current source damage");
      return powerSaved + Math.trunc(regularSaved);
    }
    finally { call.words.setInt32(roles.amount * 4, amount, true); }
  }
  private sourceActor(pointer: number): OwnedActor | null {
    const source = this.options.source;
    if (source === undefined || pointer === 0) return null;
    const slot = this.options.game.data.numberFromPointer(pointer);
    if (slot >= 1022 || this.source.state(slot) === null) return null;
    return source.actor(slot);
  }
  private enterDamage(call: QvmFunctionCall): number {
    const incoming = this.incoming; this.incoming = null;
    if (incoming !== null) {
      const actor = this.owned(incoming.request.target), slot = this.options.slot(incoming.request.target);
      if (actor !== null && slot !== null) incoming.result = this.scopes.run(call, actor, slot, incoming.request, incoming.observer);
      return 0;
    }
    const joined = this.options.source;
    if (joined === undefined) return call.proceed();
    const roles = this.options.definition.damageCall.roles;
    const target = this.sourceActor(call.words.getInt32(roles.target * 4, true));
    if (target === null) return call.proceed();
    const inflictor = this.sourceActor(call.words.getInt32(roles.inflictor * 4, true))?.id ?? null;
    const attacker = this.sourceActor(call.words.getInt32(roles.attacker * 4, true))?.id ?? null;
    const flags = call.words.getInt32(roles.flags * 4, true), amount = call.words.getInt32(roles.amount * 4, true);
    const request: DamageRequest = { target: target.id, amount, knockback: (flags & this.options.definition.damageFlags.noKnockback) !== 0 || call.words.getInt32(roles.direction * 4, true) === 0 ? 0 : amount,
      direction: this.vector(call.words.getInt32(roles.direction * 4, true)), point: this.vector(call.words.getInt32(roles.point * 4, true)), normal: { x: 0, y: 0, z: 0 },
      delivery: (flags & this.options.definition.damageFlags.radius) !== 0 ? "radius" : "direct", attack: { ...joined.provenance(attacker, inflictor, target.id), attacker, inflictor,
        cause: { kind: "q3", meansOfDeath: call.words.getInt32(roles.method * 4, true), damageFlags: this.canonicalFlags(flags) } } };
    this.options.combat.apply(request, composed => this.options.combat.runSourceDamage(composed, (observer, effective) => {
      const actor = this.owned(effective.target), slot = this.options.slot(effective.target);
      if (actor === null || slot === null) return { appliedDamage: 0, reaction: "none" };
      if (isDeepStrictEqual(effective, request)) return this.scopes.run(call, actor, slot, effective, observer);
      let result: SourceDamageResult = { appliedDamage: 0, reaction: "none" };
      this.source.damage(this.lower(effective, slot, flags), words => {
        const saved = Object.values(roles).map(index => ({ index, word: call.words.getInt32(index * 4, true) }));
        try {
          for (const { index } of saved) {
            if (index === roles.direction && isDeepStrictEqual(effective.direction, request.direction) || index === roles.point && isDeepStrictEqual(effective.point, request.point)
              || index === roles.attacker && isDeepStrictEqual(effective.attack.attacker, request.attack.attacker)
              || index === roles.inflictor && isDeepStrictEqual(effective.attack.inflictor, request.attack.inflictor)) continue;
            const word = words[index];
            if (word === undefined) throw new Error("Source damage role lost its declared argument");
            call.words.setInt32(index * 4, word, true);
          }
          result = this.scopes.run(call, actor, slot, effective, observer);
        } finally { saved.forEach(({ word, index }) => call.words.setInt32(index * 4, word, true)); }
      });
      return result;
    }));
    return 0;
  }
  private canonicalFlags(source: number): number {
    const flags = this.options.definition.damageFlags;
    return ((source & flags.radius) !== 0 ? 1 : 0) | ((source & flags.noArmor) !== 0 ? 2 : 0) | ((source & flags.noKnockback) !== 0 ? 4 : 0)
      | ((source & flags.noProtection) !== 0 ? 8 : 0) | ((source & flags.noTeamProtection) !== 0 ? 16 : 0);
  }
  private lower(request: DamageRequest, slot: number, originalFlags = 0): QvmGameDamage {
    const { bodies, definition } = this.options, cause = request.attack.cause, flags = attackDamageFlags(request), inflictor = request.attack.inflictor;
    const sourceInflictor = inflictor === null ? null : this.options.slot(inflictor), inflictorBody = inflictor === null ? null : bodies.read(inflictor);
    const masks = definition.damageFlags, declared = masks.radius | masks.noArmor | masks.noKnockback | masks.noProtection | masks.noTeamProtection;
    // Undeclared private flags remain attached to their current original invocation.
    const lowered = (originalFlags & ~declared) | (request.delivery === "radius" ? masks.radius : 0) | (flags.noArmor ? masks.noArmor : 0)
      | (flags.noKnockback ? masks.noKnockback : 0) | (flags.noProtection ? masks.noProtection : 0) | (flags.noTeamProtection ? masks.noTeamProtection : 0);
    return { target: slot, attacker: request.attack.attacker === null ? null : this.options.slot(request.attack.attacker),
      inflictor: sourceInflictor !== null ? { kind: "entity", slot: sourceInflictor } : inflictorBody === null ? null : { kind: "foreign", body: inflictorBody },
      direction: request.direction, point: request.point, amount: Math.trunc(request.amount),
      flags: lowered,
      method: request.attack.weapon !== null && ["q3:weapon_grapplinghook", "q2:weapon_grapple", "q2:weapon_hook", "ctf:grapple"].includes(request.attack.weapon)
        ? definition.grappleDamageMethod : cause.kind === "q3" ? cause.meansOfDeath : cause.kind === "q2" && cause.meansOfDeath === 56 ? definition.grappleDamageMethod : 0 };
  }
  private damage(input: DamageRequest) {
    return this.options.combat.runSourceDamage(input, (observer, request) => {
      const slot = this.options.slot(request.target);
      const incoming: IncomingDamage = { request, observer, result: { appliedDamage: 0, reaction: "none" } };
      if (slot === null) return incoming.result;
      this.source.damage(this.lower(request, slot), words => {
        const previous = this.incoming; this.incoming = incoming;
        try { this.options.game.module.call(words, this.options.definition.callbacks.damage); }
        finally { this.incoming = previous; }
      });
      return incoming.result;
    });
  }
}
