import type { Bounds, Plane, Vec3 } from "../../../contracts/math.ts";
import type { GameEntity } from "./game/state.ts";
export type TraceShape = { readonly kind: "point" } | { readonly kind: "box" | "capsule"; readonly mins: Vec3; readonly maxs: Vec3 };
export interface ServerTraceQuery { readonly start: Vec3; readonly end: Vec3; readonly shape: TraceShape; readonly passEntityNum: number; readonly mask: number; }
export interface ServerTraceResult {
  readonly fraction: number; readonly end: Vec3; readonly entityNum: number;
  readonly solidity: "clear" | "start-solid" | "all-solid";
  readonly contact: { readonly kind: "none" } | { readonly kind: "plane"; readonly plane: Plane };
  readonly contents: number; readonly surfaceFlags: number;
}
export interface LinkState { readonly absbounds: Bounds; readonly linked: boolean; readonly linkcount: number; }
/** Source-shaped operations over the session collision and body owners. No world storage lives here. */
export interface ServerWorld {
  entityContact(bounds: Bounds, entityNum: number, capsule?: boolean): boolean;
  trace(query: ServerTraceQuery): ServerTraceResult;
  areaEntities(bounds: Bounds, maximum?: number): readonly number[];
  pointContents(point: Vec3, passEntityNum: number): number;
  linkState(number: number): LinkState | undefined;
  link(entity: GameEntity): void;
  unlink(number: number): void;
}
