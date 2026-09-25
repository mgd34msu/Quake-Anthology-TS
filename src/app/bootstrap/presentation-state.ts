import { presentationOwnerKey, samePresentationOwner, type PresentationOwner, type ComponentPresentationMediaRequest } from "../../contracts/presentation.ts";
import { SimulationQ1Fog, type SimulationQ1FogOptions } from "./simulation/q1-fog.ts";
import type { ContentId, ResolvedResourceReference, ResourceId } from "../../contracts/content.ts";
import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { SceneLightStyle } from "../../contracts/scene.ts";
import type { SourceTime } from "../../contracts/time.ts";
import type { Q2PresentationEvent } from "../../content/q2/foundation/host.ts";
import type { SimulationPresentationEvent, SourcePresentationEvent } from "./simulation/types.ts";
import { readSavedActor, savedActorId } from "../../persistence/save-image.ts";
import { namespaced, SaveReader } from "../../persistence/value.ts";
import { readContentId } from "../../persistence/recipe.ts";
import { readVector } from "../../persistence/shared.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import { normalizeShaderName, stripShaderExtension } from "../../materials/material.ts";

export interface LocalPresentationMedia {
  readonly kind: "local-media";
  readonly event: ComponentPresentationMediaRequest;
  readonly owner?: PresentationOwner;
  readonly content: ContentId;
  readonly sequence: number;
  readonly seconds: number;
}
type RetainedPresentation = SimulationPresentationEvent | LocalPresentationMedia;
function q2LoopKey(event: Extract<Q2PresentationEvent, { readonly kind: "sound" }>, recipient?: ActorId): string {
  return JSON.stringify(["sound", event.loopOwner ?? null, event.actor?.slot ?? -1, event.actor?.generation ?? -1, event.channel, event.path,
    recipient === undefined ? null : [recipient.slot, recipient.generation]]);
}

/** Retains source events until the application resolves their content-owned media. */
export class PresentationState {
  private presentationSequence = 0;
  private nextOwnerGeneration = 1;
  private legacyPersistence = false;
  private readonly owners = new Map<ProviderId, { readonly token: PresentationOwner; readonly content: ContentId; readonly fog: SimulationQ1Fog | null; status: "restored" | "active" }>();
  private readonly source: SimulationPresentationEvent[] = [];
  protected readonly resources = new Map<string, ResolvedResourceReference>();
  private readonly resourcesById = new Map<ResourceId, ResolvedResourceReference>();
  private readonly styles = new Map<number, { readonly family: "q1" | "q2"; readonly pattern: string }>();
  private readonly legacyStyles = new Map<number, { readonly family: "q1" | "q2"; readonly pattern: string }>();
  private readonly persistent = new Map<string, RetainedPresentation>();
  private readonly localMediaOutput = new Map<number, { readonly request: RetainedPresentation; readonly retain: boolean; readonly shaderReplay?: true; readonly current?: () => boolean }>();
  private localMediaEnabled = false;
  private mediaSequence = -1;
  private readonly shaderSequences = new Map<string, number>();
  private restoredThrough = -1;
  private restoredOwnerGeneration = 0;

  private readonly fog: SimulationQ1Fog | null;

  constructor(protected readonly now: () => SourceTime, protected readonly sourceSlot: (actor: ActorId) => number | null,
    private readonly fogOptions: SimulationQ1FogOptions | null = null) { this.fog = fogOptions === null ? null : new SimulationQ1Fog(fogOptions); }

  private ownerFog(content: ContentId): SimulationQ1Fog | null {
    return this.fogOptions === null ? null : new SimulationQ1Fog({ ...this.fogOptions,
      acceptedContents: new Set([...(this.fogOptions.acceptedContents ?? []), content]) });
  }

  bindOwner(provider: ProviderId, content: ContentId, restoring: boolean): Pick<PresentationState, "emit" | "registerResource"> & { readonly owner: PresentationOwner; close(): undefined } {
    const prior = this.owners.get(provider);
    if (prior?.status === "active") throw new Error(`Presentation owner is already active: ${provider}`);
    if (prior !== undefined && (!restoring || prior.content !== content)) throw new Error(`Restored presentation owner differs: ${provider}`);
    if (restoring && this.legacyPersistence && ([...this.persistent.values()].some(event => event.content === content)
      || this.fog?.presentation().some(event => event.content === content) === true))
      throw new Error(`Legacy save has persistent presentation in component ${provider}'s content without recorded ownership; primary and component output cannot be distinguished`);
    if (prior === undefined && !Number.isSafeInteger(this.nextOwnerGeneration + 1)) throw new Error("Presentation owner generation exhausted");
    const entry = prior ?? { token: { provider, generation: this.nextOwnerGeneration++ }, content, fog: this.ownerFog(content), status: "active" };
    entry.status = "active"; this.owners.set(provider, entry);
    let closed = false;
    const current = (): void => { if (closed || this.owners.get(provider) !== entry) throw new Error(`Presentation owner retired: ${provider}`); };
    return {
      owner: entry.token,
      emit: (sourceContent, source, time, recipient) => {
        current(); if (source.kind === "presentation-owner") throw new Error("Component source cannot emit owner lifecycle events");
        this.emitOwned(entry.token, sourceContent, source, time, recipient); return undefined;
      },
      registerResource: (sourceContent, path, resource) => { current(); return this.registerResource(sourceContent, path, resource); },
      close: () => {
        if (closed) return undefined;
        closed = true;
        if (this.owners.get(provider) === entry) { this.owners.delete(provider); this.retireOwner(entry.token, content); }
        return undefined;
      },
    };
  }

  finishOwnerRestore(): void {
    for (const entry of this.owners.values()) if (entry.status === "restored") throw new Error(`Saved presentation owner was not restored: ${entry.token.provider}`);
    this.legacyPersistence = false;
  }

  refreshOwner(provider: ProviderId): void {
    const entry = this.owners.get(provider);
    if (entry?.status !== "active") throw new Error(`Presentation owner is not active: ${provider}`);
    this.emit(entry.content, { kind: "presentation-owner", event: { kind: "refreshed", owner: entry.token } });
  }

  private retireOwner(owner: PresentationOwner, content: ContentId): void {
    const affected = new Set<string>(), localShaders = new Map<string, LocalPresentationMedia>(); let localMusic = false;
    for (const [key, event] of this.persistent) if (samePresentationOwner(event.owner, owner)) {
      const domain = persistentDomain(event);
      if (event.kind === "local-media") {
        if (event.event.kind === "shader-remap") localShaders.set(shaderDomain(event.event.original), event);
        else localMusic = true;
      }
      else if (domain !== null) affected.add(domain);
      this.persistent.delete(key);
    }
    for (const [sequence, { request: event }] of this.localMediaOutput) if (samePresentationOwner(event.owner, owner)) {
      if (event.kind === "local-media" && event.event.kind === "shader-remap") localShaders.set(shaderDomain(event.event.original), event);
      this.localMediaOutput.delete(sequence);
    }
    this.emit(content, { kind: "presentation-owner", event: { kind: "retired", owner } });
    const replacements = new Map<string, SimulationPresentationEvent>();
    for (const event of this.persistent.values()) {
      if (event.kind === "local-media") continue;
      const slot = persistentSlot(event);
      if (slot !== null && affected.has(persistentDomain(event) ?? "") && (replacements.get(slot)?.sequence ?? -1) < event.sequence) replacements.set(slot, event);
    }
    for (const event of [...replacements.values()].sort((a, b) => a.sequence - b.sequence))
      this.source.push({ ...event, sequence: this.presentationSequence++ });
    if (this.localMediaEnabled && (localMusic || affected.has("music:track") && [...this.persistent.values()].some(event => event.kind === "local-media" && event.event.kind !== "shader-remap"))) {
      const replacement = [...this.persistent.values()].filter(event => persistentDomain(event) === "music:track").sort((a, b) => b.sequence - a.sequence)[0];
      if (replacement !== undefined) {
        const replay = { ...replacement, sequence: this.presentationSequence++ };
        this.localMediaOutput.set(replay.sequence, { request: replay, retain: false });
      }
    }
    if (this.localMediaEnabled) for (const [domain, removed] of localShaders) {
      const replacement = [...this.persistent.values()].filter(event => persistentDomain(event) === domain).sort((a, b) => b.sequence - a.sequence)[0];
      if (replacement !== undefined) {
        const request = { ...replacement, sequence: this.presentationSequence++ };
        this.localMediaOutput.set(request.sequence, { request, retain: false, shaderReplay: true });
      } else if (removed.event.kind === "shader-remap") {
        const request: LocalPresentationMedia = { kind: "local-media", content: removed.content, seconds: removed.seconds, sequence: this.presentationSequence++,
          event: { kind: "shader-remap", original: removed.event.original, replacement: removed.event.original, timeOffset: 0 } };
        this.localMediaOutput.set(request.sequence, { request, retain: false, shaderReplay: true });
      }
    }
    const fog = [...(this.fog?.presentation() ?? []), ...[...this.owners.values()].flatMap(entry =>
      entry.fog?.presentation().map(event => ({ ...event, owner: entry.token })) ?? [])];
    for (const event of fog.sort((a, b) => a.sequence - b.sequence)) this.source.push({ ...event, sequence: this.presentationSequence++ });
    this.rebuildStyles();
  }

  private rebuildStyles(): void {
    this.styles.clear(); for (const [style, value] of this.legacyStyles) this.styles.set(style, value);
    for (const source of [...this.persistent.values()].sort((a, b) => a.sequence - b.sequence))
      if ((source.kind === "q1" || source.kind === "q2") && source.event.kind === "lightstyle" && source.recipient === undefined)
        this.styles.set(source.event.style, { family: source.kind, pattern: source.event.pattern });
  }

  retire(actor: ActorId): void {
    this.fog?.retire(actor); for (const entry of this.owners.values()) entry.fog?.retire(actor);
    for (const [key, event] of this.persistent) if (event.kind !== "local-media" && event.recipient?.equals(actor) === true) this.persistent.delete(key);
  }

  resource(id: ResourceId): ResolvedResourceReference | null { return this.resourcesById.get(id) ?? null; }
  persistentPresentation(): readonly SimulationPresentationEvent[] { return [...this.persistent.values()].filter(event => event.kind !== "local-media").sort((a, b) => a.sequence - b.sequence); }

  publishLocalMedia(owner: PresentationOwner | undefined, content: ContentId, event: ComponentPresentationMediaRequest, initializing: boolean, current?: () => boolean): void {
    if (owner !== undefined) {
      const active = this.owners.get(owner.provider);
      if (active?.status !== "active" || !samePresentationOwner(active.token, owner) || active.content !== content)
        throw new Error("Local media requires its active presentation owner and content");
    }
    this.enableLocalMedia();
    const domain = event.kind === "shader-remap" ? shaderDomain(event.original) : "music:track";
    if (initializing && (owner === undefined || owner.generation < this.restoredOwnerGeneration)
      && [...this.persistent.values()].some(value => value.sequence < this.restoredThrough && persistentDomain(value) === domain)) return;
    const time = this.now();
    const request: LocalPresentationMedia = { kind: "local-media", ...(owner === undefined ? {} : { owner }), content, event,
      sequence: this.presentationSequence++, seconds: time.kind === "seconds" ? time.value : time.value / 1000 };
    if (event.kind !== "shader-remap") this.persistent.set(`local:${presentationOwnerKey(owner)}:${persistentSlot(request)}`, request);
    this.localMediaOutput.set(request.sequence, { request, retain: event.kind === "shader-remap", ...(current === undefined ? {} : { current }) });
  }

  enableLocalMedia(): void {
    if (this.localMediaEnabled) return;
    this.localMediaEnabled = true;
    for (const event of this.persistent.values()) if (event.kind === "local-media") this.localMediaOutput.set(event.sequence, { request: event, retain: false });
  }

  pendingLocalMedia(): readonly RetainedPresentation[] { return [...this.localMediaOutput.values()].map(value => value.request).sort((a, b) => a.sequence - b.sequence); }
  get appliedMediaSequence(): number { return this.mediaSequence; }
  appliedMedia(sequence: number): void { this.mediaSequence = Math.max(this.mediaSequence, sequence); }
  appliedShader(original: string, sequence: number): void {
    const domain = shaderDomain(original); this.shaderSequences.set(domain, Math.max(this.shaderSequences.get(domain) ?? -1, sequence));
  }
  resolveShaderReplay(request: LocalPresentationMedia): LocalPresentationMedia | null {
    const delivery = this.localMediaOutput.get(request.sequence);
    if (delivery?.request !== request) return null;
    if (delivery.shaderReplay !== true || request.event.kind !== "shader-remap") return request;
    const domain = shaderDomain(request.event.original);
    const winner = [...this.persistent.values()].filter(event => persistentDomain(event) === domain).sort((a, b) => b.sequence - a.sequence)[0];
    if (winner !== undefined && winner.kind !== "local-media") throw new Error("Shader replay requires a local material cue");
    const resolved: LocalPresentationMedia = winner === undefined
      ? { kind: "local-media", content: request.content, sequence: request.sequence, seconds: request.seconds,
        event: { kind: "shader-remap", original: request.event.original, replacement: request.event.original, timeOffset: 0 } }
      : { ...winner, sequence: request.sequence };
    this.localMediaOutput.set(resolved.sequence, { request: resolved, retain: false });
    return resolved;
  }
  localMediaCurrent(request: RetainedPresentation): boolean {
    const delivery = this.localMediaOutput.get(request.sequence);
    if (delivery?.request !== request || delivery.current?.() === false
      || request.owner !== undefined && !samePresentationOwner(this.owners.get(request.owner.provider)?.token, request.owner)) return false;
    if (request.kind !== "local-media" || request.event.kind !== "shader-remap") return true;
    const domain = shaderDomain(request.event.original);
    return request.sequence >= (this.shaderSequences.get(domain) ?? -1);
  }
  acknowledgeLocalMedia(request: RetainedPresentation, committed = true): void {
    const delivery = this.localMediaOutput.get(request.sequence);
    if (delivery?.request !== request) return;
    if (committed && delivery.retain) this.persistent.set(`local:${presentationOwnerKey(request.owner)}:${persistentSlot(request)}`, request);
    this.localMediaOutput.delete(request.sequence);
  }
  assertLocalMediaConsumed(): void {
    if (this.localMediaOutput.size !== 0) throw new Error("Save requires completed local presentation media");
  }

  registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined {
    if (resource.requestedPath !== path) throw new Error("Registered resource path does not match its source request");
    this.resources.set(`${content}/${path}`, resource);
    this.resourcesById.set(resource.id, resource);
    return undefined;
  }

  emit(content: ContentId, source: SourcePresentationEvent, time: SourceTime = this.now(), recipient?: ActorId): undefined {
    this.emitOwned(undefined, content, source, time, recipient); return undefined;
  }

  protected emitOwned(owner: PresentationOwner | undefined, content: ContentId, source: SourcePresentationEvent, time: SourceTime = this.now(), recipient?: ActorId): SimulationPresentationEvent {
    if (source.kind === "q1" && source.event.kind === "static-model") source = { kind: "q1", event: { ...source.event,
      frame: Math.trunc(source.event.frame), colorMap: Math.trunc(source.event.colorMap), skin: Math.trunc(source.event.skin),
      origin: { ...source.event.origin }, angles: { ...source.event.angles } } };
    const seconds = time.kind === "seconds" ? time.value : time.value / 1000;
    const event = source.kind === "view-reset" ? source : source.kind === "q2-composition" ? "event" in source.event ? source.event.event : source.event : source.event;
    const actor = "actor" in event ? event.actor : null;
    const presentation: SimulationPresentationEvent = { ...source, ...(owner === undefined ? {} : { owner }), ...(recipient === undefined ? {} : {recipient}), sequence: this.presentationSequence++, content, seconds, sourceEntity: actor === null ? null : this.sourceSlot(actor) };
    this.record(presentation);
    return presentation;
  }

  /** Network admission uses the authoritative activation token, never a locally allocated substitute. */
  admitReplicatedOwner(token: PresentationOwner, content: ContentId): void {
    const previous = this.owners.get(token.provider);
    if (previous !== undefined) {
      if (samePresentationOwner(previous.token, token)) {
        if (previous.content !== content || previous.status !== "active") throw new Error("Replicated presentation owner changed identity");
        return;
      }
      if (token.generation <= previous.token.generation) throw new Error("Replicated presentation activation moved backward");
      this.owners.delete(token.provider); this.retireOwner(previous.token, previous.content);
    }
    this.nextOwnerGeneration = Math.max(this.nextOwnerGeneration, token.generation + 1);
    if (!Number.isSafeInteger(this.nextOwnerGeneration)) throw new Error("Presentation owner generation exhausted");
    this.owners.set(token.provider, { token, content, fog: this.ownerFog(content), status: "active" });
  }

  retireReplicatedOwner(token: PresentationOwner): void {
    const entry = this.owners.get(token.provider);
    if (entry === undefined || !samePresentationOwner(entry.token, token)) return;
    this.owners.delete(token.provider); this.retireOwner(token, entry.content);
  }

  /** Incoming reliable controls and original client calls share this client's delivery chronology. */
  receivePresentation(source: SimulationPresentationEvent): number {
    const sequence = this.presentationSequence;
    if (source.kind === "presentation-owner" && source.event.kind === "retired") {
      const owner = this.owners.get(source.event.owner.provider);
      if (owner !== undefined && samePresentationOwner(owner.token, source.event.owner)) this.owners.delete(source.event.owner.provider);
      this.retireOwner(source.event.owner, source.content);
      return sequence;
    }
    this.record({ ...source, sequence: this.presentationSequence++ });
    return sequence;
  }

  private record(presentation: SimulationPresentationEvent): void {
    const { owner, recipient } = presentation;
    this.source.push(presentation);
    if (presentation.kind === "q1-composition" && presentation.event.kind === "addon" && presentation.event.event.kind === "fog")
      this.source.push(...((owner === undefined ? this.fog : this.owners.get(owner.provider)?.fog)?.update(presentation, presentation.event.event)
        .map(event => ({ ...event, ...(owner === undefined ? {} : { owner }) })) ?? []));
    const slot = persistentSlot(presentation), prefix = presentationOwnerKey(owner);
    if (slot !== null) this.persistent.set(`${prefix}:${slot}`, presentation);
    if (presentation.kind === "q1" && (presentation.event.kind === "ambient" || presentation.event.kind === "static-model"))
      this.persistent.set(`${prefix}:${presentation.event.kind}:${presentation.sequence}`, presentation);
    if (presentation.kind === "q2" && presentation.event.kind === "sound" && presentation.event.loop !== "once") {
      const key = `${prefix}:${q2LoopKey(presentation.event, recipient)}`;
      if (presentation.event.loop === "stop") this.persistent.delete(key); else this.persistent.set(key, presentation);
    }
    if ((presentation.kind === "q1" || presentation.kind === "q2") && presentation.event.kind === "lightstyle" && (presentation.kind === "q2" || recipient === undefined))
      this.styles.set(presentation.event.style, { family: presentation.kind, pattern: presentation.event.pattern });
  }

  takePresentation(): readonly SimulationPresentationEvent[] { return this.source.splice(0); }

  assertOutputConsumed(): undefined {
    this.assertLocalMediaConsumed();
    if (this.source.length !== 0) throw new Error("Save requires consumed source output");
    return undefined;
  }

  capture() {
    return { ownership: { nextGeneration: this.nextOwnerGeneration, owners: [...this.owners.values()].map(entry => ({ ...entry.token, content: entry.content, fog: entry.fog?.capture() ?? null })) }, baseStyles: [...this.legacyStyles].map(([style, value]) => ({ style, ...value })), q1Fog: this.fog?.capture() ?? null, presentationSequence: this.presentationSequence, styles: [...this.styles].map(([style, value]) => ({ style, ...value })),
      persistent: [...this.persistent].sort((a, b) => a[1].sequence - b[1].sequence).map(([key, original]) => {
        if (original.kind === "local-media") return { key, ...original };
        const value = {...original, ...(original.recipient === undefined ? {} : {recipient:savedActorId(original.recipient)})};
        if (value.kind === "q2" && value.event.kind === "sound") return { key, ...value, event: { ...value.event, actor: value.event.actor === null ? null : savedActorId(value.event.actor) } };
        if (value.kind === "q1-level" && value.event.kind === "finale" || value.kind === "q1-sky" || value.kind === "q1-client" || value.kind === "music" || value.kind === "q2" && (value.event.kind === "music" || value.event.kind === "lightstyle") || value.kind === "q1" && (value.event.kind === "ambient" || value.event.kind === "static-model" || value.event.kind === "finale" || value.event.kind === "lightstyle")) return { key, ...value };
        throw new Error("Unsupported persistent source event");
      }) };
  }
  restore(reader: SaveReader, reference: (actor: SavedActorId) => ActorId): undefined {
    this.presentationSequence = reader.field("presentationSequence").integer(0);
    this.restoredThrough = this.presentationSequence; this.localMediaOutput.clear(); this.localMediaEnabled = false; this.mediaSequence = -1; this.shaderSequences.clear();
    this.source.length = 0; this.styles.clear(); this.legacyStyles.clear(); this.persistent.clear();
    this.owners.clear();
    const ownership = reader.field("ownership"); this.legacyPersistence = ownership.value === undefined;
    this.nextOwnerGeneration = ownership.value === undefined ? 1 : ownership.field("nextGeneration").integer(1);
    if (!Number.isSafeInteger(this.nextOwnerGeneration)) return ownership.fail("Invalid presentation generation counter");
    this.restoredOwnerGeneration = this.nextOwnerGeneration;
    if (ownership.value !== undefined) ownership.field("owners").list(value => {
      const token = readPresentationOwner(value), content = readContentId(value.field("content"));
      if (token.generation >= this.nextOwnerGeneration || this.owners.has(token.provider)) return value.fail("Invalid saved presentation owner");
      const fog = this.ownerFog(content);
      if (value.field("fog").value !== null) {
        if (fog === null) return value.fail("Owned fog requires a Q1 map");
        this.source.push(...fog.restore(value.field("fog"), reference).map(event => ({ ...event, owner: token })));
      }
      this.owners.set(token.provider, { token, content, fog, status: "restored" });
    });
    const fog = reader.field("q1Fog");
    if (fog.value !== undefined && fog.value !== null) {
      if (this.fog === null) return fog.fail("Q1 fog state requires a Q1 map");
      this.source.push(...this.fog.restore(fog, reference));
    } else this.fog?.reset();
    reader.field("styles").list(value => this.styles.set(value.field("style").integer(0), { family: value.field("family").choice("q1", "q2"), pattern: value.field("pattern").string() }));
    if (reader.field("baseStyles").value !== undefined) reader.field("baseStyles").list(value =>
      this.legacyStyles.set(value.field("style").integer(0), { family: value.field("family").choice("q1", "q2"), pattern: value.field("pattern").string() }));
    if (this.legacyPersistence) for (const [style, value] of this.styles) this.legacyStyles.set(style, value);
    reader.field("persistent").list(value => {
      const event = value.field("event"), family = value.field("kind").choice("q1", "q2", "music", "q1-sky", "q1-client", "q1-level", "local-media"), kind = event.field("kind").choice("ambient", "music", "sound", "static-model", "finale", "cd-track", "pause", "lightstyle", "skybox", "name", "social", "player-info", "colors", "frags", "ping", "music-stop", "shader-remap");
      const recipient = value.field("recipient");
      const owner = value.field("owner").value === undefined ? undefined : readPresentationOwner(value.field("owner"));
      if (owner !== undefined && !samePresentationOwner(this.owners.get(owner.provider)?.token, owner)) return value.fail("Persistent event has no saved presentation owner");
      const base = { ...(owner === undefined ? {} : { owner }), ...(recipient.value === undefined ? {} : {recipient:reference(readSavedActor(recipient))}), sequence: value.field("sequence").integer(0), content: readContentId(value.field("content")), seconds: value.field("seconds").number(), sourceEntity: family === "local-media" ? null : value.field("sourceEntity").nullable(v => v.integer(0)) };
      if (family === "local-media") {
        if (recipient.value !== undefined || kind !== "music" && kind !== "music-stop" && kind !== "shader-remap") return value.fail("Invalid local presentation media request");
        const restored: LocalPresentationMedia = { kind: "local-media", ...(owner === undefined ? {} : { owner }), content: base.content, sequence: base.sequence, seconds: base.seconds,
          event: kind === "music-stop" ? { kind } : kind === "shader-remap"
            ? { kind, original: event.field("original").string(), replacement: event.field("replacement").string(), timeOffset: event.field("timeOffset").number() }
            : { kind, intro: event.field("intro").string(), loop: event.field("loop").string() } };
        if (owner !== undefined && this.owners.get(owner.provider)?.content !== base.content || restored.sequence >= this.presentationSequence) return value.fail("Invalid local presentation media content or sequence");
        this.persistent.set(`local:${presentationOwnerKey(owner)}:${persistentSlot(restored)}`, restored);
        return;
      }
      let restored: SimulationPresentationEvent;
      if (family === "music" && kind === "cd-track") restored = {...base, kind:"music",event:{kind,track:event.field("track").integer(0)}};
      else if (family === "q1-sky" && kind === "skybox") restored = {...base,kind:"q1-sky",event:{kind,name:event.field("name").string()}};
      else if (family === "q1-client" && (kind === "name" || kind === "social" || kind === "player-info")) restored = {...base,kind:"q1-client",event:{kind,slot:sourceClientInteger(event.field("slot"),0,255),value:event.field("value").string()}};
      else if (family === "q1-client" && (kind === "colors" || kind === "frags" || kind === "ping")) restored = {...base,kind:"q1-client",event:{kind,slot:sourceClientInteger(event.field("slot"),0,255),value:sourceClientInteger(event.field("value"),-32768,32767)}};
      else if (family === "music" && kind === "pause") restored = {...base,kind:"music",event:{kind,paused:event.field("paused").boolean()}};
      else if ((family === "q1" || family === "q2") && kind === "lightstyle") restored = {...base,kind:family,event:{kind,style:event.field("style").integer(0),pattern:event.field("pattern").string()}};
      else if (family === "q1-level" && kind === "finale") restored = { ...base, kind: "q1-level", event: { kind, text: event.field("text").string(), track: event.field("track").integer(0) } };
      else if (family === "q1" && kind === "finale") restored = {...base,kind:"q1",event:{kind,text:event.field("text").string(),stage:event.field("stage").choice(1,2,3,4,5,6)}};
      else if (family === "q1" && kind === "ambient") restored = { ...base, kind: "q1", event: { kind, origin: readVector(event.field("origin")), path: event.field("path").string(), volume: event.field("volume").number(), attenuation: event.field("attenuation").number() } };
      else if (family === "q1" && kind === "static-model") restored = { ...base, kind: "q1", event: { kind, path: event.field("path").string(), frame: event.field("frame").integer(),
        colorMap: event.field("colorMap").integer(), skin: event.field("skin").integer(), origin: readVector(event.field("origin")), angles: readVector(event.field("angles")) } };
      else if (family === "q2" && kind === "music") restored = { ...base, kind: "q2", event: { kind, track: event.field("track").string() } };
      else if (family === "q2" && kind === "sound") restored = { ...base, kind: "q2", event: { kind, actor: event.field("actor").nullable(v => reference(readSavedActor(v))), origin: readVector(event.field("origin")), path: event.field("path").string(), channel: event.field("channel").number(), volume: event.field("volume").number(), attenuation: event.field("attenuation").number(), reliable: event.field("reliable").boolean(), loop: event.field("loop").literal("start"),
        ...(event.field("loopOwner").value === undefined ? {} : { loopOwner: namespaced(event.field("loopOwner")) }) } };
      else return event.fail("Invalid persistent source event family");
      const slot = persistentSlot(restored);
      const key = `${presentationOwnerKey(owner)}:${slot ?? (restored.kind === "q2" && restored.event.kind === "sound"
        ? q2LoopKey(restored.event, restored.recipient) : `${kind}:${restored.sequence}`)}`;
      this.persistent.set(key, restored); this.source.push(restored);
    });
    this.source.sort((a, b) => a.sequence - b.sequence);
    return undefined;
  }

  lightStyle(style: number): string { return this.styles.get(style)?.pattern ?? ""; }

  lightStyles(seconds: number): readonly SceneLightStyle[] {
    return Array.from(this.styles, ([style, value]): SceneLightStyle => {
      const letter = value.pattern.length === 0 ? 12 : value.pattern.charCodeAt(Math.floor(seconds * 10) % value.pattern.length) - 97;
      const scale = letter / 12;
      return value.family === "q1" ? { kind: "q1", style, value: value.pattern.length === 0 ? 256 : letter * 22 }
        : { kind: "q2", style, rgb: { x: scale, y: scale, z: scale }, white: scale * 3 };
    });
  }


}

function sourceClientInteger(reader: SaveReader, minimum: number, maximum: number): number {
  const value=reader.integer(minimum);return value>maximum ? reader.fail('source client value out of range') : value;
}

function readPresentationOwner(reader: SaveReader): PresentationOwner {
  const generation = reader.field("generation").integer(1);
  if (!Number.isSafeInteger(generation)) return reader.fail("Invalid presentation owner generation");
  return { provider: namespaced(reader.field("provider")), generation };
}

function persistentSlot(source: RetainedPresentation): string | null {
  const domain = persistentDomain(source);
  const recipient = source.kind === "local-media" || source.recipient === undefined ? "world" : `${source.recipient.slot}:${source.recipient.generation}`;
  return domain === null ? null : `${domain}:${recipient}`;
}

function persistentDomain(source: RetainedPresentation): string | null {
  if (source.kind === "local-media") return source.event.kind === "shader-remap" ? shaderDomain(source.event.original) : "music:track";
  if (source.kind === "q1-sky") return "sky";
  if (source.kind === "q1-client") return `client:${source.content}:${source.event.slot}:${source.event.kind}`;
  if ((source.kind === "q1" || source.kind === "q2") && source.event.kind === "lightstyle") return `style:${source.event.style}`;
  if ((source.kind === "q1" || source.kind === "q1-level") && source.event.kind === "finale") return "finale";
  if (source.kind === "music") return `music:${source.event.kind === "pause" ? "pause" : "track"}`;
  if (source.kind === "q2" && source.event.kind === "music") return "music:track";
  return null;
}

function shaderDomain(original: string): string { return `shader:${normalizeShaderName(stripShaderExtension(original))}`; }
