import { musicFileCue, shuffledTracks } from "./playlist.ts";
import { MusicControls } from "../../../audio/music.ts";
import { CdMusic, MusicPlayer, remapQ2MusicTrack } from "../../../audio/index.ts";
import type { SoundBank, UnifiedAudio } from "../../../audio/index.ts";
import type { PcmStream } from "../../../audio/streams.ts";
import type { ContentId, GameFamily } from "../../../contracts/content.ts";
import type { InstalledCatalog } from "../../../content/catalog/index.ts";
import type { OpenMusicTrack, MusicVolumeMode } from "../../../audio/music.ts";

export interface MusicSource {
  readonly content: ContentId;
  readonly family: GameFamily;
  readonly edition: string;
  readonly campaign: string;
}

export function worldMusicTrack(world: ReadonlyMap<string, string> | undefined, source: Pick<MusicSource, "family" | "edition">): string {
  if (source.family === "q3") return world?.get("music") ?? "";
  const music = source.family === "q2" && source.edition === "rerelease" ? world?.get("music") ?? "" : "";
  return music !== "" ? music : world?.get("sounds") ?? "";
}

/** Only the official original campaigns share numbered soundtracks across Q1 editions. */
export function q1MusicFallback(content: ContentId, catalog: InstalledCatalog): ContentId | null {
  const pairs = [["q1-classic-id1", "q1-rerelease-id1"], ["q1-classic-hipnotic", "q1-rerelease-hipnotic"], ["q1-classic-rogue", "q1-rerelease-rogue"]];
  const selected = catalog.product(content);
  const pair = pairs.find(ids => ids.includes(selected.expectation.id));
  const alternate = pair?.find(id => id !== selected.expectation.id);
  const product = catalog.products.find(candidate => candidate.expectation.id === alternate && candidate.availability.kind === "installed");
  return product?.id ?? null;
}

/** One world soundtrack owns the shared engine's intro/loop stream. */
export class ApplicationMusic {
  private current: {
    readonly source: MusicSource; readonly bank: SoundBank; readonly fallback: OpenMusicTrack | null;
    readonly player: MusicPlayer; readonly cd: CdMusic; readonly opener: { open: OpenMusicTrack };
    track: string; looping: boolean; authoredCue: string;
  } | null = null;
  private automatic: { readonly cue: string; readonly tracks: readonly string[]; bag: string[]; shuffle: boolean; completed: number } | null = null;
  private request = 0;
  private gain = 0.25;

  constructor(private readonly engine: UnifiedAudio, private readonly print: (text: string) => undefined, private readonly volumeMode: MusicVolumeMode = "source", readonly controls: MusicControls = new MusicControls(), private readonly random: () => number = Math.random) {}

  get volume(): number { return this.gain; }
  set volume(value: number) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid music volume");
    this.gain = value; this.current?.player.setVolume(value);
  }

  select(source: MusicSource, bank: SoundBank, fallback: OpenMusicTrack | null = null): void {
    if (this.current?.source.content === source.content && this.current.bank === bank) return;
    this.stop();
    const player = new MusicPlayer(this.engine.sampleRate, source.family, this.volumeMode, this.controls);
    player.setVolume(this.gain);
    const opener = { open: (path: string) => bank.openMusic(path) };
    const cd = new CdMusic(player, path => opener.open(path));
    this.current = { source, bank, fallback, player, cd, opener, track: "", looping: false, authoredCue: "" };
  }

  async musicCommand(args: readonly string[], print: (text: string) => void = this.print): Promise<void> {
    if (args.length < 1 || args.length > 2 || args.some(value => value.trim() === "")) { print("music <intro> [loop]\n"); return; }
    if (this.current === null) { print("No soundtrack source selected.\n"); return; }
    this.automatic = null;
    await this.startTrack(args.map(musicFileCue).join(" "), args.length === 2, false);
  }

  async cdCommand(args: readonly string[], print: (text: string) => void = this.print): Promise<void> {
    const command = args[0]?.toLowerCase();
    if (command === undefined) return;
    if (command === "close" || command === "eject") { print(`cd ${command}: disc tray operations are unavailable with file-backed music.\n`); return; }
    const current = this.current;
    if (command === "info") {
      if (!this.controls.enabled) print("CD music is disabled.\n");
      else if (current?.player.playing) {
        const mapped = current.cd.playingTrack;
        const track = mapped !== null && String(mapped) !== current.track ? `${current.track} (mapped to ${mapped})` : current.track;
        print(`${current.player.paused ? "Paused" : "Currently"} ${current.looping ? "looping" : "playing"} track ${track}\n`);
      }
      else print("Not playing.\n");
      print(`Volume is ${this.gain}\n`); return;
    }
    if (command === "on") { this.controls.enabled = true; return; }
    if (command === "off") { this.stopPlayback("manual"); this.controls.enabled = false; return; }
    if (command === "stop") { this.stopPlayback("manual"); return; }
    if (command === "reset") { this.stopPlayback("manual"); this.controls.reset(); return; }
    if (command === "remap") {
      if (args.length === 1) {
        this.controls.remappedTracks.forEach((track, index) => { if (track !== index + 1) print(`  ${index + 1} -> ${track}\n`); });
        return;
      }
      const tracks = args.slice(1).map(value => /^\d+$/.test(value) ? Number(value) : NaN);
      if (tracks.length > 99 || tracks.some(track => !Number.isSafeInteger(track) || track < 0 || track > 255)) {
        print("cd remap requires at most 99 track numbers from 0 through 255.\n"); return;
      }
      this.controls.setRemap(tracks); return;
    }
    if (current === null) {
      if (command !== "pause" && command !== "resume") print("No soundtrack source selected.\n");
      return;
    }
    if (command === "play" || command === "loop") {
      const argument = args[1] ?? "", track = /^\d+$/.test(argument) ? Number(argument) : NaN;
      if (args.length !== 2 || !Number.isSafeInteger(track) || track < 1 || track > 255) {
        print(`cd ${command} <track 1..255>\n`); return;
      }
      this.automatic = null;
      await this.startTrack(String(track), command === "loop", true); return;
    }
    if (command === "pause" || command === "resume") {
      if (command === "pause") current.cd.pause(); else current.cd.resume();
      return;
    }

    print(`Unknown cd command: ${command}.\n`);
  }

  stopPlayback(reason: "manual" | "source"): void {
    this.automatic = null;
    if (reason === "source" && this.current !== null) this.current.authoredCue = "";
    this.clearPlayback();
  }

  invalidatePending(): void { this.request++; this.current?.cd.invalidatePending(); }

  private clearPlayback(): void {
    this.request++; this.current?.cd.stop(); this.engine.stopMusic("world");
  }

  /** Retire the selected content as well as playback when its application closes. */
  stop(): void { this.stopPlayback("source"); this.current = null; }

  async play(source: MusicSource, bank: SoundBank, track: string, fallback: OpenMusicTrack | null = null, playlist: { readonly shuffle: boolean; readonly tracks: readonly string[] } | null = null): Promise<void> {
    this.select(source, bank, fallback);
    const selected = track.trim();
    if (playlist !== null && this.current?.authoredCue === selected && this.automatic === null) return;
    if (this.current !== null) this.current.authoredCue = selected;
    if (selected === "" || selected === "0") { this.automatic = null; this.clearPlayback(); return; }
    const current = this.current;
    if (current === null) return;
    const shuffle = source.family === "q2" && playlist !== null && playlist.shuffle && playlist.tracks.length > 0;
    if (this.automatic?.cue === selected && this.automatic.shuffle === shuffle && current.player.playing) return;
    this.automatic = { cue: selected, tracks: playlist?.tracks ?? [], bag: [], shuffle, completed: current.player.completedPlays };
    if (shuffle) await this.nextAutomaticTrack(); else await this.startTrack(selected, true, false);
  }

  async updateAutomatic(shuffle: boolean): Promise<void> {
    const automatic = this.automatic, current = this.current;
    if (automatic === null || current === null || !this.controls.enabled || current.player.paused) return;
    const enabled = current.source.family === "q2" && shuffle && automatic.tracks.length > 0;
    if (enabled !== automatic.shuffle) {
      automatic.shuffle = enabled;
      automatic.completed = current.player.completedPlays;
      if (enabled) await this.nextAutomaticTrack(); else await this.startTrack(automatic.cue, true, false);
    } else if (enabled && automatic.completed !== current.player.completedPlays) {
      automatic.completed = current.player.completedPlays;
      await this.nextAutomaticTrack();
    }
  }

  private async nextAutomaticTrack(): Promise<void> {
    const automatic = this.automatic, current = this.current;
    if (automatic === null || current === null) return;
    if (automatic.bag.length === 0) automatic.bag = shuffledTracks(automatic.tracks, current.track, this.random);
    while (automatic.bag.length > 0 && this.automatic === automatic && this.controls.enabled) {
      const track = automatic.bag.shift();
      if (track === undefined) return;
      await this.startTrack(musicFileCue(track), false, false);
      if (current.player.playing) return;
    }
  }

  private async startTrack(selected: string, looping: boolean, numbered: boolean): Promise<void> {
    const current = this.current;
    if (current === null || !current.cd.enabled) return;
    const { source: { content, family, edition, campaign }, bank, fallback, player, cd, opener } = current;
    const numeric = /^[0-9]+$/.test(selected) && (family !== "q3" || numbered);
    const mapped = !numeric ? null : family === "q2"
      ? remapQ2MusicTrack(Number(selected), edition === "rerelease" ? { kind: "remastered", campaign } : { kind: "disc" }) : Number(selected);
    if (current.track === selected && current.looping === looping && player.playing
      && (mapped === null || cd.playingTrack === (cd.remappedTracks[mapped - 1] ?? mapped))) return;
    this.clearPlayback();
    const request = this.request;
    current.track = selected; current.looping = looping;
    opener.open = path => bank.openMusic(path);
    this.engine.attachMusic({ id: "world", audience: { kind: "world" }, gain: 1 }, player);
    if (mapped !== null) {
      let played = await cd.play(mapped, looping);
      if (!played && family === "q1" && fallback !== null && request === this.request) {
        opener.open = fallback; played = await cd.play(mapped, looping);
      }
      if (request !== this.request || !this.controls.enabled) return;
      if (!played) this.print(`Music unavailable: ${content}/${selected}\n`);
      return;
    }
    const [introName = "", loopName] = selected.match(/"[^"]*"|\S+/g)?.map(token => token.replace(/^"|"$/g, "")) ?? [];
    const open = async (name: string): Promise<PcmStream | null> => {
      const normalized = name.replaceAll("\\", "/");
      const path = normalized.startsWith("music/") ? normalized : `music/${normalized}`;
      const candidates = /\.(?:wav|ogg)$/i.test(path) ? [path] : family === "q3" ? [`${path}.wav`, `${path}.ogg`] : [`${path}.ogg`, `${path}.wav`];
      for (const openTrack of [opener.open, family === "q1" ? fallback : null]) {
        if (openTrack === null) continue;
        for (const candidate of candidates) {
          const stream = await openTrack(candidate);
          if (stream !== null) return stream;
          if (request !== this.request || !this.controls.enabled) return null;
        }
      }
      return null;
    };
    const intro = await open(introName);
    if (intro === null) { if (request === this.request) this.print(`Music unavailable: ${content}/${introName}\n`); return; }
    if (request !== this.request || !this.controls.enabled) { intro.close(); return; }
    const loop = !looping ? null : loopName === undefined || loopName === "" || loopName === introName ? intro : await open(loopName);
    if (request !== this.request || !this.controls.enabled) { intro.close(); if (loop !== intro) loop?.close(); return; }
    current.looping = loop !== null; player.start(intro, loop);
  }
}
