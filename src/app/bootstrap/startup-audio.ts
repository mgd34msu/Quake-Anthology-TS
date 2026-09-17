import { mountedMusicTracks, musicFileCue } from "./audio/playlist.ts";
import { readMusicSettings, type MusicPreferences } from "./audio/playlist-settings.ts";
import type { AudioOutputFormat } from "../../audio/output.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { readAudioOutputCvars, writeAudioOutputCvars } from "./audio/output-settings.ts";
import type { MusicControls } from "../../audio/music.ts";
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
  readonly engine: UnifiedAudio;
  private outputCvars: CvarRegistry | null = null;
  get outputFormat(): AudioOutputFormat { return this.engine.outputFormat; }
  bindOutputCvars(cvars: CvarRegistry): void { this.outputCvars = cvars; }
  selectOutputFormat(format: AudioOutputFormat): void {
    this.engine.selectOutput(this.engine.selectedOutput, format);
    if (this.outputCvars !== null) writeAudioOutputCvars(this.outputCvars, this.outputFormat);
  }
  restartOutput(): void {
    this.engine.selectOutput(this.engine.selectedOutput, this.outputCvars === null ? this.outputFormat : readAudioOutputCvars(this.outputCvars), true);
  }
  private readonly music: ApplicationMusic;
  private readonly candidates: { readonly mounts: MountedContent; readonly source: MusicSource; readonly names: readonly string[]; readonly bank: SoundBank }[] = [];
  private menuTrack: string | null = null;
  private tracks: readonly string[] = [];
  get musicTracks(): readonly string[] { return this.tracks; }
  get musicPreferences(): MusicPreferences { return this.outputCvars === null ? { musicShuffle: false, menuTrack: this.menuTrack ?? "auto" } : readMusicSettings(this.outputCvars); }
  private readonly commands: { readonly name: "cd" | "music"; readonly args: readonly string[]; readonly print: (text: string) => void }[] = [];
  private readonly bank: SoundBank;
  private readonly sounds = new Map<UiSound, SoundAsset>();
  private closed = false;

  private constructor(mounts: MountedContent, private readonly family: GameFamily, private readonly seat: SeatId,
    private readonly print: (text: string) => undefined, preferences: Partial<AudioPreferences>, controls?: MusicControls) {
    this.engine = new UnifiedAudio({ milliseconds: () => Math.trunc(performance.now()), random: () => 0,
      ...(preferences.outputFormat === undefined ? {} : { outputFormat: preferences.outputFormat }) });
    this.bank = new SoundBank(mounts);
    this.music = new ApplicationMusic(this.engine, print, "immediate", controls);
    this.setVolumes(preferences.effectsVolume ?? 0.7, preferences.musicVolume ?? 0.25);
    this.engine.setListeners([{ seat, actor: null, origin: { x: 0, y: 0, z: 0 },
      axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false }]);
  }

  static async open(options: { readonly musicControls?: MusicControls; readonly mounts: MountedContent; readonly source: MusicSource;
    readonly theme: { readonly mounts: MountedContent; readonly source: MusicSource } | null;
    readonly seat: SeatId; readonly print: (text: string) => undefined; readonly preferences: Partial<AudioPreferences> }): Promise<StartupAudio> {
    const audio = new StartupAudio(options.mounts, options.source.family, options.seat, options.print, options.preferences, options.musicControls);
    try {
      const events: readonly UiSound[] = ["open", "close", "move", "change", "reject"];
      for (const event of events) {
        const sound = await audio.bank.register(menuSoundPath(options.source.family, event), options.source.family);
        if (sound !== null) audio.sounds.set(event, sound);
      }
      audio.music.select(options.source, audio.bank);
      const fallback = options.source.family === "q1" ? ["music/track02", "music/02"]
        : options.source.family === "q2" ? ["music/02", "music/track02"] : ["music/sonic5"];
      audio.candidates.push({ mounts: options.mounts, source: options.source, names: fallback, bank: audio.bank });
      if (options.theme !== null) audio.candidates.unshift({ ...options.theme, names: ["music/track77"], bank: new SoundBank(options.theme.mounts) });
      audio.tracks = [...new Set((await Promise.all(audio.candidates.map(candidate => mountedMusicTracks(candidate.mounts)))).flat())].sort();
      await audio.selectMenuTrack(options.preferences.menuTrack ?? "auto");
      return audio;
    } catch (error) { audio.close(); throw error; }
  }

  private async selectMenuTrack(value: string): Promise<void> {
    if (this.closed || this.menuTrack === value) return;
    this.menuTrack = value;
    this.music.stopPlayback("source");
    if (value === "0") return;
    for (const candidate of this.candidates) {
      const number = /^\d+$/.test(value) ? String(Number(value)).padStart(2, "0") : null;
      const names = value === "auto" ? candidate.names : number !== null ? [`music/${number}`, `music/track${number}`]
        : [value.startsWith("music/") ? value : `music/${value}`];
      for (const name of names) for (const path of /\.(?:ogg|wav)$/i.test(name) ? [name] : [`${name}.ogg`, `${name}.wav`]) {
        const resolved = await candidate.mounts.resolve(path);
        if (this.closed || this.menuTrack !== value) return;
        if (resolved === null) continue;
        await this.music.play(candidate.source, candidate.bank, musicFileCue(path));
        return;
      }
    }
    if (value !== "auto") this.print(`Menu music unavailable: ${value}\n`);
  }

  openOutput(deviceName: string | null, print: (text: string) => undefined): void {
    try { this.engine.openDevice({ deviceName }); }
    catch (error) {
      if (deviceName === null) throw error;
      print(`Audio output ${deviceName} unavailable: ${error instanceof Error ? error.message : String(error)}. Using system default.\n`);
      this.engine.openDevice();
    }
  }
  async cdCommand(args: readonly string[], print: (text: string) => void): Promise<void> {
    if (!this.closed) await this.music.cdCommand(args, print);
  }
  queueCdCommand(args: readonly string[], print: (text: string) => void): void {
    if (!this.closed) this.commands.push({ name: "cd", args: [...args], print });
  }
  queueMusicCommand(args: readonly string[], print: (text: string) => void): void {
    if (!this.closed) this.commands.push({ name: "music", args: [...args], print });
  }
  async flushCommands(): Promise<void> {
    if (this.outputCvars !== null) await this.selectMenuTrack(readMusicSettings(this.outputCvars).menuTrack);
    while (!this.closed) {
      const command = this.commands.shift();
      if (command === undefined) return;
      if (command.name === "cd") await this.cdCommand(command.args, command.print);
      else await this.music.musicCommand(command.args, command.print);
    }
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
    this.closed = true; this.commands.length = 0; this.music.stop(); this.engine.close(); this.bank.clear(); for (const candidate of this.candidates) candidate.bank.clear(); this.sounds.clear();
  }
}
