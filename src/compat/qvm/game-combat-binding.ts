import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { ArmorState, DamageRequest } from "../../contracts/gameplay.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmGame } from "./game.ts";
import type { SharedBodyTable } from "../../world/actors/body.ts";
import type { GameplayAuthority } from "../../world/gameplay/authority.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";
import { QvmGameCombat, type QvmGameArmorDefinition, type QvmGameCombatDefinition } from "./game-combat.ts";

interface NativeCombatDefinition extends QvmGameCombatDefinition {
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
  slot(actor: ActorId): number | null;
}

/** Shared attacks enter the source G_Damage; its own reactions remain authoritative. */
export class QvmCombatBindings {
  private readonly source: QvmGameCombat;
  constructor(private readonly options: NativeCombatOptions) {
    this.source = new QvmGameCombat(options.game, options.artifact, options.definition);
    for (const field of Object.values(options.definition.reactions)) if (!Number.isInteger(field) || field < 0 || field % 4 !== 0 || field + 4 > options.definition.entityStride)
      throw new Error("Source combat reaction field is outside its entity record");
    const { armor } = options.definition, image = options.artifact.image;
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
    const view = (): DataView => game.data.entityBytes(slot);
    const read = () => {
      const state = this.source.state(slot), flags = view().getInt32(definition.reactions.flags, true);
      const team = slot < game.data.numClients ? game.data.copyPlayerState(slot).persistent[3] ?? 0 : 0;
      return { health: state?.health ?? 0, canTakeDamage: state?.damageable ?? false, mass: 200, armor: this.armor(slot),
        team: team === 1 || team === 2 ? `q3:${team}` : null, invulnerable: (flags & 16) !== 0, noKnockback: (flags & 2048) !== 0 };
    };
    const binding = { read, sourceDamage: (request: DamageRequest) => this.damage(request, slot),
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
  private damage(input: DamageRequest, slot: number) {
    const { game, definition, combat, bodies } = this.options;
    return combat.runSourceDamage(input, (observer, request) => {
      const before = this.source.state(slot), armor = this.armor(slot), body = bodies.read(request.target);
      let flushed = false, result: { appliedDamage: number; reaction: "none" | "pain" | "death" } = { appliedDamage: 0, reaction: "none" };
      const flush = (): void => {
        if (flushed) return; flushed = true;
        const after = this.source.state(slot), currentArmor = this.armor(slot), currentBody = bodies.read(request.target);
        if (armor.regular.kind === "q3" && currentArmor.regular.kind === "q3" && armor.regular.points !== currentArmor.regular.points) observer.stored({ kind: "armor", before: armor, after: currentArmor });
        if (before !== null && after !== null && before.health !== after.health) { observer.stored({ kind: "health", before: before.health, after: after.health }); result.appliedDamage = before.health - after.health; }
        if (body !== null && currentBody !== null && (body.velocity.x !== currentBody.velocity.x || body.velocity.y !== currentBody.velocity.y || body.velocity.z !== currentBody.velocity.z))
          observer.stored({ kind: "source-velocity", before: body.velocity, after: currentBody.velocity, movementProvider: request.attack.movementProvider });
      };
      const entity = game.data.entityBytes(slot), pointer = game.data.checkpoint().entitiesWord + slot * definition.entityStride;
      const removals: (() => void)[] = [];
      try {
        for (const reaction of ["pain", "death"] satisfies readonly ("pain" | "death")[]) {
          const entry = entity.getInt32(reaction === "pain" ? definition.reactions.pain : definition.reactions.die, true);
          if (entry === 0) continue;
          removals.push(game.module.observeFunction({ kind: "qvm", module: definition.module, instructionIndex: entry }, call => {
            if (call.argument(0) !== pointer || flushed) return undefined;
            flush(); result = { reaction, appliedDamage: call.argument(reaction === "pain" ? 2 : 3) };
            observer.beforeReaction(result); return undefined;
          }));
        }
        const cause = request.attack.cause, flags = attackDamageFlags(request), inflictor = request.attack.inflictor;
        const sourceInflictor = inflictor === null ? null : this.options.slot(inflictor), inflictorBody = inflictor === null ? null : bodies.read(inflictor);
        this.source.damage({ target: slot, attacker: request.attack.attacker === null ? null : this.options.slot(request.attack.attacker),
          inflictor: sourceInflictor !== null ? { kind: "entity", slot: sourceInflictor } : inflictorBody === null ? null : { kind: "foreign", body: inflictorBody },
          direction: request.direction, point: request.point, amount: Math.trunc(request.amount),
          flags: cause.kind === "q3" ? cause.damageFlags : (request.delivery === "radius" ? 1 : 0) | (flags.noArmor ? 2 : 0) | (flags.noKnockback ? 4 : 0) | (flags.noProtection ? 8 : 0),
          method: request.attack.weapon !== null && ["q3:weapon_grapplinghook", "q2:weapon_grapple", "q2:weapon_hook", "ctf:grapple"].includes(request.attack.weapon)
            ? definition.grappleDamageMethod : cause.kind === "q3" ? cause.meansOfDeath : cause.kind === "q2" && cause.meansOfDeath === 56 ? definition.grappleDamageMethod : 0 });
        flush(); return result;
      } finally { for (const remove of removals) remove(); }
    });
  }
}
