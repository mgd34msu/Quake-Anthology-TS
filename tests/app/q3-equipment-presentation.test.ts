import { expect, test } from "bun:test";
import { q3PresentationSnapshot } from "../../src/app/bootstrap/q3-client/equipment.ts";
import type { Snapshot } from "../../src/network/q3/server-message.ts";
import { PlayerStateRecord } from "../../src/network/q3/state/player.ts";
import { EntityState } from "../../src/network/q3/state/entity.ts";
import { ClientGameState } from "../../src/content/q3/presentation/state.ts";
import { ClientWeaponSelection } from "../../src/content/q3/presentation/weapons.ts";
import { retailSnapshot } from "../../src/content/q3/presentation/retail-snapshot.ts";

test("shared hook HUD detaches native weapon presentation without changing source weapon ownership", () => {
  const player = new PlayerStateRecord<number, number, number>("baseq3", 0, 2, 3);
  player.stats.set(2, 1 << 2); player.ammo.set(2, 87); player.weaponTime = 99;
  const snapshot: Snapshot = { messageNumber: 1, serverTime: 50, deltaNumber: -1, flags: 0, serverCommandNumber: 0,
    parseEntitiesNumber: 0, playerState: player, entities: [], areaMask: new Uint8Array(32) };
  for (const primaryWeapon of [2, 3]) {
    const projected = q3PresentationSnapshot(snapshot, { primaryWeapon });
    expect(projected.playerState.weapon).toBe(0);
    expect(projected.playerState.ammo.get(0)).toBe(-1);
    expect(projected.playerState.stats.get(2)).toBe(1 << 2);
    expect(projected.playerState.weaponTime).toBe(0);
    expect(player.weapon).toBe(2); expect(player.ammo.get(2)).toBe(87);
    expect(player.ammo.get(0)).toBe(0); expect(player.stats.get(2)).toBe(1 << 2);
  }
  expect(q3PresentationSnapshot(snapshot, null)).toBe(snapshot);
});

test("body overrides leave source snapshot flags, collision and weapon state untouched", () => {
  const player = new PlayerStateRecord<number, number, number>("baseq3", 0, 5, 0); player.clientNum = 1;
  const entity = new EntityState(); entity.number = 1; entity.eFlags = 2; entity.solid = 123;
  const snapshot: Snapshot = { messageNumber: 1, serverTime: 50, deltaNumber: -1, flags: 0, serverCommandNumber: 0,
    parseEntitiesNumber: 0, playerState: player, entities: [entity], areaMask: new Uint8Array(32) };
  const projected = q3PresentationSnapshot(snapshot, null);
  expect(projected).toBe(snapshot);
  expect(projected.entities[0]?.eFlags).toBe(2); expect(projected.entities[0]?.solid).toBe(123);
  expect(projected.playerState.eFlags).toBe(0); expect(projected.playerState.weapon).toBe(5);
  expect(entity.eFlags).toBe(2); expect(player.eFlags).toBe(0);
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
