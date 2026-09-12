/* Original Xatrix/Rogue p_weapon.c source callbacks over the shared Weapon_Generic. */
import { add, dot, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Weapons, Q2WeaponContext, Q2WeaponExtension, Q2ThrowDefinition } from "../../foundation/weapons/player.ts";
import type { Q2Edition } from "../../foundation/host.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import type { Q2MissionPackProjectiles } from "../projectiles/index.ts";
import { velocity } from "../projectiles/common.ts";
import type { Q2MissionPack } from "../types.ts";
import { q2MissionPackDamage as mod } from "../types.ts";
import { rogueWeaponDefinitions, xatrixWeaponDefinitions } from "./definitions.ts";

export class Q2MissionPackWeapons {
  constructor(readonly projectiles: Q2MissionPackProjectiles) {}

  register(weapons: Q2Weapons, pack: Q2MissionPack, edition: Q2Edition = "classic"): undefined {
    for (const original of pack === "xatrix" ? xatrixWeaponDefinitions : rogueWeaponDefinitions) {
      const definition = edition !== "rerelease" ? original : original.name === "ionripper" ? { ...original, activateLast: 5, fireLast: 7, fires: [6] }
        : original.name === "heatbeam" ? { ...original, repeating: true, idleLast: 42, deactivateLast: 47 }
        : original.name === "chainfist" || original.name === "etf_rifle" ? { ...original, repeating: true } : original;
      const extension: Q2WeaponExtension = definition.name === "trap" || definition.name === "tesla"
        ? { definition, fire: this.fire, think: this.think, held: (context, source, held) => this.throw(context, source, held) }
        : { definition, fire: this.fire, think: this.think };
      if (edition === "classic" && pack === "xatrix" && (definition.name === "ionripper" || definition.name === "phalanx")) {
        const requested = definition.name === "ionripper" ? "hyperblaster" : "railgun";
        weapons.register({ ...extension, selection: { requested, choose: (self, game, state) => {
          if (game.host.inventory.count(self.actor.id, definition.item) === 0) return false;
          if (requested === "hyperblaster") return state.weapon === requested;
          if (game.host.inventory.count(self.actor.id, "q2:ammo_slugs") === 0) return game.host.inventory.count(self.actor.id, "q2:ammo_magslug") > 0;
          return state.weapon === requested;
        } } });
      } else weapons.register(extension);
    }
    if (pack === "rogue") weapons.setFallbackOrder(["railgun", "heatbeam", "etf_rifle", "chaingun", "machinegun", "supershotgun", "shotgun", "blaster"]);
    return undefined;
  }

  private readonly think = (context: Q2WeaponContext, weapons: Q2Weapons): undefined => {
    const { state, input, game, self, definition } = context;
    if (definition.name === "trap" || definition.name === "tesla") {
      const trap = definition.name === "trap";
      if (!trap && !context.rerelease) state.viewModel = state.frame > 1 && state.frame < 9 ? "models/weapons/v_tesla2/tris.md2" : null;
      const throwing: Q2ThrowDefinition = { soundFrame: trap ? 5 : 99, holdFrame: trap ? 11 : 1, fireFrame: trap ? 12 : 2,
        cockSound: "weapons/trapcock.wav", holdSound: trap ? "weapons/traploop.wav" : "", explode: trap && !context.rerelease,
        wrapBeforePause: !trap, releaseHeld: !trap, fire: (current, held) => this.throw(current, weapons, held) };
      if (context.rerelease) weapons.throwRerelease(context, throwing); else weapons.throwClassic(context, throwing);
      return undefined;
    }
    if (context.rerelease) {
      weapons.genericRerelease(context);
      if (state.primaryHandoff === "holstered") return undefined;
      if (definition.name === "chainfist") {
        if ((state.frame === 42 || state.frame === 51) && Math.floor(game.host.random() * 8) !== 0 && input.hand !== "center" && game.host.random() < 0.4) {
          const projection = weapons.project(context, { x: 8, y: 8, z: -4 });
          game.host.emit({ kind: "effect", effect: "q2:chainfist_smoke", origin: projection.start, direction: zero, count: 0, color: 0 });
        }
        weapons.setLoop(self, game, state, state.phase === "firing" ? "weapons/sawhit.wav" : state.phase === "dropping" ? "" : "weapons/sawidle.wav");
      }
      return undefined;
    }
    let lastSequence = 0;
    if (definition.name === "chainfist") {
      if (state.frame === 13 || state.frame === 23) state.frame = 32;
      else if ((state.frame === 42 || state.frame === 51) && Math.floor(game.host.random() * 8) !== 0 && input.hand !== "center" && game.host.random() < 0.4) {
        const projection = weapons.project(context, { x: 8, y: 8, z: -4 });
        game.host.emit({ kind: "effect", effect: "q2:chainfist_smoke", origin: projection.start, direction: zero, count: 0, color: 0 });
      }
      weapons.setLoop(self, game, state, state.phase === "firing" ? "weapons/sawhit.wav" : state.phase === "dropping" ? "" : "weapons/sawidle.wav");
    } else if (definition.name === "etf_rifle" && state.phase === "firing" && weapons.ammo(context) <= 0) state.frame = 8;
    else if (definition.name === "heatbeam") {
      if (state.phase === "firing") {
        weapons.setLoop(self, game, state, "weapons/bfg__l1a.wav");
        if (weapons.ammo(context) >= 2 && weapons.continuesAttack(context)) {
          if (state.frame >= 13) state.frame = 9;
          state.viewModel = "models/weapons/v_beamer2/tris.md2";
        } else { state.frame = 13; state.viewModel = null; }
      } else { state.viewModel = null; weapons.setLoop(self, game, state, ""); }
    }
    if (context.rerelease) weapons.genericRerelease(context); else weapons.genericClassic(context);
    if (state.primaryHandoff === "holstered") return undefined;
    if (definition.name === "etf_rifle" && state.frame === 8 && weapons.continuesAttack(context)) state.frame = 6;
    if (definition.name === "chainfist") {
      if (weapons.continuesAttack(context) && (state.frame === 13 || state.frame === 23 || state.frame === 32)) { lastSequence = state.frame; state.frame = 6; }
      if (state.frame === 6) {
        let chance = game.host.random();
        if (lastSequence === 13) chance -= 0.34;
        else if (lastSequence === 23) chance += 0.33;
        else if (lastSequence === 32 && chance >= 0.33) chance += 0.34;
        if (chance < 0.33) state.frame = 14;
        else if (chance < 0.66) state.frame = 24;
      }
    }
    return undefined;
  };

  private readonly fire = (context: Q2WeaponContext, weapons: Q2Weapons): undefined => {
    switch (context.definition.name) {
      case "ionripper": return this.ion(context, weapons);
      case "phalanx": return this.phalanx(context, weapons);
      case "etf_rifle": return this.etf(context, weapons);
      case "disintegrator": return this.tracker(context, weapons);
      case "heatbeam": return this.heat(context, weapons);
      case "chainfist": return this.chainfist(context, weapons);
      case "proxlauncher": return this.prox(context, weapons);
      default: throw new Error(`No mission-pack fire callback for ${context.definition.name}`);
    }
  };

  private throw(context: Q2WeaponContext, weapons: Q2Weapons, held: boolean): undefined {
    const { self, game, input, state } = context, trap = context.definition.name === "trap";
    if (context.rerelease) {
      const timer = state.grenadeTime - context.now, duration = trap ? 5 : 3, minimum = trap ? 300 : 400, maximum = trap ? 700 : 800;
      const speed = Math.trunc((game.host.combat.read(self.actor.id)?.health ?? 0) <= 0 ? minimum : Math.min(minimum + (duration - timer) * (maximum - minimum) / duration, maximum));
      const projection = weapons.project(context, trap ? { x: 8, y: 0, z: -8 } : { x: 0, y: 0, z: -22 }, { ...input.angles, x: Math.max(-62.5, input.angles.x) });
      state.grenadeTime = 0;
      if (trap) this.projectiles.fireTrap(self, game, projection.start, projection.direction, 125 * weapons.multiplier(context), speed, 1, 165, held);
      else this.projectiles.fireTesla(self, game, projection.start, projection.direction, weapons.multiplier(context), speed);
      return weapons.consume(context, 1, false);
    }
    const timer = state.grenadeTime - context.now, charged = 400 + (3 - timer) * 400 / 3;
    const speed = Math.trunc(trap ? charged : Math.min(800, charged)), axes = angleVectors(input.angles);
    const projection = weapons.project(context, { x: 8, y: 8, z: -8 });
    if (trap) this.projectiles.fireTrap(self, game, projection.start, projection.direction, 125 * weapons.multiplier(context), speed, timer, 165, held);
    else {
      const side = input.hand === "left" ? 4 : input.hand === "center" ? 0 : -4;
      const start = add(add(game.body(self).origin, scale(axes.right, side)), scale(axes.up, self.viewHeight - 22));
      this.projectiles.fireTesla(self, game, start, axes.forward, weapons.multiplier(context), speed);
    }
    weapons.consume(context, 1, !trap); state.grenadeTime = context.now + 1;
    if (trap && weapons.ammo(context) === 0 && !held) weapons.noAmmo(context, false);
    if (!trap) weapons.animation(context, input.ducked ? "attack" : "reverse", input.ducked ? 159 : 119, input.ducked ? 162 : 112);
    return undefined;
  }

  private prox(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, state, input } = context, projection = weapons.project(context, { x: 8, y: context.rerelease ? 0 : 8, z: -8 }, context.rerelease ? { ...input.angles, x: Math.max(-62.5, input.angles.x) } : input.angles);
    weapons.kick(context, scale(angleVectors(input.angles).forward, -2), { x: -1, y: 0, z: 0 });
    this.projectiles.fireProx(self, game, projection.start, projection.direction, weapons.multiplier(context), 600);
    weapons.flash(context, context.rerelease ? 31 : 6); if (!context.rerelease) state.frame++;
    weapons.playerNoise(self, game, projection.start, "weapon"); return weapons.consume(context);
  }

  private ion(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, input, state } = context;
    const aim = { ...input.angles, y: input.angles.y + game.host.random() * 2 - 1 };
    const projection = weapons.project(context, { x: 16, y: 7, z: -8 }, aim);
    weapons.kick(context, scale(angleVectors(context.rerelease ? input.angles : aim).forward, -3), { x: -3, y: 0, z: 0 });
    this.projectiles.fireIonRipper(self, game, projection.start, projection.direction, (game.options.mode === "deathmatch" ? 30 : 50) * weapons.multiplier(context), 500, 0x100000);
    weapons.flash(context, 16); if (!context.rerelease) state.frame++;
    weapons.playerNoise(self, game, projection.start, "weapon"); return weapons.consume(context);
  }

  private phalanx(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, input, state } = context, second = state.frame === 8, multiplier = weapons.multiplier(context);
    const damage = (70 + Math.floor(game.host.random() * 10)) * multiplier;
    const angles = { ...input.angles, y: input.angles.y + (second ? -1.5 : 1.5) };
    const projection = weapons.project(context, { x: 0, y: 8, z: -8 }, context.rerelease ? angles : input.angles);
    const direction = context.rerelease ? projection.direction : angleVectors(angles).forward;
    weapons.kick(context, scale(angleVectors(input.angles).forward, -2), { x: -2, y: 0, z: 0 });
    this.projectiles.firePlasma(self, game, projection.start, direction, damage, 725, 120, second ? 30 : 120 * multiplier);
    if (second) { weapons.consume(context); if (context.rerelease) weapons.flash(context, 20); }
    else { weapons.flash(context, 18); weapons.playerNoise(self, game, projection.start, "weapon"); }
    if (!context.rerelease) state.frame++; return undefined;
  }

  private etf(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, input, state } = context;
    if (context.rerelease) {
      if (!weapons.continuesAttack(context)) { state.frame = 8; return undefined; }
      state.frame = state.frame === 6 ? 7 : 6;
    }
    if (weapons.ammo(context) < context.definition.quantity) { weapons.kick(context, zero, zero); state.frame = 8; return weapons.noAmmo(context); }
    const random = () => (game.host.random() * 2 - 1) * 0.85;
    const kickOrigin = { x: random(), y: 0, z: 0 }, kickAngles = { x: random(), y: 0, z: 0 };
    kickOrigin.y = random(); kickAngles.y = random(); kickOrigin.z = random(); kickAngles.z = random();
    weapons.kick(context, kickOrigin, kickAngles);
    const axes = angleVectors(input.angles), side = (state.frame === 6 ? 8 : 6) * (input.hand === "left" ? -1 : input.hand === "center" ? 0 : 1);
    const projection = context.rerelease ? weapons.project(context, { x: 15, y: state.frame === 6 ? 8 : 6, z: -8 }, add(input.angles, kickAngles)) : {
      start: add(add(add(add(game.body(self).origin, { x: 0, y: 0, z: self.viewHeight }), scale(axes.forward, 15)), scale(axes.right, side)), scale(axes.up, -8)), direction: axes.forward };
    this.projectiles.fireFlechette(self, game, projection.start, projection.direction, 10 * weapons.multiplier(context), context.rerelease ? 1150 : 750, 3 * weapons.multiplier(context));
    if (context.rerelease) weapons.powerupSound(context);
    weapons.flash(context, context.rerelease && state.frame === 7 ? 32 : 30); weapons.playerNoise(self, game, projection.start, "weapon");
    if (!context.rerelease) state.frame++; weapons.consume(context, context.definition.quantity, context.rerelease); return weapons.attackAnimation(context);
  }

  private tracker(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, state, input } = context, projection = weapons.project(context, { x: 24, y: 8, z: -8 });
    const end = add(projection.start, scale(projection.direction, 8192));
    let mask = context.rerelease ? 0x46004003 : 0x6000003;
    if (context.rerelease && !input.playersCollide) mask &= ~0x40000000;
    const restore = context.rerelease && weapons.hooks.lagCompensation.kind === "history" ? weapons.hooks.lagCompensation.begin(self.actor.id, projection.start, projection.direction) : null;
    let trace: import("../../../../contracts/scene.ts").TraceResult;
    try { trace = game.host.trace({ start: projection.start, end, bounds: null, ignore: self.actor.id, mask }); }
    finally { restore?.(); }
    if (trace.hit.kind !== "actor" || trace.hit.actor === game.host.worldActor())
      trace = game.host.trace({ start: projection.start, end, bounds: { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }, ignore: self.actor.id, mask });
    const actor = trace.hit.kind === "actor" ? trace.hit.actor : null;
    const enemy = actor !== null && (game.host.isMonster(actor) || game.host.isPlayer(actor) || game.entity(actor)?.damageableTarget === true) && (game.host.combat.read(actor)?.health ?? 0) > 0 ? actor : null;
    weapons.kick(context, scale(angleVectors(input.angles).forward, -2), { x: -1, y: 0, z: 0 });
    this.projectiles.fireTracker(self, game, projection.start, projection.direction, (context.rerelease ? game.options.mode === "deathmatch" ? 45 : 135 : game.options.mode === "deathmatch" ? 30 : 45) * weapons.multiplier(context), 1000, enemy);
    weapons.hooks.emit({ kind: "muzzleflash", actor: self.actor.id, flash: 35, silenced: context.rerelease && context.silenced });
    weapons.playerNoise(self, game, projection.start, "weapon"); if (!context.rerelease) state.frame++;
    return weapons.consume(context, context.definition.quantity, context.rerelease);
  }

  private heat(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, state } = context, projection = weapons.project(context, { x: 7, y: 2, z: -3 });
    if (context.rerelease) {
      if (!weapons.continuesAttack(context) || weapons.ammo(context) < 2) {
        state.frame = 13; state.viewSkin = 0; weapons.setLoop(self, game, state, "");
        return weapons.continuesAttack(context) ? weapons.noAmmo(context) : undefined;
      }
      state.frame = state.frame > 12 || state.frame === 11 ? 8 : state.frame + 1;
      state.viewSkin = 1; weapons.setLoop(self, game, state, "weapons/bfg__l1a.wav"); weapons.powerupSound(context);
    } else { state.frame++; state.viewModel = "models/weapons/v_beamer2/tris.md2"; }
    weapons.kick(context, zero, zero);
    const restore = context.rerelease && weapons.hooks.lagCompensation.kind === "history" ? weapons.hooks.lagCompensation.begin(self.actor.id, projection.start, projection.direction) : null;
    try { this.projectiles.fireHeatBeam(self, game, projection.start, projection.direction, { x: 2, y: 7, z: -3 }, 15 * weapons.multiplier(context), (game.options.mode === "deathmatch" ? 75 : 30) * weapons.multiplier(context)); }
    finally { restore?.(); }
    weapons.flash(context, 33); weapons.playerNoise(self, game, projection.start, "weapon"); weapons.consume(context);
    return weapons.attackAnimation(context);
  }

  private chainfistRerelease(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    const { self, game, state } = context;
    if (!weapons.continuesAttack(context) && (state.frame === 13 || state.frame === 23 || state.frame >= 32)) { state.frame = 33; return undefined; }
    const projection = weapons.project(context, { x: 0, y: 0, z: -4 }), own = game.body(self);
    const ownMin = add(own.origin, own.bounds.min), ownMax = add(own.origin, own.bounds.max);
    const closest = (point: Vec3, min: Vec3, max: Vec3): Vec3 => ({ x: Math.max(min.x, Math.min(max.x, point.x)), y: Math.max(min.y, Math.min(max.y, point.y)), z: Math.max(min.z, Math.min(max.z, point.z)) });
    let count = 0, hit = false;
    for (const actor of game.host.actors.observations()) {
      if (actor.id === self.actor.id || game.host.combat.read(actor.id)?.canTakeDamage !== true) continue;
      const body = game.host.bodies.read(actor.id), target = game.entity(actor.id);
      if (body === null || target?.solid === "none" || target?.solid === "trigger") continue;
      const min = add(body.origin, body.bounds.min), max = add(body.origin, body.bounds.max);
      if (min.x > ownMax.x + 23 || max.x < ownMin.x - 23 || min.y > ownMax.y + 23 || max.y < ownMin.y - 23 || min.z > ownMax.z + 23 || max.z < ownMin.z - 23) continue;
      const point = closest(projection.start, min, max), near = closest(point, ownMin, ownMax);
      if (length(subtract(point, near)) > 24) continue;
      const intersect = min.x + 2 <= ownMax.x - 2 && max.x - 2 >= ownMin.x + 2 && min.y + 2 <= ownMax.y - 2 && max.y - 2 >= ownMin.y + 2 && min.z + 2 <= ownMax.z - 2 && max.z - 2 >= ownMin.z + 2;
      if (!intersect && dot(normalize(subtract(scale(add(min, max), 0.5), projection.start)), projection.direction) < 0.7) continue;
      if (++count > 4) break;
      const visible = target === null ? game.canDamage(actor.id, self) : game.canDamage(self.actor.id, target);
      if (!visible) continue;
      const monster = this.projectiles.hooks.monster(actor.id);
      if (monster !== null) monster.state.painTime -= 0.005 + game.host.random() * 0.07;
      game.damage(actor.id, self.actor.id, self.actor.id, (game.options.mode === "deathmatch" ? 15 : 7) * weapons.multiplier(context), 50,
        projection.direction, point, scale(projection.direction, -1), mod.chainfist, 64 | 8, "q2:weapon_chainfist");
      hit = true;
    }
    if (hit && state.emptySoundTime < context.now) { state.emptySoundTime = context.now + 0.5; game.sound(self, "weapons/sawslice.wav", 1); }
    weapons.playerNoise(self, game, projection.start, "weapon"); state.frame++;
    if (weapons.continuesAttack(context)) {
      if (state.frame === 12) state.frame = 14;
      else if (state.frame === 22) state.frame = 24;
      else if (state.frame >= 32) state.frame = 7;
    }
    return weapons.attackAnimation(context);
  }

  private chainfist(context: Q2WeaponContext, weapons: Q2Weapons): undefined {
    if (context.rerelease) return this.chainfistRerelease(context, weapons);
    const { self, game, input, state } = context, projection = weapons.project(context, { x: 0, y: 8, z: -4 });
    const axes = angleVectors(input.angles);
    weapons.kick(context, scale(axes.forward, -2), { x: -1, y: 0, z: 0 });
    const trace = game.host.trace({ start: projection.start, end: add(projection.start, scale(projection.direction, 64)), bounds: null, ignore: self.actor.id, mask: 0x6000003 });
    if (trace.fraction < 1) {
      const target = trace.hit.kind === "actor" ? trace.hit.actor : null;
      if (target !== null && game.host.combat.read(target)?.canTakeDamage === true) {
        velocity(game, self.actor.id, add(add(game.body(self).velocity, scale(axes.forward, 75)), scale(axes.up, 75)));
        game.damage(target, self.actor.id, self.actor.id, (game.options.mode === "deathmatch" ? 30 : 15) * weapons.multiplier(context), 50,
          zero, game.host.bodies.read(target)?.origin ?? trace.end, zero, mod.chainfist, 64 | 8, "q2:weapon_chainfist");
      } else game.host.emit({ kind: "effect", effect: "q2:gunshot", origin: trace.end, direction: trace.contact.kind === "plane" ? trace.contact.plane.normal : zero, count: 0, color: 0 });
    }
    weapons.playerNoise(self, game, projection.start, "weapon"); if (!context.rerelease) state.frame++;
    return undefined;
  }
}
