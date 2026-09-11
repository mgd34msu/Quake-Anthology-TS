/* Rogue g_newai.c and rerelease rogue/g_rogue_newai.cpp hint paths, plus g_ai pursuit.
 * Copyright (C) 1998-2023 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import { saveQ2Actor } from "../../foundation/checkpoint.ts";
import { length, subtract } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Touch } from "../../foundation/host.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext } from "../../foundation/monsters/types.ts";
import { health, MASK_OPAQUE, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import type { SaveReader } from "../../../../persistence/value.ts";
import { readSavedActor } from "../../../../persistence/save-image.ts";

const HINT_ENDPOINT = 1;
const MAX_HINT_CHAINS = 100;
const HOLD_FOREVER = Number(0x7fffffffffffffffn) / 1000;

interface HintNode { chain: number; next: ActorId | null; }
interface HintMonster { goal: ActorId | null; lastTime: number; }
export interface Q2HintPathInitialization {
  readonly present: boolean;
  readonly chains: number;
  readonly issues: readonly string[];
}
export interface Q2RogueHintsCheckpoint {
  readonly version: 1;
  readonly present: boolean;
  readonly starts: readonly SavedActorId[];
  readonly nodes: readonly { readonly actor: SavedActorId; readonly chain: number; readonly next: SavedActorId | null }[];
  readonly monsters: readonly { readonly actor: SavedActorId; readonly goal: SavedActorId | null; readonly lastTime: number }[];
}

export function decodeQ2RogueHintsCheckpoint(reader: SaveReader): Q2RogueHintsCheckpoint {
  const checkpoint: Q2RogueHintsCheckpoint = {
    version: reader.field("version").literal(1), present: reader.field("present").boolean(),
    starts: reader.field("starts").list(readSavedActor),
    nodes: reader.field("nodes").list(node => ({ actor: readSavedActor(node.field("actor")), chain: node.field("chain").integer(-1), next: node.field("next").nullable(readSavedActor) })),
    monsters: reader.field("monsters").list(monster => ({ actor: readSavedActor(monster.field("actor")), goal: monster.field("goal").nullable(readSavedActor), lastTime: monster.field("lastTime").finite() })),
  };
  if (checkpoint.starts.length > MAX_HINT_CHAINS || checkpoint.nodes.some(node => node.chain >= checkpoint.starts.length)) reader.fail("invalid hint chain index");
  return checkpoint;
}

/** Hint links belong to map entities; movement, enemy selection and animation belong to Q2Monsters. */
export class Q2RogueHints implements Q2SpawnModule {
  private present = false;
  private readonly starts: ActorId[] = [];
  private readonly nodes = new Map<ActorId, HintNode>();
  private readonly pursuers = new Map<ActorId, HintMonster>();

  constructor(private readonly monsters: Q2Monsters) {}

  readonly hooks = {
    run: (context: MonsterContext, distance: number): boolean => this.run(context, distance),
    checkLost: (context: MonsterContext): boolean => this.checkLost(context),
    stop: (context: MonsterContext): undefined => this.stop(context),
  };
  private readonly sourceTouch: Q2Touch = (entity, game, contact) => {
    const context = this.monsters.context(contact.other);
    return context === null ? undefined : this.touch(entity, game, context);
  };
  get callbacks(): Q2CallbackDefinitions { return { touch: { hint_path_touch: this.sourceTouch } }; }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname !== "hint_path") return false;
    if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
    if (entity.target.length === 0 && entity.targetname.length === 0) {
      game.host.diagnostic(`unlinked hint_path at ${this.position(entity, game)}`); game.remove(entity); return true;
    }
    this.nodes.set(entity.actor.id, { chain: -1, next: null });
    entity.touch = this.sourceTouch; entity.serverFlags |= 1; entity.visible = false;
    game.move(entity, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }, false);
    game.solid(entity, "trigger"); game.show(entity); return true;
  }

  private position(entity: Q2Entity, game: Q2GameServices): string {
    const origin = game.body(entity).origin; return `${origin.x} ${origin.y} ${origin.z}`;
  }

  /** InitHintPaths runs after all authored entities exist, never once per monster or frame. */
  finalize(game: Q2GameServices): Q2HintPathInitialization {
    this.starts.length = 0; this.nodes.clear();
    const hints = [...game.entities.values()].filter(entity => entity.classname === "hint_path")
      .sort((a, b) => (game.host.actors.sourceOf(a.actor.id)?.slot ?? a.actor.id.slot) - (game.host.actors.sourceOf(b.actor.id)?.slot ?? b.actor.id.slot));
    this.present = hints.length !== 0;
    const issues: string[] = [];
    const report = (message: string): undefined => { issues.push(message); return game.host.diagnostic(message); };
    for (const hint of hints) {
      this.nodes.set(hint.actor.id, { chain: -1, next: null });
      if ((hint.spawnflags & HINT_ENDPOINT) === 0 || hint.target.length === 0) continue;
      if (hint.targetname.length !== 0) {
        report(`Hint path at ${this.position(hint, game)} marked as endpoint with both target (${hint.target}) and targetname (${hint.targetname})`);
      } else if (this.starts.length < MAX_HINT_CHAINS) this.starts.push(hint.actor.id);
    }
    for (const [chain, actor] of this.starts.entries()) {
      const start = game.entity(actor); if (start === null) continue;
      const root: HintNode = { chain, next: null }; this.nodes.set(actor, root);
      let current = start;
      const visited = new Set<ActorId>([actor]);
      while (current.target.length !== 0) {
        const matches = game.targets(current.target), next = matches[0];
        if (matches.length > 1) {
          report(`Forked hint path at ${this.position(current, game)} detected for chain ${this.starts.length}, target ${current.target}`);
          root.next = null; break;
        }
        if (next === undefined) break;
        const previous = this.nodes.get(next.actor.id);
        if (visited.has(next.actor.id) || previous?.next !== null && previous?.next !== undefined) {
          report(`Circular hint path at ${this.position(next, game)} detected for chain ${this.starts.length}, targetname ${next.targetname}`);
          root.next = null; break;
        }
        const currentNode = this.nodes.get(current.actor.id);
        if (currentNode === undefined) throw new Error("Hint chain lost its current node during initialization");
        currentNode.next = next.actor.id; this.nodes.set(next.actor.id, { chain, next: null });
        visited.add(next.actor.id); current = next;
      }
    }
    return { present: this.present, chains: this.starts.length, issues };
  }

  private source(context: MonsterContext): HintMonster {
    let state = this.pursuers.get(context.entity.actor.id);
    if (state === undefined) { state = { goal: null, lastTime: 0 }; this.pursuers.set(context.entity.actor.id, state); }
    return state;
  }

  private chain(game: Q2GameServices, start: ActorId): readonly Q2Entity[] {
    const result: Q2Entity[] = [], visited = new Set<ActorId>();
    let actor: ActorId | null = start;
    while (actor !== null && !visited.has(actor)) {
      const entity = game.entity(actor); if (entity === null) break;
      visited.add(actor); result.push(entity); actor = this.nodes.get(actor)?.next ?? null;
    }
    return result;
  }

  /** Both source helper names have this same body and return the opposite endpoint. */
  findStart(entity: Q2Entity, game: Q2GameServices): Q2Entity | null {
    const forward = entity.target.length !== 0, visited = new Set<ActorId>([entity.actor.id]);
    let current = entity, last: Q2Entity | null = null;
    for (;;) {
      const name = forward ? current.target : current.targetname;
      if (name.length === 0) break;
      const next = forward ? game.targets(name)[0] : [...game.entities.values()].filter(candidate => candidate.target === name)
        .sort((a, b) => (game.host.actors.sourceOf(a.actor.id)?.slot ?? a.actor.id.slot) - (game.host.actors.sourceOf(b.actor.id)?.slot ?? b.actor.id.slot))[0];
      if (next === undefined) break;
      if (visited.has(next.actor.id)) return null;
      visited.add(next.actor.id); last = current = next;
    }
    return last !== null && (last.spawnflags & HINT_ENDPOINT) !== 0 ? last : null;
  }
  otherEnd(entity: Q2Entity, game: Q2GameServices): Q2Entity | null { return this.findStart(entity, game); }

  private visibleFrom(game: Q2GameServices, actor: ActorId, target: Q2Entity): boolean {
    const body = game.host.bodies.read(actor); if (body === null) return false;
    const destination = game.body(target).origin;
    return game.host.trace({ start: { ...body.origin, z: body.origin.z + (game.entity(actor)?.viewHeight ?? 22) },
      end: { ...destination, z: destination.z + target.viewHeight }, bounds: null, ignore: actor, mask: MASK_OPAQUE }).fraction === 1;
  }

  check(context: MonsterContext): boolean {
    const { game, entity, state } = context;
    if (!this.present || entity.enemy === null || state.standGround || entity.classname === "monster_turret" || game.options.edition === "rerelease" && state.pathing !== null) return false;
    const enemyActor = entity.enemy, enemy = game.host.bodies.read(enemyActor); if (enemy === null) return false;
    const origin = game.body(entity).origin, all = this.starts.flatMap(start => this.chain(game, start));
    const monsterNodes = all.filter(node => length(subtract(origin, game.body(node).origin)) <= 512 && visible(context, node.actor.id));
    const represented = new Set(monsterNodes.map(node => this.nodes.get(node.actor.id)?.chain));
    const targetNodes = all.filter(node => represented.has(this.nodes.get(node.actor.id)?.chain) &&
      length(subtract(enemy.origin, game.body(node).origin)) <= 512 && this.visibleFrom(game, enemyActor, node));
    if (targetNodes.length === 0) return false;
    const targetChains = new Set(targetNodes.map(node => this.nodes.get(node.actor.id)?.chain));
    let start: Q2Entity | null = null;
    // Native Rogue and rerelease never update closest_range in either loop. The RR TS
    // donor changes that behavior; retain the native last-eligible source order here.
    for (const node of monsterNodes) if (targetChains.has(this.nodes.get(node.actor.id)?.chain)) start = node;
    if (start === null) return false;
    let destination: Q2Entity | null = null;
    const chain = this.nodes.get(start.actor.id)?.chain;
    for (const node of targetNodes) if (this.nodes.get(node.actor.id)?.chain === chain && length(subtract(origin, game.body(node).origin)) < 10000000) destination = node;
    if (destination === null) return false;
    this.source(context).goal = destination.actor.id; this.go(context, start); return true;
  }

  checkLost(context: MonsterContext): boolean {
    const now = context.game.host.now(), source = this.source(context);
    if (context.state.trailTime + 5 > now || source.lastTime + 10 > now) return false;
    source.lastTime = now; return this.check(context);
  }

  go(context: MonsterContext, point: Q2Entity): undefined {
    const { game, entity, state } = context;
    state.idealYaw = vectorAngles(subtract(game.body(point).origin, game.body(entity).origin)).y;
    entity.goal = state.moveTarget = point.actor.id; state.pauseTime = 0; state.hintPath = true;
    state.soundTarget = null; state.pursuitLastSeen = false; state.pursueNext = false; state.pursueTemporary = false;
    state.searchTime = game.host.now(); return context.run();
  }

  stop(context: MonsterContext): undefined {
    const { game, entity, state } = context, source = this.source(context);
    entity.goal = state.moveTarget = null; source.lastTime = game.host.now(); source.goal = null; state.hintPath = false;
    if (entity.enemy !== null && game.host.actors.isLive(entity.enemy) && health(game, entity.enemy) >= 1) {
      return visible(context) ? this.monsters.foundTarget(context) : this.monsters.huntTarget(context);
    }
    entity.enemy = null; state.pauseTime = game.options.edition === "classic" ? game.host.now() + 100000000 : HOLD_FOREVER;
    return context.stand();
  }

  run(context: MonsterContext, distance: number): boolean {
    if (!context.state.hintPath) return false;
    const { entity, game } = context;
    context.moveToGoal(distance);
    if (!game.host.actors.isLive(entity.actor.id)) return true;
    if (entity.enemy === null || !game.host.actors.isLive(entity.enemy)) { entity.enemy = null; this.stop(context); return true; }
    const target = game.entity(entity.enemy), realEnemy = target?.classname === "player_noise" ? target.owner : entity.enemy;
    if (realEnemy === null) { entity.enemy = null; this.stop(context); return true; }
    if (visible(context, realEnemy)) this.stop(context);
    else if (game.options.mode === "coop") context.findTarget();
    return true;
  }

  touch(hint: Q2Entity, game: Q2GameServices, context: MonsterContext): undefined {
    if (context.state.moveTarget !== hint.actor.id) return undefined;
    const goal = this.source(context).goal;
    if (goal === hint.actor.id) return this.stop(context);
    const node = this.nodes.get(hint.actor.id), start = node === undefined ? undefined : this.starts[node.chain];
    let next: Q2Entity | null = null, goalFound = false;
    if (start !== undefined) for (const entry of this.chain(game, start)) {
      const following = this.nodes.get(entry.actor.id)?.next ?? null;
      if (entry.actor.id === hint.actor.id) { next = game.entity(following); break; }
      if (entry.actor.id === goal) goalFound = true;
      if (following === hint.actor.id && goalFound) { next = entry; break; }
    }
    if (next === null) return this.stop(context);
    this.go(context, next);
    // Resume the existing named monster think, preserving source animation ownership.
    if (hint.wait !== 0 && context.entity.think !== null) game.schedule(context.entity, hint.wait, context.entity.think);
    return undefined;
  }

  capture(game: Q2GameServices): Q2RogueHintsCheckpoint {
    const saved = (actor: ActorId): SavedActorId => ({ slot: actor.slot, generation: actor.generation });
    return { version: 1, present: this.present, starts: this.starts.map(saved),
      nodes: [...this.nodes].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, node]) => ({ actor: saved(actor), chain: node.chain, next: saveQ2Actor(node.next) })),
      monsters: [...this.pursuers].filter(([actor]) => game.host.actors.isLive(actor)).map(([actor, state]) => ({ actor: saved(actor), goal: saveQ2Actor(state.goal), lastTime: state.lastTime })) };
  }

  restore(game: Q2GameServices, checkpoint: Q2RogueHintsCheckpoint): undefined {
    this.present = checkpoint.present; this.starts.length = 0; this.nodes.clear(); this.pursuers.clear();
    const reference = (actor: SavedActorId): ActorId => game.host.actors.resolveSaved(actor)?.id ?? game.host.actors.referenceSaved(actor);
    for (const start of checkpoint.starts) this.starts.push(reference(start));
    for (const node of checkpoint.nodes) this.nodes.set(reference(node.actor), { chain: node.chain, next: node.next === null ? null : reference(node.next) });
    for (const monster of checkpoint.monsters) this.pursuers.set(reference(monster.actor), { goal: monster.goal === null ? null : reference(monster.goal), lastTime: monster.lastTime });
    return undefined;
  }
}
