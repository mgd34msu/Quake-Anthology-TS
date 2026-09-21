/* Original Rogue dm_ball.c. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Pain, Q2SpawnModule, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, dot, length, movedir, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import { monsterSolidMask } from "../../foundation/monsters/ai.ts";

export interface Q2DeathBallHooks {
  settings(): { readonly team1Skin: string; readonly team2Skin: string; readonly goalLimit: number };
  skin(actor: ActorId): string;
  setSkin(actor: ActorId, skin: string): undefined;
  addScore(actor: ActorId, amount: number): undefined;
  endLevel(): undefined;
  selectSpawn(entity: Q2Entity, game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 };
  spawnDistance(spot: Q2Entity, game: Q2GameServices): number;
}
export interface Q2DeathBallCheckpoint { readonly ball: SavedActorId | null; readonly starts: number; readonly team1Score: number; readonly team2Score: number; }
export function q2DeathBallRules(deathmatchFlags: number) { return { stopSpeed: 0, deathmatchFlags: deathmatchFlags | 0x20000 | 0x80000 | 0x40000 | 256 | 64 }; }

export class Q2DeathBall implements Q2SpawnModule {
  private ball: ActorId | null = null;
  private starts = 0;
  private team1Score = 0;
  private team2Score = 0;
  constructor(readonly hooks: Q2DeathBallHooks) {}
  get callbacks(): Q2CallbackDefinitions {
    return { think: { DBall_BallRespawn: this.respawn }, touch: { DBall_BallTouch: this.ballTouch, DBall_GoalTouch: this.goalTouch, DBall_SpeedTouch: this.speedTouch },
      pain: { DBall_BallPain: this.pain }, die: { DBall_BallDie: this.die } };
  }
  capture(): Q2DeathBallCheckpoint {
    return { ball: this.ball === null ? null : { slot: this.ball.slot, generation: this.ball.generation }, starts: this.starts, team1Score: this.team1Score, team2Score: this.team2Score };
  }
  restore(game: Q2GameServices, saved: Q2DeathBallCheckpoint): undefined {
    this.ball = saved.ball === null ? null : game.host.actors.resolveSaved(saved.ball)?.id ?? game.host.actors.referenceSaved(saved.ball);
    this.starts = saved.starts; this.team1Score = saved.team1Score; this.team2Score = saved.team2Score; return undefined;
  }
  ballActor(): ActorId | null { return this.ball; }
  scores(): readonly [number, number] { return [this.team1Score, this.team2Score]; }
  checkRules(game: Q2GameServices): boolean {
    const limit = this.hooks.settings().goalLimit;
    if (limit === 0) return false;
    const winner = this.team1Score >= limit ? 1 : this.team2Score >= limit ? 2 : null;
    if (winner === null) return false;
    game.host.emit({ kind: "print", actor: null, level: "high", text: `Team ${winner} Wins.\n` }); this.hooks.endLevel(); return true;
  }

  clientBegin(entity: Q2Entity, game: Q2GameServices): undefined {
    const settings = this.hooks.settings(); let one = 0, two = 0, unassigned = 0;
    for (const actor of game.host.players()) {
      if (actor === entity.actor.id) continue;
      const skin = this.hooks.skin(actor);
      if (skin.includes("/") && skin === settings.team1Skin) one++;
      else if (skin.includes("/") && skin === settings.team2Skin) two++;
      else unassigned++;
    }
    this.hooks.setSkin(entity.actor.id, one > two ? settings.team2Skin : settings.team1Skin);
    if (unassigned !== 0) game.host.diagnostic(`${unassigned} unassigned players present!`);
    return undefined;
  }
  selectSpawn(entity: Q2Entity, game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 } {
    const skin = this.hooks.skin(entity.actor.id), settings = this.hooks.settings();
    const classname = skin === settings.team1Skin ? "dm_dball_team1_start" : skin === settings.team2Skin ? "dm_dball_team2_start" : "info_player_deathmatch";
    let best: Q2Entity | null = null, distance = 0;
    for (const spot of game.entities.values()) if (spot.classname === classname) {
      const candidate = this.hooks.spawnDistance(spot, game);
      if (candidate > distance) { best = spot; distance = candidate; }
    }
    if (best === null) return this.hooks.selectSpawn(entity, game);
    const body = game.body(best); return { origin: add(body.origin, { x: 0, y: 0, z: 9 }), angles: body.angles };
  }
  postSpawn(game: Q2GameServices): undefined {
    this.starts = 0;
    for (const entity of game.entities.values()) {
      if (entity.classname === "misc_teleporter_dest") game.solid(entity, "none");
      else if (entity.classname === "dm_dball_ball_start") this.starts++;
    }
    if (this.starts === 0) game.host.diagnostic("No Deathball start points!");
    return undefined;
  }
  changeDamage(target: ActorId, attacker: ActorId | null, damage: number): number { return target === this.ball ? 1 : attacker !== this.ball ? Math.trunc(damage / 2) : damage; }
  changeKnockback(target: ActorId, knockback: number, meansOfDeath: number, game: Q2GameServices): number {
    if (target !== this.ball) return knockback;
    if (knockback < 1) {
      if (meansOfDeath === 8) return 70;
      if (meansOfDeath === 14) return 90;
      game.host.diagnostic(`zero knockback, mod ${meansOfDeath}`); return knockback;
    }
    switch (meansOfDeath) {
      case 1: return knockback * 3;
      case 2: return Math.trunc(knockback * 3 / 8);
      case 3: return Math.trunc(knockback / 3);
      case 4: case 9: return Math.trunc(knockback * 3 / 2);
      case 10: return knockback * 4;
      case 6: case 15: case 46: case 7: case 16: case 24: case 51: case 41: return Math.trunc(knockback / 2);
      case 11: case 44: return Math.trunc(knockback / 3);
      default: return knockback;
    }
  }

  private readonly goalTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other !== this.ball) return undefined;
    const ball = game.entity(this.ball);
    if (ball === null) return undefined;
    const team = (entity.spawnflags & 1) !== 0 ? 1 : 2, settings = this.hooks.settings();
    if (team === 1) this.team1Score = Math.trunc(this.team1Score + entity.wait); else this.team2Score = Math.trunc(this.team2Score + entity.wait);
    for (const actor of game.host.players()) {
      const skin = this.hooks.skin(actor), score = Math.trunc(entity.wait + (actor === ball.enemy ? 5 : 0));
      if (!skin.includes("/")) continue;
      const playerTeam = skin === settings.team1Skin ? 1 : skin === settings.team2Skin ? 2 : null;
      if (playerTeam === null) game.host.diagnostic("unassigned player!!!!");
      else if (playerTeam === team) this.hooks.addScore(actor, score);
      else if (actor === ball.enemy) this.hooks.addScore(actor, -score);
    }
    this.resetBall(ball, game);
    return game.useTargets(entity, ball.actor.id);
  };
  private readonly ballTouch: Q2Touch = (entity, game, contact) => {
    if (!game.host.isPlayer(contact.other) || game.host.combat.read(contact.other)?.canTakeDamage !== true) return undefined;
    const body = game.body(entity), other = game.host.bodies.read(contact.other), speed = length(body.velocity);
    if (other !== null && speed !== 0 && dot(subtract(body.origin, other.origin), body.velocity) > 0.7)
      game.damage(contact.other, entity, entity.actor.id, Math.trunc(speed / 10), Math.trunc(speed / 10), zero, body.origin, zero, 52);
    return undefined;
  };
  private readonly pain: Q2Pain = (entity, game, reaction) => { entity.enemy = reaction.attacker; return game.host.combat.setHealth(entity.actor, entity.maxHealth); };
  private goalEffect(entity: Q2Entity, game: Q2GameServices): undefined {
    return game.host.emit({ kind: "effect", effect: "q2:dball_goal", origin: game.body(entity).origin, direction: zero, count: 0, color: 0 });
  }
  private readonly die: Q2Die = (entity, game) => this.resetBall(entity, game);
  private resetBall(entity: Q2Entity, game: Q2GameServices): undefined {
    this.goalEffect(entity, game); entity.angularVelocity = zero;
    game.move(entity, { angles: zero, velocity: zero }); game.motion(entity, entity.motion); game.solid(entity, "none");
    return game.schedule(entity, 2, this.respawn);
  };
  private readonly respawn: Q2Think = (entity, game) => {
    this.goalEffect(entity, game);
    const starts = [...game.entities.values()].filter(candidate => candidate.classname === "dm_dball_ball_start"), which = Math.ceil(game.host.random() * this.starts);
    const spot = starts[which - 1] ?? starts[0];
    if (spot === undefined) game.host.diagnostic("No ball start points found!");
    entity.angularVelocity = zero; entity.model = "models/objects/dball/tris.md2";
    game.move(entity, { origin: spot === undefined ? game.body(entity).origin : game.body(spot).origin, angles: zero, velocity: zero, ground: null });
    game.solid(entity, "box"); game.motion(entity, entity.motion); game.show(entity);
    game.host.emit({ kind: "entity-event", actor: entity.actor.id, event: 6 }); killQ2Box(entity, game); return game.link(entity);
  };
  private readonly speedTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other !== this.ball || entity.timestamp >= game.host.now()) return undefined;
    const ball = game.entity(this.ball);
    if (ball === null) return undefined;
    const velocity = game.body(ball).velocity;
    if (length(velocity) < 1 || (entity.spawnflags & 1) !== 0 && dot(normalize(velocity), entity.movedir) < 0.8) return undefined;
    entity.timestamp = game.host.now() + entity.delay; game.move(ball, { velocity: scale(velocity, entity.speed) }); return game.motion(ball, ball.motion);
  };

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (!["dm_dball_ball", "dm_dball_goal", "dm_dball_speed_change", "dm_dball_ball_start", "dm_dball_team1_start", "dm_dball_team2_start"].includes(entity.classname)) return false;
    if (game.options.mode !== "deathmatch") { game.remove(entity); return true; }
    game.sourceCallbacks.register(this.callbacks);
    if (entity.classname === "dm_dball_ball") {
      this.ball = entity.actor.id; entity.model = "models/objects/dball/tris.md2"; entity.maxHealth = 50000; entity.clipMask = monsterSolidMask(game);
      entity.pain = this.pain; entity.die = this.die; entity.touch = this.ballTouch;
      game.host.combat.create(entity.actor, { health: 50000, mass: 50, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, canTakeDamage: true, invulnerable: false, team: null });
      game.move(entity, { bounds: { min: { x: -32, y: -32, z: -32 }, max: { x: 32, y: 32, z: 32 } } });
      game.solid(entity, "box"); game.motion(entity, "new-toss"); game.show(entity);
    } else if (entity.classname === "dm_dball_goal" || entity.classname === "dm_dball_speed_change") {
      const speed = entity.classname === "dm_dball_speed_change";
      entity.touch = speed ? this.speedTouch : this.goalTouch; entity.visible = false;
      if (speed) { entity.speed ||= 2; entity.delay ||= 0.2; } else entity.wait ||= 10;
      entity.movedir = movedir(game.body(entity).angles); game.move(entity, { angles: zero });
      game.solid(entity, "trigger"); game.motion(entity, "stationary"); game.show(entity);
    }
    return true;
  }
}
