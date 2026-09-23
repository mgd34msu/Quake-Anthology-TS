import type { ComponentPresentationMediaRequest } from "../../contracts/presentation.ts";
import type { ActiveModPresentation } from "../../world/session/mod-presentations.ts";
import type { ApplicationAudio, ApplicationAudioSeatEvents } from "./audio.ts";
import type { SimulationEvents } from "./simulation/events.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

export function presentationAudioControl(source: SimulationPresentationEvent): boolean {
  return source.kind === "presentation-owner" || source.kind === "music"
    || source.kind === "q2" && source.event.kind === "music"
    || source.kind === "q1-level" && source.event.kind === "finale";
}

/** Apply retained local requests in the same chronology as incoming source controls. */
export async function preparePresentationAudio(events: SimulationEvents, audio: Pick<ApplicationAudio, "playComponentMedia" | "receive">,
  source: readonly SimulationPresentationEvent[] = [], seats: readonly ApplicationAudioSeatEvents[] = []): Promise<void> {
  const pending = events.pendingLocalMedia(), local = new Set(pending);
  const ordered = [...source.filter(presentationAudioControl), ...pending].sort((a, b) => a.sequence - b.sequence);
  for (const request of ordered) {
    if (request.kind !== "presentation-owner" && request.sequence < events.appliedMediaSequence) {
      if (local.has(request)) events.acknowledgeLocalMedia(request);
      continue;
    }
    if (local.has(request)) {
      if (!events.localMediaCurrent(request)) continue;
      if (request.kind === "local-media") await audio.playComponentMedia(request, () => events.localMediaCurrent(request));
      else await audio.receive([request]);
      events.acknowledgeLocalMedia(request);
    } else if (request.kind !== "local-media") await audio.receive([request]);
    if (request.kind !== "presentation-owner") events.appliedMedia(request.sequence);
  }
  for (const batch of seats) await audio.receive(batch.events.filter(presentationAudioControl), { kind: "seat", seat: batch.seat }, batch.music);
}

export function componentMediaControl(events: SimulationEvents, audio: ApplicationAudio) {
  events.enableLocalMedia();
  return async (source: ActiveModPresentation, request: ComponentPresentationMediaRequest, initializing: boolean, assertCurrent: () => void): Promise<void> => {
    assertCurrent();
    events.publishLocalMedia(source.owner, source.identity.source.content, request, initializing);
    await preparePresentationAudio(events, audio);
    assertCurrent();
  };
}
