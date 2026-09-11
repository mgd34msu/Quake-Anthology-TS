import type { Axis, Bounds, Vec2, Vec3, Vec4 } from "../../../contracts/math.ts";

/** The caller supplies its actual registered material object, retaining identity. */
export interface ParticleShader { readonly name: string; }
export interface ParticleResources { registerShader(name: string): Promise<ParticleShader | null>; }
export interface RefPolyVertex { readonly position: Vec3; readonly texCoord: Vec2; readonly color: Vec4; }
export interface RefPoly { readonly shader: ParticleShader | null; readonly vertices: readonly RefPolyVertex[]; }
export interface ParticleClientState {
  readonly time: number;
  readonly refdef: { readonly viewAxis: Axis };
  readonly snap: { readonly playerState: { readonly origin: Vec3 } } | null;
}
export interface ParticleClientEntity {
  readonly currentState: { readonly origin: Vec3; readonly origin2: Vec3; readonly angles: Vec3; readonly angles2: Vec3;
    readonly time: number; readonly time2: number; readonly frame: number };
}
export interface ParticleTrace {
  readonly end: Vec3;
  readonly entityNum: number;
  readonly solidity: "clear" | "start-solid" | "all-solid";
  readonly fraction: number;
}
export interface ParticleTracer {
  trace(start: Vec3, end: Vec3, bounds: Bounds, passEntity: number, contents: number): ParticleTrace;
}
