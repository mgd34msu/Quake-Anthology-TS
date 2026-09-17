/* quakec_mg3/items.qc powerup_touch and client.qc CheckPowerups. GPL-2.0-or-later. */
import type { Q1PlayerState } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";
import { MG3_ITEM_PREFIX, startMg3Item } from "./common.ts";

export function registerMg3LavaSuit(context: Q1AddonContext): void {
  const { game } = context;
  game.named.register(MG3_ITEM_PREFIX + "lavasuit_touch", { touch: (_game, entity, other) => {
    const player = game.player(other);
    if (player === null || game.health(other) <= 0) return undefined;
    game.givePowerup(player, "mg3:lavasuit", 30);
    context.setPlayerNumber(other, "lavasuit_time", 1);
    game.message(other, "$qc_got_item", true, ["$mg3_qc_lavasuit"]);
    game.sound(player.actor, "items/suit.wav", "item");
    game.effect("pickup", game.body(entity).origin, other);
    entity.model = ""; entity.solid = "none"; game.link(entity);
    entity.activator = other; game.useTargets(entity, other);
    if (!game.live(entity)) return undefined;
    if (game.options.coop) entity.target = "";
    const respawn = game.options.coop ? 2.5 : game.options.deathmatch !== 0 ? 60 : entity.wait;
    return respawn > 0 ? game.schedule(entity, respawn, game.named.action(entity, "SUB_regen")) : game.cancel(entity);
  } });
  game.registerSpawn("item_artifact_lavasuit", (_game, entity) => {
    game.precacheModel("progs/lavasuit.mdl");
    game.precacheSound("items/suit.wav"); game.precacheSound("items/suit2.wav");
    entity.model = "progs/lavasuit.mdl"; entity.fields.set("netname", "$mg3_qc_lavasuit");
    entity.touch = game.named.touch(entity, MG3_ITEM_PREFIX + "lavasuit_touch");
    game.setBounds(entity, { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
    return startMg3Item(context, entity);
  });
}

export function mg3LavaSuitFrame(context: Q1AddonContext, player: Q1PlayerState): void {
  const { game } = context, expires = player.powerups.get("mg3:lavasuit") ?? 0;
  if (expires === 0) return;
  const actor = player.actor.id, warning = context.playerNumber(actor, "lavasuit_time"), body = game.host.bodies.read(actor);
  if (expires < game.time + 3 && warning === 1) {
    game.message(actor, "$mg3_qc_lavasuit_wearing_out", true);
    game.sound(player.actor, "items/suit2.wav", "item");
    context.setPlayerNumber(actor, "lavasuit_time", game.time + 1);
    if (body !== null) game.effect("pickup", body.origin, actor);
  } else if (expires < game.time + 3 && warning < game.time) {
    context.setPlayerNumber(actor, "lavasuit_time", game.time + 1);
    if (body !== null) game.effect("pickup", body.origin, actor);
  }
  if (expires <= game.time) context.setPlayerNumber(actor, "lavasuit_time", 0);
}
