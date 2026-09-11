/* LM_CTF p_weapon.c hook and g_cmds.c offhand controls. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import type { Q2WeaponDefinition } from "../../foundation/weapons/types.ts";
import { add, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { lmctfActive, lmctfPlayer, lmctfPrint } from "./types.ts";
import type { LmctfContext } from "./types.ts";

const hookDefinition: Q2WeaponDefinition = { name: "lmctf:hook", item: "q2:weapon_hook", classname: "weapon_hook", ammo: null, quantity: 0, warning: 0,
  viewModel: "models/weapons/v_hook/tris.md2", worldModel: "models/objects/debris2/tris.md2", playerModel: 11,
  activateLast: 9, fireLast: 13, idleLast: 34, deactivateLast: 38, pauses: [14, 18, 26, 30], fires: [8, 9, 10, 11], repeating: true };
export class LmctfGrapple {
  constructor(readonly context: LmctfContext) {
    context.hooks.items.register({ kind: "weapon", classname: "weapon_hook", ammo: null, model: hookDefinition.worldModel, icon: "w_blaster", name: "Grappling Hook",
      sound: "misc/w_pkup.wav", rotate: false, respawn: 0, coopStay: true });
    context.hooks.weapons.register({ definition: hookDefinition, fire: current => this.fire(current.self, current.game),
      think: (current, weapons) => {
        if (current.state.phase === "activating") current.state.frame++;
        if (current.state.pending !== null && current.state.phase !== "dropping") { current.state.phase = "dropping"; current.state.frame = 36; return undefined; }
        if (!current.input.attack && !current.state.latchedAttack && !lmctfPlayer(context, current.self.actor.id).hookHeld) this.abort(current.self, current.game);
        return weapons.genericClassic(current);
      } });
  }
  get callbacks(): Q2CallbackDefinitions { return { think: { "lmctf:Grapple_Bolt_Think": this.think }, touch: { "lmctf:hook_touch": this.touch }, die: { "lmctf:hook_die": this.die } }; }
  abort(player: Q2Entity, game: Q2GameServices): undefined {
    const state = lmctfPlayer(this.context, player.actor.id), common = this.context.hooks.player(player.actor.id), body = game.body(player), weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (body.ground !== null) { if (common !== null) common.oldVelocity = { ...common.oldVelocity, z: 0 }; game.move(player, { velocity: { ...body.velocity, z: 0 } }); }
    if (weapon?.weapon === "lmctf:hook" && weapon.phase === "firing") weapon.phase = "ready";
    state.hookState = 0; state.hookLength = 0;
    const hook = game.entity(state.hook); state.hook = null;
    if (hook !== null) { game.cancel(hook); hook.enemy = null; game.remove(hook); }
    return undefined;
  }
  private readonly die: Q2Die = (hook, game) => { const owner = game.entity(hook.owner); return owner === null ? game.remove(hook) : this.abort(owner, game); };
  private readonly think: Q2Think = (hook, game) => {
    const state = hook.owner === null ? undefined : this.context.states.get(hook.owner);
    if (state === undefined) return game.remove(hook);
    if (state.hookLength <= 126) return game.cancel(hook);
    game.sound(hook, hook.enemy === null ? "weapons/grapple/gflyair.wav" : "weapons/grapple/gpulling.wav", 0);
    return game.schedule(hook, hook.enemy === null ? 0.4 : 0.8, this.think);
  };
  private readonly touch: Q2Touch = (hook, game, contact) => {
    const owner = game.entity(hook.owner); if (owner === null) return game.remove(hook);
    if (contact.other.equals(owner.actor.id) || hook.enemy !== null && !hook.enemy.equals(contact.other)) return undefined;
    const other = game.entity(contact.other), classname = other?.classname ?? "", state = lmctfPlayer(this.context, owner.actor.id);
    if (!game.host.isPlayer(contact.other) && classname !== "bodyque" && classname !== "worldspawn" && !classname.startsWith("func") && !classname.startsWith("info_flag") && !contact.other.equals(game.host.worldActor())) return this.abort(owner, game);
    const targetState = this.context.states.get(contact.other), targetPlayer = this.context.hooks.player(contact.other);
    if ((contact.surface?.nativeFlags ?? 0) & 4 || targetState !== undefined && state.team === targetState.team || targetPlayer?.dead === true) return this.abort(owner, game);
    game.move(hook, { velocity: zero }); state.hookState = 2;
    if ((this.context.rules.ctfFlags & 64) === 0 || targetPlayer === null) {
      const frame = Math.round(game.host.now() * 10), repeated = hook.enemy?.equals(contact.other) ?? false;
      if (!repeated || frame % 7 === 0 && frame !== hook.count) {
        const amount = repeated ? 1 : 8;
        if (lmctfActive(this.context, game, contact.other)) game.sound(hook, repeated ? "weapons/grapple/gkilling.wav" : "weapons/grapple/ghit.wav", 0);
        else if (!repeated) game.sound(hook, "weapons/grapple/ghitwall.wav", 0, 0.8);
        game.damage(contact.other, hook, owner.actor.id, amount, amount, zero, game.body(hook).origin, contact.plane?.normal ?? zero, 60, 4, "q2:weapon_hook");
        if (repeated) hook.count = frame;
      }
    }
    if (this.context.hooks.player(contact.other)?.dead === true) return this.abort(owner, game);
    if (hook.enemy === null) {
      const body = game.host.bodies.read(contact.other); if (body === null) return this.abort(owner, game);
      hook.enemy = contact.other; hook.pos1 = subtract(game.body(hook).origin, add(body.origin, body.bounds.min)); game.solid(hook, "trigger");
    }
    game.host.emit({ kind: "effect", effect: "blaster", origin: game.body(hook).origin, direction: contact.plane?.normal ?? zero, count: 0, color: 0 }); return undefined;
  };
  private launch(player: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3): Q2Entity {
    const hook = game.create("noclass"), angles = vectorAngles(direction);
    hook.owner = player.actor.id; hook.touch = this.touch; hook.die = this.die; hook.damage = 2; hook.maxHealth = 59; hook.model = "models/objects/ghook/tris.md2"; hook.clipMask = 0x6000003;
    game.move(hook, { origin: start, angles: { ...angles, x: angles.x + 90 }, velocity: scale(normalize(direction), 800) });
    game.solid(hook, "box"); game.motion(hook, "fly-missile"); game.host.combat.create(hook.actor, { health: 59, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    game.show(hook); game.schedule(hook, 1, this.think); game.sound(player, "weapons/grapple/grfire.wav", 0, 0.8);
    const trace = game.host.trace({ start: game.body(player).origin, end: start, bounds: null, ignore: player.actor.id, mask: 0x6000003 });
    if (trace.fraction < 1) {
      game.move(hook, { origin: add(start, scale(direction, -10)) });
      const other = trace.hit.kind === "actor" ? trace.hit.actor : game.host.worldActor();
      this.touch(hook, game, { self: hook.actor, other, plane: null, surface: null });
    }
    return hook;
  }
  private draw(player: Q2Entity, start: Vec3, end: Vec3): undefined {
    return length(subtract(end, start)) > 64 ? this.context.hooks.emit({ kind: "grapple-cable", actor: player.actor.id, start, end, offset: zero }) : undefined;
  }
  fire(player: Q2Entity, game: Q2GameServices): undefined {
    const state = lmctfPlayer(this.context, player.actor.id), common = this.context.hooks.player(player.actor.id), weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (weapon !== undefined) weapon.sourceFiring = false;
    const body = game.body(player), basis = angleVectors(game.host.playerViewState(player.actor.id)?.viewAngles ?? body.angles), side = common?.hand === "left" ? -8 : common?.hand === "center" ? 0 : 8;
    const start = add(add(add(body.origin, scale(basis.forward, 8)), scale(basis.right, side)), { x: 0, y: 0, z: player.viewHeight - 8 });
    if (state.hookState === 0) {
      if (weapon !== undefined) { weapon.sourceFiring = true; weapon.kickOrigin = scale(basis.forward, -2); weapon.kickAngles = { ...weapon.kickAngles, x: -1 }; }
      state.hookState = 1; const hook = this.launch(player, game, start, basis.forward); state.hook = hook.actor.id;
      if (!game.host.actors.isLive(hook.actor.id)) { state.hook = null; return undefined; }
      this.draw(player, start, game.body(hook).origin);
      return this.draw(player, start, game.body(hook).origin);
    }
    const hook = game.entity(state.hook);
    if (hook === null) { state.hookState = 0; return undefined; }
    if (state.hookState === 1) return this.draw(player, start, game.body(hook).origin);
    const target = hook.enemy === null ? null : game.host.bodies.read(hook.enemy);
    if (target !== null) game.move(hook, { origin: add(add(target.origin, target.bounds.min), hook.pos1) });
    const end = game.body(hook).origin; this.draw(player, start, end);
    const distance = Math.trunc(length(subtract(end, start))); state.hookLength = distance;
    const speed = distance > 120 ? 800 : distance > 100 ? distance * 5 : distance > 80 ? distance * 4 : distance > 40 ? distance * 3 : distance > 20 ? distance * 2 : distance > 10 ? distance : 1;
    const velocity = scale(normalize(subtract(end, start)), speed); game.move(player, { velocity });
    if (common !== null) common.oldVelocity = velocity; return undefined;
  }
  gravityScale(actor: ActorId): 0 | 1 { const state = this.context.states.get(actor); return state?.hookState === 2 && state.hookLength < 50 ? 0 : 1; }
  command(player: Q2Entity, game: Q2GameServices, pressed: boolean): undefined {
    const state = lmctfPlayer(this.context, player.actor.id), common = this.context.hooks.player(player.actor.id), weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (common === null || common.noclip || common.spectator) return undefined;
    if ((this.context.rules.ctfFlags & 16) !== 0) {
      if (weapon?.weapon === "lmctf:hook") { state.hookHeld = pressed; if (pressed) weapon.latchedAttack = true; else this.abort(player, game); return undefined; }
      if (!pressed) return this.abort(player, game);
      if (state.hook !== null) return undefined;
      if (game.host.inventory.count(player.actor.id, "q2:weapon_hook") === 0) return lmctfPrint(game, "You have no hook.\n", player.actor.id);
      if ((this.context.hooks.weapons.inputs.get(player.actor.id)?.quadUntil ?? 0) > game.host.now()) game.sound(player, "items/damage3.wav", 3);
      return this.fire(player, game);
    }
    if (pressed) this.context.hooks.weapons.requestWeapon(player, game, "lmctf:hook"); return undefined;
  }
}
