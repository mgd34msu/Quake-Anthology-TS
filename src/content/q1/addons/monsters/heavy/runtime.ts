/* MG3 heavy monster source controllers. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../../contracts/identity.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../../persistence/value.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import type { Q1CallbackHandlers } from "../../../foundation/callbacks.ts";
import type { MonsterFrame } from "../../../base/animation.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import { BaseMonster, registerMonsterCallbacks } from "../../../base/monsters.ts";
import type { Q1AddonContext } from "../../context.ts";
import { initMg3Monster, startMg3Monster, mg3MonsterActivator, registerMg3MonsterStartup } from "../startup.ts";
import { Mg3Monster } from "../ai/index.ts";

export const heavyPrefix = "mg3:heavy";
export type HeavyAction = (monster: Q1HeavyMonster) => undefined;
export interface HeavyDefinition {
  readonly spec: MonsterSpecies;
  readonly frames: ReadonlyMap<string, MonsterFrame>;
  readonly actions: Readonly<Record<string, HeavyAction>>;
  readonly spawn: HeavyAction;
  readonly pain: (monster: Q1HeavyMonster, attacker: ActorId | null, damage: number) => undefined;
  readonly die: HeavyAction;
  readonly melee?: HeavyAction;
  readonly attack?: (monster: Q1HeavyMonster) => boolean;
  readonly sight?: HeavyAction;
  readonly callbacks?: Readonly<Record<string, Q1CallbackHandlers>>;
}
export class Q1HeavyMonster extends Mg3Monster {
  constructor(readonly runtime: Q1Mg3Heavy, entity: Q1Actor, readonly definition: HeavyDefinition) {
    super(runtime.context.game, entity, definition.spec, runtime.context.base, { callbackPrefix: heavyPrefix, frames: definition.frames,
      actions: new Map(Object.entries(definition.actions).map(([name, action]) => [name, (monster: BaseMonster) => action(runtime.require(monster.entity))])) });
  }
  get context(): Q1AddonContext { return this.runtime.context; }
  number(key: string, value: number): undefined { return this.context.setNumber(this.entity, key, value); }
  override spawn(): undefined { return this.definition.spawn(this); }
  installCallbacks(): undefined {
    const { game, entity } = this; entity.pain = game.named.pain(entity, `${heavyPrefix}:monster_pain`); entity.die = game.named.die(entity, `${heavyPrefix}:monster_die`);
    entity.pathEnd = game.named.action(entity, `${heavyPrefix}:monster_stand`); return undefined;
  }
  initialize(size: 1 | 2): undefined { this.installCallbacks(); return initMg3Monster(this, this.context, `progs/${this.spec.model}.mdl`, 1, size); }
  override start(): undefined { return startMg3Monster(this, this.context); }
  override use(activator: ActorId | null): undefined { return super.use(mg3MonsterActivator(this.game, activator)); }
  override play(name: string): undefined {
    const action = this.definition.actions[name]; if (!this.definition.frames.has(name) && action !== undefined) return action(this);
    return super.play(name);
  }
  override sightSound(): undefined { return this.definition.sight === undefined ? super.sightSound() : this.definition.sight(this); }
  override meleeAttack(): undefined { return this.definition.melee?.(this); }
  override tryAttack(): boolean {
    if (this.definition.attack !== undefined) return this.definition.attack(this);
    return this.checkAttack();
  }
  override pain(attacker: ActorId | null, damage: number): undefined { this.retaliate(attacker); return this.definition.pain(this, attacker, damage); }
  override die(attacker: ActorId | null): undefined {
    if (this.countedDeath) return undefined;
    const { game, entity } = this; this.enemy = attacker;
    if (game.health(entity.actor.id) < -99) game.host.combat.setHealth(entity.actor, -99);
    entity.damageable = false; entity.touch = null; this.countKill(); return this.definition.die(this);
  }
}
export class Q1Mg3Heavy {
  readonly monsters = new Map<OwnedActor, Q1HeavyMonster>();
  readonly definitions = new Map<string, HeavyDefinition>();
  runeKnightMeleeCycle = 0;
  constructor(readonly context: Q1AddonContext) {
    const { game } = context; registerMonsterCallbacks(game, heavyPrefix, entity => this.require(entity)); registerMg3MonsterStartup(game, heavyPrefix, entity => this.require(entity));
    game.named.register(`${heavyPrefix}:source_die`, { action: (_game, entity) => { const monster = this.require(entity); return monster.definition.die(monster); } });
    game.host.actors.onRelease(actor => { this.monsters.delete(actor); return undefined; });
    game.registerStateExtension({ id: heavyPrefix, capture: () => encodeCheckpointValue({ runeKnightMeleeCycle: this.runeKnightMeleeCycle, monsters: [...this.monsters.values()].map(monster => ({
      actor: { slot: monster.entity.actor.id.slot, generation: monster.entity.actor.id.generation }, definition: monster.spec.classnames[0] ?? monster.entity.classname, state: monster.capture(),
    })) }), restore: bytes => {
      const root = new SaveReader(decodeCheckpointValue(bytes), heavyPrefix); this.runeKnightMeleeCycle = root.field("runeKnightMeleeCycle").number(); this.monsters.clear();
      root.field("monsters").list(reader => {
        const saved = reader.field("actor"), owner = game.host.actors.resolveSaved({ slot: saved.field("slot").integer(0), generation: saved.field("generation").integer(0) }), entity = owner === null ? null : game.entity(owner.id);
        if (entity === null) return reader.fail("missing heavy monster actor");
        const definition = this.definitions.get(reader.field("definition").string()); if (definition === undefined) return reader.fail("unknown heavy monster definition");
        this.create(entity, definition).restore(reader.field("state")); return undefined;
      }); return undefined;
    }, clone: (source, target) => { const monster = this.monsters.get(source.actor); if (monster !== undefined) this.create(target, monster.definition).restore(new SaveReader(monster.capture(), heavyPrefix)); return undefined; } });
  }
  require(entity: Q1Actor): Q1HeavyMonster { const monster = this.monsters.get(entity.actor); if (monster === undefined) throw new Error(`Missing MG3 heavy source controller for ${entity.classname}`); return monster; }
  private create(entity: Q1Actor, definition: HeavyDefinition): Q1HeavyMonster { const monster = new Q1HeavyMonster(this, entity, definition); this.monsters.set(entity.actor, monster); return monster; }
  register(definition: HeavyDefinition): undefined {
    for (const [name, callback] of Object.entries(definition.callbacks ?? {})) this.context.game.named.register(`${heavyPrefix}:${name}`, callback);
    for (const classname of definition.spec.classnames) {
      this.definitions.set(classname, definition); this.context.game.registerSpawn(classname, (_game, entity) => this.create(entity, definition).spawn());
    }
    return undefined;
  }
}
