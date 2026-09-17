/* Reachability construction from id Software be_aas_reach.c. GPL-2.0-or-later.
 * Geometry and movement borrow the shared map and selected prediction owner. */
import type { Vec3 } from "../../contracts/math.ts";
import type { DecodedWorld, SceneQueries } from "../../contracts/scene.ts";
import type { BotMovementPrediction } from "../behavior/q3/navigation-types.ts";
import type { BotTravelPredictionResult } from "../behavior/q3/travel/types.ts";
import type { NavigationProfile } from "./types.ts";
import { aasPointArea } from "./aas.ts";
import type { AasAsset } from "./aas.ts";
import { aasAt, AasReachabilityGeometry } from "./aas-reachability-geometry.ts";
import { AasReachabilitySpecial } from "./aas-reachability-special.ts";
import { AasReachabilitySpatial, AasReachabilityEntities } from "./aas-reachability-spatial.ts";
import { initAasMovementSettings } from "./aas-reachability-types.ts";
import type { AasMovementSettings, AasReachabilityWorld } from "./aas-reachability-types.ts";

const LINK_BYTES = 48, MAX_REACHABILITY = 65536;
export interface AasReachabilityOptions {
  readonly asset: AasAsset;
  readonly geometry: DecodedWorld;
  readonly scene: SceneQueries;
  readonly profile: NavigationProfile;
  readonly predictionClient: number;
  readonly predictClientMovement: (query: BotMovementPrediction) => BotTravelPredictionResult;
  readonly force?: boolean;
  readonly debug?: boolean;
  readonly settings?: Readonly<AasMovementSettings>;
  readonly variable?: (name: string, defaultValue: string) => number;
  readonly print?: (severity: 1 | 2 | 3 | 4 | 5, text: string) => void;
  readonly debugLine?: (start: Vec3, end: Vec3, color: number) => void;
}
export class AasReachabilityDebugState {
  readonly counts = new Map<string, number>();
  count(category: string): void { this.counts.set(category, (this.counts.get(category) ?? 0) + 1); }
}

/** Binary32 source link fields with ordinary JavaScript lifetime. */
export class AasLinkedReachability {
  private diagnosticBytes: Uint8Array | null = null;
  private diagnosticNext: AasLinkedReachability | null = null;
  private readonly startVector = this.vector(12);
  private readonly endVector = this.vector(24);

  protected view(): DataView {
    if (this.diagnosticBytes === null) this.diagnosticBytes = new Uint8Array(LINK_BYTES);
    return new DataView(this.diagnosticBytes.buffer, this.diagnosticBytes.byteOffset, LINK_BYTES);
  }

  private vector(offset: number): Vec3 {
    const record = this;
    return Object.freeze({
      get x(): number { return record.view().getFloat32(offset, true); },
      get y(): number { return record.view().getFloat32(offset + 4, true); },
      get z(): number { return record.view().getFloat32(offset + 8, true); },
    });
  }

  private setVector(offset: number, value: Vec3): void {
    this.view().setFloat32(offset, value.x, true);
    this.view().setFloat32(offset + 4, value.y, true);
    this.view().setFloat32(offset + 8, value.z, true);
  }

  get area(): number { return this.view().getInt32(0, true); }
  set area(value: number) { this.view().setInt32(0, value, true); }
  get face(): number { return this.view().getInt32(4, true); }
  set face(value: number) { this.view().setInt32(4, value, true); }
  get edge(): number { return this.view().getInt32(8, true); }
  set edge(value: number) { this.view().setInt32(8, value, true); }
  get start(): Vec3 { return this.startVector; }
  set start(value: Vec3) { this.setVector(12, value); }
  get end(): Vec3 { return this.endVector; }
  set end(value: Vec3) { this.setVector(24, value); }
  get travelType(): number { return this.view().getInt32(36, true); }
  set travelType(value: number) { this.view().setInt32(36, value, true); }
  get next(): AasLinkedReachability | null { return this.diagnosticNext; }
  set next(value: AasLinkedReachability | null) { this.diagnosticNext = value; }
  get travelTime(): number { return this.view().getUint16(40, true); }
  set travelTime(value: number) {
    const integer = Math.trunc(value);
    if (!Number.isFinite(integer) || integer < -2147483648 || integer > 2147483647) {
      throw new RangeError("AAS reachability travel time exceeds source integer conversion range");
    }
    this.view().setUint16(40, integer, true);
  }

  clear(): void {
    const view = this.view();
    new Uint8Array(view.buffer, view.byteOffset, LINK_BYTES).fill(0);
    this.diagnosticNext = null;
  }
}

export interface AasReachabilityContext {
  readonly world: AasReachabilityWorld;
  readonly spatial: AasReachabilitySpatial;
  readonly bspEntities: AasReachabilityEntities;
  readonly settings: Readonly<AasMovementSettings>;
  readonly variables: { value(name: string, initial: string): number };
  readonly debug: boolean;
  readonly debugState: AasReachabilityDebugState;
  readonly heads: (AasLinkedReachability | null)[];
  print(severity: 1 | 2 | 3 | 4 | 5, text: string): void;
  log(text: string): void;
  permanentLine(start: Vec3, end: Vec3, color: number): void;
  allocate(): AasLinkedReachability | null;
  free(link: AasLinkedReachability): void;
  exists(from: number, to: number): boolean;
}

/** Rebuild source links without mutating the input asset or its live movement actor. */
export function buildAasReachability(options: AasReachabilityOptions): AasAsset {
  if (options.asset.reachability.length > 0 && options.force !== true) return options.asset;
  if (!Number.isSafeInteger(options.predictionClient) || options.predictionClient < 0) throw new RangeError("AAS generation requires a selected prediction client");
  const settings = options.asset.settings.map(setting => ({ ...setting }));
  const world: AasReachabilityWorld = { ...options.asset, settings,
    pointArea: point => aasPointArea(options.asset, point), setting: area => aasAt(settings, area) };
  const variables = { value: options.variable ?? ((_name: string, initial: string) => Number(initial)) };
  const movementSettings = options.settings ?? initAasMovementSettings(variables.value);
  const bspEntities = new AasReachabilityEntities(options.geometry.entities);
  const spatial = new AasReachabilitySpatial(options, world, bspEntities, movementSettings);
  const heads: (AasLinkedReachability | null)[] = world.areas.map(() => null), free: AasLinkedReachability[] = [];
  let allocated = 0;
  const print = options.print ?? (() => undefined);
  const context: AasReachabilityContext = { world, spatial, bspEntities, settings: movementSettings, variables,
    debug: options.debug ?? false, debugState: new AasReachabilityDebugState(), heads, print, log: text => print(1, text),
    permanentLine: options.debugLine ?? (() => undefined),
    allocate() {
      if (allocated >= MAX_REACHABILITY) { print(4, "AAS_MAX_REACHABILITYSIZE"); return null; }
      allocated++;
      return free.pop() ?? new AasLinkedReachability();
    },
    free(link) { link.clear(); free.push(link); allocated--; },
    exists(from, to) {
      for (let link = aasAt(heads, from); link !== null; link = link.next) if (link.area === to) return true;
      return false;
    } };
  const geometry = new AasReachabilityGeometry(context), special = new AasReachabilitySpecial(context);
  special.setWeaponJumpAreaFlags();
  const grapple = Math.trunc(variables.value("grapplereach", "0")) !== 0;
  for (let from = 1; from < world.areas.length; from++) {
    if ((aasAt(settings, from).contents & 128) !== 0) continue;
    for (let to = 1; to < world.areas.length; to++) {
      if (from === to || context.exists(from, to)) continue;
      if ((aasAt(settings, from).contents & (64 | 128)) !== 0 && (aasAt(settings, to).contents & (64 | 128)) === 0) continue;
      if (geometry.swim(from, to) || geometry.equalFloorHeight(from, to)
        || geometry.stepBarrierWaterJumpWalkOffLedge(from, to) || geometry.ladder(from, to) || geometry.jump(from, to)) continue;
    }
    if ((aasAt(settings, from).contents & (64 | 128)) !== 0) continue;
    for (let to = 1; to < world.areas.length; to++) {
      if (from === to || context.exists(from, to)) continue;
      if (grapple) special.grapple(from, to);
      special.weaponJump(from, to);
    }
  }
  for (let area = 1; area < world.areas.length; area++) if ((aasAt(settings, area).contents & 128) === 0) geometry.walkOffLedge(area);
  special.jumpPad(); special.teleport(); special.elevator(); special.funcBobbing();
  const zero = { x: 0, y: 0, z: 0 };
  const reachability: AasAsset["reachability"][number][] = [{ area: 0, face: 0, edge: 0, start: zero, end: zero, travelType: 0, travelTime: 0, padding: 0 }];
  for (let area = 0; area < world.areas.length; area++) {
    const setting = aasAt(settings, area); setting.firstReach = reachability.length; setting.reachCount = 0;
    for (let link = aasAt(heads, area); link !== null; link = link.next) {
      reachability.push({ area: link.area, face: link.face, edge: link.edge, start: { ...link.start }, end: { ...link.end },
        travelType: link.travelType, travelTime: link.travelTime, padding: 0 });
      setting.reachCount++;
    }
  }
  return { ...options.asset, settings, reachability };
}
