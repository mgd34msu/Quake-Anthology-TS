import type { ActorId, CallbackId, ClientId, OwnedActor, ProviderId, SessionId } from "./identity.ts";
import type { Bounds, Plane, Vec3 } from "./math.ts";
import type { FrameContext, SourceTime, ThinkTiming } from "./time.ts";

export interface ActorObservation {
  readonly id: ActorId;
  readonly owner: ProviderId;
  readonly definition: `${string}:${string}`;
}

export interface ActorRegistry {
  readonly session: SessionId;
  allocate(owner: ProviderId, definition: `${string}:${string}`): OwnedActor;
  release(actor: OwnedActor): undefined;
  isLive(actor: ActorId): boolean;
  observe(actor: ActorId): ActorObservation | null;
  ownedBy(owner: ProviderId): readonly OwnedActor[];
}

export interface BodyState {
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly velocity: Vec3;
  readonly bounds: Bounds;
  readonly ground: ActorId | null;
}

/** Bounds visible to spatial queries remain those captured by the last source-defined link. */
export interface LinkedBody {
  readonly actor: ActorId;
  readonly state: BodyState;
  readonly absoluteBounds: Bounds;
  readonly linkCount: number;
}

export interface BodyTable {
  read(actor: ActorId): BodyState | null;
  write(actor: OwnedActor, state: BodyState): undefined;
  linked(actor: ActorId): LinkedBody | null;
  link(actor: OwnedActor): undefined;
  unlink(actor: OwnedActor): undefined;
}

/** These callbacks return synchronously. `undefined` excludes Promise-returning handlers. */
export interface ActorCallbacks {
  readonly think: ((self: OwnedActor, frame: FrameContext) => undefined) | null;
  readonly touch: ((contact: TouchContact) => undefined) | null;
  readonly use: ((self: OwnedActor, other: ActorId | null, activator: ActorId | null) => undefined) | null;
  readonly pain: ((reaction: PainReaction) => undefined) | null;
  readonly die: ((reaction: DeathReaction) => undefined) | null;
}

export interface TouchContact {
  readonly self: OwnedActor;
  readonly other: ActorId;
  readonly plane: Plane | null;
  readonly surface: { readonly name: string; readonly nativeFlags: number; readonly nativeValue: number } | null;
}

export interface PainReaction {
  readonly self: OwnedActor;
  readonly attacker: ActorId | null;
  readonly kick: number;
  readonly damage: number;
}

export interface DeathReaction extends PainReaction {
  readonly inflictor: ActorId | null;
  readonly point: Vec3;
}

export interface ScheduledThink {
  readonly actor: ActorId;
  readonly callback: CallbackId;
  readonly timing: ThinkTiming;
}

/** Kept by the owning controller, never by a foreign actor observation. */
export interface ActorSchedule {
  schedule(actor: OwnedActor, callback: CallbackId, timing: ThinkTiming): undefined;
  cancel(actor: OwnedActor): undefined;
  pending(actor: ActorId): ScheduledThink | null;
}

export interface Q2AdmissionResult {
  readonly allowed: boolean;
  readonly userinfo: string;
}

export type ClientAdmission =
  | { readonly kind: "q1"; readonly connect: (client: ClientId) => undefined }
  | { readonly kind: "q2-classic"; readonly connect: (client: ClientId, userinfo: string) => Q2AdmissionResult }
  | { readonly kind: "q2-rerelease"; readonly connect: (client: ClientId, userinfo: string, socialId: string, isBot: boolean) => Q2AdmissionResult }
  | { readonly kind: "q3"; readonly connect: (client: ClientId, firstTime: boolean, isBot: boolean) => string | null };

export interface ActorLifetimePolicy {
  readonly firstDynamicSlot: number;
  readonly reuse: "immediate" | "source-cooldown";
  readonly reusableAfter: (freedAt: SourceTime, now: SourceTime) => boolean;
  readonly clear: "source-edict" | "source-gentity";
  readonly exhaustion: "fatal" | "qw-last-slot";
}
