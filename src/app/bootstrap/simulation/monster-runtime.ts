import type { Q2Ballistics } from "../../../content/q2/foundation/weapons/ballistics.ts";
import type { EnemySelection, MonsterDefinitionReference, ProviderReference } from "../../../contracts/content.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Q1Entity } from "../../../formats/q1-map/index.ts";
import type { AuthoredMonster, MonsterMission } from "../../../content/monsters/authored.ts";
import type { Q1Foundation } from "../../../content/q1/foundation/runtime.ts";
import type { Q2Foundation } from "../../../content/q2/foundation/runtime.ts";
import type { Q2SpawnFields } from "../../../content/q2/foundation/host.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { Q2EntityServices } from "../../../content/q2/foundation/entity-services.ts";
import type { Q2ItemModule } from "../../../content/q2/foundation/items.ts";
import { placeTriggeredMonster } from "../../../content/q2/foundation/monsters/index.ts";
import type { Q2Monsters } from "../../../content/q2/foundation/monsters/index.ts";
import type { Q2PathFollower, Q2CombatFollower } from "../../../content/q2/foundation/monsters/index.ts";
import type { FrameContext } from "../../../contracts/time.ts";
import type { SourceRandom } from "./random.ts";
import type { SavedAuthoredMonster } from "./monster-checkpoint.ts";

export type SelectedMonsterSource = {
  readonly reference: ProviderReference;
  readonly random: SourceRandom;
  readonly clock: { frame: FrameContext; advanced: boolean };
} & ({ readonly kind: "q1"; readonly game: Q1EntityServices }
  | { readonly kind: "q2"; readonly game: Q2EntityServices; readonly monsters: Q2Monsters; readonly ballistics: Q2Ballistics });

export interface SelectedMonsterBehavior {
  attach(actor: OwnedActor, definition: MonsterDefinitionReference, mission: MonsterMission): undefined;
  validatePlacement(entry: AuthoredMonster, definition: MonsterDefinitionReference): undefined;
  enemy(actor: ActorId): ActorId | null;
  oldEnemy(actor: ActorId): ActorId | null;
  setRoute(actor: ActorId, goal: ActorId | null, pauseUntil: number): undefined;
  resume(actor: ActorId, activator: ActorId | null): undefined;
}

export type MonsterMap = { readonly kind: "q1"; readonly game: Q1Foundation }
  | { readonly kind: "q2"; readonly game: Q2Foundation; readonly items: Q2ItemModule };

const q1Ordinary = new Set(["monster_army", "monster_dog", "monster_knight", "monster_enforcer", "monster_demon1", "monster_ogre", "monster_ogre_marksman", "monster_hell_knight", "monster_shambler", "monster_wizard", "monster_shalrath", "monster_tarbaby", "monster_fish", "monster_zombie"]);
const q2Ordinary = new Set(["monster_soldier", "monster_soldier_light", "monster_soldier_ss", "monster_infantry", "monster_berserk", "monster_gladiator", "monster_gunner", "monster_parasite", "monster_flyer", "monster_floater", "monster_hover", "monster_mutant", "monster_chick", "monster_tank", "monster_tank_commander", "monster_flipper", "monster_brain"]);

/** Authored links and counters remain in the map program while behavior attaches to its actual actor. */
export class SelectedMonsters {
  readonly authored = new Map<ActorId, AuthoredMonster>();
  readonly definitions = new Map<ActorId, MonsterDefinitionReference>();
  constructor(readonly selection: Extract<EnemySelection, { readonly kind: "replace" }>, readonly map: MonsterMap,
    private readonly behavior: SelectedMonsterBehavior) {
    map.game.host.actors.onRelease(actor => { this.authored.delete(actor.id); this.definitions.delete(actor.id); return undefined; });
  }

  resolve(classname: string, fields: ReadonlyMap<string, string>): MonsterDefinitionReference | null {
    if (!classname.startsWith("monster_")) return null;
    const supported = this.map.kind === "q1" ? q1Ordinary : q2Ordinary;
    if (!supported.has(classname)) throw new Error(`Selected monster admission does not yet preserve authored ${classname} obligations`);
    const flags = Number(fields.get("spawnflags") ?? 0);
    const inhibition = this.map.kind === "q1" ? 0x700 : this.map.game.options.edition === "rerelease" ? 0xff00 : 0x1f00;
    if ((flags & ~inhibition & ~(this.map.kind === "q2" ? 3 : 1)) !== 0 || classname === "monster_zombie" && (flags & 1) !== 0) throw new Error(`Selected monster admission does not yet preserve ${classname} spawn flags ${flags}`);
    return this.selection.byClassname[classname] ?? this.selection.default;
  }

  admitQ1(actor: OwnedActor, source: Q1Entity, ordinal: number, definition: MonsterDefinitionReference): undefined {
    return this.admit(actor, new Map(source.properties.map(property => [property.key, property.value])), ordinal, definition);
  }
  admitQ2(actor: OwnedActor, source: Q2SpawnFields, definition: MonsterDefinitionReference): undefined {
    return this.admit(actor, source.values, source.ordinal, definition);
  }

  active(actor: ActorId): boolean { return (this.authored.get(actor)?.activation.kind ?? "active") === "active"; }

  capture(): readonly SavedAuthoredMonster[] {
    const save = (actor: ActorId) => ({ slot: actor.slot, generation: actor.generation });
    return [...this.authored.values()].map(entry => {
      const definition = this.definitions.get(entry.actor.id);
      if (definition === undefined) throw new Error("Authored monster has no selected definition");
      return { ...entry, definition, actor: save(entry.actor.id), routeGoal: entry.routeGoal === null ? null : save(entry.routeGoal), combatGoal: entry.combatGoal === null ? null : save(entry.combatGoal),
        activation: entry.activation.kind === "scheduled" ? { ...entry.activation, activator: entry.activation.activator === null ? null : save(entry.activation.activator) } : entry.activation };
    });
  }

  restore(entries: readonly SavedAuthoredMonster[]): undefined {
    const actors = this.map.game.host.actors;
    for (const saved of entries) {
      const actor = actors.resolveSaved(saved.actor);
      const provider = this.map.kind === "q1" ? this.map.game.provider : this.map.game.options.provider;
      if (actor === null || actor.owner !== provider) throw new Error("Missing authored monster map owner");
      const expected = this.selection.byClassname[saved.classname] ?? this.selection.default;
      if (expected.classname !== saved.definition.classname || expected.source.provider !== saved.definition.source.provider || expected.source.content !== saved.definition.source.content
        || actors.observe(actor.id)?.definition !== `${expected.source.provider}/${expected.classname}`) throw new Error("Saved monster definition differs from selected actor");
      const { definition, ...fields } = saved;
      const entry: AuthoredMonster = { ...fields, actor, routeGoal: saved.routeGoal === null ? null : actors.referenceSaved(saved.routeGoal), combatGoal: saved.combatGoal === null ? null : actors.referenceSaved(saved.combatGoal),
        activation: saved.activation.kind === "scheduled" ? { ...saved.activation, activator: saved.activation.activator === null ? null : actors.referenceSaved(saved.activation.activator) } : saved.activation };
      this.authored.set(actor.id, entry); this.definitions.set(actor.id, definition); this.map.game.authoredTargets.set(actor.id, entry);
    }
    return undefined;
  }

  beforeTurn(actor: ActorId): boolean {
    const entry = this.authored.get(actor);
    if (entry === undefined || entry.activation.kind === "active") return true;
    const activation = entry.activation;
    if (this.map.kind !== "q2") throw new Error("Triggered monster activation requires its Q2 map program");
    if (activation.kind === "dormant" || activation.at > this.map.game.host.now()) return false;
    const game = this.map.game;
    placeTriggeredMonster(game, entry.actor);
    if (!game.host.actors.isLive(actor)) return false;
    entry.activation = { kind: "active" };
    game.host.combat.setTraits(entry.actor, { canTakeDamage: true });
    game.host.bodies.link(entry.actor);
    this.behavior.resume(actor, (entry.spawnflags & 1) === 0 ? activation.activator : null);
    return game.host.actors.isLive(actor);
  }

  q1PathFollower(actor: ActorId): { readonly targetname: string; readonly enemy: ActorId | null; advance(name: string, goal: ActorId | null, pauseUntil: number): undefined } | null {
    const entry = this.authored.get(actor);
    if (entry === undefined) return null;
    return { targetname: entry.route, enemy: this.behavior.enemy(actor), advance: (name, goal, pauseUntil) => {
      entry.route = goal === null ? "" : name; entry.routeGoal = goal; entry.routeResolved = true;
      return this.behavior.setRoute(actor, goal, pauseUntil);
    } };
  }

  q2PathFollower(actor: ActorId): Q2PathFollower | null {
    const entry = this.authored.get(actor);
    if (entry === undefined) return null;
    return { actor: entry.actor, moveTarget: entry.routeGoal, enemy: this.behavior.enemy(actor), advance: (name, goal, pauseUntil) => {
      entry.route = name; entry.routeGoal = goal; entry.routeResolved = true;
      return this.behavior.setRoute(actor, goal, pauseUntil);
    } };
  }

  q2CombatFollower(actor: ActorId): Q2CombatFollower | null {
    const entry = this.authored.get(actor);
    if (entry === undefined) return null;
    return { get moveTarget() { return entry.combatGoal; }, enemy: this.behavior.enemy(actor), oldEnemy: this.behavior.oldEnemy(actor),
      activator: entry.activation.kind === "scheduled" ? entry.activation.activator : null, walking: true,
      advance: (target, _goal, moveTarget) => { entry.target = target; entry.combatGoal = moveTarget; return undefined; },
      hold: () => { entry.standGround = true; return undefined; },
      finish: () => { entry.target = ""; entry.combatGoal = null; return undefined; } };
  }

  private admit(actor: OwnedActor, fields: ReadonlyMap<string, string>, ordinal: number, definition: MonsterDefinitionReference): undefined {
    const target = fields.get("target") ?? "";
    const entry: AuthoredMonster = { actor, classname: fields.get("classname") ?? "", sourceOrdinal: ordinal,
      spawnflags: Number(fields.get("spawnflags") ?? 0), deathTarget: fields.get("deathtarget") ?? "", dropItem: fields.get("item") ?? "", targetname: fields.get("targetname") ?? "", target,
      killtarget: fields.get("killtarget") ?? "", message: fields.get("message") ?? "", delay: Number(fields.get("delay") ?? 0), route: target, routeGoal: null, routeResolved: false, countedDeath: false,
      combatTarget: fields.get("combattarget") ?? "", combatGoal: null, standGround: false,
      activation: this.map.kind === "q2" && (Number(fields.get("spawnflags") ?? 0) & 2) !== 0 ? { kind: "dormant" } : { kind: "active" } };
    this.authored.set(actor.id, entry); this.definitions.set(actor.id, definition);
    this.map.game.authoredTargets.set(actor.id, entry);
    this.behavior.attach(actor, definition, this.mission(entry));
    if (entry.activation.kind !== "active") {
      this.map.game.host.combat.setTraits(actor, { canTakeDamage: false });
      this.map.game.host.bodies.link(actor);
    }
    return undefined;
  }

  private route(entry: AuthoredMonster): ActorId | null {
    if (entry.routeResolved) return entry.routeGoal;
    const game = this.map.game;
    if (this.map.kind === "q2" && this.map.game.targets(entry.route).some(target => target.classname === "point_combat")) {
      entry.combatTarget = entry.route; entry.target = ""; entry.route = "";
    }
    const target = this.map.kind === "q1" ? this.map.game.find(entry.route)[0] : this.map.game.pickTarget(entry.route);
    entry.routeGoal = target?.classname === "path_corner" && game.host.actors.isLive(target.actor.id) ? target.actor.id : null;
    entry.routeResolved = true;
    if (this.map.kind === "q2" && entry.routeGoal !== null) entry.target = "";
    return entry.routeGoal;
  }

  mission(entry: AuthoredMonster): MonsterMission {
    return { ambush: (entry.spawnflags & 1) !== 0, started: () => {
      const definition = this.definitions.get(entry.actor.id);
      if (definition === undefined) throw new Error("Started monster has no selected definition");
      return this.behavior.validatePlacement(entry, definition);
    }, route: () => this.route(entry), foundTarget: () => {
      if (entry.combatTarget !== "" && this.behavior.enemy(entry.actor.id) !== null && this.map.kind === "q2") {
        const target = this.map.game.pickTarget(entry.combatTarget);
        if (target !== null) {
          entry.combatTarget = ""; entry.combatGoal = target.actor.id;
          if (this.map.game.options.edition === "classic") target.targetname = "";
        }
      }
      return undefined;
    }, combatRoute: () => ({ goal: entry.combatGoal, standGround: entry.standGround }), use: activator => {
      if (entry.activation.kind === "active") return false;
      if (this.map.kind !== "q2") throw new Error("Triggered monster use requires its Q2 map program");
      if (entry.activation.kind === "dormant") entry.activation = { kind: "scheduled", at: this.map.game.host.now() + (this.map.game.options.edition === "rerelease" ? this.map.game.host.frameSeconds() : 0.1), activator };
      return true;
    }, spawned: () => {
      if (this.map.kind === "q1") {
        this.map.game.totalMonsters++;
        if (entry.classname === "monster_fish" && this.map.game.options.edition === "classic") this.map.game.totalMonsters++;
      } else this.map.game.counters.totalMonsters++;
      return undefined;
    }, killed: attacker => {
      if (entry.countedDeath) return undefined;
      entry.countedDeath = true;
      if (this.map.kind === "q1") {
        const game = this.map.game; game.killedMonsters++;
        game.host.emit({ kind: "monster-killed", actor: entry.actor.id, total: game.totalMonsters, found: game.killedMonsters });
      } else {
        const game = this.map.game; game.counters.killedMonsters++;
        if (entry.dropItem !== "") {
          this.map.items.dropMonster(entry.actor, game, entry.dropItem);
        }
        if (entry.deathTarget !== "") entry.target = entry.deathTarget;
      }
      return this.map.game.useTargets(entry, attacker);
    } };
  }
}
