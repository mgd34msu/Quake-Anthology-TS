import type { ComponentPresentationMediaRequest } from "../../contracts/presentation.ts";
import type { ActiveModPresentation } from "../../world/session/mod-presentations.ts";
import type { ApplicationAudio, ApplicationAudioSeatEvents } from "./audio.ts";
import type { PresentationState } from "./presentation-state.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import type { ApplicationAssets } from "./assets.ts";

export function presentationAudioControl(source: SimulationPresentationEvent): boolean {
  return source.kind === "presentation-owner" || source.kind === "music"
    || source.kind === "q2" && source.event.kind === "music"
    || source.kind === "q1-level" && source.event.kind === "finale";
}

/** Apply retained local requests in the same chronology as incoming source controls. */
export async function preparePresentationAudio(events: PresentationState, audio: Pick<ApplicationAudio, "playComponentMedia" | "receive">,
  source: readonly SimulationPresentationEvent[] = [], seats: readonly ApplicationAudioSeatEvents[] = []): Promise<void> {
  const pending = events.pendingLocalMedia().filter(request => request.kind !== "local-media" || request.event.kind !== "shader-remap"), local = new Set(pending);
  const ordered = [...source.filter(presentationAudioControl), ...pending].sort((a, b) => a.sequence - b.sequence);
  for (const request of ordered) {
    if (request.kind !== "presentation-owner" && request.sequence < events.appliedMediaSequence) {
      if (local.has(request)) events.acknowledgeLocalMedia(request);
      continue;
    }
    if (local.has(request)) {
      if (!events.localMediaCurrent(request)) continue;
      if (request.kind === "local-media") {
        if (request.event.kind === "shader-remap") continue;
        await audio.playComponentMedia({ ...request, event: request.event }, () => events.localMediaCurrent(request));
      }
      else await audio.receive([request]);
      events.acknowledgeLocalMedia(request);
    } else if (request.kind !== "local-media") await audio.receive([request]);
    if (request.kind !== "presentation-owner") events.appliedMedia(request.sequence);
  }
  for (const batch of seats) await audio.receive(batch.events.filter(presentationAudioControl), { kind: "seat", seat: batch.seat }, batch.music);
}

const shaderDeliveries = new WeakMap<PresentationState, Promise<void>>();

export async function preparePresentationShaders(events: PresentationState, assets: Pick<ApplicationAssets, "provider" | "world">): Promise<void> {
  for (;;) { const pending = shaderDeliveries.get(events); if (pending === undefined) break; await pending; }
  const delivery = drainPresentationShaders(events, assets);
  shaderDeliveries.set(events, delivery);
  try { await delivery; }
  finally { if (shaderDeliveries.get(events) === delivery) shaderDeliveries.delete(events); }
}

async function drainPresentationShaders(events: PresentationState, assets: Pick<ApplicationAssets, "provider" | "world">): Promise<void> {
  for (;;) {
    const pending = events.pendingLocalMedia().find(request => request.kind === "local-media" && request.event.kind === "shader-remap");
    if (pending === undefined) return;
    if (pending.kind !== "local-media") throw new Error("Shader delivery requires local media");
    const request = events.resolveShaderReplay(pending);
    if (request === null) continue;
    if (request.event.kind !== "shader-remap") throw new Error("Shader delivery requires a material cue");
    const current = (): boolean => events.localMediaCurrent(request);
    if (!current()) { events.acknowledgeLocalMedia(request, false); continue; }
    const shaders = request.event.original === request.event.replacement ? assets.world.shaders : (await assets.provider(request.content)).shaders;
    if (!current()) { events.acknowledgeLocalMedia(request, false); continue; }
    const result = await assets.world.remapShader(request.event.original, request.event.replacement, request.event.timeOffset, { source: shaders, current });
    if (result === "stale" && current()) throw new Error("Shader destination changed before local media delivery");
    events.acknowledgeLocalMedia(request, result === "committed");
    if (result !== "stale") events.appliedShader(request.event.original, request.sequence);
  }
}

export function primaryShaderControl(events: PresentationState, assets: ApplicationAssets, sourceCurrent: () => boolean) {
  events.enableLocalMedia();
  return async (original: string, replacement: string, offset: string, initializing: boolean, consumerCurrent: () => boolean): Promise<void> => {
    const current = (): boolean => sourceCurrent() && consumerCurrent();
    if (!current()) throw new Error("Shader consumer is retired");
    const parsed = Number.parseFloat(offset), timeOffset = Number.isNaN(parsed) ? 0 : parsed;
    events.publishLocalMedia(undefined, assets.content.recipe.engineBehavior.content, { kind: "shader-remap", original, replacement, timeOffset }, initializing, current);
    await preparePresentationShaders(events, assets);
    if (!current()) throw new Error("Shader consumer is retired");
  };
}

export function componentMediaControl(events: PresentationState, audio: ApplicationAudio, assets: ApplicationAssets) {
  events.enableLocalMedia();
  return async (source: ActiveModPresentation, request: ComponentPresentationMediaRequest, initializing: boolean, current: () => boolean): Promise<void> => {
    if (!current()) throw new Error("Component media consumer is retired");
    events.publishLocalMedia(source.owner, source.identity.source.content, request, initializing, request.kind === "shader-remap" ? current : undefined);
    if (request.kind === "shader-remap") await preparePresentationShaders(events, assets);
    else await preparePresentationAudio(events, audio);
    if (!current()) throw new Error("Component media consumer is retired");
  };
}
