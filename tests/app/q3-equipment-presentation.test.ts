import { expect, test } from "bun:test";
import { q3EquipmentCommand } from "../../src/app/bootstrap/q3-client/equipment.ts";
import { PlayerStateRecord } from "../../src/network/q3/state/player.ts";
import { ClientGameState } from "../../src/content/q3/presentation/state.ts";
import { ClientWeaponSelection } from "../../src/content/q3/presentation/weapons.ts";
import { retailSnapshot } from "../../src/content/q3/presentation/retail-snapshot.ts";

test("selected arsenal retains the source predicted weapon and movement while taking attack input", () => {
  const command = { serverTime: 50, angles: [10, 20, 30] satisfies [number, number, number], buttons: 9, weapon: 7, forwardmove: 100, rightmove: -25, upmove: 127 };
  expect(q3EquipmentCommand(command, null)).toBe(command);
  expect(q3EquipmentCommand(command, { primaryWeapon: 2, warning: "none" })).toEqual({ ...command, weapon: 2, buttons: 8 });
  expect(command.buttons).toBe(9); expect(command.weapon).toBe(7);
});

test("accepted source weapon commands publish same-weapon intent without admitting unowned weapons", () => {
  const player = new PlayerStateRecord<number, number, number>("baseq3", 0, 2, 0);
  player.stats.set(2, (1 << 2) | (1 << 3)); player.ammo.set(2, 50); player.ammo.set(3, 10);
  const state = new ClientGameState("baseq3", 0, 0), selected: number[] = [];
  state.snap = retailSnapshot({ messageNumber: 1, serverTime: 50, deltaNumber: -1, flags: 0, serverCommandNumber: 0,
    parseEntitiesNumber: 0, playerState: player, entities: [], areaMask: new Uint8Array(32) });
  state.weaponSelect = 2;
  const weapons = new ClientWeaponSelection(state, weapon => { selected.push(weapon); });
  weapons.selectWeapon(2); weapons.selectWeapon(2); weapons.selectWeapon(4); weapons.selectWeapon(0);
  expect(selected).toEqual([2, 2]); expect(state.weaponSelect).toBe(2);
  weapons.nextWeapon(); weapons.previousWeapon();
  expect(selected).toEqual([2, 2, 3, 2]); expect(state.weaponSelect).toBe(2);
});
