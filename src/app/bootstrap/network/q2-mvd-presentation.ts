import type { Bounds, Vec3 } from '../../../contracts/math.ts';
import type { MvdProfile } from '../../../network/q2/mvd-profile.ts';
import type { MvdVisibility } from '../../../network/q2/mvd-playback.ts';
import type { EntityStateT, PlayerStateT } from '../../../network/q2/state.ts';
import { q2SolidEncoding, unpackQ2Solid } from '../../../network/q2/solid.ts';
import { readElement } from '../../../network/q2/index.ts';
import type { createSceneQueries } from '../../../world/collision/index.ts';
import { q2ApplicationLayout, type Q2ApplicationLayout } from './q2-layout.ts';

export function q2MvdLayout(profile: MvdProfile): Q2ApplicationLayout {
  if (!profile.extended || profile.rerelease) return q2ApplicationLayout(profile.protocol);
  return { models: 62, sounds: 8254, images: 10302, lights: 12350, items: 12606, playerSkins: 12862,
    maxModels: 8192, maxSounds: 2048, maxImages: 2048, maxConfigStrings: 13630,
    mapChecksum: 61, maxClients: 60, airAccelerate: 59, n64Physics: null };
}

export function q2MvdVisibility(host: {
  readonly profile: MvdProfile;
  scene(): ReturnType<typeof createSceneQueries>;
  modelPath(index: number): string | undefined;
}): MvdVisibility {
  let appliedScene: ReturnType<typeof createSceneQueries> | null = null;
  let appliedBits = new Uint8Array(0);
  const origin = (player: PlayerStateT): Vec3 => host.profile.rerelease
    ? { x: readElement(player.pmove.originF, 0), y: readElement(player.pmove.originF, 1), z: readElement(player.pmove.originF, 2) }
    : { x: readElement(player.pmove.origin, 0) / 8, y: readElement(player.pmove.origin, 1) / 8, z: readElement(player.pmove.origin, 2) / 8 };
  const sceneWithPortals = (bits: Uint8Array): ReturnType<typeof createSceneQueries> => {
    const scene = host.scene(), geometry = scene.geometry;
    if (geometry.kind !== 'q2-bsp') throw new Error('MVD visibility requires the admitted Q2 BSP');
    if (appliedScene === scene && appliedBits.length === bits.length && appliedBits.every((value, index) => value === bits[index])) return scene;
    for (const portal of new Set(geometry.areaPortals.map(value => value.portal))) {
      // CM_SetPortalStates opens portals beyond the supplied recorded byte count.
      const byte = bits[portal >>> 3];
      scene.setAreaPortalState(portal, byte === undefined || (byte & 1 << (portal & 7)) !== 0);
    }
    appliedScene = scene; appliedBits = bits.slice();
    return scene;
  };
  const visible = (leaf: number, channel: 'pvs' | 'phs', player: PlayerStateT, bits: Uint8Array): boolean => {
    const scene = sceneWithPortals(bits), geometry = scene.geometry;
    if (geometry.kind !== 'q2-bsp' || !Number.isInteger(leaf) || leaf < 0 || leaf >= geometry.leaves.length)
      throw new Error('MVD multicast leaf is outside the admitted BSP');
    const viewer = scene.pointLeaf(origin(player)), cluster = scene.leafCluster(viewer);
    return cluster !== -1 && scene.areasConnected(scene.leafArea(leaf), scene.leafArea(viewer))
      && scene.clusterVisible(scene.leafCluster(leaf), cluster, channel);
  };
  const viewOrigin = (player: PlayerStateT): Vec3 => {
    const point = origin(player);
    return { x: point.x + readElement(player.viewoffset, 0), y: point.y + readElement(player.viewoffset, 1),
      z: point.z + readElement(player.viewoffset, 2) + (host.profile.rerelease ? player.pmove.viewheight : 0) };
  };
  const entityBounds = (entity: EntityStateT): Bounds => {
    const path = host.modelPath(entity.modelindex);
    if (path !== undefined && /^\*[0-9]+$/.test(path)) return host.scene().modelBounds(Number(path.slice(1)));
    if (entity.solid !== 0 && entity.solid !== 31) return unpackQ2Solid(entity.solid, q2SolidEncoding(host.profile.protocol, host.profile.extended));
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  };
  const entities = (states: readonly EntityStateT[], player: PlayerStateT, bits: Uint8Array): readonly EntityStateT[] => {
    const scene = sceneWithPortals(bits), geometry = scene.geometry;
    if (geometry.kind !== 'q2-bsp') throw new Error('MVD entity admission requires the admitted Q2 BSP');
    const point = viewOrigin(player), viewer = scene.pointLeaf(point), area = scene.leafArea(viewer), cluster = scene.leafCluster(viewer);
    const fat = scene.boxLeaves({ min: { x: point.x - 8, y: point.y - 8, z: point.z - 8 }, max: { x: point.x + 8, y: point.y + 8, z: point.z + 8 } }, 64);
    const fatClusters = [...new Set(fat.leaves.map(leaf => scene.leafCluster(leaf)))];
    return states.filter(entity => {
      const shadow = (entity.renderfx & 16384) !== 0, beam = (entity.renderfx & 128) !== 0;
      if (entity.number === 0 || entity.modelindex === 0 && entity.effects === 0 && entity.sound === 0 && entity.event === 0 && !shadow) return false;
      let bounds = entityBounds(entity);
      if (entity.solid === 31 && entity.angles.some(value => value !== 0)) {
        const radius = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.min.y), Math.abs(bounds.min.z), Math.abs(bounds.max.x), Math.abs(bounds.max.y), Math.abs(bounds.max.z));
        bounds = { min: { x: -radius, y: -radius, z: -radius }, max: { x: radius, y: radius, z: radius } };
      }
      const x = readElement(entity.origin, 0), y = readElement(entity.origin, 1), z = readElement(entity.origin, 2);
      const linked = scene.boxLeaves({ min: { x: x + bounds.min.x - 1, y: y + bounds.min.y - 1, z: z + bounds.min.z - 1 },
        max: { x: x + bounds.max.x + 1, y: y + bounds.max.y + 1, z: z + bounds.max.z + 1 } }, 128);
      let firstArea = 0, secondArea = 0;
      for (const leaf of linked.leaves) {
        const next = scene.leafArea(leaf);
        if (next !== 0) { if (firstArea !== 0 && firstArea !== next) secondArea = next; else firstArea = next; }
      }
      if (!scene.areasConnected(area, firstArea) && !scene.areasConnected(area, secondArea)) return false;
      const clusters = [...new Set(linked.leaves.map(leaf => scene.leafCluster(leaf)).filter(value => value !== -1))];
      const inMask = (kind: 'pvs' | 'phs'): boolean => {
        const admitted = (target: number): boolean => kind === 'phs' ? scene.clusterVisible(cluster, target, kind)
          : fatClusters.some(source => scene.clusterVisible(source, target, kind));
        if (linked.leaves.length < 128 && clusters.length <= 16) return clusters.some(admitted);
        if (linked.topnode === null) throw new Error('MVD overflow entity has no BSP topnode');
        const visit = (node: number): boolean => {
          const branch = geometry.nodes[node];
          if (branch === undefined) throw new Error('MVD entity topnode is outside the BSP');
          return branch.children.some(child => child.kind === 'leaf' ? admitted(scene.leafCluster(child.index)) : visit(child.index));
        };
        return visit(linked.topnode);
      };
      if (!inMask(beam || entity.sound !== 0 || shadow ? 'phs' : 'pvs')) return false;
      const distance = Math.hypot(point.x - x, point.y - y, point.z - z);
      if (entity.sound !== 0) {
        const attenuation = entity.loop_attenuation;
        const multiplier = attenuation === -1 ? 0 : attenuation > 0 && attenuation !== 3 ? attenuation * 0.0006 : 0.003;
        if ((distance - 80) * multiplier > 1 && (entity.modelindex === 0 || !beam && !inMask('pvs'))) return false;
      } else if (entity.modelindex === 0 && !shadow && distance > 400) return false;
      return true;
    });
  };
  return {
    visible, entities,
    areaBits: (player, bits) => { const scene = sceneWithPortals(bits); return scene.areaBits(scene.leafArea(scene.pointLeaf(viewOrigin(player)))); },
    soundAudible: (position, player, bits) => visible(host.scene().pointLeaf({ x: position[0], y: position[1], z: position[2] }), 'phs', player, bits),
    soundOrigin: entity => {
      const x = readElement(entity.origin, 0), y = readElement(entity.origin, 1), z = readElement(entity.origin, 2);
      if (entity.solid !== 31) return [x, y, z];
      const path = host.modelPath(entity.modelindex);
      if (path === undefined || !/^\*[0-9]+$/.test(path)) throw new Error('MVD brush sound has no inline model');
      const bounds = host.scene().modelBounds(Number(path.slice(1)));
      return [x + (bounds.min.x + bounds.max.x) / 2, y + (bounds.min.y + bounds.max.y) / 2, z + (bounds.min.z + bounds.max.z) / 2];
    },
  };
}
