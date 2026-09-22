import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { ArmorState, AttackProvenance, DamageRequest } from "../../contracts/gameplay.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmGame } from "./game.ts";
import type { SharedBodyTable } from "../../world/actors/body.ts";
import type { GameplayAuthority, SourceDamageObserver, SourceDamageResult, SourcePoweredArmorStage } from "../../world/gameplay/authority.ts";
import type { SessionActorRegistry } from "../../world/actors/registry.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";
import { QvmGameCombat, type QvmGameArmorDefinition, type QvmGameCombatDefinition, type QvmGameDamage } from "./game-combat.ts";
import type { QvmFunctionCall } from "./interpreter.ts";
import { QvmOpcode } from "./image.ts";
import { QvmDamageScopes } from "./game-combat-scope.ts";
import { isDeepStrictEqual } from "node:util";

interface NativeCombatDefinition extends QvmGameCombatDefinition {
  readonly fields: QvmGameCombatDefinition["fields"] & { readonly client: number };
  readonly armor: QvmGameArmorDefinition;
  readonly reactions: { readonly flags: number; readonly pain: number; readonly die: number };
  readonly grappleDamageMethod: number;
}
interface NativeCombatOptions {
  readonly game: QvmGame;
  readonly artifact: QvmModuleOptions["artifact"];
  readonly definition: NativeCombatDefinition;
  readonly bodies: SharedBodyTable;
  readonly combat: GameplayAuthority;
  readonly source?: {
    readonly actors: SessionActorRegistry;
    actor(slot: number): OwnedActor | null;
    provenance(attacker: ActorId | null, inflictor: ActorId | null, target: ActorId): Omit<AttackProvenance, "attacker" | "inflictor" | "cause">;
  };
  slot(actor: ActorId): number | null;
}
type PowerIntercept = Parameters<SourcePoweredArmorStage["bind"]>[0];
interface IncomingDamage { readonly request: DamageRequest; readonly observer: SourceDamageObserver; result: SourceDamageResult; }

/** Qualified G_Damage calls retain their original stores, armor and reactions. */
export class QvmCombatBindings {
  private readonly source: QvmGameCombat;
  private readonly scopes: QvmDamageScopes;
  private readonly admitted = new Map<number, OwnedActor>();
  private readonly power = new Map<OwnedActor, PowerIntercept>();
  private readonly removals: (() => void)[] = [];
  private removePower: (() => void) | null = null;
  private incoming: IncomingDamage | null = null;
  private closed = false;
  constructor(private readonly options: NativeCombatOptions) {
    this.source = new QvmGameCombat(options.game, options.artifact, options.definition);
    for (const field of Object.values(options.definition.reactions)) if (!Number.isInteger(field) || field < 0 || field % 4 !== 0 || field + 4 > options.definition.entityStride)
      throw new Error("Source combat reaction field is outside its entity record");
    const { armor } = options.definition, image = options.artifact.image;
    if (image.instructions[armor.checkArmor]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("Source CheckArmor declaration is not a function entry");
    if (options.definition.fields.client !== 516 || options.definition.abiProfile !== "q3-modern") throw new Error("Source combat requires its declared modern Q3 client layout");
    const stat = (index: number): void => {
      if (!Number.isInteger(index) || index < 0 || index >= 16) throw new Error("Source armor stat is outside the public player record");
    };
    const protection = (value: number): void => {
      if (!Number.isFinite(value) || value < 0 || value > 1 || Math.fround(value) !== value) throw new Error("Source armor protection must be a binary32 fraction");
    };
    stat(armor.pointsStat); protection(armor.protection);
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
    this.scopes = new QvmDamageScopes({ game: options.game, health: options.definition.fields.health, pointsStat: armor.pointsStat,
      tierStat: armor.tiers?.stat ?? null, modeWords: armor.tiers?.whenAny.map(condition => condition.offset) ?? [],
      reactions: options.definition.reactions, armor: slot => this.armor(slot), live: actor => this.live(actor) });
    try {
      this.removals.push(options.game.module.bindInvocation({ kind: "qvm", module: options.definition.module, instructionIndex: options.definition.callbacks.damage }, call => this.enterDamage(call)));
      if (options.source !== undefined) {
        const actors = options.source.actors;
        this.removals.push(options.game.module.bindInvocation({ kind: "qvm", module: options.definition.module, instructionIndex: options.definition.callbacks.free }, call => {
          const slot = options.game.data.numberFromPointer(call.words.getInt32(0, true)), actor = this.admitted.get(slot);
          const result = call.proceed();
          if (actor !== undefined && actors.resolveOwned(actor.id) === actor && this.source.state(slot) === null) actors.release(actor);
          return result;
        }));
        this.removals.push(actors.onRelease(actor => {
          this.power.delete(actor);
          for (const [slot, current] of this.admitted) if (current === actor) this.admitted.delete(slot);
          this.removeUnusedPowerHook();
          return undefined;
        }));
      }
    } catch (error) { this.close(); throw error; }
  }
  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true; this.power.clear(); this.admitted.clear(); this.removeUnusedPowerHook();
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
    return slot === null ? null : (this.options.game.data.entityBytes(slot).getInt32(this.options.definition.reactions.flags, true) & 32) !== 0;
  }
  normalizeLegacyArmor(actor: ActorId, saved: ArmorState): ArmorState {
    const slot = this.options.slot(actor);
    if (slot === null || slot >= 1022) throw new Error("Legacy QVM armor has no source actor");
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
  private protection(stats: readonly number[], tiers: QvmGameArmorDefinition["tiers"]): number {
    return tiers === null ? this.options.definition.armor.protection : tiers.values.find(entry => entry.tier === stats[tiers.stat])?.protection ?? tiers.fallback;
  }
  private armor(slot: number): ArmorState {
    if (slot >= this.options.game.data.numClients) return { regular: { kind: "none" }, powered: { kind: "none" } };
    const stats = this.options.game.data.copyPlayerState(slot).stats;
    return { regular: { kind: "q3", points: stats[this.options.definition.armor.pointsStat] ?? 0, protection: this.protection(stats, this.activeTiers()) }, powered: { kind: "none" } };
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
    if (requested === this.protection(stats, tiers)) return { points, tier: null };
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
      const team = slot < game.data.numClients ? game.data.copyPlayerState(slot).persistent[3] ?? 0 : 0;
      return { health: state?.health ?? 0, canTakeDamage: state?.damageable ?? false, mass: 200, armor: this.armor(slot),
        team: team === 1 || team === 2 ? `q3:${team}` : null, invulnerable: (flags & 16) !== 0, noKnockback: (flags & 2048) !== 0 };
    };
    const binding = { read, sourceDamage: (request: DamageRequest) => this.damage(request),
      ...(this.options.source === undefined ? {} : { poweredArmorStage: this.powerStage(actor) }),
      validateArmor: (armor: ArmorState): undefined => {
        this.armorWrite(slot, armor);
        return undefined;
      },
      writeHealth: (health: number): undefined => {
        view().setInt32(definition.fields.health, health, true);
        if (slot < game.data.numClients) { const state = game.data.copyPlayerState(slot), stats = [...state.stats]; stats[0] = health; game.data.writePlayerState(slot, { ...state, stats }); }
        return undefined;
      }, writeArmor: (armor: ArmorState): undefined => {
        const write = this.armorWrite(slot, armor); if (write === null) return undefined;
        const state = game.data.copyPlayerState(slot), stats = [...state.stats]; stats[definition.armor.pointsStat] = write.points;
        if (write.tier !== null) stats[write.tier.stat] = write.tier.value;
        game.data.writePlayerState(slot, { ...state, stats }); return undefined;
      } };
    if (combat.read(actor.id) === null) combat.bind(actor, binding); else combat.rebind(actor, binding);
    return undefined;
  }
  private powerStage(actor: OwnedActor): SourcePoweredArmorStage {
    return { bind: intercept => {
      if (!this.live(actor)) throw new Error("Source powered armor owner is retired");
      if (this.power.has(actor)) throw new Error("Source powered armor stage already has an owner");
      this.power.set(actor, intercept);
      try {
        this.removePower ??= this.options.game.module.bindFunction({ kind: "qvm", module: this.options.definition.module,
          instructionIndex: this.options.definition.armor.checkArmor }, call => this.checkArmor(call));
      } catch (error) { this.power.delete(actor); throw error; }
      return () => {
        if (this.power.get(actor) === intercept) this.power.delete(actor);
        this.removeUnusedPowerHook(); return undefined;
      };
    } };
  }
  private removeUnusedPowerHook(): void {
    if (this.power.size !== 0) return;
    this.removePower?.(); this.removePower = null;
  }
  private vector(word: number): Vec3 {
    if (word === 0) return { x: 0, y: 0, z: 0 };
    const view = this.options.game.module.memory.view(word, 12);
    return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) };
  }
  private checkArmor(call: QvmFunctionCall): number {
    const frame = this.scopes.current(call.words.getInt32(0, true));
    const intercept = frame === null ? undefined : this.power.get(frame.actor);
    if (frame === null || intercept === undefined) return call.proceed();
    if (!this.live(frame.actor)) return this.scopes.cancel(frame, call);
    const amount = call.words.getInt32(4, true), flags = call.words.getInt32(8, true), originating = attackDamageFlags(frame.request);
    const saved = intercept({ request: frame.request, amount,
      geometry: { direction: this.vector(frame.call.words.getInt32(12, true)), point: this.vector(frame.call.words.getInt32(16, true)), normal: frame.request.normal },
      // Q3 owns its live armor flag; foreign power-only flags have no Q3 argument encoding.
      flags: { stage: "power", noArmor: (flags & 2) !== 0, noPowerArmor: originating.noPowerArmor, noRegularArmor: false, energy: originating.energy } }, () => 0);
    if (!this.live(frame.actor)) return this.scopes.cancel(frame, call);
    if (!Number.isInteger(saved) || saved < 0 || saved > Math.max(0, amount)) throw new Error("QVM powered armor savings require an integer within the current source damage");
    call.words.setInt32(4, amount - saved, true);
    try { return saved + call.proceed(); }
    finally { call.words.setInt32(4, amount, true); }
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
    const target = this.sourceActor(call.words.getInt32(0, true));
    if (target === null) return call.proceed();
    const inflictor = this.sourceActor(call.words.getInt32(4, true))?.id ?? null;
    const attacker = this.sourceActor(call.words.getInt32(8, true))?.id ?? null;
    const flags = call.words.getInt32(24, true), amount = call.words.getInt32(20, true);
    const request: DamageRequest = { target: target.id, amount, knockback: (flags & 4) !== 0 || call.words.getInt32(12, true) === 0 ? 0 : amount,
      direction: this.vector(call.words.getInt32(12, true)), point: this.vector(call.words.getInt32(16, true)), normal: { x: 0, y: 0, z: 0 },
      delivery: (flags & 1) !== 0 ? "radius" : "direct", attack: { ...joined.provenance(attacker, inflictor, target.id), attacker, inflictor,
        cause: { kind: "q3", meansOfDeath: call.words.getInt32(28, true), damageFlags: flags } } };
    this.options.combat.runSourceDamage(request, (observer, effective) => {
      const actor = this.owned(effective.target), slot = this.options.slot(effective.target);
      if (actor === null || slot === null) return { appliedDamage: 0, reaction: "none" };
      if (isDeepStrictEqual(effective, request)) return this.scopes.run(call, actor, slot, effective, observer);
      let result: SourceDamageResult = { appliedDamage: 0, reaction: "none" };
      this.source.damage(this.lower(effective, slot), words => {
        const saved = Array.from({ length: 8 }, (_, index) => call.words.getInt32(index * 4, true));
        try {
          words.forEach((word, index) => {
            if (index === 3 && isDeepStrictEqual(effective.direction, request.direction) || index === 4 && isDeepStrictEqual(effective.point, request.point)) return;
            call.words.setInt32(index * 4, word, true);
          });
          result = this.scopes.run(call, actor, slot, effective, observer);
        } finally { saved.forEach((word, index) => call.words.setInt32(index * 4, word, true)); }
      });
      return result;
    });
    return 0;
  }
  private lower(request: DamageRequest, slot: number): QvmGameDamage {
    const { bodies, definition } = this.options, cause = request.attack.cause, flags = attackDamageFlags(request), inflictor = request.attack.inflictor;
    const sourceInflictor = inflictor === null ? null : this.options.slot(inflictor), inflictorBody = inflictor === null ? null : bodies.read(inflictor);
    return { target: slot, attacker: request.attack.attacker === null ? null : this.options.slot(request.attack.attacker),
      inflictor: sourceInflictor !== null ? { kind: "entity", slot: sourceInflictor } : inflictorBody === null ? null : { kind: "foreign", body: inflictorBody },
      direction: request.direction, point: request.point, amount: Math.trunc(request.amount),
      flags: cause.kind === "q3" ? cause.damageFlags : (request.delivery === "radius" ? 1 : 0) | (flags.noArmor ? 2 : 0) | (flags.noKnockback ? 4 : 0) | (flags.noProtection ? 8 : 0),
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
