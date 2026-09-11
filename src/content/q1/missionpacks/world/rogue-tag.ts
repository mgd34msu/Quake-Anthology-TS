/* dmatch.qc token lifecycle and source scoring. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO, vadd } from "../../foundation/types.ts";
import { q1Base } from "../../base/provider.ts";
import type { MissionpackWorldHooks } from "./index.ts";
import { later, number } from "./common.ts";

export class RogueTag {
  constructor(private readonly game: Q1EntityServices, private readonly hooks: MissionpackWorldHooks) {
    game.named.register("rogue:tag_respawn", { action: () => this.respawn() });
    game.named.register("rogue:tag_fall", { action: (g, e) => { number(e, "tag_frags", 0); this.dropFloor(e); return later(g, e, 30, "rogue:tag_respawn"); } });
    game.named.register("rogue:tag_place", { action: (g, e) => { e.movement = "toss"; e.solid = "trigger"; g.setOrigin(e, vadd(g.body(e).origin, { x: 0, y: 0, z: 6 })); return this.dropFloor(e) ? undefined : g.remove(e); } });
    game.named.register("rogue:tag_think", { action: (g, e) => {
      if (e.owner !== null && g.health(e.owner) > 0) {
        if (e.number("tag_message_time") < g.time) { this.announce("$qc_has_token", e.owner); number(e, "tag_message_time", g.time + 30); }
        g.setOrigin(e, vadd(g.host.bodies.read(e.owner)?.origin ?? ZERO, { x: 0, y: 0, z: 48 })); return later(g, e, 0.1, "rogue:tag_think");
      }
      if (e.owner !== null) this.announce("$qc_lost_token", e.owner); number(e, "tag_frags", 0); e.solid = "trigger"; e.owner = null; e.touch = g.named.touch(e, "rogue:tag_touch"); return later(g, e, 0.1, "rogue:tag_fall");
    } });
    game.named.register("rogue:tag_touch", { touch: (g, e, other) => { if (!g.isPlayer(other)) return undefined; this.take(e, other, 30); g.sound(e, "runes/end1.wav"); return this.announce("$qc_got_token", other); } });
    game.registerSpawn("dmatch_tag_token", (g, e) => { if (g.options.teamplay !== 3) return g.remove(e); e.model = "progs/sphere.mdl"; e.skin = 1; e.effects |= 8; e.touch = g.named.touch(e, "rogue:tag_touch"); g.setBounds(e, { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }); return later(g, e, 0.2, "rogue:tag_place"); });
  }
  private announce(text: string, actor: ActorId): undefined { if (this.hooks.playerName === undefined) throw new Error("Rogue token messages require shared player names"); for (const player of this.game.host.players()) this.game.host.emit({ kind: "message", player, text, args: [this.hooks.playerName(actor)], center: false }); return undefined; }
  private token(): Q1Actor | undefined { return [...this.game.entities.values()].find(entity => entity.classname === "dmatch_tag_token"); }
  private dropFloor(entity: Q1Actor): boolean { const body = this.game.body(entity), hit = this.game.host.trace({ start: body.origin, end: vadd(body.origin, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true }); if (hit.fraction === 1 || hit.allSolid) return false; this.game.setBody(entity, { origin: hit.end, ground: hit.actor }); this.game.link(entity); return true; }
  private take(token: Q1Actor, actor: ActorId, announcementDelay: number): undefined { const game = this.game; game.world?.references.set("rogue:tag_token_owner", actor); token.owner = actor; number(token, "tag_frags", 0); number(token, "tag_message_time", game.time + announcementDelay); token.solid = "none"; token.touch = null; return later(game, token, 0.1, "rogue:tag_think"); }
  private respawn(): undefined { const token = this.token(); if (token === undefined) return undefined; const game = this.game, point = q1Base(game).spawnSelector.select(true); if (point === null) throw new Error("Tag token has no respawn point"); game.setOrigin(token, game.body(point).origin); game.world?.references.set("rogue:tag_token_owner", null); token.solid = "trigger"; token.touch = game.named.touch(token, "rogue:tag_touch"); token.think = game.named.action(token, "SUB_Null"); token.owner = null; number(token, "tag_frags", 0); this.dropFloor(token); return undefined; }
  score(victim: ActorId, attacker: ActorId): number {
    const token = this.token(); if (token === undefined) return 1; const game = this.game, owner = game.world?.references.get("rogue:tag_token_owner") ?? null;
    if (owner !== null && sameActor(attacker, owner)) {
      number(token, "tag_frags", token.number("tag_frags") + 1);
      if (token.number("tag_frags") === 5) { const player = game.player(attacker); if (player !== null) { game.message(attacker, "$qc_got_quad", false); game.givePowerup(player, "quad"); } }
      else if (token.number("tag_frags") === 10) { this.announce("$qc_lost_token", attacker); this.respawn(); }
      return 3;
    }
    if (owner !== null && sameActor(victim, owner)) { const source = game.host.actors.resolveOwned(victim); if (source !== null) game.sound(source, "runes/end1.wav"); if (game.isPlayer(attacker)) this.take(token, attacker, 0.5); return 5; }
    return 1;
  }
}
