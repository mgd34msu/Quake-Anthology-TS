/* quakec_mg1/monsters/boss.qc BOSS_KILLABLE and quakec_mg1/combat.qc: the 4000 HP Chthon that only the lightning gun hurts. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import type { MonsterFrame } from "../../../base/animation.ts";
import { monsterFrames } from "../../../base/frames.ts";
import { callbackName } from "../../../foundation/callbacks.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import type { Q1AddonContext } from "../../context.ts";

export const BOSS_KILLABLE = 2;
const prefix = "mg1:ordinary";

function frame(name: string): MonsterFrame { const value = monsterFrames.get(name); if (value === undefined) throw new Error(`Missing Chthon frame ${name}`); return value; }
const frames = new Map<string, MonsterFrame>();
/** shockz is shocka without the freeze. */
for (let i = 1; i <= 10; i++) frames.set(`boss_shockz${i}`, { ...frame(`boss_shocka${i}`), next: i === 10 ? "boss_missile1" : `boss_shockz${i + 1}` });
for (const name of ["boss_shocka10", "boss_shockb10"]) frames.set(name, { ...frame(name), operations: [{ kind: "action", name: "boss_freeze" }] });
export const chthonFrames: ReadonlyMap<string, MonsterFrame> = frames;

export function killableChthon(monster: BaseMonster): boolean { return monster.spec.species === "boss" && (monster.entity.spawnflags & BOSS_KILLABLE) !== 0; }

export const chthonActions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map([
  ["boss_freeze", monster => {
    const { game, entity } = monster; if (!killableChthon(monster)) return undefined;
    entity.fields.set("storednextthink", String(entity.nextThink)); entity.fields.set("addon.storedthink", callbackName(entity.think) ?? ""); entity.fields.set("is_frozen", "1");
    game.cancel(entity); entity.think = game.named.action(entity, "SUB_Null"); entity.use = game.named.use(entity, `${prefix}:boss_unfreeze`); return undefined;
  }],
]);

/** boss_awake with BOSS_KILLABLE: 4000 HP, damageable, no longer re-triggerable into the rise. */
export function awakeKillableChthon(monster: BaseMonster, activator: ActorId | null): undefined {
  const { game, entity } = monster;
  entity.model = "progs/boss.mdl"; entity.solid = "slidebox"; game.host.combat.setHealth(entity.actor, 4000); entity.maxHealth = 4000;
  entity.damageable = true; entity.aimedDamage = true; monster.enemy = activator;
  entity.use = game.named.use(entity, `${prefix}:monster_use`);
  game.effect("lava-splash", monster.origin); game.link(entity); return monster.play("boss_rise1");
}

/** boss_pain: shock animations on the first hit and when health crosses one third and two thirds. */
export function chthonPain(monster: BaseMonster, attacker: ActorId | null, damage: number): undefined {
  const { game, entity } = monster, health = game.health(entity.actor.id), max = entity.maxHealth, prior = health + damage;
  if (prior === max && health < max) { monster.play("boss_shockz1"); game.useTargets(entity, attacker); }
  if (health < max / 3 && prior > max / 3) { monster.play("boss_shockb1"); return game.useTargets(entity, attacker); }
  if (health < max * 2 / 3 && prior > max * 2 / 3) { monster.play("boss_shocka1"); return game.useTargets(entity, attacker); }
  return undefined;
}

export function registerChthon(context: Q1AddonContext, chthon: (entity: Q1Actor) => BaseMonster | undefined): undefined {
  const { game } = context;
  game.named.register(`${prefix}:boss_unfreeze`, { use: (_game, entity) => {
    const name = entity.text("addon.storedthink"), due = entity.number("storednextthink");
    entity.think = name === "" ? null : game.named.action(entity, name);
    if (entity.think !== null) game.schedule(entity, due - game.time, entity.think);
    entity.fields.set("storednextthink", "-1"); entity.fields.set("is_frozen", "0"); return undefined;
  } });
  game.registerDamageSourceEffects("mg1:chthon", { beforeHealth: request => {
    const entity = game.entity(request.target), monster = entity === null ? undefined : chthon(entity);
    if (monster === undefined || !killableChthon(monster)) return true;
    return request.attack.attacker !== null && game.player(request.attack.attacker)?.weapon === "lightning";
  } });
  return undefined;
}
