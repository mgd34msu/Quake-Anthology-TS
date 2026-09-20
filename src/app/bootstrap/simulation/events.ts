import { SimulationQ1Fog, type SimulationQ1FogOptions } from "./q1-fog.ts";
import type { ContentId, ResolvedResourceReference, ResourceId } from "../../../contracts/content.ts";
import type { ActorId, ClientId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NetworkEvent } from "../../../contracts/protocol.ts";
import type { SceneLightStyle } from "../../../contracts/scene.ts";
import type { SimulationEvent, SimulationEventPayload } from "../../../contracts/session.ts";
import type { SourceTime } from "../../../contracts/time.ts";
import type { Q1Event } from "../../../content/q1/foundation/types.ts";
import type { Q2PresentationEvent } from "../../../content/q2/foundation/host.ts";
import type { SharedBodyTable } from "../../../world/actors/index.ts";
import type { SimulationPresentationEvent, SourcePresentationEvent } from "./types.ts";
import { readSavedActor, savedActorId } from "../../../persistence/save-image.ts";
import { namespaced, SaveReader } from "../../../persistence/value.ts";
import { readContentId } from "../../../persistence/recipe.ts";
import { readVector } from "../../../persistence/shared.ts";
import type { SavedActorId } from "../../../contracts/session.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
function q2LoopKey(event: Extract<Q2PresentationEvent, { readonly kind: "sound" }>, recipient?: ActorId): string {
  return event.loopOwner === undefined ? `sound:${event.actor?.slot ?? -1}:${event.channel}:${event.path}`
    : JSON.stringify(["sound", event.loopOwner, event.actor?.slot ?? -1, event.actor?.generation ?? -1, event.channel, event.path,
      recipient === undefined ? null : [recipient.slot, recipient.generation]]);
}

/** Retains source events until the application resolves their content-owned media. */
export class SimulationEvents {
  private sequence = 0;
  private presentationSequence = 0;
  private readonly source: SimulationPresentationEvent[] = [];
  private readonly emitted: SimulationEvent[] = [];
  private readonly resources = new Map<string, ResolvedResourceReference>();
  private readonly resourcesById = new Map<ResourceId, ResolvedResourceReference>();
  private readonly styles = new Map<number, { readonly family: "q1" | "q2"; readonly pattern: string }>();
  private readonly persistent = new Map<string, SimulationPresentationEvent>();

  private readonly fog: SimulationQ1Fog | null;

  constructor(private readonly bodies: SharedBodyTable, private readonly now: () => SourceTime,
    private readonly clientFor: (actor: ActorId) => ClientId | null, private readonly sourceSlot: (actor: ActorId) => number | null, fog: SimulationQ1FogOptions | null = null) { this.fog = fog === null ? null : new SimulationQ1Fog(fog); }

  retire(actor: ActorId): void {
    this.fog?.retire(actor);
    for (const [key, event] of this.persistent) if (event.recipient?.equals(actor) === true) this.persistent.delete(key);
  }

  get nextSequence(): number { return this.sequence; }

  resource(id: ResourceId): ResolvedResourceReference | null { return this.resourcesById.get(id) ?? null; }
  persistentPresentation(): readonly SimulationPresentationEvent[] { return [...this.persistent.values()].sort((a, b) => a.sequence - b.sequence); }

  registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined {
    if (resource.requestedPath !== path) throw new Error("Registered resource path does not match its source request");
    this.resources.set(`${content}/${path}`, resource);
    this.resourcesById.set(resource.id, resource);
    return undefined;
  }

  emit(content: ContentId, source: SourcePresentationEvent, time: SourceTime = this.now(), recipient?: ActorId): undefined {
    if (source.kind === "q1" && source.event.kind === "static-model") source = { kind: "q1", event: { ...source.event,
      frame: Math.trunc(source.event.frame), colorMap: Math.trunc(source.event.colorMap), skin: Math.trunc(source.event.skin),
      origin: { ...source.event.origin }, angles: { ...source.event.angles } } };
    const seconds = time.kind === "seconds" ? time.value : time.value / 1000;
    const event = source.kind === "view-reset" ? source : source.kind === "q2-composition" ? "event" in source.event ? source.event.event : source.event : source.event;
    const actor = "actor" in event ? event.actor : null;
    const presentation = { ...source, ...(recipient === undefined ? {} : {recipient}), sequence: this.presentationSequence++, content, seconds, sourceEntity: actor === null ? null : this.sourceSlot(actor) };
    this.source.push(presentation);
    if (source.kind === "q1-composition" && source.event.kind === "addon" && source.event.event.kind === "fog")
      this.source.push(...(this.fog?.update(presentation, source.event.event) ?? []));
    const recipientKey = recipient === undefined ? "world" : `${recipient.slot}:${recipient.generation}`;
    if (source.kind === "q1-sky") this.persistent.set(`q1-sky:${content}:${recipientKey}`, presentation);
    if (source.kind === "q1-client") this.persistent.set(`q1-client:${content}:${source.event.slot}:${source.event.kind}:${recipientKey}`, presentation);
    if (source.kind === "q1" && source.event.kind === "lightstyle") this.persistent.set(`q1-style:${source.event.style}:${recipientKey}`, presentation);
    if (source.kind === "q1" && source.event.kind === "finale") this.persistent.set(`q1-finale:${recipientKey}`, presentation);
    if (source.kind === "music") this.persistent.set(`source-music:${source.event.kind}:${recipientKey}`, presentation);
    if (source.kind === "q1" && source.event.kind === "ambient") this.persistent.set(`ambient:${this.presentationSequence}`, presentation);
    if (source.kind === "q1" && source.event.kind === "static-model") this.persistent.set(`static-model:${this.presentationSequence}`, presentation);
    if (source.kind === "q2" && source.event.kind === "music") this.persistent.set("music", presentation);
    if (source.kind === "q2" && source.event.kind === "sound" && source.event.loop !== "once") {
      const key = q2LoopKey(source.event, recipient);
      if (source.event.loop === "stop") this.persistent.delete(key); else this.persistent.set(key, presentation);
    }
    if (source.kind === "q2-composition" && (source.event.kind === "ctf" || source.event.kind === "lmctf")) {
      const event = source.event.event;
      if (event.kind === "scoreboard" || source.event.kind === "lmctf" && event.kind === "hud" && "layout" in event)
        this.message({ kind: "q2-layout", program: event.layout }, event.actor);
      else if (event.kind === "match-status") this.message({ kind: "print", level: 2, text: event.text });
    }
    if (source.kind === "q1") this.q1(content, source.event, presentation.sequence, recipient);
    else if (source.kind === "q2") this.q2(content, source.event, presentation.sequence);
    else if (source.kind === "q2-weapon" && source.event.kind === "muzzleflash") {
      const entityNumber = this.sourceSlot(source.event.actor);
      if (entityNumber !== null) this.message({ kind: "q2-muzzle-flash", entityNumber, flash: source.event.flash, monster: false });
    }
    return undefined;
  }

  append(payload: SimulationEventPayload, actor: ActorId | null = null): undefined {
    const client = actor === null ? null : this.clientFor(actor);
    if (actor !== null && client === null) return undefined;
    this.emitted.push({ sequence: this.sequence++, time: this.now(), payload,
      audience: client === null ? { kind: "world" } : { kind: "client", client } });
    return undefined;
  }

  message(event: NetworkEvent, actor: ActorId | null = null, sourcePresentationSequence?: number): undefined {
    return this.append({ kind: "message", event, ...(sourcePresentationSequence === undefined ? {} : { sourcePresentationSequence }) }, actor);
  }

  take(): readonly SimulationEvent[] { return this.emitted.splice(0); }
  takePresentation(): readonly SimulationPresentationEvent[] { return this.source.splice(0); }

  assertOutputConsumed(): undefined {
    if (this.source.length !== 0 || this.emitted.length !== 0) throw new Error("Save requires consumed source output");
    return undefined;
  }

  capture() {
    return { q1Fog: this.fog?.capture() ?? null, sequence: this.sequence, presentationSequence: this.presentationSequence, styles: [...this.styles].map(([style, value]) => ({ style, ...value })),
      persistent: [...this.persistent].sort((a, b) => a[1].sequence - b[1].sequence).map(([key, original]) => {
        const value = {...original, ...(original.recipient === undefined ? {} : {recipient:savedActorId(original.recipient)})};
        if (value.kind === "q2" && value.event.kind === "sound") return { key, ...value, event: { ...value.event, actor: value.event.actor === null ? null : savedActorId(value.event.actor) } };
        if (value.kind === "q1-sky" || value.kind === "q1-client" || value.kind === "music" || value.kind === "q2" && value.event.kind === "music" || value.kind === "q1" && (value.event.kind === "ambient" || value.event.kind === "static-model" || value.event.kind === "finale" || value.event.kind === "lightstyle")) return { key, ...value };
        throw new Error("Unsupported persistent source event");
      }) };
  }
  restore(reader: SaveReader, reference: (actor: SavedActorId) => ActorId): undefined {
    this.sequence = reader.field("sequence").integer(0); this.presentationSequence = reader.field("presentationSequence").integer(0);
    this.source.length = 0; this.emitted.length = 0; this.styles.clear(); this.persistent.clear();
    const fog = reader.field("q1Fog");
    if (fog.value !== undefined && fog.value !== null) {
      if (this.fog === null) return fog.fail("Q1 fog state requires a Q1 map");
      this.source.push(...this.fog.restore(fog, reference));
    } else this.fog?.reset();
    reader.field("styles").list(value => this.styles.set(value.field("style").integer(0), { family: value.field("family").choice("q1", "q2"), pattern: value.field("pattern").string() }));
    reader.field("persistent").list(value => {
      const event = value.field("event"), family = value.field("kind").choice("q1", "q2", "music", "q1-sky", "q1-client"), kind = event.field("kind").choice("ambient", "music", "sound", "static-model", "finale", "cd-track", "pause", "lightstyle", "skybox", "name", "social", "player-info", "colors", "frags", "ping");
      const recipient = value.field("recipient");
      const base = { ...(recipient.value === undefined ? {} : {recipient:reference(readSavedActor(recipient))}), sequence: value.field("sequence").integer(0), content: readContentId(value.field("content")), seconds: value.field("seconds").number(), sourceEntity: value.field("sourceEntity").nullable(v => v.integer(0)) };
      let restored: SimulationPresentationEvent;
      if (family === "music" && kind === "cd-track") restored = {...base, kind:"music",event:{kind,track:event.field("track").integer(0)}};
      else if (family === "q1-sky" && kind === "skybox") restored = {...base,kind:"q1-sky",event:{kind,name:event.field("name").string()}};
      else if (family === "q1-client" && (kind === "name" || kind === "social" || kind === "player-info")) restored = {...base,kind:"q1-client",event:{kind,slot:sourceClientInteger(event.field("slot"),0,255),value:event.field("value").string()}};
      else if (family === "q1-client" && (kind === "colors" || kind === "frags" || kind === "ping")) restored = {...base,kind:"q1-client",event:{kind,slot:sourceClientInteger(event.field("slot"),0,255),value:sourceClientInteger(event.field("value"),-32768,32767)}};
      else if (family === "music" && kind === "pause") restored = {...base,kind:"music",event:{kind,paused:event.field("paused").boolean()}};
      else if (family === "q1" && kind === "lightstyle") restored = {...base,kind:"q1",event:{kind,style:event.field("style").integer(0),pattern:event.field("pattern").string()}};
      else if (family === "q1" && kind === "finale") restored = {...base,kind:"q1",event:{kind,text:event.field("text").string(),stage:event.field("stage").choice(1,2,3,4,5,6)}};
      else if (family === "q1" && kind === "ambient") restored = { ...base, kind: "q1", event: { kind, origin: readVector(event.field("origin")), path: event.field("path").string(), volume: event.field("volume").number(), attenuation: event.field("attenuation").number() } };
      else if (family === "q1" && kind === "static-model") restored = { ...base, kind: "q1", event: { kind, path: event.field("path").string(), frame: event.field("frame").integer(),
        colorMap: event.field("colorMap").integer(), skin: event.field("skin").integer(), origin: readVector(event.field("origin")), angles: readVector(event.field("angles")) } };
      else if (family === "q2" && kind === "music") restored = { ...base, kind: "q2", event: { kind, track: event.field("track").string() } };
      else if (family === "q2" && kind === "sound") restored = { ...base, kind: "q2", event: { kind, actor: event.field("actor").nullable(v => reference(readSavedActor(v))), origin: readVector(event.field("origin")), path: event.field("path").string(), channel: event.field("channel").number(), volume: event.field("volume").number(), attenuation: event.field("attenuation").number(), reliable: event.field("reliable").boolean(), loop: event.field("loop").literal("start"),
        ...(event.field("loopOwner").value === undefined ? {} : { loopOwner: namespaced(event.field("loopOwner")) }) } };
      else return event.fail("Invalid persistent source event family");
      const key = restored.kind === "q2" && restored.event.kind === "sound" && restored.event.loopOwner !== undefined
        ? q2LoopKey(restored.event, restored.recipient)
        : value.field("key").string();
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

  private sound(content: ContentId, path: string, actor: ActorId | null, origin: Vec3, channel: number, volume: number, attenuation: number, recipient?: ActorId): undefined {
    const resource = this.resources.get(`${content}/${path}`) ?? this.resources.get(`${content}/sound/${path}`);
    if (resource !== undefined) this.append({ kind: "sound", resource: resource.id, actor, origin, channel, volume, attenuation }, recipient ?? null);
    return undefined;
  }

  private q1(content: ContentId, event: Q1Event, sequence: number, recipient?: ActorId): undefined {
    if (event.kind === "sound") {
      const channel = typeof event.channel === "number" ? event.channel : event.channel === "auto" ? 0 : event.channel === "weapon" ? 1 : event.channel === "voice" ? 2 : event.channel === "item" ? 3 : 4;
      const body = this.bodies.read(event.actor);
      // SV_StartSound captures origin + 0.5 * (mins + maxs) before the source edict can move or disappear.
      const center = body === null ? zero : {
        x: Math.fround(body.origin.x + Math.fround(body.bounds.min.x + body.bounds.max.x) * 0.5),
        y: Math.fround(body.origin.y + Math.fround(body.bounds.min.y + body.bounds.max.y) * 0.5),
        z: Math.fround(body.origin.z + Math.fround(body.bounds.min.z + body.bounds.max.z) * 0.5),
      };
      this.sound(content, event.path, event.actor, event.origin ?? center, channel, event.volume, event.attenuation, recipient);
    } else if (event.kind === "ambient") this.sound(content, event.path, null, event.origin, 0, event.volume, event.attenuation, recipient);
    else if (event.kind === "message") this.message(event.center ? { kind: "center-print", text: event.text } : { kind: "print", level: 2, text: event.text }, event.player, sequence);
    else if (event.kind === "lightstyle" && recipient === undefined) this.styles.set(event.style, { family: "q1", pattern: event.pattern });
    return undefined;
  }

  private q2(content: ContentId, event: Q2PresentationEvent, sequence: number): undefined {
    if (event.kind === "sound") this.sound(content, event.path, event.actor, event.origin, event.channel, event.volume, event.attenuation);
    else if (event.kind === "centerprint") this.message({ kind: "center-print", text: event.text }, event.actor, sequence);
    else if (event.kind === "help") this.message({ kind: "print", level: 2, text: event.text }, null, sequence);
    else if (event.kind === "lightstyle") this.styles.set(event.style, { family: "q2", pattern: event.pattern });
    return undefined;
  }
}

function sourceClientInteger(reader: SaveReader, minimum: number, maximum: number): number {
  const value=reader.integer(minimum);return value>maximum ? reader.fail('source client value out of range') : value;
}
