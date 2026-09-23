import type { ActorId, ProviderId, SeatId } from "../contracts/identity.ts";
import type { ResolvedResourceReference, ResourceId } from "../contracts/content.ts";
import type { Axis, Vec3 } from "../contracts/math.ts";
import type { PcmSound } from "./wav.ts";
export type SoundFamily = "q1" | "q2" | "q3";
export type AudioAudience = {
    readonly kind: "world";
} | {
    readonly kind: "seat";
    readonly seat: SeatId;
};
export interface AudioListener {
    readonly seat: SeatId;
    readonly actor: ActorId | null;
    readonly origin: Vec3;
    readonly axis: Axis;
    readonly gain: number;
    readonly underwater: boolean;
}
export interface SoundAsset {
    readonly reference?: ResolvedResourceReference;
    readonly resource: ResourceId;
    readonly name: string;
    readonly pcm: PcmSound;
}
export type SoundOrigin = {
    readonly kind: "local";
} | {
    readonly kind: "fixed";
    readonly position: Vec3;
} | {
    readonly kind: "actor";
    readonly actor: ActorId;
};
export interface PlaySound {
    readonly owner?: ProviderId;
    readonly sound: SoundAsset;
    readonly family: SoundFamily;
    readonly actor: ActorId | null;
    readonly origin: SoundOrigin;
    readonly audience: AudioAudience;
    readonly channel: number;
    /** Protocol-normalized 0..1 gain; source adapters preserve family channel scales. */
    readonly volume: number;
    readonly attenuation: number;
    readonly delaySeconds?: number;
    readonly serverMilliseconds?: number;
}
export interface LoopSound extends Omit<PlaySound, "channel" | "delaySeconds" | "serverMilliseconds"> {
    readonly actor: ActorId;
    readonly velocity: Vec3;
    readonly frameNumber: number;
    readonly lifetime: "frame" | "persistent";
}
export interface StreamPcm {
    readonly samples: Int16Array | Uint8Array;
    readonly channels: 1 | 2;
    readonly sampleRate: number;
    /** Sample frame position in this source stream, before resampling. */
    readonly sourceSample: number;
    readonly resetStream: boolean;
}
export interface AudioStreamTarget {
    readonly id: string;
    readonly audience: AudioAudience;
    readonly gain: number;
}

export type SharedSoundChannel = "weapon" | "voice" | "item" | "body" | "local" | "local-sound" | "announcer" | `${SoundFamily}:extension:${number}`;
export type SoundChannelCommand = { readonly kind: "auto" } | { readonly kind: "replace-actor" } | { readonly kind: "channel"; readonly channel: SharedSoundChannel };
export function sourceSoundChannel(family: SoundFamily, channel: number): SoundChannelCommand {
    if (!Number.isInteger(channel) || channel < 0 && !(family === "q1" && channel === -1)) throw new RangeError("Invalid source sound channel");
    if (channel === -1) return { kind: "replace-actor" };
    if (channel === 0) return { kind: "auto" };
    const names: readonly SharedSoundChannel[] = family === "q3" ? ["local", "weapon", "voice", "item", "body", "local-sound", "announcer"] : ["weapon", "voice", "item", "body"];
    return { kind: "channel", channel: names[channel - 1] ?? `${family}:extension:${channel}` };
}

export type AudioVoiceEvent = { readonly kind: "start"; readonly seat: SeatId; readonly voiceId: number; readonly sound: SoundAsset; readonly outputSample: number; readonly sampleRate: number; readonly sourceOffsetSeconds: number }
  | { readonly kind: "stop"; readonly seat: SeatId; readonly voiceId: number; readonly outputSample: number; readonly reason: "ended" | "stopped" | "replaced" };
export interface AudioVoiceClock { readonly outputSample: number; readonly sampleRate: number; readonly paused: boolean; }
