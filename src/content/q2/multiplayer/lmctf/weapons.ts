/* LMCTF plasma.c / p_weapon.c. Copyright Team HOSTILE and LMCTF. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import type { Q2WeaponContext, Q2Weapons } from "../../foundation/weapons/player.ts";
import type { Q2WeaponDefinition } from "../../foundation/weapons/types.ts";
import { add, scale, zero } from "../../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { lmctfPlayer, lmctfPrint } from "./types.ts";
import type { LmctfContext } from "./types.ts";

const plasma: Q2WeaponDefinition = { name: "lmctf:plasma", item: "q2:weapon_plasma", classname: "weapon_plasma", ammo: "q2:ammo_cells", quantity: 10, warning: 10,
  viewModel: "models/weapons/v_plasma/tris.md2", worldModel: "models/weapons/g_plasma/tris.md2", playerModel: 12,
  activateLast: 3, fireLast: 11, idleLast: 46, deactivateLast: 51, pauses: [16, 46], fires: [4, 5], repeating: false };
export class LmctfWeapons {
  constructor(readonly context: LmctfContext) {
    context.hooks.items.register({ kind: "weapon", classname: plasma.classname, ammo: plasma.ammo, model: plasma.worldModel, icon: "w_plasma", name: "Plasma Rifle",
      sound: "misc/w_pkup.wav", rotate: true, respawn: 30, coopStay: true });
    context.hooks.weapons.register({ definition: plasma, fire: this.fire, think: this.think, selection: { requested: plasma.name, choose: (self, game, state) => {
      if (state.weapon === plasma.name) { const player = lmctfPlayer(context, self.actor.id); player.plasmaMode = !player.plasmaMode; this.mode(self, game); }
      return true;
    } } });
  }
  get callbacks(): Q2CallbackDefinitions { return { think: { "lmctf:plasma_free": this.free }, touch: { "lmctf:plasma_reflect_touch": this.reflect, "lmctf:plasma_spread_touch": this.spread } }; }
  private mode(self: Pick<Q2Entity, "actor">, game: Q2GameServices): undefined { return lmctfPrint(game, lmctfPlayer(this.context, self.actor.id).plasmaMode ? "bounce plasma\n" : "spread plasma\n", self.actor.id); }
  private readonly think = (current: Q2WeaponContext, weapons: Q2Weapons): undefined => {
    this.context.plasmaQuad = current.input.quadUntil > current.now;
    const { state } = current, activating = state.phase === "activating" && state.frame === 3;
    if (state.phase === "ready" && state.frame === 35 && !current.input.attack && !state.latchedAttack && state.pending === null) current.game.sound(current.self, "weapons/plasma/vent.wav", 1);
    weapons.genericClassic(current);
    if (activating && state.phase === "ready") this.mode(current.self, current.game);
    return undefined;
  };
  private readonly fire = (current: Q2WeaponContext, weapons: Q2Weapons): undefined => {
    const { self, game, state, input, now } = current;
    if (weapons.ammo(current) < 1) {
      state.frame++;
      if (now >= state.emptySoundTime) { game.sound(self, "weapons/plasma/empty.wav", 2); state.emptySoundTime = now + 1; }
      return weapons.noAmmo(current, false);
    }
    if (state.frame === 4) {
      const projection = weapons.project(current, { x: 8, y: 8, z: -8 }), reflect = lmctfPlayer(this.context, self.actor.id).plasmaMode;
      state.kickOrigin = scale(angleVectors(input.angles).forward, -2);
      game.sound(self, reflect ? "weapons/plasma/fire1.wav" : "weapons/plasma/fire2.wav", 1);
      this.launch(self, game, projection.start, projection.direction, reflect);
      const cells = game.host.inventory.entries(self.actor.id).find(entry => entry.item === "q2:ammo_cells");
      if (cells === undefined) throw new Error("LMCTF plasma fired without its admitted cell counter");
      game.host.inventory.configure(self.actor, { ...cells, countPolicy: { kind: "source-counter", arithmetic: "int32" } });
      game.host.inventory.adjustSourceCounter(self.actor, cells.item, -9);
      if ((game.options.deathmatchFlags & 8192) === 0) game.host.inventory.adjustSourceCounter(self.actor, cells.item, -1);
      weapons.hooks.ammoChanged(self.actor.id, cells.item);
      const player = this.context.hooks.player(self.actor.id);
      if (player !== null) { player.damagePitch = -2; player.damageRoll = (game.host.random() * 2 - 1) * 2; player.damageTime = now + 0.5; }
      weapons.playerNoise(self, game, projection.start, "weapon");
    }
    state.frame++; return undefined;
  };
  launch(owner: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, reflect: boolean): undefined {
    const angles = vectorAngles(direction);
    for (const yaw of reflect ? [0] : [0, 10, -10]) {
      const goop = game.create("goop"), velocity = scale(yaw === 0 ? direction : angleVectors({ ...angles, y: angles.y + yaw }).forward, 1200);
      goop.owner = owner.actor.id; goop.clipMask = 0x6000003; goop.serverFlags = 2; goop.damage = reflect ? 39 : 1;
      goop.effects = 0x100000 | 0x2000; goop.renderFlags = 32; goop.model = "sprites/s_plasma1.sp2"; goop.sound = "weapons/plasma/flyby.wav";
      goop.touch = reflect ? this.reflect : this.spread;
      game.move(goop, { origin: start, velocity, angles: reflect ? velocity : zero, bounds: reflect ? { min: { x: -12, y: -12, z: -12 }, max: { x: 12, y: 12, z: 12 } } : { min: zero, max: zero } });
      game.solid(goop, "box"); game.motion(goop, reflect ? "wall-bounce" : "fly-missile"); game.show(goop); game.schedule(goop, reflect ? 1.5 : 3, this.free);
    }
    return undefined;
  }
  private readonly free: Q2Think = (self, game) => game.remove(self);
  private readonly reflect: Q2Touch = (self, game, contact) => this.impact(self, game, contact, true);
  private readonly spread: Q2Touch = (self, game, contact) => this.impact(self, game, contact, false);
  private impact(self: Q2Entity, game: Q2GameServices, contact: Parameters<Q2Touch>[2], reflect: boolean): undefined {
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(self);
    if (!reflect && game.entity(contact.other)?.classname === "goop") return undefined;
    const body = game.body(self), owner = game.entity(self.owner), normal = contact.plane?.normal ?? zero;
    const damage = (reflect ? 39 : 28) * (this.context.plasmaQuad ? 4 : 1), hurt = game.host.combat.read(contact.other)?.canTakeDamage === true;
    if (owner !== null && game.host.isPlayer(owner.actor.id)) this.context.hooks.weapons.playerNoise(owner, game, body.origin, "impact");
    if (hurt) game.damage(contact.other, self, self.owner, damage, 1, body.velocity, body.origin, normal, 34, 4, plasma.item);
    else {
      game.host.emit({ kind: "effect", effect: "q2:laser_sparks", origin: body.origin, direction: normal, count: 32, color: 176 });
      game.radiusDamage(self, self.owner, damage, null, damage + 70, 34, 0, plasma.item);
    }
    if (reflect && !hurt) return game.sound(self, "weapons/plasma/bounce.wav", 4, 1, 3);
    game.sound(self, "weapons/plasma/hit.wav", 4, 1, 2);
    game.solid(self, "none"); self.touch = null; self.model = "sprites/s_plasma2.sp2"; self.frame = 0; self.sound = "";
    game.move(self, { origin: add(body.origin, scale(body.velocity, -0.1)), velocity: zero }); game.show(self); return game.schedule(self, 0.1, this.free);
  }
}
