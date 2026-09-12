/** Native ClientThink / ClientBeginServerFrame weapon command continuation. */
export interface Q2WeaponTurnState {
  buttons: number;
  latchedButtons: number;
  weaponThunk: boolean;
}

export function latchQ2WeaponButtons(state: Q2WeaponTurnState, buttons: number): undefined {
  state.latchedButtons |= buttons & ~state.buttons;
  state.buttons = buttons;
}

export function earlyQ2WeaponTurn(state: Q2WeaponTurnState, tick: (latchedAttack: boolean) => undefined): undefined {
  if ((state.latchedButtons & 1) !== 0 && !state.weaponThunk) {
    state.weaponThunk = true;
    tick(true);
  }
}

export function beginQ2WeaponTurn(state: Q2WeaponTurnState, allowed: boolean, tick: (latchedAttack: boolean) => undefined): undefined {
  if (allowed && !state.weaponThunk) tick((state.latchedButtons & 1) !== 0);
  else state.weaponThunk = false;
}
