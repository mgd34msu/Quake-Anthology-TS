/* Base Quake campaign and boss behavior. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import { doorDown } from "../foundation/movers.ts";
import { ZERO, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import { BaseMonster } from "./monsters.ts";
import type { MonsterServices } from "./monsters.ts";
import { baseSpecies } from "./species.ts";
import { remainingMapClassnames, spawnRemainingMapActor, registerMapCallbacks } from "./map-entities.ts";
import { throwGib } from "./projectiles.ts";
import { Q1LevelRules, Q1SpawnSelector } from "./rules.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../persistence/value.ts";
import { Q1Creatures } from "./creatures.ts";
import { q1FinaleText } from "./finales.ts";
import { registerCharacterCallbacks } from "./player.ts";

const providers = new WeakMap<Q1EntityServices, Q1Base>();
export function q1Base(game: Q1EntityServices): Q1Base { const base = providers.get(game); if (base === undefined) throw new Error("Q1 base content was not registered"); return base; }

export interface Q1CampaignBinding {
  readFlags(): number;
  writeFlags(flags: number): undefined;
  setSkill(skill: 0 | 1 | 2 | 3): undefined;
}
export class Q1CampaignState implements Q1CampaignBinding {
  constructor(public flags = 0, public skill: 0 | 1 | 2 | 3 = 1) {}
  readFlags(): number { return this.flags; }
  writeFlags(flags: number): undefined { this.flags = flags; return undefined; }
  setSkill(skill: 0 | 1 | 2 | 3): undefined { this.skill = skill; return undefined; }
}
export interface Q1BaseOptions {
  readonly campaign?: Q1CampaignBinding;
  readonly registered?: boolean;
  readonly finaleFinished?: () => boolean;
  readonly finishCampaign?: () => undefined;
  readonly sameLevel?: () => boolean;
  readonly playerExited?: (actor: ActorId) => undefined;
  readonly officialCampaign?: boolean;
}
export const Q1_BASE_CLASSNAMES: readonly string[] = [...baseSpecies.flatMap(spec => spec.classnames), ...remainingMapClassnames];

/** Registers base content on the permanent Q1 provider; it has no independent game frame loop. */
export class Q1Base implements MonsterServices {
  readonly creatures: Q1Creatures;
  get monsters() { return this.creatures.monsters; }
  get backpacks() { return this.creatures.backpacks; }
  get projectileTargets() { return this.creatures.projectileTargets; }
  get wizardShots() { return this.creatures.wizardShots; }
  readonly campaign: Q1CampaignBinding;
  readonly registered: boolean;
  readonly levelRules: Q1LevelRules;
  readonly spawnSelector: Q1SpawnSelector;
  private readonly killCountRules = new Map<string, (monster: BaseMonster) => boolean>();
  private lightningEnd = -1;
  private electrodes: readonly [Q1Actor, Q1Actor] | null = null;
  private finaleStarted = false;
  private finaleDismissed = false;
  constructor(readonly game: Q1EntityServices, readonly options: Q1BaseOptions = {}) {
    this.campaign = options.campaign ?? new Q1CampaignState(0, game.options.skill); this.registered = options.registered ?? true;
    providers.set(game, this);
    this.levelRules = new Q1LevelRules(game, this.campaign, this.registered, options.officialCampaign ?? game.options.campaign.endsWith(":id1")); this.spawnSelector = new Q1SpawnSelector(game, this.campaign);
    game.registerPlayerExtension({ id: "q1:base-level-stats", attach: (_game, player) => this.levelRules.resetPlayer(player.actor) });
    this.creatures = new Q1Creatures(game, this);
    const monster = (entity: Q1Actor): BaseMonster => { const value = this.monsters.get(entity.actor); if (value === undefined) throw new Error(`Missing Q1 monster controller for ${entity.classname}`); return value; };
    registerMapCallbacks(game);
    registerCharacterCallbacks(game);
    game.named.register("base:lightning_use", { use: (_game, entity, _other, activator) => this.useLightning(entity, activator) });
    game.named.register("base:lightning_fire", { action: (_game, entity) => this.fireLightning(entity) });
    game.named.register("base:finale_2", { action: (_game, timer) => {
      const owner = timer.owner === null ? null : game.entity(timer.owner); if (owner === null) throw new Error("Finale timer lost Shub");
      const shub = monster(owner); game.effect("teleport", vsub(shub.origin, { x: 0, y: 100, z: 0 })); game.sound(owner, "misc/r_tele1.wav"); game.host.emit({ kind: "finale", text: "", stage: 2 });
      return game.schedule(timer, 2, game.named.action(timer, "base:finale_3"));
    } });
    game.named.register("base:finale_3", { action: (_game, timer) => {
      const owner = timer.owner === null ? null : game.entity(timer.owner); if (owner === null) throw new Error("Finale timer lost Shub");
      const shub = monster(owner); game.sound(owner, "boss2/death.wav"); game.host.emit({ kind: "lightstyle", style: 0, pattern: "abcdefghijklmlkjihgfedcb" });
      game.host.emit({ kind: "finale", text: "", stage: 3 }); shub.nextFrame = "old_thrash1"; shub.delay(0.1); return game.remove(timer);
    } });
    game.named.register("base:finale_wait", { action: (_game, timer) => {
      if (!this.hasFinishedFinale) return game.schedule(timer, 0.1, game.named.action(timer, "base:finale_wait"));
      game.host.emit({ kind: "finale", text: "", stage: 5 }); return game.schedule(timer, 5, game.named.action(timer, "base:finale_6"));
    } });
    game.named.register("base:finale_6", { action: (_game, timer) => { game.host.emit({ kind: "finale", text: "", stage: 6 }); if (game.options.coop) game.travel("start", null); else this.options.finishCampaign?.(); return game.remove(timer); } });
    game.registerStateExtension({ id: "q1:base", capture: () => this.capture(), restore: bytes => this.restore(bytes), clone: (source, target) => this.clone(source, target) });
    this.creatures.registerSpecies(baseSpecies);
    for (const classname of remainingMapClassnames) game.registerSpawn(classname, (_game, entity) => spawnRemainingMapActor(this, entity));
  }
  registerKillCountRule(id: string, rule: (monster: BaseMonster) => boolean): undefined {
    if (this.killCountRules.has(id)) throw new Error(`Duplicate Q1 kill-count rule ${id}`);
    this.killCountRules.set(id, rule); return undefined;
  }
  countMonsterKill(monster: BaseMonster): boolean { for (const rule of this.killCountRules.values()) if (!rule(monster)) return false; return true; }
  private clone(source: Q1Actor, target: Q1Actor): undefined { return this.creatures.clone(source, target); }
  private capture(): Uint8Array {
    const saved = (actor: ActorId) => ({ slot: actor.slot, generation: actor.generation });
    return encodeCheckpointValue({ version: 1, flags: this.campaign.readFlags(), lightningEnd: this.lightningEnd, finaleStarted: this.finaleStarted, finaleDismissed: this.finaleDismissed,
      spawn: this.spawnSelector.capture(), rules: this.levelRules.capture(),
      electrodes: this.electrodes === null ? null : this.electrodes.map(entity => saved(entity.actor.id)),
      ...this.creatures.captureFields(),
    });
  }
  private restore(bytes: Uint8Array): undefined {
    const root = new SaveReader(decodeCheckpointValue(bytes), "q1:base"); root.field("version").literal(1);
    const actor = (reader: SaveReader): OwnedActor => { const value = this.game.host.actors.resolveSaved({ slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }); if (value === null) return reader.fail("missing saved actor"); return value; };
    this.campaign.writeFlags(root.field("flags").number()); this.lightningEnd = root.field("lightningEnd").number();
    this.finaleStarted = root.field("finaleStarted").boolean(); this.finaleDismissed = root.field("finaleDismissed").boolean();
    this.spawnSelector.restore(root.field("spawn")); this.levelRules.restore(root.field("rules"));
    this.electrodes = root.field("electrodes").nullable(reader => {
      const entries = reader.list(value => this.game.entity(actor(value).id)), first = entries[0], second = entries[1];
      if (entries.length !== 2 || first === undefined || first === null || second === undefined || second === null) return reader.fail("missing lightning electrodes"); return [first, second];
    });
    this.creatures.restoreFields(root);
    return undefined;
  }
  nextHellKnightMelee(): string { return this.creatures.nextHellKnightMelee(); }
  spawnLightning(entity: Q1Actor): undefined {
    entity.use = this.game.named.use(entity, "base:lightning_use"); return undefined;
  }
  private useLightning(entity: Q1Actor, activator: ActorId | null): undefined {
      const { game } = this;
      if (this.lightningEnd >= game.time + 1) return undefined;
      const electrodes = [...game.entities.values()].filter(actor => actor.target === "lightning"); const first = electrodes[0], second = electrodes[1];
      if (first === undefined || second === undefined) throw new Error("event_lightning is missing its two lightning electrodes");
      if (first.state !== second.state || first.state !== "top" && first.state !== "bottom") return undefined;
      game.cancel(first); game.cancel(second); this.electrodes = [first, second]; this.lightningEnd = game.time + 1; game.sound(entity, "misc/power.wav");
      this.fireLightning(entity); const boss = [...this.monsters.values()].find(monster => monster.spec.species === "boss");
      if (boss === undefined) return undefined; boss.enemy = activator;
      if (first.state === "top" && game.health(boss.entity.actor.id) > 0) {
        game.sound(boss.entity, "boss1/pain.wav"); const health = game.health(boss.entity.actor.id) - 1; game.host.combat.setHealth(boss.entity.actor, health);
        return boss.play(health >= 2 ? "boss_shocka1" : health === 1 ? "boss_shockb1" : "boss_shockc1");
      }
      return undefined;
  }
  private fireLightning(entity: Q1Actor): undefined {
    const { game } = this, electrodes = this.electrodes; if (electrodes === null) throw new Error("Lightning has no electrodes");
    const [first, second] = electrodes;
    if (game.time >= this.lightningEnd) { doorDown(game, first); return doorDown(game, second); }
    const a = game.body(first), b = game.body(second);
    const p1 = { ...vscale(vadd(a.bounds.min, a.bounds.max), 0.5), z: a.origin.z + a.bounds.min.z - 16 };
    let p2 = { ...vscale(vadd(b.bounds.min, b.bounds.max), 0.5), z: b.origin.z + b.bounds.min.z - 16 };
    p2 = vsub(p2, vscale(normalize(vsub(p2, p1)), 100));
    game.host.emit({ kind: "beam", style: "lightning3", actor: game.world?.actor.id ?? entity.actor.id, start: p1, end: p2 }); return game.schedule(entity, 0.1, game.named.action(entity, "base:lightning_fire"));
  }
  finale(monster: BaseMonster): undefined {
    if (this.finaleStarted) return undefined; this.finaleStarted = true; const { game } = this;
    monster.countKill(); game.cancel(monster.entity);
    const position = [...game.entities.values()].find(entity => entity.classname === "info_intermission");
    const train = [...game.entities.values()].find(entity => entity.classname === "misc_teleporttrain");
    if (position === undefined || train === undefined) throw new Error("Q1 finale requires info_intermission and misc_teleporttrain");
    game.remove(train); game.intermission = { map: "start", cause: monster.enemy, exitAfter: game.time + 10000000 };
    for (const playerId of game.host.players()) {
      const player = game.host.actors.resolveOwned(playerId), body = game.host.bodies.read(playerId); if (player === null || body === null) continue;
      game.host.bodies.write(player, { ...body, origin: game.body(position).origin, angles: position.vector("mangle"), velocity: ZERO }); game.host.bodies.link(player);
      game.host.combat.setTraits(player, { canTakeDamage: false });
    }
    game.host.emit({ kind: "intermission", origin: game.body(position).origin, angles: position.vector("mangle"), map: "start", exitAfter: game.time + 10000000, track: 0 });
    game.host.emit({ kind: "finale", text: "", stage: 1 });
    if (game.options.edition === "rerelease" && game.mapName === "end") {
      game.host.emit({ kind: "achievement", player: null, id: "ACH_DEFEAT_SHUB" });
      if (game.options.skill === 3) game.host.emit({ kind: "achievement", player: null, id: "ACH_DEFEAT_SHUB_NIGHTMARE" });
    }
    const timer = game.create("finale_timer"); timer.owner = monster.entity.actor.id;
    return game.schedule(timer, 1, game.named.action(timer, "base:finale_2"));
  }
  finishFinale(monster: BaseMonster): undefined {
    const { game } = this; const origin = monster.origin; game.sound(monster.entity, "boss2/pop2.wav");
    for (let z = 16; z <= 144; z += 96) for (let x = -64; x <= 64; x += 32) for (let y = -64; y <= 64; y += 32) {
      const r = game.host.random(); throwGib(game, vadd(origin, { x, y, z }), r < 0.3 ? "gib1" : r < 0.6 ? "gib2" : "gib3", -999);
    }
    game.host.emit({ kind: "finale", text: q1FinaleText(game.options.edition, "$qc_finale_end"), stage: 4 });
    const victory = game.create("finale_player"); victory.model = "progs/player.mdl"; victory.frame = 1;
    game.setBody(victory, { origin: vsub(origin, { x: 32, y: 264, z: 0 }), angles: { x: 0, y: 290, z: 0 } }); game.link(victory); game.remove(monster.entity);
    game.host.emit({ kind: "lightstyle", style: 0, pattern: "m" });
    if (game.options.edition === "classic") return undefined;
    const timer = game.create("finale_wait"); return game.schedule(timer, 1, game.named.action(timer, "base:finale_wait"));
  }
  dismissFinale(): undefined { this.finaleDismissed = true; return undefined; }
  get hasFinishedFinale(): boolean { return this.options.finaleFinished?.() ?? this.finaleDismissed; }
}
export function registerQ1Base(game: Q1EntityServices, options: Q1BaseOptions = {}): Q1Base { return new Q1Base(game, options); }
