/* Base Quake campaign and boss behavior. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import { WEAPONS } from "../foundation/types.ts";
import { SaveReader, namespaced } from "../../../persistence/value.ts";
import { BaseMonster, registerMonsterCallbacks } from "./monsters.ts";
import type { MonsterServices } from "./monsters.ts";
import type { MonsterSpecies } from "./species.ts";
import { baseSpecies } from "./species.ts";
import { registerProjectileCallbacks } from "./projectiles.ts";
import type { BackpackContents } from "./projectiles.ts";
import { wizardFastFire } from "./monster-actions.ts";

const components = new WeakMap<Q1EntityServices, Q1Creatures>();
export function q1Creatures(game: Q1EntityServices): Q1Creatures {
  const creatures = components.get(game);
  if (creatures === undefined) throw new Error("Q1 creature services were not registered");
  return creatures;
}

export class Q1Creatures implements MonsterServices {
  readonly monsters = new Map<OwnedActor, BaseMonster>();
  readonly backpacks = new Map<OwnedActor, BackpackContents>();
  readonly projectileTargets = new Map<OwnedActor, ActorId>();
  readonly wizardShots = new Map<OwnedActor, { readonly enemy: ActorId; readonly right: Vec3 }>();
  private hellKnightType = 0;

  constructor(readonly game: Q1EntityServices, private readonly services: Pick<MonsterServices, "countMonsterKill" | "finale" | "finishFinale">) {
    if (components.has(game)) throw new Error("Q1 creature services already registered");
    components.set(game, this);
    game.host.actors.onRelease(actor => { this.monsters.delete(actor); this.backpacks.delete(actor); this.projectileTargets.delete(actor); this.wizardShots.delete(actor); return undefined; });
    registerMonsterCallbacks(game, "base", entity => {
      const monster = this.monsters.get(entity.actor);
      if (monster === undefined) throw new Error(`Missing Q1 monster controller for ${entity.classname}`);
      return monster;
    });
    registerProjectileCallbacks(game);
    game.named.register("base:wizard_fastfire", { action: wizardFastFire });
  }
  registerSpecies(species: readonly MonsterSpecies[]): undefined {
    for (const spec of species) for (const classname of spec.classnames) this.game.registerSpawn(classname, (_game, entity) => {
      const monster = new BaseMonster(this.game, entity, spec, this); this.monsters.set(entity.actor, monster); return monster.spawn();
    });
  }
  countMonsterKill(monster: BaseMonster): boolean { return this.services.countMonsterKill(monster); }
  finale(monster: BaseMonster): undefined { return this.services.finale(monster); }
  finishFinale(monster: BaseMonster): undefined { return this.services.finishFinale(monster); }
  clone(source: Q1Actor, target: Q1Actor): undefined {
    const original = this.monsters.get(source.actor);
    if (original !== undefined) { const monster = new BaseMonster(this.game, target, original.spec, this, original.source); monster.restore(new SaveReader(original.capture())); this.monsters.set(target.actor, monster); }
    const backpack = this.backpacks.get(source.actor); if (backpack !== undefined) this.backpacks.set(target.actor, backpack);
    const enemy = this.projectileTargets.get(source.actor); if (enemy !== undefined) this.projectileTargets.set(target.actor, enemy);
    const shot = this.wizardShots.get(source.actor); if (shot !== undefined) this.wizardShots.set(target.actor, shot);
    return undefined;
  }
  captureFields() {
    const saved = (actor: ActorId) => ({ slot: actor.slot, generation: actor.generation });
    return { hellKnightType: this.hellKnightType,
      monsters: [...this.monsters.values()].map(monster => ({ actor: saved(monster.entity.actor.id), state: monster.capture() })),
      backpacks: [...this.backpacks].map(([actor, contents]) => ({ actor: saved(actor.id), contents: { weapon: contents.weapon, shells: contents.shells, nails: contents.nails, rockets: contents.rockets, cells: contents.cells, extra: contents.extra ?? [], selection: contents.selection ?? "source-default", avoidUnderwaterLightning: contents.avoidUnderwaterLightning ?? this.game.options.edition === "rerelease", ownerPickupDelay: contents.ownerPickupDelay ?? 0 } })),
      targets: [...this.projectileTargets].map(([actor, enemy]) => ({ actor: saved(actor.id), enemy: saved(enemy) })),
      shots: [...this.wizardShots].map(([actor, shot]) => ({ actor: saved(actor.id), enemy: saved(shot.enemy), right: shot.right })),
    };
  }
  restoreFields(root: SaveReader): undefined {
    const actor = (reader: SaveReader): OwnedActor => { const value = this.game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }); if (value === null) return reader.fail("missing saved actor"); return value; };
    const reference = (reader: SaveReader): ActorId => this.game.host.actors.referenceSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) });
    this.hellKnightType = root.field("hellKnightType").number();
    this.monsters.clear(); this.backpacks.clear(); this.projectileTargets.clear(); this.wizardShots.clear();
    root.field("monsters").list(reader => {
      const owner = actor(reader.field("actor")), entity = this.game.entity(owner.id); if (entity === null) return reader.fail("missing source monster entity");
      const spec = baseSpecies.find(species => species.classnames.includes(entity.classname)); if (spec === undefined) return reader.fail("unknown base monster");
      const monster = new BaseMonster(this.game, entity, spec, this); monster.restore(reader.field("state")); this.monsters.set(owner, monster); return undefined;
    });
    root.field("backpacks").list(reader => { const data = reader.field("contents"); this.backpacks.set(actor(reader.field("actor")), { weapon: data.field("weapon").nullable(value => value.choice(...WEAPONS, ...this.game.registeredWeapons.keys())), shells: data.field("shells").number(), nails: data.field("nails").number(), rockets: data.field("rockets").number(), cells: data.field("cells").number(), extra: data.field("extra").list(entry => ({ item: namespaced(entry.field("item")), count: entry.field("count").number() })), selection: data.field("selection").choice("source-default", "rank"), avoidUnderwaterLightning: data.field("avoidUnderwaterLightning").boolean(), ownerPickupDelay: data.field("ownerPickupDelay").number() }); return undefined; });
    root.field("targets").list(reader => { this.projectileTargets.set(actor(reader.field("actor")), reference(reader.field("enemy"))); return undefined; });
    root.field("shots").list(reader => { const right = reader.field("right"); this.wizardShots.set(actor(reader.field("actor")), { enemy: reference(reader.field("enemy")), right: { x: right.field("x").number(), y: right.field("y").number(), z: right.field("z").number() } }); return undefined; });
    return undefined;
  }
  nextHellKnightMelee(): string {
    this.hellKnightType++;
    if (this.hellKnightType === 1) return "hknight_slice1";
    if (this.hellKnightType === 2) return "hknight_smash1";
    this.hellKnightType = 0; return "hknight_watk1";
  }
}
