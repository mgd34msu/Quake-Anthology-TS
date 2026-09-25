import { SaveReader } from "../../../persistence/value.ts";
import type { VictimArmorContext } from "../../../world/gameplay/armor.ts";
import type { AttackProvenance, CombatPolicy, CombatProgress, CurrentCombatState, CombatState, DamageDecision, DamageOutcome, DamageRequest, ItemId, SourceDamageModifier } from "../../../contracts/gameplay.ts";
import type { ActorId, ProviderId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import { createQ3CombatPolicy, nativeVictimArmor } from "../../../world/gameplay/policies.ts";
import type { Q3EntityRecords } from "./records.ts";
import type { ActorSpatialQueries, ServerWorld } from "./world.ts";
import type { EntityPool } from "./game/entities.ts";
import type { CombatContext, DamageDiagnostic, Q3DamageCall } from "./game/combat.ts";
import { q3DamageFeedback, q3ForeignDamageFeedback } from "./game/combat.ts";
import { GameEntity } from "./game/state.ts";
import type { UseParticipant, DamageParticipant } from "./game/state.ts";
import { useActor } from "./game/use-participant.ts";
import { GameFlags } from "./game/state.ts";
import { GameType, Powerup, statSchema } from "./shared/definitions.ts";
import { q3WeaponItem } from "../foundation/arsenal.ts";
import { itemAt } from "./shared/items.ts";

interface CombatBridgeServices {
  readonly authority: GameplayAuthority;
  readonly entities: EntityPool;
  readonly records: Q3EntityRecords;
  readonly world: ServerWorld & ActorSpatialQueries;
  readonly weaponProvider: ProviderId;
  readonly damagePowerupOwner?: ProviderId;
  readonly sourceDamageModifier?: SourceDamageModifier;
  readonly combatProvider: ProviderId;
  readonly inventoryProvider: ProviderId;
  readonly movementProvider: ProviderId;
  armorContext(request: DamageRequest): VictimArmorContext;
  time(): number;
  intermissionQueued(): number;
  gameType(): number;
  friendlyFire(): boolean;
  knockback(): number;
  readonly debugDamage: ((diagnostic: DamageDiagnostic) => void) | null;
  checkHurtCarrier(target: GameEntity, attacker: GameEntity): void;
  logAccuracyHit(target: GameEntity, attacker: GameEntity): boolean;
}
export type Q3CombatBridgeHost = CombatBridgeServices & ({ readonly product: "baseq3" } |
  { readonly product: "missionpack";
    projectileParent(actor: ActorId): ActorId | null;
    checkObeliskAttack(target: GameEntity, attacker: GameEntity): boolean;
    invulnerabilityEffect(target: GameEntity, direction: Vec3, point: Vec3): void; });

/** Source combat context and feedback over the existing shared damage authority. */
export class Q3CombatBridge {
  captureSaveState() {
    if (this.calls.length !== 0) throw new Error("Cannot save Q3 during a combat call");
    return { sequence: this.sequence };
  }
  restoreSaveState(value: unknown): void {
    if (this.calls.length !== 0) throw new Error("Cannot restore Q3 during a combat call");
    this.sequence = new SaveReader(value, "q3.combatBridge").field("sequence").integer(0);
  }

  readonly context: CombatContext;
  private readonly calls: Q3DamageCall[] = [];
  private sequence = 0;

  constructor(readonly host: Q3CombatBridgeHost) {
    const shared = {
      authority: host.authority, entities: host.entities, spatial: host.world,
      ...(host.sourceDamageModifier === undefined ? {} : { sourceDamageModifier: host.sourceDamageModifier }),
      actors: {
        isLive: (actor: ActorId) => host.records.host.actors.isLive(actor),
        participant: (actor: ActorId) => host.records.damageInflictor(actor),
        parent: (actor: ActorId): ActorId | null => host.product === "missionpack" ? host.projectileParent(actor) : null,
        linkedBounds: (actor: ActorId) => host.records.host.bodies.linked(actor)?.absoluteBounds ?? null,
        isPlayer: (actor: ActorId) => {
          const native = host.records.nativeByActor(actor);
          return native === null ? host.records.host.isPlayer(actor) : native.client !== null;
        },
      },
      get time() { return host.time(); }, get intermissionQueued() { return host.intermissionQueued(); },
      get gameType() { return host.gameType(); }, get friendlyFire() { return host.friendlyFire(); }, get knockback() { return host.knockback(); },
      debugDamage: host.debugDamage,
      attack: (inflictor: DamageParticipant, attacker: UseParticipant, weapon: ItemId | null, meansOfDeath: number, flags: number, originatingProjectile?: ActorId): AttackProvenance => ({
        sequence: this.sequence++, time: { kind: "milliseconds", value: host.time() }, attacker: useActor(attacker), inflictor: useActor(inflictor),
        ...(originatingProjectile === undefined ? {} : { originatingProjectile }),
        weapon: weapon ?? q3WeaponItem((inflictor instanceof GameEntity ? inflictor.s.weapon : 0) || (attacker instanceof GameEntity ? attacker.s.weapon : 0))?.item ?? null, weaponProvider: host.weaponProvider, combatProvider: host.combatProvider, inventoryProvider: host.inventoryProvider,
        movementProvider: host.movementProvider, damagePowerupOwner: host.damagePowerupOwner ?? host.weaponProvider, cause: { kind: "q3", meansOfDeath, damageFlags: flags },
      }),
      dispatch: (call: Q3DamageCall, operation: () => DamageOutcome): DamageOutcome => {
        this.calls.push(call); try { return operation(); } finally { this.calls.pop(); }
      },
      checkHurtCarrier: (target: GameEntity, attacker: GameEntity): void => host.checkHurtCarrier(target, attacker),
      logAccuracyHit: (target: GameEntity, attacker: GameEntity): boolean => host.logAccuracyHit(target, attacker),
    };
    this.context = host.product === "baseq3" ? { ...shared, product: "baseq3" } : {
      ...shared, product: "missionpack",
      checkObeliskAttack: (target, attacker) => {
        const native = attacker instanceof GameEntity ? attacker : host.records.nativeByActor(attacker.actor);
        if (native === null && host.records.host.isPlayer(useActor(attacker))) throw new Error("Admitted Q3 map player has no native client behavior record");
        return native === null ? false : host.checkObeliskAttack(target, native);
      },
      invulnerabilityEffect: (target, direction, point) => host.invulnerabilityEffect(target, direction, point),
    };
    // Object spread evaluates accessor properties. Install the live source cvars and clocks on the final context.
    Object.defineProperties(this.context, {
      time: { get: () => host.time() }, intermissionQueued: { get: () => host.intermissionQueued() },
      gameType: { get: () => host.gameType() }, friendlyFire: { get: () => host.friendlyFire() }, knockback: { get: () => host.knockback() },
    });
  }

  get currentCall(): Q3DamageCall | null { return this.calls[this.calls.length - 1] ?? null; }

  /** The shared GameplayAuthority beforeReaction hook calls this before dispatching actor callbacks. */
  beforeReaction(decision: DamageDecision): void {
    const call = this.currentCall;
    if (decision.request.attack.cause.kind === "q3" && call !== null && call.target.actor.id.equals(decision.request.target)) {
      q3DamageFeedback(this.context, call, decision);
      return;
    }
    const target = this.host.records.nativeByActor(decision.request.target);
    const attacker = decision.request.attack.attacker;
    if (target !== null) q3ForeignDamageFeedback(this.context, target, attacker === null ? null : this.host.records.nativeByActor(attacker), decision);
  }

  /** Register this once under the selected combat provider; victims retain their own armor policy. */
  policy(): CombatPolicy {
    const host = this.host;
    const policy = createQ3CombatPolicy({ id: host.combatProvider,
      armor: nativeVictimArmor(request => host.armorContext(request)),
      context: request => {
        const target = host.records.nativeByActor(request.target), owner = host.records.nativeByActor(request.attack.attacker);
        const targetClient = target?.client ?? null, ownerClient = owner?.client ?? null;
        const method = request.attack.cause.kind === "q3" ? request.attack.cause.meansOfDeath : -1;
        const parentActor = host.product === "missionpack" && method === 25 && request.attack.inflictor !== null ? this.context.actors.parent(request.attack.inflictor) : null;
        const parent = host.records.nativeByActor(parentActor);
        const schema = statSchema(host.product);
        const guard = ownerClient !== null && schema.product === "missionpack" &&
          itemAt("missionpack", ownerClient.ps.stats.get(schema.persistentPowerup)).tag === Powerup.PW_GUARD;
        return { player: targetClient !== null, attackerPlayer: ownerClient !== null,
          attackerMaxHealth: ownerClient?.ps.stats.get(schema.maxHealth) ?? 100, attackerGuard: guard,
          intermission: host.intermissionQueued() !== 0, noclip: targetClient?.noclip ?? false,
          missionpackInvulnerability: host.product === "missionpack" && targetClient !== null && targetClient.invulnerabilityTime > host.time(),
          noKnockback: target !== null && (target.flags & GameFlags.NO_KNOCKBACK) !== 0,
          knockbackScale: host.knockback(), friendlyFire: host.friendlyFire(),
          battlesuit: targetClient !== null && targetClient.ps.powerups.get(Powerup.PW_BATTLESUIT) !== 0,
          falling: method === 19, juiced: method === 27,
          proximityProtected: host.product === "missionpack" && method === 25 &&
            (target !== null && target === owner || parent !== null && this.sameTeam(target, parent)), product: host.product };
      },
    });
    const sourceState = (request: DamageRequest, state: CombatState, attacker: boolean): CombatState => {
      const entity = host.records.nativeByActor(attacker ? request.attack.attacker : request.target);
      return { ...state, invulnerable: state.invulnerable || entity !== null && (entity.flags & GameFlags.GODMODE) !== 0,
        team: entity?.client !== null && entity?.client !== undefined && host.gameType() >= GameType.GT_TEAM ? `q3-team:${entity.client.sess.sessionTeam}` : state.team };
    };
    const project = (request: DamageRequest, current: CurrentCombatState): CurrentCombatState => ({
      target: () => { const value = current.target(); return value === null ? null : sourceState(request, value, false); },
      attacker: () => { const value = current.attacker(); return value === null ? null : sourceState(request, value, true); },
    });
    const progress = (value: CombatProgress): CombatProgress => {
      switch (value.kind) {
        case "complete": return value;
        case "source-continuation": return { ...value, resume: (current: CurrentCombatState) => progress(value.resume(project(value.request, current))) };
        case "armor-stage": return { ...value, resume: (result, current) => progress(value.resume(result, project(value.request, current))) };
      }
    };
    return { id: policy.id, decide: (request, target, attacker) => progress(policy.decide(request, sourceState(request, target, false),
      attacker === null ? null : sourceState(request, attacker, true))) };
  }

  private sameTeam(first: GameEntity | null, second: GameEntity | null): boolean {
    return first?.client != null && second?.client != null && this.host.gameType() >= GameType.GT_TEAM &&
      first.client.sess.sessionTeam === second.client.sess.sessionTeam;
  }
}
