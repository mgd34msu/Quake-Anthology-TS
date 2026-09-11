/* Threewave weapons.qc slot animation. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { length } from "../foundation/types.ts";
import type { ThreewaveGrapple } from "./threewave-grapple.ts";

export interface ThreewaveWeaponHooks {
  selected(actor: ActorId): boolean;
  available(actor: ActorId): boolean;
  frame(actor: ActorId, frame: number): undefined;
}

/** Uses the core's saved animation actor and deadlines, including the named delayed launch. */
export class ThreewaveWeapon {
  constructor(readonly core: ThreewaveGrapple, readonly hooks: ThreewaveWeaponHooks) {
    const game = core.game;
    game.named.register("ctf:hook_launch_frame", { action: (_runtime, timer) => {
      const actor = timer.owner;
      if (actor !== null && game.host.actors.isLive(actor)) {
        core.state(actor).animation = null;
        if (game.health(actor) > 0 && hooks.selected(actor)) {
          this.frame(actor, 3);
          if (hooks.available(actor)) core.fire(actor);
        }
      }
      return game.remove(timer);
    } });
  }

  private frame(actor: ActorId, frame: number): undefined {
    this.core.state(actor).weaponFrame = frame;
    return this.hooks.frame(actor, frame);
  }

  private movingFrame(actor: ActorId): number {
    const body = this.core.game.host.bodies.read(actor);
    if (body === null) throw new Error("Threewave weapon owner requires a shared body");
    return length(body.velocity) >= 750 ? 4 : 3;
  }

  attack(actor: ActorId): boolean {
    if (!this.hooks.available(actor)) return false;
    const { game } = this.core, state = this.core.state(actor);
    if (state.attackFinished > game.time) return false;
    state.attackFinished = Math.fround(game.time + 0.1);
    if (this.core.hook(actor) !== null) { this.frame(actor, this.movingFrame(actor)); return true; }
    if (state.animation !== null) return true;
    const timer = game.create("ctf_hook_animation"); timer.owner = actor;
    state.animation = timer.actor.id; this.frame(actor, 2);
    game.schedule(timer, 0.1, game.named.action(timer, "ctf:hook_launch_frame"));
    return true;
  }

  animate(actor: ActorId): undefined {
    const state = this.core.state(actor), game = this.core.game;
    if (this.core.hook(actor) !== null) {
      const next = this.movingFrame(actor);
      if (state.weaponFrame !== next) this.frame(actor, next);
    } else if (state.animation === null && state.weaponFrame !== 0) {
      if (state.weaponFrame !== 5) { this.frame(actor, 5); state.releaseTime = Math.fround(game.time + 0.1); }
      else if (game.time >= state.releaseTime) this.frame(actor, 0);
    }
    return undefined;
  }

  holster(actor: ActorId): undefined {
    // HookPull releases on attack-up only while the hook is selected.
    return this.frame(actor, 0);
  }
  /** Q1 weapon switches complete immediately; scheduled source attacks have separate owners. */
  isHolstered(): boolean { return true; }
  resume(actor: ActorId): undefined { return this.frame(actor, 0); }
}

export function threewaveCharacterPose(core: ThreewaveGrapple, actor: ActorId) {
  const frame = core.state(actor).weaponFrame, hook = core.hook(actor);
  return { axePose: true, frame: frame === 2 ? 137 : frame === 3 ? hook !== null && core.game.time < hook.number("ctf.fired") + 0.1 ? 138 : 139 : frame === 4 ? 73 : frame === 5 ? 140 : null };
}
