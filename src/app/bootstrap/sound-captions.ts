import type { UnifiedAudio } from "../../audio/index.ts";
import type { AudioVoiceEvent } from "../../audio/types.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { ActiveCaption, CaptionPreferences } from "../../text/captions.ts";
import { SeatMediaCaptions } from "../../text/media-captions.ts";
import type { LoadedApplicationContent } from "./content.ts";

type StartedVoice = Extract<AudioVoiceEvent, { readonly kind: "start" }>;
interface CaptionVoice { readonly event: StartedVoice; captions: SeatMediaCaptions | null; language: string; stopSample: number | null; }

/** Source-authored sound sidecars follow the actual per-seat mixer voice, including replacement. */
export class SeatSoundCaptions {
  private readonly voices = new Map<number, CaptionVoice>();
  private readonly catalogs = new Map<string, SeatMediaCaptions>();
  private closed = false;
  private readonly dispose: () => void;
  constructor(private readonly seat: SeatId, private readonly audio: Pick<UnifiedAudio, "observeVoices" | "voiceClock">, private readonly language: () => string) {
    this.dispose = audio.observeVoices(event => {
      if (!event.seat.equals(this.seat)) return;
      if (event.kind === "start") this.voices.set(event.voiceId, { event, captions: null, language: "", stopSample: null });
      else { const voice = this.voices.get(event.voiceId); if (voice !== undefined) voice.stopSample = event.outputSample; }
    });
  }
  async prepare(content: Pick<LoadedApplicationContent, "forContent">): Promise<void> {
    const clock = this.audio.voiceClock;
    for (const [id, voice] of this.voices) {
      if (voice.stopSample !== null && clock.outputSample >= voice.stopSample) { this.voices.delete(id); continue; }
      const reference = voice.event.sound.reference;
      if (reference === undefined) continue;
      const language = this.language();
      if (voice.captions !== null && voice.language === language) continue;
      const key = `${reference.provenance.mount.identity.content}:${reference.requestedPath}:${language}`;
      let captions = this.catalogs.get(key);
      if (captions === undefined) {
        const mounts = await content.forContent(reference.provenance.mount.identity.content);
        if (this.closed || this.voices.get(id) !== voice) continue;
        captions = new SeatMediaCaptions(this.seat, async path => (await mounts.open(path))?.bytes ?? null, null, "caption");
        this.catalogs.set(key, captions);
        await captions.prepare(reference.requestedPath, language);
      }
      if (this.closed || this.voices.get(id) !== voice) continue;
      voice.captions = captions; voice.language = language;
    }
  }
  active(preferences: CaptionPreferences): readonly ActiveCaption[] {
    const now = this.audio.voiceClock;
    return [...this.voices.values()].flatMap(voice => {
      if (voice.captions === null || now.outputSample < voice.event.outputSample || voice.stopSample !== null && now.outputSample >= voice.stopSample) return [];
      const source = voice.event.sound.reference?.requestedPath;
      if (source === undefined) return [];
      const sourceTimeMilliseconds = voice.event.sourceOffsetSeconds * 1000 + (now.outputSample - voice.event.outputSample) * 1000 / voice.event.sampleRate;
      return voice.captions.active({ source, sourceTimeMilliseconds, status: now.paused ? "paused" : "playing" }, preferences);
    });
  }
  close(): void { this.closed = true; this.dispose(); for (const captions of this.catalogs.values()) captions.clear(); this.catalogs.clear(); this.voices.clear(); }
}
