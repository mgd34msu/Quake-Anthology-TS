import { expect, test } from 'bun:test';
import { PlayerStateT } from '../../../src/network/q2/state.ts';
import { toQ2Player, toQ2RereleasePlayer, toQ2RereleaseCommand } from '../../../src/network/q2/adapters.ts';
import { KexPmTypeT, PMF_DUCKED } from '../../../src/movement/q2/types.ts';
import { q2RereleaseViewContinuous, Q2RereleaseViewHeight, q2RemoteViewHeight, q2RemoteViewPosition, q2RemoteBodyBounds, q2RemoteCommand } from '../../../src/app/bootstrap/network/q2-remote-view.ts';

const origin = { x: 100, y: 200, z: 300 };
test('rerelease stance stays separate from bob and damage offset in remote projection', () => {
  const wire = new PlayerStateT(); wire.pmove.originF.set([100, 200, 300]); wire.pmove.viewheight = 22; wire.viewoffset.set([2, -3, 4]);
  const standing = toQ2RereleasePlayer(wire), view = q2RemoteViewPosition(standing, origin, standing.viewOffset, q2RemoteViewHeight(standing));
  expect(view).toEqual({ origin: { x: 102, y: 197, z: 304 }, viewHeight: 22 });
  expect(q2RemoteBodyBounds(standing)).toEqual({ min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
  wire.pmove.pm_flags = PMF_DUCKED; wire.pmove.viewheight = -2;
  const crouched = toQ2RereleasePlayer(wire);
  expect(q2RemoteViewPosition(crouched, origin, crouched.viewOffset, q2RemoteViewHeight(crouched))).toEqual({ origin: view.origin, viewHeight: -2 });
  expect(q2RemoteBodyBounds(crouched).max.z).toBe(4); expect(crouched.movement.origin).toEqual(origin);
  wire.pmove.pm_type = KexPmTypeT.PM_GIB; wire.pmove.viewheight = 8;
  expect(q2RemoteBodyBounds(toQ2RereleasePlayer(wire))).toEqual({ min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 16 } });
});

test('classic viewoffset contributes eye height once', () => {
  const wire = new PlayerStateT(); wire.viewoffset.set([2, -3, 22]);
  const player = toQ2Player(wire);
  expect(q2RemoteViewPosition(player, origin, player.viewOffset, q2RemoteViewHeight(player))).toEqual({ origin: { x: 102, y: 197, z: 300 }, viewHeight: 22 });
});

test('rerelease remote input subtracts float source deltas before short wire encoding', () => {
  const wire = new PlayerStateT(); wire.pmove.deltaAngleEncoding = 'float'; wire.pmove.delta_anglesF.set([11.25, 45, -22.5]);
  const player = toQ2RereleasePlayer(wire);
  const command = q2RemoteCommand({ kind: 'q2-rerelease', angles: { x: 22.5, y: 90, z: 0 }, milliseconds: 25, forwardMove: 200, sideMove: 0, buttons: 0, serverFrame: 7 }, player);
  expect(toQ2RereleaseCommand(command, 7).angles).toEqual({ x: 11.25, y: 45, z: 22.5 });
  expect(command.forwardmove).toBe(200);
});

test('rerelease stance uses source 100ms targets, including reversal and activation reset', () => {
 const height = new Q2RereleaseViewHeight();
 expect(height.sample(22, 0)).toBe(22);
 expect(height.sample(-2, 100)).toBe(22);
 expect(height.sample(-2, 150)).toBe(10);
 expect(height.sample(22, 150)).toBe(-2);
 expect(height.sample(22, 200)).toBe(10);
 const beforeWire = new PlayerStateT(), afterWire = new PlayerStateT();
 afterWire.pmove.originF[0] = 257;
 expect(q2RereleaseViewContinuous(toQ2RereleasePlayer(beforeWire), toQ2RereleasePlayer(afterWire), 1, 2, 0)).toBe(false);
 // Teleport duplicates old playerstate; source camera transition state survives it.
 expect(height.sample(22, 225)).toBe(16);
 expect(height.sample(22, 250)).toBe(22);
 height.reset();
 expect(height.sample(-2, 0)).toBe(-2);
});
