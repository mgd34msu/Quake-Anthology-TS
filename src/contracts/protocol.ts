/* Wire shapes derived from id Software's Quake, Quake II, Quake II rerelease,
 * and Quake III public headers. GPL-2.0-or-later. */
import type { ClientId, SeatId, SessionId } from "./identity.ts";
import type { Vec3, Vec4 } from "./math.ts";

export type Q1ProtocolIdentity =
  | { readonly kind: "q1-netquake"; readonly version: 15 }
  | { readonly kind: "q1-fitzquake"; readonly version: 666 }
  | { readonly kind: "q1-rmq"; readonly version: 999; readonly flags: number };
export type QwProtocolIdentity =
  | { readonly kind: "q1-quakeworld"; readonly version: 28 }
  | { readonly kind: "q1-quakeworld-donor-wide"; readonly version: 29; readonly flags: number };
export type Q2ProRevision = 1015 | 1016 | 1017 | 1018 | 1019 | 1020 | 1021 | 1022 | 1023 | 1024 | 1025 | 1026;
export type Q2ProtocolIdentity =
  | { readonly kind: "q2-classic"; readonly version: 34 }
  | { readonly kind: "q2-r1q2"; readonly version: 35; readonly revision: 1903 | 1904 | 1905 }
  | { readonly kind: "q2-q2pro"; readonly version: 36; readonly revision: Q2ProRevision }
  | { readonly kind: "q2-rerelease"; readonly version: 1038 }
  | { readonly kind: "q2-kex"; readonly version: 2023 }
  | { readonly kind: "q2-kex-demo"; readonly version: 2022 }
  | { readonly kind: "q2-private-classic"; readonly version: 4038 };
export interface Q3ProtocolIdentity { readonly kind: "q3"; readonly version: 68; }

/** Wire versions select codecs. They do not select game APIs or frame cadence. */
export type ProtocolIdentity = Q1ProtocolIdentity | QwProtocolIdentity | Q2ProtocolIdentity | Q3ProtocolIdentity;
export type IntegerTriple = readonly [number, number, number];
export type AngleWords = IntegerTriple;

/** NetQuake's move message includes fields outside its local usercmd_t. */
export interface Q1UserCommand {
  readonly kind: "q1-netquake";
  readonly acknowledgedServerTimeSeconds: number;
  readonly viewAngles: Vec3;
  readonly forwardMove: number;
  readonly sideMove: number;
  readonly upMove: number;
  readonly buttons: number;
  readonly impulse: number;
}
export interface QwUserCommand {
  readonly kind: "q1-quakeworld";
  readonly milliseconds: number;
  readonly angles: Vec3;
  readonly forwardMove: number;
  readonly sideMove: number;
  readonly upMove: number;
  readonly buttons: number;
  readonly impulse: number;
}
export interface Q2UserCommand {
  readonly kind: "q2-classic";
  readonly milliseconds: number;
  readonly angleShorts: AngleWords;
  readonly forwardMove: number;
  readonly sideMove: number;
  readonly upMove: number;
  readonly buttons: number;
  readonly impulse: number;
  readonly lightLevel: number;
}
export interface Q2RereleaseUserCommand {
  readonly kind: "q2-rerelease";
  readonly milliseconds: number;
  readonly angles: Vec3;
  readonly forwardMove: number;
  readonly sideMove: number;
  readonly buttons: number;
  readonly serverFrame: number;
}
export interface Q3UserCommand {
  readonly kind: "q3";
  readonly serverTimeMilliseconds: number;
  readonly angleWords: AngleWords;
  readonly buttons: number;
  readonly weapon: number;
  readonly forwardMove: number;
  readonly rightMove: number;
  readonly upMove: number;
}
export type UserCommand = Q1UserCommand | QwUserCommand | Q2UserCommand | Q2RereleaseUserCommand | Q3UserCommand;
export interface SeatUserCommand {
  readonly seat: SeatId;
  readonly client: ClientId;
  readonly sequence: number;
  readonly command: UserCommand;
}

/** Source numbers identify wire slots, never generation-checked shared actors. */
export interface Q1EntityState {
  readonly number: number;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly modelIndex: number;
  readonly frame: number;
  readonly colorMap: number;
  readonly skin: number;
  readonly effects: number;
}
export interface Q1ExtendedEntityState extends Q1EntityState {
  readonly alpha: number;
  readonly scale: number;
  readonly lerpFinishSeconds: number;
  readonly step: boolean;
}
export interface Q1ClientData {
  readonly viewHeight: number;
  readonly idealPitch: number;
  readonly punchAngles: Vec3;
  readonly velocity: Vec3;
  readonly items: number;
  readonly onGround: boolean;
  readonly inWater: boolean;
  readonly weaponFrame: number;
  readonly armor: number;
  readonly weaponModel: number;
  readonly health: number;
  readonly ammo: number;
  readonly shells: number;
  readonly nails: number;
  readonly rockets: number;
  readonly cells: number;
  readonly activeWeapon: number;
}
export interface QwPlayerState {
  readonly number: number;
  readonly flags: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly modelIndex: number;
  readonly frame: number;
  readonly skin: number;
  readonly effects: number;
  readonly weaponFrame: number;
  readonly milliseconds: number;
  readonly command: QwUserCommand;
}
export interface Q2MovementState {
  readonly kind: "q2-classic";
  readonly type: number;
  readonly originEighths: IntegerTriple;
  readonly velocityEighths: IntegerTriple;
  readonly flags: number;
  readonly timeEightMilliseconds: number;
  readonly gravity: number;
  readonly deltaAngleShorts: AngleWords;
}
export interface Q2RereleaseMovementState {
  readonly kind: "q2-rerelease";
  readonly type: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly flags: number;
  readonly timeMilliseconds: number;
  readonly gravity: number;
  readonly deltaAngles: Vec3;
  readonly viewHeight: number;
}
interface Q2PlayerView {
  readonly viewAngles: Vec3;
  readonly viewOffset: Vec3;
  readonly kickAngles: Vec3;
  readonly gunAngles: Vec3;
  readonly gunOffset: Vec3;
  readonly gunIndex: number;
  readonly gunFrame: number;
  readonly fov: number;
  readonly renderFlags: number;
  readonly stats: readonly number[];
}
export interface Q2PlayerState extends Q2PlayerView {
  readonly kind: "q2-classic";
  readonly movement: Q2MovementState;
  readonly blend: Vec4;
}
export interface Q2RereleasePlayerState extends Q2PlayerView {
  readonly kind: "q2-rerelease";
  readonly movement: Q2RereleaseMovementState;
  readonly gunSkin: number;
  readonly gunRate: number;
  readonly screenBlend: Vec4;
  readonly damageBlend: Vec4;
  readonly teamId: number;
}
export interface Q2EntityState {
  readonly number: number;
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly oldOrigin: Vec3;
  readonly modelIndexes: readonly [number, number, number, number];
  readonly frame: number;
  readonly skin: number;
  readonly effects: number;
  readonly renderEffects: number;
  readonly solid: number;
  readonly sound: number;
  readonly event: number;
}
export interface Q2RereleaseEntityState extends Omit<Q2EntityState, "effects"> {
  readonly effects: bigint;
  readonly alpha: number;
  readonly scale: number;
  readonly instanceBits: number;
  readonly loopVolume: number;
  readonly loopAttenuation: number;
  readonly owner: number;
  readonly oldFrame: number;
}
export interface Q3Trajectory {
  readonly kind: "stationary" | "interpolate" | "linear" | "linear-stop" | "sine" | "gravity";
  readonly timeMilliseconds: number;
  readonly durationMilliseconds: number;
  readonly base: Vec3;
  readonly delta: Vec3;
}
export interface Q3EntityState {
  readonly number: number;
  readonly type: number;
  readonly flags: number;
  readonly position: Q3Trajectory;
  readonly angularPosition: Q3Trajectory;
  readonly timeMilliseconds: number;
  readonly time2Milliseconds: number;
  readonly origin: Vec3;
  readonly origin2: Vec3;
  readonly angles: Vec3;
  readonly angles2: Vec3;
  readonly otherEntityNumber: number;
  readonly otherEntityNumber2: number;
  readonly groundEntityNumber: number;
  readonly constantLight: number;
  readonly loopSound: number;
  readonly modelIndex: number;
  readonly modelIndex2: number;
  readonly clientNumber: number;
  readonly frame: number;
  readonly solid: number;
  readonly event: number;
  readonly eventParameter: number;
  readonly powerups: number;
  readonly weapon: number;
  readonly legsAnimation: number;
  readonly torsoAnimation: number;
  readonly generic1: number;
}
export interface Q3PlayerState {
  readonly commandTimeMilliseconds: number;
  readonly movementType: number;
  readonly bobCycle: number;
  readonly movementFlags: number;
  readonly movementTimeMilliseconds: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly weaponTimeMilliseconds: number;
  readonly gravity: number;
  readonly speed: number;
  readonly deltaAngleWords: AngleWords;
  readonly groundEntityNumber: number;
  readonly legsTimerMilliseconds: number;
  readonly legsAnimation: number;
  readonly torsoTimerMilliseconds: number;
  readonly torsoAnimation: number;
  readonly movementDirection: number;
  readonly grapplePoint: Vec3;
  readonly flags: number;
  readonly eventSequence: number;
  readonly events: readonly [number, number];
  readonly eventParameters: readonly [number, number];
  readonly externalEvent: number;
  readonly externalEventParameter: number;
  readonly externalEventTimeMilliseconds: number;
  readonly clientNumber: number;
  readonly weapon: number;
  readonly weaponState: number;
  readonly viewAngles: Vec3;
  readonly viewHeight: number;
  readonly damageEvent: number;
  readonly damageYaw: number;
  readonly damagePitch: number;
  readonly damageCount: number;
  readonly stats: readonly number[];
  readonly persistent: readonly number[];
  readonly powerups: readonly number[];
  readonly ammo: readonly number[];
  readonly generic1: number;
  readonly loopSound: number;
  readonly jumpPadEntity: number;
  /** Shared player-state fields copied by the host, outside the network delta fields. */
  readonly pingMilliseconds: number;
  readonly movementFrameCount: number;
  readonly jumpPadFrame: number;
  readonly entityEventSequence: number;
}

export type Q1Snapshot =
  | { readonly kind: "q1-netquake"; readonly protocol: Extract<Q1ProtocolIdentity, { readonly version: 15 }>; readonly serverTimeSeconds: number; readonly client: Q1ClientData; readonly entities: readonly Q1EntityState[] }
  | { readonly kind: "q1-enhanced"; readonly protocol: Exclude<Q1ProtocolIdentity, { readonly version: 15 }>; readonly serverTimeSeconds: number; readonly client: Q1ClientData; readonly entities: readonly Q1ExtendedEntityState[] };
export interface QwSnapshot {
  readonly kind: "q1-quakeworld";
  readonly protocol: QwProtocolIdentity;
  readonly sequence: number;
  readonly deltaSequence: number | null;
  readonly players: readonly QwPlayerState[];
  readonly entities: readonly Q1EntityState[];
}
interface Q2Frame {
  readonly protocol: Q2ProtocolIdentity;
  readonly serverFrame: number;
  readonly deltaFrame: number | null;
  readonly suppressedCount: number;
  readonly areaBits: Uint8Array;
}
export interface Q2Snapshot extends Q2Frame {
  readonly kind: "q2-classic";
  readonly player: Q2PlayerState;
  readonly entities: readonly Q2EntityState[];
}
export interface Q2RereleaseSnapshot extends Q2Frame {
  readonly kind: "q2-rerelease";
  readonly player: Q2RereleasePlayerState;
  readonly entities: readonly Q2RereleaseEntityState[];
}
/** Snapshot storage is an owned copy, including arrays borrowed from a guest. */
export interface Q3Snapshot {
  readonly kind: "q3";
  readonly protocol: Q3ProtocolIdentity;
  readonly flags: number;
  readonly pingMilliseconds: number;
  readonly serverTimeMilliseconds: number;
  readonly areaMask: Uint8Array;
  readonly player: Q3PlayerState;
  readonly entities: readonly Q3EntityState[];
  readonly serverCommandCount: number;
  readonly serverCommandSequence: number;
}
export type NetworkSnapshot = Q1Snapshot | QwSnapshot | Q2Snapshot | Q2RereleaseSnapshot | Q3Snapshot;

/** Decoded service messages keep source identifiers for the selected codec. */
export type NetworkEvent =
  | { readonly kind: "print"; readonly level: number; readonly text: string }
  | { readonly kind: "center-print"; readonly text: string }
  | { readonly kind: "command-text"; readonly text: string }
  | { readonly kind: "config-string"; readonly index: number; readonly value: string }
  | { readonly kind: "sound"; readonly entityNumber: number; readonly channel: number; readonly soundIndex: number; readonly origin: Vec3 | null; readonly volume: number; readonly attenuation: number; readonly delaySeconds: number }
  | { readonly kind: "q1-damage"; readonly armor: number; readonly blood: number; readonly source: Vec3 }
  | { readonly kind: "q1-particle"; readonly origin: Vec3; readonly direction: Vec3; readonly count: number; readonly color: number }
  | { readonly kind: "q2-layout"; readonly program: string }
  | { readonly kind: "q2-inventory"; readonly counts: readonly number[] }
  | { readonly kind: "q2-muzzle-flash"; readonly entityNumber: number; readonly flash: number; readonly monster: boolean }
  | { readonly kind: "q3-server-command"; readonly sequence: number; readonly text: string }
  | { readonly kind: "disconnect"; readonly reason: string };
export interface NetworkDelivery {
  readonly session: SessionId;
  readonly client: ClientId;
  readonly protocol: ProtocolIdentity;
  readonly sequence: number;
  readonly events: readonly NetworkEvent[];
}
export type ProtocolSupport =
  | { readonly kind: "supported"; readonly protocol: ProtocolIdentity }
  | { readonly kind: "unsupported"; readonly protocol: ProtocolIdentity; readonly reasons: readonly string[] };
