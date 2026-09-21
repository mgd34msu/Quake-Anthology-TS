// Q3 AAS and bot movement imports over the shared navigation owner. GPL-2.0-or-later.
import type { SourceBotNavigation } from "../../bots/behavior/q3/navigation.ts";
import type { BotLibrary } from "../../bots/behavior/q3/library.ts";
import type { AasBspEntities } from "../../bots/behavior/library/bsp-entities.ts";
import type { BotMovementPrediction } from "../../bots/behavior/q3/navigation-types.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ActorId } from "../../contracts/identity.ts";
import { float32ToBits } from "../../core/numeric.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import { qvmBotInitMoveReference, qvmBotMoveResultReference, qvmBotMovementTarget,
  qvmBotMovementVector, readQvmBotGoalReference, writeQvmAasEntityInfo } from "./bot-navigation-records.ts";
import type { AasEntityInfo } from "./bot-navigation-records.ts";

export interface QvmAasMovementPrediction {
  readonly success: boolean;
  readonly end: Vec3;
  readonly endArea: number;
  readonly velocity: Vec3;
  readonly trace: { readonly startSolid: boolean; readonly fraction: number; readonly end: Vec3;
    readonly entityNum: number; readonly lastArea: number; readonly area: number; readonly plane: number };
  readonly presence: number;
  readonly stopEvent: number;
  readonly endContents: number;
  readonly time: number;
  readonly frames: number;
}
export interface QvmBotNavigationServices {
  readonly navigation: SourceBotNavigation;
  readonly library: BotLibrary;
  readonly bspEntities: AasBspEntities;
  time(): number;
  initialized(): boolean;
  entityInfo(number: number): AasEntityInfo | null;
  predictClientMovement(query: BotMovementPrediction): QvmAasMovementPrediction;
}

/** Preserve selected-provider collision observations while projecting source entity/area identities. */
export function qvmBotMovementPrediction(navigation: SourceBotNavigation, query: BotMovementPrediction,
  entityNumber: (actor: ActorId) => number): QvmAasMovementPrediction {
  const frameTime = query.frameTime <= 0 ? Math.fround(0.1) : query.frameTime;
  const result = navigation.host.predictClientMovement({ ...query, frameTime }), observation = result.trace;
  const zero = { x: 0, y: 0, z: 0 };
  let trace: QvmAasMovementPrediction["trace"] = { startSolid: false, fraction: 0, end: zero,
    entityNum: 0, lastArea: 0, area: 0, plane: 0 };
  if (observation !== null && result.stopEvent !== 0 && (result.stopEvent & (4 | 8 | 16)) === 0) {
    const collision = observation.result, asset = navigation.host.runtime.graph.asset;
    const plane = collision.sourcePlane;
    const planeIndex = asset?.kind === "aas" ? asset.planes.findIndex(candidate => candidate.distance === plane.distance
      && candidate.normal.x === plane.normal.x && candidate.normal.y === plane.normal.y && candidate.normal.z === plane.normal.z) : -1;
    const crossings = navigation.traceAreas(observation.query.start, collision.end, navigation.host.runtime.graph.nodes.length + 1);
    trace = { startSolid: collision.startSolid, fraction: collision.fraction, end: collision.end,
      entityNum: collision.hit.kind === "actor" ? entityNumber(collision.hit.actor) : 0,
      lastArea: crossings.at(-1)?.area ?? navigation.pointArea(observation.query.start),
      area: collision.fraction === 1 ? 0 : navigation.pointArea(collision.end), plane: Math.max(0, planeIndex) };
  }
  const crouched = navigation.presenceBounds(4), bounds = result.bounds;
  const presence = bounds === null ? query.presence
    : bounds.max.z - bounds.min.z <= crouched.max.z - crouched.min.z ? 4 : 2;
  return { success: result.stopEvent !== 0 || result.frames >= Math.max(0, query.maxFrames),
    end: result.end, endArea: result.endArea ?? navigation.pointArea(result.end), velocity: result.velocity, trace, presence,
    stopEvent: result.stopEvent, endContents: (result.stopEvent & (4 | 8 | 16)) !== 0 ? navigation.host.pointContents(result.end) : 0,
    time: result.stopEvent === 0 ? result.seconds : Math.max(0, result.seconds - frameTime),
    frames: result.stopEvent === 0 ? result.frames : Math.max(0, result.frames - 1) };
}

function vector(view: DataView, offset: number, value: Vec3): void {
  view.setFloat32(offset, value.x, true); view.setFloat32(offset + 4, value.y, true); view.setFloat32(offset + 8, value.z, true);
}

export function qvmBotNavigationSyscall(call: QvmHostCall, services: QvmBotNavigationServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== "qagame") return null;
  const words = call.words, memory = call.guest, states = services.library.moveStates;
  const integer = (index: number): number => words.getInt32(index * 4, true);
  const float = (index: number): number => words.getFloat32(index * 4, true);
  const point = (index: number): Vec3 => qvmBotMovementVector(() => memory.pointer(integer(index)));
  const goal = (index: number) => readQvmBotGoalReference(() => memory.pointer(integer(index)));
  const fieldView = (bytes: Uint8Array, offset: number) => memory.dataView(bytes.byteOffset - memory.bytes.byteOffset + offset, 4);
  const target = (index: number) => qvmBotMovementTarget(() => memory.pointer(integer(index)), fieldView);
  const nodeId = (area: number): number => services.navigation.host.runtime.graph.asset?.kind === "aas" ? area : area - 1;
  const key = (index: number) => (candidate: string): boolean => {
    const bytes = memory.pointer(integer(index));
    if (bytes === null) throw new RangeError("QVM BSP epair key is null");
    for (let i = 0; i <= candidate.length; i++) {
      const byte = bytes[i];
      if (byte === undefined) throw new RangeError("QVM BSP epair key exceeds allocation");
      if (byte !== (i === candidate.length ? 0 : candidate.charCodeAt(i))) return false;
    }
    return true;
  };
  switch (call.code) {
    case 300: {
      const runtime = services.navigation.host.runtime;
      const area = integer(1), node = runtime.node(nodeId(area));
      if (area <= 0 || node === null) return 0;
      if (integer(2) >= 0) return Number(runtime.enableArea(node.id, integer(2) !== 0));
      return Number(runtime.checkpoint().enabled.find(entry => entry.id === node.id)?.enabled
        ?? !(node.source.kind === "aas" && (node.flags & 8) !== 0));
    }
    case 301: {
      const areas = services.navigation.bboxAreas({ min: point(1), max: point(2) }).slice(0, Math.max(0, integer(4)));
      for (const [index, area] of areas.entries()) memory.view(integer(3), 4, index * 4).setInt32(0, area, true);
      return areas.length;
    }
    case 302: {
      const runtime = services.navigation.host.runtime;
      const area = integer(1), node = runtime.node(nodeId(area));
      if (integer(2) === 0 || node === null || area <= 0) return 0;
      const info = services.navigation.area(area), out = memory.view(integer(2), 52);
      const enabled = runtime.checkpoint().enabled.find(entry => entry.id === node.id)?.enabled;
      const flags = enabled === undefined ? info.flags : enabled ? info.flags & ~8 : info.flags | 8;
      out.setInt32(0, info.contents, true); out.setInt32(4, flags, true);
      out.setInt32(8, info.presenceType, true); out.setInt32(12, info.cluster, true);
      vector(out, 16, node.bounds.min); vector(out, 28, node.bounds.max); vector(out, 40, node.origin);
      return 52;
    }
    case 303: {
      const info = services.entityInfo(integer(1));
      if (info === null) memory.fillBytes(memory.span(integer(2), 140).byteOffset - memory.bytes.byteOffset, 140, 0);
      else writeQvmAasEntityInfo(memory.view(integer(2), 140), info);
      return 0;
    }
    case 304: return Number(services.initialized());
    case 305: {
      const presence = integer(1);
      if (presence !== 2 && presence !== 4) services.library.options.print(4, "AAS_PresenceTypeBoundingBox: unknown presence type\n");
      const bounds = services.navigation.presenceBounds(presence === 2 ? 2 : 4);
      vector(memory.view(integer(2), 12), 0, bounds.min); vector(memory.view(integer(3), 12), 0, bounds.max); return 0;
    }
    case 306: return float32ToBits(services.time()) | 0;
    case 307: return services.navigation.pointArea(point(1));
    case 308: {
      memory.view(integer(3), 4).setInt32(0, 0, true);
      const crossings = services.navigation.traceAreas(point(1), point(2), integer(5));
      for (const [index, crossing] of crossings.entries()) {
        memory.view(integer(3), 4, index * 4).setInt32(0, crossing.area, true);
        if (integer(4) !== 0) vector(memory.view(integer(4), 12, index * 12), 0, crossing.point);
      }
      return crossings.length;
    }
    case 309: return services.navigation.host.pointContents(point(1));
    case 310: return services.bspEntities.nextEntity(integer(1));
    case 311: {
      const output = memory.pointer(integer(3));
      if (output === null) throw new RangeError("QVM BSP epair output is null");
      const offset = output.byteOffset - memory.bytes.byteOffset;
      return Number(services.bspEntities.value(integer(1), key(2), output, integer(4), {
        view: memory.dataView(offset, output.length), clear: length => memory.fillBytes(offset, length, 0),
      }));
    }
    case 312: {
      const out = memory.view(integer(3), 12); vector(out, 0, { x: 0, y: 0, z: 0 });
      const result = services.bspEntities.vector(integer(1), key(2)); vector(out, 0, result.value); return Number(result.found);
    }
    case 313:
    case 314: {
      const out = memory.view(integer(3), 4); out.setInt32(0, 0, true);
      const result = call.code === 313 ? services.bspEntities.float(integer(1), key(2)) : services.bspEntities.int(integer(1), key(2));
      if (call.code === 313) out.setFloat32(0, result.value, true); else out.setInt32(0, result.value, true);
      return Number(result.found);
    }
    case 315: return services.navigation.area(integer(1)).reachableAreaCount;
    case 316: return services.initialized() ? services.navigation.areaTravelTimeToGoal({ area: integer(1), origin: integer(2) === 0 ? null : point(2), goalArea: integer(3), travelFlags: integer(4) }) : 0;
    case 317: return Number(services.navigation.swimming(point(1)));
    case 318: {
      const presence = integer(4);
      if (presence !== 2 && presence !== 4) throw new RangeError("QVM movement prediction requires a supported presence type");
      const result = services.predictClientMovement({ entityNum: integer(2), origin: point(3), presence, onGround: integer(5) !== 0,
        velocity: point(6), commandMove: point(7), commandFrames: integer(8), maxFrames: integer(9), frameTime: float(10),
        stopEvents: integer(11), stopArea: integer(12), visualize: integer(13) !== 0 });
      const out = memory.view(integer(1), 84), trace = result.trace;
      vector(out, 0, result.end); out.setInt32(12, result.endArea, true); vector(out, 16, result.velocity);
      out.setInt32(28, Number(trace.startSolid), true); out.setFloat32(32, trace.fraction, true); vector(out, 36, trace.end);
      out.setInt32(48, trace.entityNum, true); out.setInt32(52, trace.lastArea, true); out.setInt32(56, trace.area, true); out.setInt32(60, trace.plane, true);
      out.setInt32(64, result.presence, true); out.setInt32(68, result.stopEvent, true); if (call.abiProfile === "q3-1.16n-base") out.setFloat32(72, result.endContents, true);
      else out.setInt32(72, result.endContents, true);
      out.setFloat32(76, result.time, true); out.setInt32(80, result.frames, true); return Number(result.success);
    }
    case 548: states.reset(integer(1)); return 0;
    case 549: {
      const result = qvmBotMoveResultReference(() => memory.pointer(integer(1)), fieldView);
      result.failure = false; result.type = 0; result.blocked = false; result.blockEntity = 0; result.travelType = 0; result.flags = 0;
      if (integer(3) === 0) result.failure = true;
      else services.navigation.moveToGoal(result, integer(2), goal(3), integer(4));
      return 0;
    }
    case 550: return Number(services.navigation.moveInDirection(integer(1), point(2), float(3), integer(4)));
    case 551: states.resetAvoidReach(integer(1)); return 0;
    case 552: states.resetLastAvoidReach(integer(1)); return 0;
    case 553: return services.navigation.reachabilityArea(point(1), integer(2));
    case 554: return integer(2) === 0 ? 0 : Number(services.navigation.movementViewTarget(integer(1), goal(2), integer(3), float(4), target(5)));
    case 555: return states.allocate();
    case 556: states.free(integer(1)); return 0;
    case 557: states.initialize(integer(1), qvmBotInitMoveReference(() => memory.pointer(integer(2)))); return 0;
    case 572: return integer(3) === 0 ? 0 : Number(services.navigation.predictVisiblePosition(point(1), integer(2), goal(3), integer(4), target(5)));
    case 574: states.addAvoidSpot(integer(1), point(2), float(3), integer(4)); return 0;
    case 575: {
      const goals = services.navigation.alternativeRouteGoals({ start: point(1), startArea: integer(2), goal: point(3), goalArea: integer(4), travelFlags: integer(5), maximumGoals: integer(7), type: integer(8) });
      for (const [index, value] of goals.entries()) {
        const out = memory.view(integer(6), 22, index * 24); vector(out, 0, value.origin); out.setInt32(12, value.area, true);
        out.setUint16(16, value.startTravelTime, true); out.setUint16(18, value.goalTravelTime, true); out.setUint16(20, value.extraTravelTime, true);
      }
      return goals.length;
    }
    case 576: {
      const result = services.navigation.predictRoute({ area: integer(2), origin: point(3), goalArea: integer(4), travelFlags: integer(5), maximumAreas: integer(6), maximumTime: integer(7), stopEvent: integer(8), stopContents: integer(9), stopTravelFlags: integer(10), stopArea: integer(11) });
      const out = memory.view(integer(1), 36); vector(out, 0, result.endPosition); out.setInt32(12, result.endArea, true);
      out.setInt32(16, result.stopEvent, true); out.setInt32(20, result.endContents, true); out.setInt32(24, result.endTravelFlags, true);
      out.setInt32(32, result.time, true); return Number(result.succeeded);
    }
    case 577: {
      if (!services.initialized()) return 0;
      const runtime = services.navigation.host.runtime, asset = runtime.graph.asset;
      if (asset?.kind !== "aas") {
        const reachable = runtime.graph.nodes.filter(node => runtime.outgoing(node.id).length > 0);
        if (integer(1) === 0) return reachable.length;
        const area = services.navigation.pointArea(point(1)); return area === 0 ? 0 : Math.max(0, reachable.findIndex(node => node.id === nodeId(area)));
      }
      if (integer(1) === 0) return asset.clusters.reduce((sum, cluster) => (sum + cluster.reachabilityAreaCount) | 0, 0);
      const area = services.navigation.pointArea(point(1)); if (area === 0 || services.navigation.area(area).reachableAreaCount === 0) return 0;
      const settings = asset.settings[area]; if (settings === undefined) throw new RangeError("QVM reachability area exceeds AAS allocation");
      if (settings.cluster < 0) throw new RangeError("AAS_PointReachabilityAreaIndex source reuses frontcluster as a negative portal index");
      return (asset.clusters.slice(0, settings.cluster).reduce((sum, cluster) => (sum + cluster.reachabilityAreaCount) | 0, 0) + settings.clusterArea) | 0;
    }
    default: return null;
  }
}
