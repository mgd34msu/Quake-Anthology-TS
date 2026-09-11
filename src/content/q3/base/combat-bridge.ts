import type { AttackProvenance, CombatPolicy, CombatState, DamageDecision, DamageOutcome, DamageRequest, ItemId } from "../../../contracts/gameplay.ts";
import type { ProviderId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import { createQ3CombatPolicy, nativeVictimArmor } from "../../../world/gameplay/policies.ts";
import type { Q3EntityRecords } from "./records.ts";
import type { ServerWorld } from "./world.ts";
import type { EntityPool } from "./game/entities.ts";
import type { CombatContext, DamageDiagnostic, Q3DamageCall } from "./game/combat.ts";
import { q3DamageFeedback } from "./game/combat.ts";
import type { GameEntity } from "./game/state.ts";
import { GameFlags } from "./game/state.ts";
import { GameType, Powerup, statSchema } from "./shared/definitions.ts";
import { q3WeaponItem } from "../foundation/arsenal.ts";
import { itemAt } from "./shared/items.ts";

interface CombatBridgeServices {
  readonly authority: GameplayAuthority;
  readonly entities: EntityPool;
  readonly records: Q3EntityRecords;
  readonly world: ServerWorld;
  readonly weaponProvider: ProviderId;
  readonly combatProvider: ProviderId;
  readonly inventoryProvider: ProviderId;
  readonly movementProvider: ProviderId;
  armorContext(request: DamageRequest): { readonly screenFacingDot: number; readonly arithmetic: "binary32" | "binary64" };
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
    checkObeliskAttack(target: GameEntity, attacker: GameEntity): boolean;
    invulnerabilityEffect(target: GameEntity, direction: Vec3, point: Vec3): void; });

/** Source combat context and feedback over the existing shared damage authority. */
export class Q3CombatBridge {
  readonly context: CombatContext;
  private readonly calls: Q3DamageCall[] = [];
  private sequence = 0;

  constructor(readonly host: Q3CombatBridgeHost) {
    const shared = {
      authority: host.authority, entities: host.entities, world: host.world,
      get time() { return host.time(); }, get intermissionQueued() { return host.intermissionQueued(); },
      get gameType() { return host.gameType(); }, get friendlyFire() { return host.friendlyFire(); }, get knockback() { return host.knockback(); },
      debugDamage: host.debugDamage,
      attack: (inflictor: GameEntity, attacker: GameEntity, weapon: ItemId | null, meansOfDeath: number, flags: number): AttackProvenance => ({
        sequence: this.sequence++, time: { kind: "milliseconds", value: host.time() }, attacker: attacker.actor.id, inflictor: inflictor.actor.id,
        weapon: weapon ?? q3WeaponItem(inflictor.s.weapon || attacker.s.weapon)?.item ?? null, weaponProvider: host.weaponProvider, combatProvider: host.combatProvider, inventoryProvider: host.inventoryProvider,
        movementProvider: host.movementProvider, cause: { kind: "q3", meansOfDeath, damageFlags: flags },
      }),
      dispatch: (call: Q3DamageCall, operation: () => DamageOutcome): DamageOutcome => {
        this.calls.push(call); try { return operation(); } finally { this.calls.pop(); }
      },
      checkHurtCarrier: (target: GameEntity, attacker: GameEntity): void => host.checkHurtCarrier(target, attacker),
      logAccuracyHit: (target: GameEntity, attacker: GameEntity): boolean => host.logAccuracyHit(target, attacker),
    };
    this.context = host.product === "baseq3" ? { ...shared, product: "baseq3" } : {
      ...shared, product: "missionpack",
      checkObeliskAttack: (target, attacker) => host.checkObeliskAttack(target, attacker),
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
    if (call !== null && call.target.actor.id.equals(decision.request.target)) q3DamageFeedback(this.context, call, decision);
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
        const source = host.product === "missionpack" && method === 25 ? host.records.nativeByActor(request.attack.inflictor) : null;
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
            (target !== null && target === owner || source?.parent != null && this.sameTeam(target, source.parent)), product: host.product };
      },
    });
    const sourceState = (request: DamageRequest, state: CombatState, attacker: boolean): CombatState => {
      const entity = host.records.nativeByActor(attacker ? request.attack.attacker : request.target);
      return { ...state, invulnerable: state.invulnerable || entity !== null && (entity.flags & GameFlags.GODMODE) !== 0,
        team: entity?.client !== null && entity?.client !== undefined && host.gameType() >= GameType.GT_TEAM ? `q3-team:${entity.client.sess.sessionTeam}` : state.team };
    };
    return { id: policy.id, decide: (request, target, attacker) => policy.decide(request, sourceState(request, target, false),
      attacker === null ? null : sourceState(request, attacker, true)) };
  }

  private sameTeam(first: GameEntity | null, second: GameEntity | null): boolean {
    return first?.client != null && second?.client != null && this.host.gameType() >= GameType.GT_TEAM &&
      first.client.sess.sessionTeam === second.client.sess.sessionTeam;
  }
}
