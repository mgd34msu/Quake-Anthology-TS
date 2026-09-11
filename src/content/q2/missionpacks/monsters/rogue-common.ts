import type { MonsterContext } from "../../foundation/monsters/types.ts";
import { anglesVectors, enemyBody, finishDodge, health, projectFlash, visible } from "../../foundation/monsters/ai.ts";
import { parasiteDrainReachable } from "../../base/monsters/parasite.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import type { Q2GameServices } from "../../foundation/host.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import { dot, subtract } from "../../foundation/fields.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";

export function sourceTraceWorld(game: Q2GameServices, trace: TraceResult): boolean {
  return trace.hit.kind === "none" || trace.hit.kind === "world" || trace.hit.actor.equals(game.host.worldActor());
}

export function monsterMass(context: MonsterContext): number {
  const combat = context.game.host.combat.read(context.entity.actor.id);
  if (combat === null) throw new Error("Source monster has no shared combat state");
  return combat.mass;
}

export function rogueParasiteDrainTrace(context: MonsterContext): TraceResult | null {
  const { game, entity } = context, enemy = enemyBody(context);
  if (enemy === null) return null;
  const start = projectFlash(context, { x: 24, y: 0, z: 6 });
  if (!parasiteDrainReachable(start, enemy.origin) && !parasiteDrainReachable(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.max.z - 8 }) && !parasiteDrainReachable(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 8 })) return null;
  return game.host.trace({ start, end: enemy.origin, bounds: null, ignore: entity.actor.id, mask: 0x6000003 });
}

export function rogueBlockedCheckShot(context: MonsterContext, chance: number, source: Q2MissionPackMonsterState): boolean {
  const { entity, game } = context;
  if (entity.enemy === null || !game.host.isPlayer(entity.enemy) || game.host.random() < chance) return false;
  if (entity.classname === "monster_parasite") {
    const trace = rogueParasiteDrainTrace(context);
    if (trace === null) return false;
    if (trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy)) {
      source.get(entity).blocked = true; context.attack(); source.get(entity).blocked = false;
      return true;
    }
  }
  if (!visible(context) || game.entity(entity.enemy)?.classname !== "tesla") return false;
  source.get(entity).blocked = true; context.attack(); source.get(entity).blocked = false;
  return true;
}

export function rogueDuckDown(context: MonsterContext): undefined {
  const { game, entity, state } = context, body = game.body(entity);
  state.ducked = true; state.canTakeDamage = true;
  game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
  if (state.duckWait < game.host.now()) state.duckWait = game.host.now() + 1;
  return game.move(entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: state.normalHeight - 32 } } });
}
export function rogueDuckHold(context: MonsterContext): undefined { context.state.holdFrame = context.game.host.now() < context.state.duckWait; return undefined; }
export function rogueDuckUp(context: MonsterContext): undefined {
  const { game, entity, state } = context, body = game.body(entity);
  state.ducked = false; state.canTakeDamage = true; state.nextDuckTime = game.host.now() + 0.5;
  game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
  return game.move(entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: state.normalHeight } } });
}
export function rogueMonsterDodge(context: MonsterContext, monsters: Q2Monsters, attacker: ActorId, eta: number, trace: TraceResult | null, duck: ((context: MonsterContext, eta: number) => undefined) | null, sidestep: ((context: MonsterContext) => undefined) | null): undefined {
  const { entity, game, state } = context, random = game.host.random();
  if (health(game, entity.actor.id) < 1 || duck === null && (sidestep === null || state.standGround)) return undefined;
  if (entity.enemy === null) { entity.enemy = attacker; monsters.foundTarget(context); }
  if (eta < 0.1 || eta > 5 || random > 0.25 * (game.options.skill + 1) || trace === null) return undefined;
  const body = game.body(entity), height = body.origin.z + body.bounds.max.z - (duck === null ? 0 : 33), dodger = sidestep !== null && !state.standGround;
  if (duck !== null && !dodger && (trace.end.z <= height || state.ducked)) return undefined;
  if (dodger) {
    if (state.dodging) return undefined;
    if (trace.end.z <= height || state.ducked) {
      state.lefty = dot(anglesVectors(body.angles).right, subtract(trace.end, body.origin)) >= 0;
      if (duck !== null && state.ducked) rogueDuckUp(context);
      state.dodging = true; state.attackState = "sliding";
      return sidestep(context);
    }
  }
  if (duck !== null && state.nextDuckTime <= game.host.now()) { finishDodge(context); state.ducked = true; return duck(context, eta); }
  return undefined;
}
