import type { Q2WeaponDefinition, Q2WeaponState } from "./types.ts";

export type Q2GenericFrameState = Pick<Q2WeaponState, "phase" | "frame" | "latchedAttack" | "sourceFiring" | "thinkTime" | "fireFinished" | "fireBuffered" | "lastFiringTime">;
export type Q2GenericDefinition = Pick<Q2WeaponDefinition, "name" | "activateLast" | "fireLast" | "idleLast" | "deactivateLast" | "pauses" | "fires" | "quantity" | "repeating">;
export interface Q2ClassicFrameInput { readonly attack: boolean; readonly changeRequested: boolean; }
export interface Q2RereleaseFrameInput extends Q2ClassicFrameInput {
  readonly now: number;
  readonly frameSeconds: number;
  readonly instantSwitch: boolean;
  readonly holster: boolean;
  readonly weaponThunk: boolean;
}
export interface Q2ClassicFrameHooks {
  random(): number;
  ammo(): number;
  noAmmo(): undefined;
  fire(buffered: boolean): undefined;
  changeWeapon(): undefined;
  reverseAnimation(): undefined;
  attackAnimation(): undefined;
  powerupSound(): undefined;
}
export interface Q2RereleaseFrameHooks extends Q2ClassicFrameHooks {
  animationTime(): number;
  prepareDrop(): undefined;
}
export function millisecondSum(time: number, seconds: number): number { return (Math.round(time * 1000) + Math.round(seconds * 1000)) / 1000; }

export function stepQ2ClassicFrame(state: Pick<Q2GenericFrameState, "phase" | "frame" | "latchedAttack" | "sourceFiring">, d: Q2GenericDefinition, input: Q2ClassicFrameInput, hooks: Q2ClassicFrameHooks): undefined {
    const idleFirst = d.fireLast + 1;
    if (state.phase === "dropping") {
      if (state.frame === d.deactivateLast) return hooks.changeWeapon();
      if (d.deactivateLast - state.frame === 4) hooks.reverseAnimation();
      state.frame++; return undefined;
    }
    if (state.phase === "activating") {
      if (state.frame === d.activateLast) { state.phase = "ready"; state.frame = idleFirst; }
      else state.frame++;
      return undefined;
    }
    if (input.changeRequested && state.phase !== "firing") {
      state.phase = "dropping"; state.frame = d.idleLast + 1;
      if (d.deactivateLast - state.frame < 4) hooks.reverseAnimation();
      return undefined;
    }
    if (state.phase === "ready") {
      if (input.attack || state.latchedAttack) {
        state.latchedAttack = false;
        if (hooks.ammo() < d.quantity) return hooks.noAmmo();
        state.frame = d.activateLast + 1; state.phase = "firing";
        hooks.attackAnimation();
      } else {
        if (state.frame === d.idleLast) { state.frame = idleFirst; return undefined; }
        if (d.pauses.includes(state.frame) && Math.floor(hooks.random() * 16) !== 0) return undefined;
        state.frame++; return undefined;
      }
    }
    if (state.phase === "firing") {
      if (d.fires.includes(state.frame)) { state.sourceFiring = true; hooks.powerupSound(); hooks.fire(false); }
      else state.frame++;
      if (state.frame === idleFirst + 1) state.phase = "ready";
    }
    return undefined;
}

export function stepQ2RereleaseFrame(state: Q2GenericFrameState, d: Q2GenericDefinition, input: Q2RereleaseFrameInput, hooks: Q2RereleaseFrameHooks): undefined {
  const now = input.now;
    const idleFirst = d.fireLast + 1, idleLast = d.name === "bfg" ? 54 : d.idleLast;
    if (state.phase === "dropping") {
      if (state.thinkTime <= now) {
        if (state.frame === d.deactivateLast) return hooks.changeWeapon();
        if (d.deactivateLast - state.frame === 4) hooks.reverseAnimation();
        state.frame++; state.thinkTime = millisecondSum(now, hooks.animationTime());
      }
      return undefined;
    }
    if (state.phase === "activating") {
      if (state.thinkTime <= now || input.instantSwitch) {
        state.thinkTime = millisecondSum(now, hooks.animationTime());
        if (state.frame === d.activateLast || input.instantSwitch) {
          state.phase = "ready"; state.frame = idleFirst; state.fireBuffered = false;
          state.fireFinished = input.instantSwitch ? 0 : millisecondSum(now, hooks.animationTime());
        } else state.frame++;
        return undefined;
      }
    }
    if ((input.changeRequested || !input.instantSwitch && input.holster) && state.phase !== "firing") {
      if (input.instantSwitch || state.thinkTime <= now) {
        hooks.prepareDrop();
        state.phase = "dropping";
        if (input.instantSwitch) return hooks.changeWeapon();
        state.frame = idleLast + 1;
        if (d.deactivateLast - state.frame < 4) hooks.reverseAnimation();
        state.thinkTime = millisecondSum(now, hooks.animationTime());
      }
      return undefined;
    }
    if (state.phase === "ready") {
      if ((state.fireBuffered || state.latchedAttack || input.attack) && state.fireFinished <= now) {
        state.latchedAttack = false; state.thinkTime = now;
        if (hooks.ammo() < d.quantity) return hooks.noAmmo();
        state.phase = "firing"; state.lastFiringTime = millisecondSum(now, 2.5);
        if (!d.repeating) {
          state.frame = d.activateLast + 1; state.fireBuffered = false;
          state.thinkTime = millisecondSum(state.thinkTime, (input.weaponThunk ? input.frameSeconds : 0) + hooks.animationTime());
          state.fireFinished = millisecondSum(now, hooks.animationTime());
          if (d.fires.includes(state.frame)) { hooks.powerupSound(); hooks.fire(false); }
          hooks.attackAnimation();
          return undefined;
        }
      } else if (state.thinkTime <= now) {
        state.thinkTime = millisecondSum(now, hooks.animationTime());
        if (state.frame === idleLast) { state.frame = idleFirst; return undefined; }
        if (!d.pauses.includes(state.frame) || Math.floor(hooks.random() * 16) === 0) state.frame++;
        return undefined;
      }
    }
    if (state.phase === "firing" && state.thinkTime <= now) {
      state.lastFiringTime = millisecondSum(now, 2.5);
      if (!d.repeating) state.frame++;
      state.fireFinished = millisecondSum(now, hooks.animationTime());
      const buffered = state.fireBuffered;
      state.fireBuffered = false;
      if (d.repeating) hooks.fire(buffered);
      else if (d.fires.includes(state.frame) && !(d.name === "shotgun" && state.frame === 9)) { hooks.powerupSound(); hooks.fire(buffered); }
      if (state.frame === idleFirst) { state.phase = "ready"; state.fireBuffered = false; }
      state.thinkTime = millisecondSum(now, hooks.animationTime() + (d.repeating && input.weaponThunk ? input.frameSeconds : 0));
    }
    return undefined;
}
