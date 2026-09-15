/* quakec_{mg1,mg3}/weapons.qc and quakec_mg3/client.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { POINT, WEAPONS, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";
import { BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_DISCOVERED, BLOODY_NIGHTMARE_NEWGAME } from "./campaign.ts";
import { waitingMg3Monster } from "./monsters/startup.ts";

function noKeys(context: Q1AddonContext, actor: ActorId): undefined {
  const { game } = context, player = game.player(actor); if (player === null) throw new Error("Addon command requires an admitted Q1 arsenal");
  if ((game.options.deathmatch !== 0 || game.options.coop) && context.services.cvar("sv_cheats") === 0) return undefined;
  const weapons = context.services.cheatArsenal?.(actor, "weapons") ?? false;
  const ammo = context.services.cheatArsenal?.(actor, "ammo") ?? false;
  const setCount = (item: ItemId, count: number, capacity: number): undefined => {
    const previous = game.host.inventory.entries(actor).find(entry => entry.item === item);
    return game.host.inventory.configure(player.actor, previous === undefined ? { item, count, capacity } : { ...previous, count });
  };
  if (!ammo) { setCount("q1:ammo/rockets", 100, 100); setCount("q1:ammo/nails", 200, 200); setCount("q1:ammo/shells", 100, 100); setCount("q1:ammo/cells", 200, 100); }
  if (!weapons) { for (const weapon of WEAPONS) setCount(game.weaponItem(weapon), 1, 1); game.selectWeapon(player.actor, "rocketlauncher"); }
  return undefined;
}

export function omnicideQ1Addons(context: Q1AddonContext, actor: ActorId): undefined {
  const { game } = context;
  for (const entity of game.entities.values()) {
    if (!game.live(entity) || (entity.movementFlags & (32 | 16384)) === 0) continue;
    if (entity.target !== "" || entity.killtarget !== "") game.useTargets(entity, actor);
    if (context.program === "mg3") {
      if (entity.classname === "monster_oldone_new") {
        context.services.emit({ kind: "music", track: 3, loopTrack: 3 }); game.host.emit({ kind: "lightstyle", style: 0, pattern: "m" });
        game.named.action(entity, "mg3:bosses:oldnew_credits")();
      } else if (entity.classname === "monster_boss") game.named.action(entity, "mg3:bosses:boss_end")();
    }
    if (game.live(entity)) game.remove(entity);
  }
  game.killedMonsters = game.totalMonsters; return context.services.emit({ kind: "monster-count", count: game.killedMonsters });
}

function cleanupMarkers(context: Q1AddonContext, name: "secret_marker" | "exit_marker"): undefined {
  for (const entity of context.game.entities.values()) if (entity.classname === name) context.game.remove(entity);
  return undefined;
}

export function handleQ1AddonImpulse(context: Q1AddonContext, actor: ActorId, impulse: number): boolean {
  if (context.program === "ctf") return false;
  if (impulse === 219) { omnicideQ1Addons(context, actor); return true; }
  if (context.program !== "mg3") { if (impulse === 99) { noKeys(context, actor); return true; } return false; }
  const { game, base } = context, flags = base.campaign.readFlags();
  if (impulse === 11) {
    for (const rune of [1, 2, 4, 8]) if ((flags & rune) === 0) { base.campaign.writeFlags(flags | rune); return true; }
    context.services.emit({ kind: "developer-message", text: "already has all runes!\n" }); return true;
  }
  if (impulse >= 101 && impulse <= 105) { base.campaign.writeFlags(flags | (impulse === 105 ? 15 : 2 ** (impulse - 101))); return true; }
  switch (impulse) {
    case 116: case 117: {
      const field = impulse === 116 ? "secrethunter" : "exithunter", enabled = context.playerNumber(actor, field) === 0;
      context.setPlayerNumber(actor, field, enabled ? 1 : 0); if (!enabled) cleanupMarkers(context, impulse === 116 ? "secret_marker" : "exit_marker"); return true;
    }
    case 119: case 121: {
      const field = impulse === 119 ? "monsterhunter" : "buddha"; context.setPlayerNumber(actor, field, context.playerNumber(actor, field) === 0 ? 1 : 0); return true;
    }
    case 220: {
      const entity = game.entity(actor), effects = (entity?.effects ?? context.playerNumber(actor, "effects")) | 8;
      if (entity !== null) entity.effects = effects; context.setPlayerNumber(actor, "effects", effects);
      context.services.emit({ kind: "actor-effects", actor, effects }); return true;
    }
    case 222: game.travel(game.mapName, actor); return true;
    case 223:
      if ((flags & BLOODY_NIGHTMARE_ACTIVE) !== 0) base.campaign.writeFlags(flags & ~BLOODY_NIGHTMARE_ACTIVE);
      else { base.campaign.writeFlags(flags | BLOODY_NIGHTMARE_ACTIVE | BLOODY_NIGHTMARE_DISCOVERED); if (context.services.cvar("skill") !== 3) { context.services.setCvar("skill", "3"); base.campaign.setSkill(3); } }
      return true;
    case 224: base.campaign.writeFlags(flags ^ BLOODY_NIGHTMARE_NEWGAME); return true;
    default: return false;
  }
}

export function frameQ1AddonPlayer(context: Q1AddonContext, actor: ActorId, viewOffset: Vec3): undefined {
  if (context.program !== "mg3") return undefined;
  const { game } = context, body = game.host.bodies.read(actor); if (body === null) return undefined;
  const eye = vadd(body.origin, viewOffset);
  for (const [field, classname, markerName] of [["secrethunter", "trigger_secret", "secret_marker"], ["exithunter", "trigger_changelevel", "exit_marker"]] satisfies readonly (readonly [string, string, "secret_marker" | "exit_marker"])[]) {
    if (context.playerNumber(actor, field) === 0) continue;
    cleanupMarkers(context, markerName);
    for (const entity of game.entities.values()) {
      if (entity.classname !== classname) continue;
      const targetBody = game.body(entity), bounds = entity.triggerBounds ?? targetBody.bounds;
      const middle = vadd(targetBody.origin, vscale(vadd(bounds.min, bounds.max), 0.5));
      const marker = game.create(markerName), trace = game.host.trace({ start: eye, end: middle, bounds: POINT, ignore: actor, monsters: false });
      marker.model = "progs/s_bubble.spr"; game.setBody(marker, { origin: vsub(trace.end, vscale(normalize(vsub(middle, eye)), 4)) }); game.link(marker);
    }
  }
  if (context.playerNumber(actor, "monsterhunter") !== 0) for (const entity of game.entities.values()) {
    const current = game.body(entity);
    if ((entity.movementFlags & 32) !== 0 && game.health(entity.actor.id) > 0) context.services.emit({ kind: "debug-bounds", min: vadd(current.origin, current.bounds.min), max: vadd(current.origin, current.bounds.max), color: 251, lifetime: 0, depthTest: false });
    else if (waitingMg3Monster(game, entity)) context.services.emit({ kind: "debug-bounds", min: vsub(current.origin, { x: 16, y: 16, z: 16 }), max: vadd(current.origin, { x: 16, y: 16, z: 16 }), color: 244, lifetime: 0, depthTest: false });
  }
  return undefined;
}
