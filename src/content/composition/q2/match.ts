import type { ActorId } from "../../../contracts/identity.ts";
import { setInfoValue } from "../../../core/cvars/info.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../q2/foundation/host.ts";
import type { Q2ItemModule } from "../../q2/foundation/items.ts";
import type { Q2Players } from "../../q2/base/player/index.ts";
import { Q2PlayerState } from "../../q2/base/player/types.ts";
import { q2EntitiesNamed, q2PlayersRange, q2SpawnOrigin, selectQ2Spawn } from "../../q2/base/player/spawns.ts";
import { Q2Tag, Q2DeathBall } from "../../q2/missionpacks/modes/index.ts";
import { Q2Ctf } from "../../q2/multiplayer/ctf/index.ts";
import { Q2Lmctf } from "../../q2/multiplayer/lmctf/runtime.ts";
import type { Q2CtfHooks } from "../../q2/multiplayer/ctf/types.ts";
import type { Q2DamageSourceEffects } from "../../../world/gameplay/policies.ts";
import type { Q2CompositionServices } from "./types.ts";
import type { Q2MatchSelection } from "./types.ts";

export class Q2ProductMatch implements Q2SpawnModule {
  readonly source: Q2Tag | Q2DeathBall | Q2Ctf | Q2Lmctf | null;
  constructor(readonly selection: Q2MatchSelection, private readonly players: () => Q2Players, items: Q2ItemModule, world: () => Q2GameServices, hooks: Omit<Q2CtfHooks, "emit">, services: Q2CompositionServices) {
    const addScore = (actor: ActorId, amount: number): undefined => {
      const state = players().states.get(actor);
      if (state === undefined) throw new Error("Q2 match score requires an admitted player");
      state.score += amount; return undefined;
    };
    const selectSpawn = (entity: Q2Entity, game: Q2GameServices) => {
      const spot = selectQ2Spawn(game, players().states.get(entity.actor.id) ?? new Q2PlayerState(0, game.host.now()), players().rules.spawnPoint);
      return { origin: q2SpawnOrigin(spot, game), angles: game.body(spot).angles };
    };
    this.source = selection.kind === "ctf" ? new Q2Ctf({ ...hooks, emit: event => services.emit({ kind: "ctf", event }) }, {}, services.sharedGrapple ?? null) : selection.kind === "lmctf" ? new Q2Lmctf({ ...hooks, emit: event => services.emit({ kind: "lmctf", event }) }, selection.travel?.rules, selection.travel, services.sharedGrapple ?? null) : selection.kind === "standard" ? null : selection.kind === "tag" ? new Q2Tag({ items, addScore, selectSpawn,
      farthestSpawn: game => {
        let selected: Q2Entity | null = null, distance = -1;
        for (const spot of q2EntitiesNamed(game, "info_player_deathmatch")) {
          const current = q2PlayersRange(game, spot);
          if (current > distance) { selected = spot; distance = current; }
        }
        return selected;
      } }) : new Q2DeathBall({ settings: () => selection, addScore, selectSpawn,
      skin: actor => players().states.get(actor)?.skin ?? "",
      setSkin: (actor, skin) => {
        const player = players(), game = world(), state = player.states.get(actor), entity = game.entity(actor);
        if (state === undefined || entity === null) throw new Error("Q2 DeathBall skin requires an admitted source player");
        const info = setInfoValue(state.userinfo, "skin", skin, { dialect: "q2-classic", maximumLength: game.options.edition === "rerelease" ? 2048 : 512,
          target: "client-userinfo", serverHighCharacters: false, print: text => game.host.diagnostic(text) });
        return player.userinfoChanged(entity, game, info);
      },
      endLevel: () => players().endDeathmatchLevel(world()),
      spawnDistance: (spot, game) => q2PlayersRange(game, spot),
    });
  }
  get callbacks() { return this.source?.callbacks ?? {}; }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname === "dm_tag_token" && !(this.source instanceof Q2Tag) || entity.classname.startsWith("dm_dball_") && !(this.source instanceof Q2DeathBall)) {
      game.remove(entity); return true;
    }
    return this.source?.spawn(entity, game) ?? false;
  }
  afterSpawn(game: Q2GameServices): undefined { return this.source instanceof Q2Ctf ? this.source.afterSpawn(game) : this.source?.postSpawn(game); }
  admitted(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Ctf || this.source instanceof Q2Lmctf ? this.source.admitted(entity, game) : this.source instanceof Q2DeathBall ? this.source.clientBegin(entity, game) : undefined; }
  selectSpawn(entity: Q2Entity, game: Q2GameServices) { return this.source !== null && !(this.source instanceof Q2Tag) ? this.source.selectSpawn(entity, game) : null; }
  score(victim: Q2Entity, game: Q2GameServices, change: number, means: number, recipient: Q2Entity, attacker: Q2Entity | null = recipient): undefined {
    if (this.source instanceof Q2Ctf || this.source instanceof Q2Lmctf) return this.source.score(victim, attacker, game, change, means, recipient);
    if (this.source instanceof Q2Tag) return this.source.score(recipient, victim, game, change, means);
    const state = this.players().states.get(recipient.actor.id);
    if (state === undefined) throw new Error("Q2 match score has no admitted source recipient");
    state.score += change; return undefined;
  }
  death(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Ctf ? this.source.death(entity, game) : this.source instanceof Q2Lmctf || this.source instanceof Q2Tag ? this.source.playerDeath(entity, game) : undefined; }
  disconnect(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Tag || this.source instanceof Q2Ctf || this.source instanceof Q2Lmctf ? this.source.disconnect(entity, game) : undefined; }
  damage(target: ActorId, attacker: ActorId | null, amount: number): number { return this.source instanceof Q2Tag || this.source instanceof Q2DeathBall ? this.source.changeDamage(target, attacker, amount) : amount; }
  knockback(target: ActorId, amount: number, means: number, game: Q2GameServices): number { return this.source instanceof Q2DeathBall ? this.source.changeKnockback(target, amount, means, game) : amount; }
  checkRules(game: Q2GameServices): boolean { return (this.source instanceof Q2DeathBall || this.source instanceof Q2Ctf) && this.source.checkRules(game); }
  dropInventory(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Ctf || this.source instanceof Q2Lmctf ? this.source.dropInventory(entity, game) : undefined; }
  command(entity: Q2Entity, game: Q2GameServices, name: string, args: readonly string[]): boolean { return this.source instanceof Q2Ctf || this.source instanceof Q2Lmctf ? this.source.command(entity, game, name, args) : false; }
  beforePlayer(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Ctf ? this.source.beforePlayer(entity, game) : undefined; }
  playerSpawned(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.source instanceof Q2Lmctf) return this.source.playerSpawned(entity, game);
    if (this.source instanceof Q2Ctf) {
      const state = this.source.states.get(entity.actor.id);
      if (state === undefined) return undefined;
      game.host.combat.setTraits(entity.actor, { team: state.team === 0 ? null : state.team === 1 ? "RED" : "BLUE" });
      if (this.source.grapple.nativeEnabled && state.team !== 0 && this.players().states.get(entity.actor.id)?.useQ2Weapons === true) game.host.inventory.configure(entity.actor, { item: "q2:weapon_grapple", count: 1, capacity: 1 });
      this.source.assignSkin(entity);
    }
    return undefined;
  }
  gravityScale(actor: ActorId): number { return this.source instanceof Q2Lmctf ? this.source.gravityScale(actor) : 1; }
  sourceEffects(game: Q2GameServices): Q2DamageSourceEffects {
    const source = this.source;
    const armorAllowed: NonNullable<Q2DamageSourceEffects["armorAllowed"]> = (request, target, attacker) =>
      (source instanceof Q2Lmctf ? (source.rules.ctfFlags & 1024) === 0 : (game.options.deathmatchFlags & 262144) === 0) || request.attack.attacker === null || request.attack.attacker.equals(request.target) || target.team === null || target.team !== attacker?.team;
    if (source instanceof Q2Ctf) return {
      beforeMomentum: (request, damage) => source.techs.strength(request.attack.attacker, game, damage),
      afterArmor: (request, take) => source.techs.resistance(request.target, game, take),
      powerArmorAllowed: armorAllowed, armorAllowed,
      afterHealth: decision => source.flags.hurtCarrier(decision.request.target, decision.request.attack.attacker, game),
    };
    if (source instanceof Q2Lmctf) return {
      beforeMomentum: (request, damage) => source.runes.damage(request.attack.attacker, damage, game),
      afterPowerArmor: (request, take) => source.runes.afterPowerArmor(request.target, take, game),
      armorAllowed,
      afterHealth: decision => source.runes.afterHealth(decision.request.target, decision.request.attack.attacker, decision.appliedDamage, game),
    };
    return {};
  }
  effects(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.source instanceof Q2Ctf) this.source.afterPlayer(entity, game);
    if (this.source instanceof Q2Lmctf) this.source.playerFrame(entity, game);
    if (this.source instanceof Q2Tag) { entity.effects = entity.effects & ~0x20000000 | this.source.effects(entity.actor.id); game.show(entity); }
    return undefined;
  }
}
