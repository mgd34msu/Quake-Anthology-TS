import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ProviderReference } from "../../src/contracts/content.ts";
import type { Q2PlayerState, Q2UserCommand } from "../../src/contracts/protocol.ts";
import type { ActorCommand } from "../../src/contracts/session.ts";
import { classicGuestLocalCommand, classicGuestPlayerUi, classicGuestPlayerView } from "../../src/app/bootstrap/simulation/classic-guest-player.ts";

const source: ProviderReference = { provider: "q2:weapons", content: "q2:classic:baseq2:installed" };
const state: Q2PlayerState = {
  kind: "q2-classic", movement: { kind: "q2-classic", type: 0, originEighths: [800, -1600, 2400], velocityEighths: [0, 0, 0],
    flags: 0, timeEightMilliseconds: 0, gravity: 800, deltaAngleShorts: [16384, 32768, 65535] },
  viewAngles: { x: 10, y: 20, z: 30 }, viewOffset: { x: 2, y: -3, z: 22 }, kickAngles: { x: -4, y: 5, z: 6 },
  gunAngles: { x: 0, y: 0, z: 0 }, gunOffset: { x: 0, y: 0, z: 0 }, gunIndex: 7, gunFrame: 3, fov: 105,
  renderFlags: 0, stats: Array.from({ length: 32 }, (_, index) => index === 1 ? -17 : index === 3 ? 11 : index === 5 ? 23 : 0),
  blend: { x: 0, y: 0, z: 0, w: 0 },
};

test("native public view preserves death height, lateral offset, field of view and one kick contribution", () => {
  const view = classicGuestPlayerView(state);
  expect(view.origin).toEqual({ x: 102, y: -203, z: 300 });
  expect(view.viewHeight).toBe(22);
  expect(view.angles).toEqual(state.viewAngles);
  expect(view.kickAngles).toEqual(state.kickAngles);
  expect(view.fieldOfView).toBe(105);
  expect(classicGuestPlayerView({ ...state, blend: { x: 1, y: 0.3, z: 0.1, w: 0.6 } }).blend).toEqual({ x: 1, y: 0.3, z: 0.1, w: 0.6 });
  const dead = classicGuestPlayerView({ ...state, viewOffset: { x: 0, y: 0, z: -8 }, viewAngles: { x: -15, y: 270, z: 40 } });
  expect(dead.viewHeight).toBe(-8);
  expect(dead.angles).toEqual({ x: -15, y: 270, z: 40 });
});

test("native HUD uses reported stats and leaves private inventory and unknown mod weapons unresolved", () => {
  const configs = new Map([[39, "models/weapons/v_rocket/tris.md2"]]);
  const ui = classicGuestPlayerUi(state, configs, source);
  expect(ui.health).toBe(-17);
  expect(ui.armor).toMatchObject({ kind: "q2", points: 23 });
  expect(ui.activeWeapon).toBe("q2:weapon_rocketlauncher");
  expect(ui.ammo).toEqual({ item: "q2:ammo_rockets", count: 11 });
  expect(ui.weaponStatus?.ammo).toMatchObject({ kind: "finite", count: 11, hasAmmoToStart: true });
  expect(ui.inventory).toEqual([]);
  expect(ui.items).toEqual([]);
  configs.set(39, "models/mod/custom-weapon.md2");
  const mod = classicGuestPlayerUi(state, configs, source);
  expect(mod.health).toBe(-17);
  expect(mod.activeWeapon).toBeNull();
  expect(mod.weaponStatus).toBeNull();
  expect(mod.ammo).toBeNull();
  expect(classicGuestPlayerUi({ ...state, gunIndex: 0 }, configs, source).weaponStatus).toBeNull();
});

test("native local aim removes the source delta once and rejects already-decoded network commands", () => {
  const identity = createIdentityOwner("native-public-command");
  const command: Q2UserCommand = { kind: "q2-classic", milliseconds: 17, angleShorts: [0, 65535, 17], forwardMove: 300,
    sideMove: -125, upMove: 200, buttons: 3, impulse: 9, lightLevel: 128 };
  const input: ActorCommand = { actor: identity.actor(1, 0), source: { kind: "bot", provider: "q2:bot" }, sequence: 9, command };
  const converted = classicGuestLocalCommand(input, state);
  expect(converted).toEqual({ ...command, angleShorts: [49152, 32767, 18] });
  expect(command.angleShorts).toEqual([0, 65535, 17]);
  expect(() => classicGuestLocalCommand({ ...input, source: { kind: "remote-client", client: identity.client(0, 0) } }, state)).toThrow("wire endpoint");
  expect(() => classicGuestLocalCommand({ ...input, command: { kind: "q3", serverTimeMilliseconds: 20, angleWords: [0, 0, 0],
    forwardMove: 0, rightMove: 0, upMove: 0, buttons: 0, weapon: 1 } }, state)).toThrow("classic Quake II");
});
