import type { AudioStreamTarget, StreamPcm } from "../audio/types.ts";
import type { CinematicOptions } from "./types.ts";

export interface CinematicMixer {
  queueStream(target: AudioStreamTarget, pcm: StreamPcm): void;
  stopStream(id: string): void;
  pauseStream(id: string, paused: boolean): void;
}

/** A movie has one PCM lane in the shared mixer, regardless of renderer or video format. */
export function cinematicAudio(mixer: CinematicMixer, id: string, gain = 1): Pick<CinematicOptions, "onAudio" | "onAudioReset" | "onAudioPause"> {
  return {
    onAudio(audio, target) {
      mixer.queueStream({ id, gain, audience: target.kind === "seat" ? target : { kind: "world" } }, audio);
    },
    onAudioReset() { mixer.stopStream(id); },
    onAudioPause(paused) { mixer.pauseStream(id, paused); },
  };
}
