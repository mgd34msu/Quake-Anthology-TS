import type { ActorId } from "../../../contracts/identity.ts";
import { setInfoValue } from "../../../core/cvars/info.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../q2/foundation/host.ts";
import type { Q2ItemModule } from "../../q2/foundation/items.ts";
import type { Q2Players } from "../../q2/base/player/index.ts";
import { Q2PlayerState } from "../../q2/base/player/types.ts";
import { q2EntitiesNamed, q2PlayersRange, q2SpawnOrigin, selectQ2Spawn } from "../../q2/base/player/spawns.ts";
import { Q2Tag, Q2DeathBall } from "../../q2/missionpacks/modes/index.ts";
import type { Q2MatchSelection } from "./types.ts";

export class Q2ProductMatch implements Q2SpawnModule {
  readonly source: Q2Tag | Q2DeathBall | null;
  constructor(readonly selection: Q2MatchSelection, private readonly players: () => Q2Players, items: Q2ItemModule, world: () => Q2GameServices) {
    const addScore = (actor: ActorId, amount: number): undefined => {
      const state = players().states.get(actor);
      if (state === undefined) throw new Error("Q2 match score requires an admitted player");
      state.score += amount; return undefined;
    };
    const selectSpawn = (entity: Q2Entity, game: Q2GameServices) => {
      const spot = selectQ2Spawn(game, players().states.get(entity.actor.id) ?? new Q2PlayerState(0, game.host.now()), players().rules.spawnPoint);
      return { origin: q2SpawnOrigin(spot, game), angles: game.body(spot).angles };
    };
    this.source = selection.kind === "standard" ? null : selection.kind === "tag" ? new Q2Tag({ items, addScore, selectSpawn,
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
  afterSpawn(game: Q2GameServices): undefined { return this.source?.postSpawn(game); }
  admitted(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2DeathBall ? this.source.clientBegin(entity, game) : undefined; }
  selectSpawn(entity: Q2Entity, game: Q2GameServices) { return this.source instanceof Q2DeathBall ? this.source.selectSpawn(entity, game) : null; }
  score(victim: Q2Entity, game: Q2GameServices, change: number, means: number, recipient: Q2Entity): undefined {
    if (this.source instanceof Q2Tag) return this.source.score(recipient, victim, game, change, means);
    const state = this.players().states.get(recipient.actor.id);
    if (state === undefined) throw new Error("Q2 match score has no admitted source recipient");
    state.score += change; return undefined;
  }
  death(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Tag ? this.source.playerDeath(entity, game) : undefined; }
  disconnect(entity: Q2Entity, game: Q2GameServices): undefined { return this.source instanceof Q2Tag ? this.source.disconnect(entity, game) : undefined; }
  damage(target: ActorId, attacker: ActorId | null, amount: number): number { return this.source?.changeDamage(target, attacker, amount) ?? amount; }
  knockback(target: ActorId, amount: number, means: number, game: Q2GameServices): number { return this.source instanceof Q2DeathBall ? this.source.changeKnockback(target, amount, means, game) : amount; }
  checkRules(game: Q2GameServices): boolean { return this.source instanceof Q2DeathBall && this.source.checkRules(game); }
  effects(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.source instanceof Q2Tag) { entity.effects = entity.effects & ~0x20000000 | this.source.effects(entity.actor.id); game.show(entity); }
    return undefined;
  }
}
