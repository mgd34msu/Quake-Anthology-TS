import { CdMusic, MusicPlayer, remapQ2MusicTrack } from "../../../audio/index.ts";
import type { SoundBank, UnifiedAudio } from "../../../audio/index.ts";
import type { PcmStream } from "../../../audio/streams.ts";
import type { ContentId, GameFamily } from "../../../contracts/content.ts";

/** One world soundtrack owns the shared engine's intro/loop stream. */
export class ApplicationMusic {
  private current: { readonly content: ContentId; readonly player: MusicPlayer; readonly cd: CdMusic; track: string } | null = null;
  private request = 0;
  private gain = 0.25;
  private paused = false;

  constructor(private readonly engine: UnifiedAudio, private readonly print: (text: string) => undefined) {}

  get volume(): number { return this.gain; }
  set volume(value: number) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid music volume");
    this.gain = value;
    this.current?.player.setVolume(value);
  }

  pause(paused: boolean): void { this.paused = paused; if (this.current !== null) this.current.player.paused = paused; }

  stop(): void {
    this.request++;
    this.current?.cd.stop();
    this.engine.stopMusic("world");
    this.current = null;
  }

  async play(content: ContentId, family: GameFamily, campaign: string, bank: SoundBank, track: string): Promise<void> {
    const selected = track.trim();
    if (selected === "" || selected === "0") { this.stop(); return; }
    if (this.current?.content === content && this.current.track === selected && this.current.player.playing) return;
    this.stop();
    const request = this.request;
    const player = new MusicPlayer(this.engine.sampleRate, family);
    player.setVolume(this.gain);
    const cd = new CdMusic(player, path => bank.openMusic(path));
    this.current = { content, player, cd, track: selected };
    this.engine.attachMusic({ id: "world", audience: { kind: "world" }, gain: 1 }, player);
    if (/^[0-9]+$/.test(selected) && family !== "q3") {
      const number = Number(selected);
      const mapped = family === "q2" ? remapQ2MusicTrack(number, campaign) : number;
      const played = await cd.play(mapped, true);
      if (request !== this.request) return;
      if (!played) this.print(`Music unavailable: ${content}/${selected}\n`);
      player.paused = this.paused;
      return;
    }
    // CG_StartMusic accepts an intro and an optional loop token; an omitted loop repeats the intro.
    const [introName = "", loopName] = selected.match(/"[^"]*"|\S+/g)?.map(token => token.replace(/^"|"$/g, "")) ?? [];
    const open = async (name: string): Promise<PcmStream | null> => {
      const path = name.startsWith("music/") ? name : `music/${name}`;
      const candidates = /\.(?:wav|ogg)$/i.test(path) ? [path] : family === "q3" ? [`${path}.wav`, `${path}.ogg`] : [`${path}.ogg`, `${path}.wav`];
      for (const candidate of candidates) {
        const stream = await bank.openMusic(candidate);
        if (stream !== null) return stream;
      }
      return null;
    };
    const intro = await open(introName);
    if (intro === null) { if (request === this.request) this.print(`Music unavailable: ${content}/${introName}\n`); return; }
    const loop = loopName === undefined || loopName === "" || loopName === introName ? intro : await open(loopName);
    if (request !== this.request) { intro.close(); if (loop !== intro) loop?.close(); return; }
    player.start(intro, loop);
    player.paused = this.paused;
  }
}
