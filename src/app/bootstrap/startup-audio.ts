import { menuSoundPath } from "./audio/menu.ts";
import { SoundBank, UnifiedAudio } from "../../audio/index.ts";
import type { SoundAsset } from "../../audio/index.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { GameFamily } from "../../contracts/content.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { UiSound } from "../../ui/common/controller.ts";
import { ApplicationMusic } from "./audio/music.ts";
import type { MusicSource } from "./audio/music.ts";
import type { AudioPreferences } from "./audio-settings.ts";

/** The frontend uses the same mixer and music decoder as a gameplay session. */
export class StartupAudio {
  readonly engine = new UnifiedAudio({ milliseconds: () => Math.trunc(performance.now()), random: () => 0 });
  private readonly music: ApplicationMusic;
  private readonly bank: SoundBank;
  private readonly sounds = new Map<UiSound, SoundAsset>();
  private closed = false;

  private constructor(mounts: MountedContent, private readonly family: GameFamily, private readonly seat: SeatId,
    print: (text: string) => undefined, preferences: Partial<AudioPreferences>) {
    this.bank = new SoundBank(mounts);
    this.music = new ApplicationMusic(this.engine, print, "immediate");
    this.setVolumes(preferences.effectsVolume ?? 0.7, preferences.musicVolume ?? 0.25);
    this.engine.setListeners([{ seat, actor: null, origin: { x: 0, y: 0, z: 0 },
      axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false }]);
  }

  static async open(options: { readonly mounts: MountedContent; readonly source: MusicSource;
    readonly theme: { readonly mounts: MountedContent; readonly source: MusicSource } | null;
    readonly seat: SeatId; readonly print: (text: string) => undefined; readonly preferences: Partial<AudioPreferences> }): Promise<StartupAudio> {
    const audio = new StartupAudio(options.mounts, options.source.family, options.seat, options.print, options.preferences);
    try {
      const events: readonly UiSound[] = ["open", "close", "move", "change", "reject"];
      for (const event of events) {
        const sound = await audio.bank.register(menuSoundPath(options.source.family, event), options.source.family);
        if (sound !== null) audio.sounds.set(event, sound);
      }
      const fallback = options.source.family === "q1" ? ["music/track02", "music/02"]
        : options.source.family === "q2" ? ["music/02", "music/track02"] : ["music/sonic5"];
      const candidates = [{ mounts: options.mounts, source: options.source, names: fallback }];
      if (options.theme !== null) candidates.unshift({ ...options.theme, names: ["music/track77"] });
      music: for (const candidate of candidates) for (const name of candidate.names) for (const extension of ["ogg", "wav"]) {
        const path = name + "." + extension;
        if (await candidate.mounts.resolve(path) === null) continue;
        await audio.music.play(candidate.source, new SoundBank(candidate.mounts), path);
        break music;
      }
      return audio;
    } catch (error) { audio.close(); throw error; }
  }

  openOutput(deviceName: string | null, print: (text: string) => undefined): void {
    try { this.engine.openDevice({ deviceName }); }
    catch (error) {
      if (deviceName === null) throw error;
      print(`Audio output ${deviceName} unavailable: ${error instanceof Error ? error.message : String(error)}. Using system default.\n`);
      this.engine.openDevice();
    }
  }
  cdCommand(args: readonly string[], print: (text: string) => void): void {
    if (!this.closed) this.music.cdCommand(args, print);
  }
  setVolumes(effects: number, music: number): void {
    if (this.closed) return;
    this.engine.setEffectsVolume(effects); this.music.volume = music;
  }
  sound(event: UiSound): void {
    if (this.closed) return;
    const sound = this.sounds.get(event);
    if (sound !== undefined) this.engine.play({ sound, family: this.family, actor: null, origin: { kind: "local" },
      audience: { kind: "seat", seat: this.seat }, channel: 0, volume: 1, attenuation: 0 });
  }
  pump(): void { if (!this.closed) { this.engine.updateMusic(); this.engine.pump(); } }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.music.stop(); this.engine.close(); this.bank.clear(); this.sounds.clear();
  }
}
