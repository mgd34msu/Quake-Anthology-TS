import { SaveReader } from "../../../persistence/value.ts";
import type { ActorId, SeatId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SoundAsset, SoundOrigin, PlaySound, LoopSound } from "../../../audio/types.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { StartSoundOptions } from "../../../audio/mixer.ts";
import type { SoundBank } from "../../../audio/bank.ts";
import type { ClientSoundBank } from "./resources.ts";
export interface SoundRegistration { readonly path: string; readonly compressed: boolean; readonly sound: SoundAsset | null; }
/** Source handles refer to shared decoded PCM and preserve compressed-registration intent. */
export class Q3PresentationSoundBank implements ClientSoundBank {
  private readonly registered: SoundAsset[] = [];
  private operations = 0;
  private readonly requests = new Map<string, SoundRegistration>();
  constructor(readonly bank: SoundBank, readonly zeroSound: SoundAsset | null, private readonly loadSync: (path: string, compressed: boolean) => SoundAsset | null) {}
  captureCheckpoint() {
    if (this.operations !== 0) throw new Error("Cannot checkpoint pending sound registration");
    return [...this.requests.values()].map(row => ({ path: row.path, compressed: row.compressed,
      handle: this.indexForSound(row.sound?.pcm ?? null), resource: row.sound?.resource ?? null }));
  }
  async restoreCheckpoint(value: unknown): Promise<void> {
    if (this.operations !== 0 || this.requests.size !== 0) throw new Error("Sound restore requires an empty owner");
    const r = new SaveReader(value, "client-sounds");
    for (const row of r.list(item => ({ path: item.field("path").string(), compressed: item.field("compressed").boolean(),
      handle: item.field("handle").integer(0), resource: item.field("resource").nullable(v => v.string()) }))) {
      const sound = await this.registerSound(row.path, row.compressed), entry = this.requests.get(row.path);
      if (this.indexForSound(sound) !== row.handle || (entry?.sound?.resource ?? null) !== row.resource) r.fail("sound resource binding changed");
    }
  }
  async registerSound(path: string | null, compressed: boolean): Promise<PcmSound | null> {
    if (path === null) throw new Error("S_RegisterSound dereferences NULL name at strlen");
    if (path.length === 0 || path.startsWith("*")) return null;
    const prior = this.requests.get(path);
    if (prior !== undefined) return prior.sound === null || prior.sound.pcm === this.zeroSound?.pcm ? null : prior.sound.pcm;
    this.operations++;
    let sound: SoundAsset | null;
    try { sound = await this.bank.register(path, "q3"); } finally { this.operations--; }
    this.requests.set(path, { path, compressed, sound });
    if (sound !== null && sound.pcm !== this.zeroSound?.pcm && !this.registered.includes(sound)) this.registered.push(sound);
    return sound === null || sound.pcm === this.zeroSound?.pcm ? null : sound.pcm;
  }
  sound(path: string | null, compressed: boolean): PcmSound | null {
    if (path === null) return null;
    let entry = this.requests.get(path);
    if (entry === undefined) {
      const sound = this.loadSync(path, compressed); entry = { path, compressed, sound }; this.requests.set(path, entry);
      if (sound !== null && sound.pcm !== this.zeroSound?.pcm && !this.registered.includes(sound)) this.registered.push(sound);
    }
    return entry.sound === null || entry.sound.pcm === this.zeroSound?.pcm ? null : entry.sound.pcm;
  }
  indexForSound(sound: PcmSound | null): number {
    if (sound === null || sound === this.zeroSound?.pcm) return 0;
    const index = this.registered.findIndex(entry => entry.pcm === sound);
    if (index < 0) throw new Error("PCM does not belong to this cgame sound bank");
    return index + 1;
  }
  asset(sound: PcmSound | null): SoundAsset | null { const index = this.indexForSound(sound); return index === 0 ? this.zeroSound : this.registered[index - 1] ?? this.zeroSound; }
  soundAtIndex(index: number): PcmSound | null {
    if (index === 0) return null;
    const sound = this.registered[index - 1];
    if (!Number.isInteger(index) || sound === undefined) throw new RangeError(`Q3 sound handle ${index} is not registered`);
    return sound.pcm;
  }
  soundForIndex(index: number): PcmSound | null | undefined {
    if (!Number.isInteger(index)) throw new RangeError('Sound handle must be an integer');
    return index === 0 ? null : this.registered[index - 1]?.pcm;
  }
  registrations(): readonly SoundRegistration[] { return [...this.requests.values()]; }
}
export interface Q3AudioTarget {
  readonly seat: SeatId;
  readonly sounds: Q3PresentationSoundBank;
  actor(sourceNumber: number): ActorId;
  frameNumber(): number;
  play(sound: PlaySound): void;
  loop(sound: LoopSound): void;
  updateActor(actor: ActorId, position: Vec3): void;
  /** The audio owner stops only this audience's channel state. */
  stopLoop(seat: SeatId, actor: ActorId): void;
}
/** Cgame one-shot and loop calls are scoped to the viewing seat's listener. */
export class Q3PresentationAudio {
  constructor(readonly target: Q3AudioTarget) {}
  startSourceSound(sound: PcmSound | null, options: StartSoundOptions): void {
    const asset = this.target.sounds.asset(sound); if (asset === null) return;
    const actor = options.entity < 0 ? null : this.target.actor(options.entity);
    const origin: SoundOrigin = options.origin.kind === "entity"
      ? { kind: "actor", actor: this.target.actor(options.origin.entity) }
      : options.origin.kind === "fixed" ? { kind: "fixed", position: { ...options.origin.position } } : { kind: "local" };
    this.target.play({ sound: asset, family: "q3", actor, origin,
      audience: { kind: "seat", seat: this.target.seat }, channel: options.channel, volume: options.volume / 127,
      attenuation: origin.kind === "local" ? 0 : 1 });
  }
  startSound(origin: Vec3 | null, entity: number, channel: number, sound: PcmSound | null): void {
    const asset = this.target.sounds.asset(sound); if (asset === null) return;
    const actor = entity < 0 ? null : this.target.actor(entity);
    let source: SoundOrigin;
    if (origin !== null) source = { kind: "fixed", position: { ...origin } };
    else { if (actor === null) throw new RangeError("Entity-attached sound requires a source actor"); source = { kind: "actor", actor }; }
    this.target.play({ sound: asset, family: "q3", actor,
      origin: source,
      audience: { kind: "seat", seat: this.target.seat }, channel, volume: 1, attenuation: 1 });
  }
  startLocalSound(sound: PcmSound | null, channel: number): void {
    const asset = this.target.sounds.asset(sound); if (asset === null) return;
    this.target.play({ sound: asset, family: "q3", actor: null,
      origin: { kind: "local" }, audience: { kind: "seat", seat: this.target.seat }, channel, volume: 1, attenuation: 0 });
  }
  addLoopSound(entity: number, origin: Vec3, velocity: Vec3, sound: PcmSound | null, realLoop: boolean): void {
    const asset = this.target.sounds.asset(sound); if (asset === null) return;
    const actor = this.target.actor(entity);
    this.target.loop({ sound: asset, family: "q3", actor, origin: { kind: "fixed", position: { ...origin } },
      audience: { kind: "seat", seat: this.target.seat }, velocity: { ...velocity }, volume: 1, attenuation: 1,
      frameNumber: this.target.frameNumber(), lifetime: realLoop ? "persistent" : "frame" });
  }
  updateSoundPosition(entity: number, origin: Vec3): void { this.target.updateActor(this.target.actor(entity), origin); }
  stopLoopingSound(entity: number): void { this.target.stopLoop(this.target.seat, this.target.actor(entity)); }
}
