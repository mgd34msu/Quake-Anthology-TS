import { expect, test } from 'bun:test';
import type { Q2WorldGeometry } from '../../../src/contracts/scene.ts';
import { createSceneQueries } from '../../../src/world/collision/index.ts';
import { packQ2Solid } from '../../../src/network/q2/solid.ts';
import { PlayerStateT, EntityStateT } from '../../../src/network/q2/state.ts';
import { mvdProfile } from '../../../src/network/q2/mvd-profile.ts';
import { q2MvdLayout, q2MvdVisibility } from '../../../src/app/bootstrap/network/q2-mvd-presentation.ts';

test('MVD profile chooses recorded config layout independently of live protocol defaults', () => {
  expect(q2MvdLayout(mvdProfile(2010, 0)).maxConfigStrings).toBe(2080);
  const extended = q2MvdLayout(mvdProfile(2013, 12));
  expect([extended.images, extended.lights, extended.items, extended.playerSkins, extended.maxConfigStrings]).toEqual([10302, 12350, 12606, 12862, 13630]);
  expect(q2MvdLayout(mvdProfile(3038, 0)).maxConfigStrings).toBe(12448);
});

test('MVD uses actual shared BSP portal connectivity, PVS/PHS and inline sound midpoint', () => {
  const bounds = { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }, empty = { first: 0, count: 0 };
  const world: Q2WorldGeometry = {
    kind: 'q2-bsp', format: 'ibsp38', entities: '', planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }],
    vertices: [], edges: [], surfaceEdges: [], nodes: [{ plane: 0, children: [{ kind: 'leaf', index: 0 }, { kind: 'leaf', index: 1 }], bounds, faces: empty }],
    leaves: [0, 1].map(index => ({ contents: 0, mergedContents: 0, cluster: index, area: index + 1, bounds, faces: empty, brushes: empty })),
    leafFaces: [], leafBrushes: [], textureInfo: [], faces: [], brushes: [], brushSides: [],
    models: [{ bounds, origin: { x: 0, y: 0, z: 0 }, headnode: 0, faces: empty }, { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 12, z: 16 } }, origin: { x: 0, y: 0, z: 0 }, headnode: 0, faces: empty }],
    areas: [{ portals: empty }, { portals: { first: 0, count: 1 } }, { portals: { first: 1, count: 1 } }],
    areaPortals: [{ portal: 0, otherArea: 2 }, { portal: 0, otherArea: 1 }],
    visibility: { clusters: [{ pvsOffset: 0, phsOffset: 1 }, { pvsOffset: 2, phsOffset: 3 }], compressed: Uint8Array.of(1, 3, 2, 3) },
    lighting: { kind: 'luminance8', samples: new Uint8Array() }, lightgrid: null, decoupledLightmaps: null, extensions: [],
  };
  const scene = createSceneQueries(world), player = new PlayerStateT(); player.pmove.origin[0] = -8;
  const visibility = q2MvdVisibility({ profile: mvdProfile(2010, 0), scene: () => scene, modelPath: index => index === 1 ? '*1' : undefined });
  expect(visibility.visible(0, 'phs', player, Uint8Array.of(0))).toBe(false);
  expect(visibility.visible(0, 'phs', player, Uint8Array.of(1))).toBe(true);
  expect(visibility.visible(0, 'pvs', player, Uint8Array.of(1))).toBe(false);
  expect(visibility.visible(0, 'phs', player, new Uint8Array())).toBe(true);
  expect(visibility.soundAudible([1, 0, 0], player, Uint8Array.of(1))).toBe(true);
  expect(visibility.areaBits(player, Uint8Array.of(1))[0]).toBe(6);
  const entity = new EntityStateT(); entity.solid = 31; entity.modelindex = 1; entity.origin[0] = 10;
  expect(visibility.soundOrigin(entity)).toEqual([14, 6, 8]);
  expect(() => visibility.visible(2, 'pvs', player, Uint8Array.of(1))).toThrow('outside the admitted BSP');
  player.pmove.origin[0] = -800;
  const state = (number: number, x: number): EntityStateT => { const value = new EntityStateT(); value.number = number; value.modelindex = 2; value.origin[0] = x; return value; };
  const hidden = state(1, 10), beam = state(2, 10); beam.renderfx = 128;
  const straddling = state(3, 10); straddling.solid = packQ2Solid({ min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 24 } }, 'short');
  const farEffect = state(4, -1000); farEffect.modelindex = 0; farEffect.effects = 1;
  const farSound = state(5, -1000); farSound.modelindex = 0; farSound.sound = 1;
  const globalSound = state(6, -1000); globalSound.modelindex = 0; globalSound.sound = 1; globalSound.loop_attenuation = -1;
  const shadow = state(7, 10); shadow.renderfx = 16384;
  const rotated = state(8, 6); rotated.modelindex = 1; rotated.solid = 31; rotated.angles[2] = 90;
  const all = [hidden, beam, straddling, farEffect, farSound, globalSound, shadow, rotated];
  expect(visibility.entities(all, player, Uint8Array.of(1)).map(value => value.number)).toEqual([2, 3, 6, 7, 8]);
  expect(visibility.entities([beam, shadow], player, Uint8Array.of(0))).toEqual([]);
  expect(all[0]).toBe(hidden); expect(hidden.sound).toBe(0);

});
