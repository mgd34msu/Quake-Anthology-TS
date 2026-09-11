/* quakec_mg3/monsters/mg3_player_ghost.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { spawnTeleportFog } from "../../../foundation/spawns.ts";
import { ZERO, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { BaseMonster } from "../../../base/monsters.ts";
import { spawnBubble } from "../../../base/map-entities.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import type { Q1AddonContext } from "../../context.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import { frames } from "./frames/ghost.ts";
import { registerBossControllers, requireBoss } from "./registry.ts";

const prefix = "mg3:ghost";
const spec: MonsterSpecies = { species: "army", classnames: ["monster_ghost"], model: "player", head: null, health: 10, gibHealth: -Infinity, gibs: [],
  bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, stand: "ghost_stand1", walk: "ghost_run1", run: "ghost_run1", sight: "", missile: null, melee: false, movement: "fly" };
const actions = new Map<string, (monster: BaseMonster) => undefined>();
for (const frame of frames.values()) for (const operation of frame.operations) if (operation.kind === "action") actions.set(operation.name, monster => {
  if (!(monster instanceof Q1Ghost)) throw new Error("Ghost callback received another source controller"); return monster.action(operation.name);
});

export class Q1Ghost extends BaseMonster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor) { super(context.game, entity, spec, context.base, { callbackPrefix: prefix, frames, actions }); }
  override spawn(): undefined {
    const { game, entity, context } = this;
    if (context.removedForRunes(entity) || context.removedOutsideCoop(entity)) return undefined;
    const choice = game.host.random() * 5; entity.fields.set("ghost.death", choice < 1 ? "ghost_diea1" : choice < 2 ? "ghost_dieb1" : choice < 3 ? "ghost_diec1" : choice < 4 ? "ghost_died1" : "ghost_diee1");
    entity.wait ||= 128; game.host.combat.setHealth(entity.actor, 10); entity.maxHealth = 10; entity.solid = "slidebox"; entity.model = "progs/player.mdl"; entity.damageable = true; entity.aimedDamage = false;
    entity.pathEnd = game.named.action(entity, `${prefix}:monster_stand`); entity.touch = game.named.touch(entity, `${prefix}:touch`); entity.die = game.named.die(entity, `${prefix}:monster_die`); entity.movement = "fly"; game.setBounds(entity, spec.bounds);
    entity.dest1 = this.origin; entity.dest2 = vadd(entity.dest1, vscale(game.makeVectors({ x: 0, y: game.host.random() * 360, z: 0 }).forward, entity.wait));
    this.play(spec.stand); entity.count = Math.floor(game.host.random() * 5 + 0.5) + 3; return undefined;
  }
  override die(_attacker: ActorId | null): undefined { return this.play(this.entity.text("ghost.death")); }
  action(name: string): undefined {
    const { game, entity } = this;
    switch (name) {
      case "ghost:ghost_stand1": return game.setBody(entity, { velocity: ZERO });
      case "ghost:ghost_stand5":
        entity.count--; if (entity.count === 0) { this.nextFrame = "ghost_run1"; entity.dest2 = vadd(entity.dest1, vscale(game.makeVectors({ x: 0, y: game.host.random() * 360, z: 0 }).forward, entity.wait)); } return undefined;
      case "ghost:ghost_run1": { const delta = vsub(entity.dest2, this.origin), direction = normalize({ ...delta, z: 0 }); return game.setBody(entity, { angles: velocityAngles(direction), velocity: vscale(direction, 150) }); }
      case "ghost:ghost_run6": entity.count = Math.floor(game.host.random() * 5 + 0.5) + 3; return undefined;
      case "ghost:ghost_diea1":
        if (entity.waterLevel === 3) {
          const timer = game.create("death_bubbles"); timer.owner = entity.actor.id; timer.count = 20; game.setOrigin(timer, this.origin); game.schedule(timer, 0.1, game.named.action(timer, `${prefix}:death_bubbles`));
          game.sound(entity, "player/h2odeath.wav", "voice", 0);
        } else { const path = `player/death${Math.floor(game.host.random() * 4 + 1.5)}.wav`; entity.fields.set("noise", path); game.sound(entity, path, "voice", 0); }
        return game.setBody(entity, { velocity: ZERO });
      case "ghost:ghost_diea11": spawnTeleportFog(game, this.origin); return game.remove(entity);
      default: throw new Error(`Unknown ghost action ${name}`);
    }
  }
  touch(other: ActorId): undefined {
    this.game.host.random();
    if (this.game.health(other) === 0 || this.state.painFinished > this.game.time || !this.game.isPlayer(other)) return undefined;
    this.entity.touch = null; return this.die(other);
  }
}
export function registerGhost(context: Q1AddonContext): undefined {
  const { game } = context, ghosts = registerBossControllers(context, prefix, "monster_ghost", entity => new Q1Ghost(context, entity));
  game.named.register(`${prefix}:touch`, { touch: (_game, entity, other) => requireBoss(ghosts, entity).touch(other) });
  game.named.register(`${prefix}:death_bubbles`, { action: (_game, timer) => {
    const owner = game.entity(timer.owner); if (owner === null || owner.waterLevel !== 3) return undefined;
    spawnBubble(game, vadd(game.body(owner).origin, { x: 0, y: 0, z: 24 })); timer.count--;
    return timer.count <= 0 ? game.remove(timer) : game.schedule(timer, 0.1, game.named.action(timer, `${prefix}:death_bubbles`));
  } }); return undefined;
}
