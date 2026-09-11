/* quakec_{mg1,mg3}/monsters/*.qc native monster admission. GPL-2.0-or-later. */
import type { OwnedActor, ActorId } from "../../../../../contracts/identity.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../../../persistence/value.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { BaseMonster, registerMonsterCallbacks } from "../../../base/monsters.ts";
import { Mg3Monster } from "../ai/index.ts";
import { rocketOgreFrames, rocketOgreFrame, registerRocketOgre } from "./rocket-ogre.ts";
import { mg3OrdinaryAttack } from "./attack.ts";
import { baseSpecies } from "../../../base/species.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import type { MonsterFrame } from "../../../base/animation.ts";
import { monsterFrames } from "../../../base/frames.ts";
import type { Q1AddonContext } from "../../context.ts";
import { initMg3Monster, startMg3Monster, registerMg3MonsterStartup, mg3MonsterActivator } from "../startup.ts";

const stores = new WeakMap<Q1AddonContext, Map<OwnedActor, Q1OrdinaryMonster>>();
const small = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } };
const large = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } };
const hang = monsterFrames.get("zombie_paine1"); if (hang === undefined) throw new Error("Missing native zombie hang model frame");
const extraFrames: ReadonlyMap<string, MonsterFrame> = new Map([["zombie_hang1", { frame: hang.frame, next: "zombie_hang1", operations: [] }]]);

function sourceSpec(context: Q1AddonContext, entity: Q1Actor): MonsterSpecies {
  const classname = entity.text("addon.monsterClass") || entity.classname;
  const rocket = context.program === "mg3" && classname === "monster_ogre_rocket";
  const spec = baseSpecies.find(value => value.classnames.includes(rocket ? "monster_ogre" : classname)); if (spec === undefined) throw new Error(`Missing native addon monster ${classname}`);
  const bounds = spec.species === "demon" || spec.species === "ogre" || spec.species === "shambler" || spec.species === "shalrath" ? large : small;
  if (spec.species === "zombie" && context.program === "mg3" && (entity.spawnflags & 128) !== 0) return { ...spec, bounds, missile: null, melee: true };
  if (spec.species === "zombie" && context.program === "mg3") return { ...spec, bounds, missile: "zombie_missile" };
  return rocket ? { ...spec, bounds, model: "ogre_rocket", sight: "armagon/sight.wav" } : { ...spec, bounds };
}

export class Q1OrdinaryMonster extends BaseMonster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) {
    super(context.game, entity, sourceSpec(context, entity), context.base, { callbackPrefix: `${context.program}:ordinary`, frames: extraFrames });
  }
  override spawn(): undefined { return spawnOrdinary(this, this.context); }
  override start(): undefined { return startMg3Monster(this, this.context); }
  override use(activator: ActorId | null): undefined { return super.use(mg3MonsterActivator(this.game, activator)); }
  override meleeAttack(): undefined {
    if (this.spec.species !== "zombie") return super.meleeAttack();
    const r = this.game.host.random(); return this.play(r < 0.3 ? "zombie_atta1" : r < 0.6 ? "zombie_attb1" : "zombie_attc1");
  }
}

function spawnOrdinary(monster: BaseMonster, context: Q1AddonContext): undefined {
  const { game, entity, spec } = monster, prefix = `${context.program}:ordinary`;
  game.host.combat.setHealth(entity.actor, spec.health);
  entity.pain = game.named.pain(entity, `${prefix}:monster_pain`); entity.die = game.named.die(entity, `${prefix}:monster_die`);
  entity.pathEnd = game.named.action(entity, `${prefix}:monster_stand`);
  if (spec.species === "zombie" && ((entity.spawnflags & 1) !== 0 || context.program === "mg3" && (entity.spawnflags & 8388608) !== 0)) {
    entity.solid = "slidebox"; entity.movement = "none"; entity.model = "progs/zombie.mdl"; game.setBounds(entity, small); game.link(entity);
    return monster.play(context.program === "mg3" && (entity.spawnflags & 8388608) !== 0 ? "zombie_hang1" : "zombie_cruc1");
  }
  if (spec.species === "fish") entity.spawnflags |= 16384;
  if (spec.species !== "wizard" && spec.species !== "fish") context.setNumber(entity, "allowPathFind", 1);
  context.setNumber(entity, "combat_style", spec.species === "knight" || spec.species === "demon" || spec.species === "tarbaby" || spec.species === "fish" ? 2 : spec.species === "ogre" || spec.species === "hellknight" || spec.species === "shambler" ? 3 : 1);
  return initMg3Monster(monster, context, `progs/${spec.model}.mdl`, spec.species === "wizard" ? 2 : spec.species === "fish" ? 3 : 1,
    spec.species === "demon" || spec.species === "ogre" || spec.species === "shambler" || spec.species === "shalrath" ? 2 : 1);
}

class Q1Mg3OrdinaryMonster extends Mg3Monster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) {
    super(context.game, entity, sourceSpec(context, entity), context.base, { callbackPrefix: `${context.program}:ordinary`, frames: entity.text("addon.monsterClass") === "monster_ogre_rocket" ? new Map([...extraFrames, ...rocketOgreFrames]) : extraFrames });
  }
  override spawn(): undefined {
    if (this.spec.model === "ogre_rocket") {
      this.entity.classname = "monster_ogre"; this.entity.fields.set("aflag", "1");
      this.entity.fields.set("projectiles_max", "2"); this.entity.fields.set("projectiles", "2");
    }
    return spawnOrdinary(this, this.context);
  }
  override pain(attacker: ActorId | null, damage: number): undefined {
    if (this.spec.model !== "ogre_rocket") return super.pain(attacker, damage);
    if (this.state.painFinished > this.game.time || this.game.host.random() * 200 > damage) return undefined;
    this.game.sound(this.entity, "armagon/pain.wav"); const r = this.game.host.random();
    this.state.painFinished = this.game.time + (r < 0.75 ? 3 : 4);
    return this.play(r < 0.25 ? "ogre_pain1" : r < 0.5 ? "ogre_painb1" : r < 0.75 ? "ogre_painc1" : r < 0.88 ? "ogre_paind1" : "ogre_paine1");
  }
  override die(attacker: ActorId | null): undefined {
    if (this.spec.model !== "ogre_rocket" || this.game.health(this.entity.actor.id) < -80) return super.die(attacker);
    if (this.countedDeath) return undefined;
    this.enemy = attacker; this.entity.damageable = false; this.entity.touch = null; this.countKill();
    this.game.sound(this.entity, "armagon/sight2.wav"); return this.play(this.game.host.random() < 0.5 ? "ogre_die1" : "ogre_bdie1");
  }
  override start(): undefined { return startMg3Monster(this, this.context); }
  override use(activator: ActorId | null): undefined { return super.use(mg3MonsterActivator(this.game, activator)); }
  override tryAttack(): boolean { return mg3OrdinaryAttack(this); }
  override play(name: string): undefined {
    if (name === "zombie_missile") return this.meleeAttack();
    if (this.spec.model === "ogre_rocket" && name === "ogre_stand5") rocketOgreFrame(this, name);
    super.play(name); if (this.spec.model === "ogre_rocket" && name !== "ogre_stand5") rocketOgreFrame(this, name); return undefined;
  }
  override meleeAttack(): undefined {
    if (this.spec.species !== "zombie") return super.meleeAttack();
    const r = this.game.host.random(); return this.play(r < 0.3 ? "zombie_atta1" : r < 0.6 ? "zombie_attb1" : "zombie_attc1");
  }
}
function createOrdinary(context: Q1AddonContext, entity: Q1Actor): Q1OrdinaryMonster {
  return context.program === "mg3" ? new Q1Mg3OrdinaryMonster(context, entity) : new Q1OrdinaryMonster(context, entity);
}

export function ordinaryAddonMonster(context: Q1AddonContext, entity: Q1Actor): BaseMonster | undefined {
  return stores.get(context)?.get(entity.actor) ?? context.base.monsters.get(entity.actor);
}

export function registerOrdinaryAddonMonsters(context: Q1AddonContext): ReadonlyMap<OwnedActor, Q1OrdinaryMonster> {
  const { game } = context, prefix = `${context.program}:ordinary`, monsters = new Map<OwnedActor, Q1OrdinaryMonster>(); stores.set(context, monsters);
  const monster = (entity: Q1Actor): Q1OrdinaryMonster => { const value = monsters.get(entity.actor); if (value === undefined) throw new Error("Missing ordinary addon source state"); return value; };
  registerMonsterCallbacks(game, prefix, monster); registerMg3MonsterStartup(game, prefix, monster);
  for (const spec of baseSpecies) {
    if (spec.species === "boss" || spec.species === "oldone") continue;
    for (const classname of spec.classnames) game.replaceSpawn(classname, (_game, entity) => {
      entity.fields.set("addon.monsterClass", classname); const value = createOrdinary(context, entity); monsters.set(entity.actor, value); return value.spawn();
    });
  }
  if (context.program === "mg3") {
    registerRocketOgre(context);
    game.registerSpawn("monster_ogre_rocket", (_game, entity) => {
      entity.fields.set("addon.monsterClass", "monster_ogre_rocket"); const value = createOrdinary(context, entity); monsters.set(entity.actor, value); return value.spawn();
    });
  }
  game.host.actors.onRelease(actor => { monsters.delete(actor); return undefined; });
  game.registerStateExtension({ id: prefix,
    capture: () => encodeCheckpointValue([...monsters.values()].map(value => ({ slot: value.entity.actor.id.slot, generation: value.entity.actor.id.generation, state: value.capture() }))),
    restore: bytes => {
      monsters.clear(); new SaveReader(decodeCheckpointValue(bytes), prefix).list(reader => {
        const actor = game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }), entity = actor === null ? null : game.entity(actor.id);
        if (entity === null) return reader.fail("missing ordinary addon monster");
        const value = createOrdinary(context, entity); value.restore(reader.field("state")); monsters.set(entity.actor, value); return undefined;
      }); return undefined;
    },
    clone: (source, target) => { const value = monsters.get(source.actor); if (value === undefined) return undefined;
      const copy = createOrdinary(context, target); copy.restore(new SaveReader(value.capture(), prefix)); monsters.set(target.actor, copy); return undefined; },
  });
  return monsters;
}
