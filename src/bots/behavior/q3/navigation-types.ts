/* Source travel flags and AI query words from be_aas.h/be_aas_route.c. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { BotGoal } from "../library/goals.ts";
import type { BotMoveResult } from "./movement-state.ts";
export const TravelType = Object.freeze({
  INVALID: 1, WALK: 2, CROUCH: 3, BARRIERJUMP: 4, JUMP: 5, LADDER: 6,
  WALKOFFLEDGE: 7, SWIM: 8, WATERJUMP: 9, TELEPORT: 10, ELEVATOR: 11,
  ROCKETJUMP: 12, BFGJUMP: 13, GRAPPLEHOOK: 14, DOUBLEJUMP: 15,
  RAMPJUMP: 16, STRAFEJUMP: 17, JUMPPAD: 18, FUNCBOB: 19,
  MASK: 0xffffff, NOTTEAM1: 1 << 24, NOTTEAM2: 2 << 24,
});

export const TravelFlags = Object.freeze({
  INVALID: 0x00000001, WALK: 0x00000002, CROUCH: 0x00000004,
  BARRIERJUMP: 0x00000008, JUMP: 0x00000010, LADDER: 0x00000020,
  WALKOFFLEDGE: 0x00000080, SWIM: 0x00000100, WATERJUMP: 0x00000200,
  TELEPORT: 0x00000400, ELEVATOR: 0x00000800, ROCKETJUMP: 0x00001000,
  BFGJUMP: 0x00002000, GRAPPLEHOOK: 0x00004000, DOUBLEJUMP: 0x00008000,
  RAMPJUMP: 0x00010000, STRAFEJUMP: 0x00020000, JUMPPAD: 0x00040000,
  AIR: 0x00080000, WATER: 0x00100000, SLIME: 0x00200000, LAVA: 0x00400000,
  DONOTENTER: 0x00800000, FUNCBOB: 0x01000000, FLIGHT: 0x02000000,
  BRIDGE: 0x04000000, NOTTEAM1: 0x08000000, NOTTEAM2: 0x10000000,
  DEFAULT: 0x011c0fbe,
});

const TYPE_FLAGS: readonly number[] = [
  TravelFlags.INVALID, TravelFlags.INVALID, TravelFlags.WALK, TravelFlags.CROUCH,
  TravelFlags.BARRIERJUMP, TravelFlags.JUMP, TravelFlags.LADDER, TravelFlags.WALKOFFLEDGE,
  TravelFlags.SWIM, TravelFlags.WATERJUMP, TravelFlags.TELEPORT, TravelFlags.ELEVATOR,
  TravelFlags.ROCKETJUMP, TravelFlags.BFGJUMP, TravelFlags.GRAPPLEHOOK, TravelFlags.DOUBLEJUMP,
  TravelFlags.RAMPJUMP, TravelFlags.STRAFEJUMP, TravelFlags.JUMPPAD, TravelFlags.FUNCBOB,
];

/** The source's lines 174-178 test zero tfl, so reachability team bits are ignored. */
export function travelFlagForType(travelType: number): number {
  const flag = TYPE_FLAGS[travelType & TravelType.MASK];
  return flag === undefined ? TravelFlags.INVALID : flag;
}


export interface RouteQuery {
  readonly area: number;
  /** Required: the source reads an uninitialized reachnum for intercluster queries with a null origin. */
  readonly origin: Vec3;
  readonly goalArea: number;
  readonly travelFlags: number;
}
export type AreaTravelTimeQuery = Omit<RouteQuery, "origin"> & { readonly origin: Vec3 | null };
export const AlternativeRouteType = Object.freeze({ ALL: 1, CLUSTER_PORTALS: 2, VIEW_PORTALS: 4 });
export interface AlternativeRouteQuery {
  readonly start: Vec3;
  readonly startArea: number;
  /** The original parameter is unused; its coordinates are never read. */
  readonly goal: Vec3;
  readonly goalArea: number;
  readonly travelFlags: number;
  /** Checked after publishing each goal, so zero and negative limits can yield one. */
  readonly maximumGoals: number;
  readonly type: number;
}
export interface AlternativeGoal {
  readonly origin: Vec3;
  /** Zero is the source fallback when no distance is less than 999999. */
  readonly area: number;
  readonly startTravelTime: number;
  readonly goalTravelTime: number;
  readonly extraTravelTime: number;
}

export type RouteResult = { readonly kind: "found"; readonly travelTime: number; readonly nextReachability: number }
  | { readonly kind: "unreachable" };
export const RouteStopEvent = Object.freeze({
  NONE: 0, NO_ROUTE: 1, USE_TRAVEL_TYPE: 2, ENTER_CONTENTS: 4, ENTER_AREA: 8,
});
export interface PredictRouteQuery extends RouteQuery {
  readonly maximumAreas: number;
  readonly maximumTime: number;
  readonly stopEvent: number;
  readonly stopContents: number;
  readonly stopTravelFlags: number;
  readonly stopArea: number;
}
/** All fields written by AAS_PredictRoute, plus its return value. The full-export
 * caller retains numareas separately: the source never writes that field. */
export interface PredictedRoute {
  readonly succeeded: boolean;
  readonly stopEvent: number;
  readonly endArea: number;
  readonly endContents: number;
  readonly endTravelFlags: number;
  readonly endPosition: Vec3;
  readonly time: number;
}

export interface BotNavigationArea {
  readonly contents: number;
  readonly flags: number;
  readonly presenceType: number;
  readonly cluster: number;
  readonly reachableAreaCount: number;
}

export interface BotMovementPrediction {
  readonly entityNum: number;
  readonly origin: Vec3;
  readonly presence: 2 | 4;
  readonly onGround: boolean;
  readonly velocity: Vec3;
  readonly commandMove: Vec3;
  readonly commandFrames: number;
  readonly maxFrames: number;
  readonly frameTime: number;
  readonly stopEvents: number;
  readonly stopArea: number;
  readonly visualize: boolean;
}

/** Every operation queries the selected shared navigation and movement providers. */
export interface BotNavigation {
  readonly ready: boolean;
  withClient<T>(client: number, think: () => T): T;
  pointArea(origin: Vec3): number;
  reachabilityArea(origin: Vec3, client: number): number;
  fuzzyPointReachabilityArea(origin: Vec3): number;
  area(number: number): BotNavigationArea;
  traceAreas(start: Vec3, end: Vec3, maximum: number): readonly { readonly area: number; readonly point: Vec3 }[];
  bboxAreas(bounds: Bounds): readonly number[];
  setAreaEnabled(area: number, enabled: boolean): void;
  areaTravelTimeToGoal(query: AreaTravelTimeQuery): number;
  route(query: RouteQuery): RouteResult;
  predictRoute(query: PredictRouteQuery): PredictedRoute;
  alternativeRouteGoals(query: AlternativeRouteQuery): readonly AlternativeGoal[];
  moveToGoal(result: BotMoveResult, moveState: number, goal: BotGoal, travelFlags: number): void;
  moveInDirection(moveState: number, direction: Vec3, speed: number, moveType: number): boolean;
  movementViewTarget(moveState: number, goal: BotGoal, travelFlags: number, lookAhead: number, output: { value: Vec3 }): boolean;
  predictVisiblePosition(origin: Vec3, area: number, goal: BotGoal, travelFlags: number, output: { value: Vec3 }): boolean;
  swimming(origin: Vec3): boolean;
  predictClientMovement(query: BotMovementPrediction): { readonly move: { readonly end: Vec3 } };
  presenceBounds(presence: 2 | 4): Bounds;
}
