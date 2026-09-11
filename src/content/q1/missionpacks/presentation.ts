/* Mission-pack player.qc poses; the selected character retains its shared lifecycle. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1CharacterDefinition, Q1CharacterPresentation, Q1CharacterSourcePose } from "../base/player.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import { length, vsub } from "../foundation/types.ts";
import type { Q1MissionPack } from "./types.ts";

const hammer: Q1CharacterDefinition = {
  model: "progs/playham.mdl", stand: { first: 6, count: 12 }, run: { first: 0, count: 6 }, pain: { first: 18, count: 6 }, death: { first: 24, count: 8 },
};
export function missionPackCharacterPose(game: Q1Foundation, actor: ActorId, pack: Q1MissionPack): Q1CharacterSourcePose {
  const player = game.player(actor); if (player === null) return { frame: null };
  const elapsed = player.weaponAnimationAt < 0 ? -1 : Math.floor((game.time - player.weaponAnimationAt) / 0.1), attacking = elapsed >= 0 && elapsed < 6;
  if (pack === "hipnotic" && player.weapon === "hipnotic:mjolnir") return { definition: hammer, frame: attacking ? player.weaponAnimationBase + elapsed : null };
  if (player.continuousFiring) {
    if (player.weapon === "hipnotic:laser") return { frame: player.weaponFrame === 1 ? 103 : 104 };
    if (player.weapon === "rogue:lava-nailgun" || player.weapon === "rogue:lava-supernailgun") return { frame: player.weaponFrame % 2 === 1 ? 103 : 104 };
  }
  if (attacking && (player.weapon === "hipnotic:proximity" || player.weapon === "rogue:multi-grenade" || player.weapon === "rogue:multi-rocket")) return { frame: 107 + elapsed };
  return { frame: null };
}

export class MissionPackCharacterEffects {
  constructor(readonly game: Q1Foundation, readonly pack: Q1MissionPack, readonly footsteps: () => boolean) {
    if (pack === "hipnotic") game.named.register("hipnotic:head-flies", { action: (runtime, timer) => {
      const owner = timer.owner === null ? null : runtime.host.actors.resolveOwned(timer.owner);
      if (owner !== null && runtime.health(owner.id) <= 0 && runtime.world?.number("worldtype") !== 2 && runtime.host.random() < 0.1) runtime.host.emit({ kind: "sound", actor: owner.id, path: "misc/flys.wav", channel: 6, attenuation: 3, volume: 0.7 });
      return runtime.remove(timer);
    } });
  }
  private state(actor: ActorId): Q1Actor {
    const previous = [...this.game.entities.values()].find(entity => entity.classname === "missionpack_character_state" && entity.owner !== null && sameActor(entity.owner, actor));
    if (previous !== undefined) return previous;
    const entity = this.game.create("missionpack_character_state"); entity.owner = actor; return entity;
  }
  frame(actor: ActorId, presentation: Q1CharacterPresentation): undefined {
    if (this.pack !== "hipnotic") return undefined;
    const game = this.game, state = this.state(actor), body = game.host.bodies.read(actor); if (body === null) return undefined;
    if (presentation.model === "progs/h_player.mdl" && state.text("model") !== presentation.model) {
      const timer = game.create("hipnotic_head_flies"); timer.owner = actor; game.schedule(timer, 1.5, game.named.action(timer, "hipnotic:head-flies"));
    }
    state.fields.set("model", presentation.model);
    const player = game.player(actor), locomotion = presentation.model === "progs/playham.mdl" ? presentation.frame < 18 : presentation.frame < 29;
    if (!this.footsteps() || presentation.life !== "alive" || !locomotion || body.velocity.x === 0 && body.velocity.y === 0 || game.time < state.number("next-step") || player?.weaponAnimationAt !== -1 || player.continuousFiring) return undefined;
    state.fields.set("next-step", String(Math.fround(game.time + 0.1)));
    let distance = Math.fround(state.number("distance") + length(vsub(body.origin, state.vector("old-origin"))));
    state.fields.set("old-origin", `${body.origin.x} ${body.origin.y} ${body.origin.z}`);
    if (body.ground !== null && distance > 95) {
      distance = distance > 190 ? 0 : Math.fround(0.5 * (distance - 95));
      const roll = game.host.random(), step = roll < 0.14 ? 1 : roll < 0.29 ? 2 : roll < 0.43 ? 3 : roll < 0.58 ? 4 : roll < 0.72 ? 5 : roll < 0.86 ? 6 : 7;
      game.host.emit({ kind: "sound", actor, path: `misc/foot${step}.wav`, channel: "voice", attenuation: 1, volume: 0.5 });
    }
    state.fields.set("distance", String(distance)); return undefined;
  }
}
