import type { ContentId, ResolvedResourceReference } from "../../../contracts/content.ts";
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
import { SaveReader } from "../../../persistence/value.ts";
import { readContentId } from "../../../persistence/recipe.ts";
import { readVector } from "../../../persistence/shared.ts";
import type { SavedActorId } from "../../../contracts/session.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** Retains source events until the application resolves their content-owned media. */
export class SimulationEvents {
  private sequence = 0;
  private presentationSequence = 0;
  private readonly source: SimulationPresentationEvent[] = [];
  private readonly emitted: SimulationEvent[] = [];
  private readonly resources = new Map<string, ResolvedResourceReference>();
  private readonly styles = new Map<number, { readonly family: "q1" | "q2"; readonly pattern: string }>();
  private readonly persistent = new Map<string, SimulationPresentationEvent>();

  constructor(private readonly bodies: SharedBodyTable, private readonly now: () => SourceTime,
    private readonly clientFor: (actor: ActorId) => ClientId | null, private readonly sourceSlot: (actor: ActorId) => number | null) {}

  get nextSequence(): number { return this.sequence; }

  registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined {
    if (resource.requestedPath !== path) throw new Error("Registered resource path does not match its source request");
    this.resources.set(`${content}/${path}`, resource);
    return undefined;
  }

  emit(content: ContentId, source: SourcePresentationEvent): undefined {
    const time = this.now();
    const seconds = time.kind === "seconds" ? time.value : time.value / 1000;
    const event = source.kind === "view-reset" ? source : source.kind === "q2-composition" ? "event" in source.event ? source.event.event : source.event : source.event;
    const reference = "actor" in event ? event.actor : null;
    const actor = reference === null ? null : "id" in reference ? reference.id : reference;
    const presentation = { ...source, sequence: this.presentationSequence++, content, seconds, sourceEntity: actor === null ? null : this.sourceSlot(actor) };
    this.source.push(presentation);
    if (source.kind === "q1" && source.event.kind === "ambient") this.persistent.set(`ambient:${this.presentationSequence}`, presentation);
    if (source.kind === "q2" && source.event.kind === "music") this.persistent.set("music", presentation);
    if (source.kind === "q2" && source.event.kind === "sound" && source.event.loop !== "once") {
      const key = `sound:${source.event.actor?.slot ?? -1}:${source.event.channel}:${source.event.path}`;
      if (source.event.loop === "stop") this.persistent.delete(key); else this.persistent.set(key, presentation);
    }
    if (source.kind === "q2-composition" && (source.event.kind === "ctf" || source.event.kind === "lmctf")) {
      const event = source.event.event;
      if (event.kind === "scoreboard" || source.event.kind === "lmctf" && event.kind === "hud" && "layout" in event)
        this.message({ kind: "q2-layout", program: event.layout }, event.actor);
      else if (event.kind === "match-status") this.message({ kind: "print", level: 2, text: event.text });
    }
    if (source.kind === "q1") this.q1(content, source.event);
    else if (source.kind === "q2") this.q2(content, source.event);
    else if (source.kind === "q2-weapon" && source.event.kind === "muzzleflash") {
      const entityNumber = this.sourceSlot(source.event.actor);
      if (entityNumber !== null) this.message({ kind: "q2-muzzle-flash", entityNumber, flash: source.event.flash, monster: false });
    }
    return undefined;
  }

  append(payload: SimulationEventPayload, actor: ActorId | null = null): undefined {
    const client = actor === null ? null : this.clientFor(actor);
    this.emitted.push({ sequence: this.sequence++, time: this.now(), payload,
      audience: client === null ? { kind: "world" } : { kind: "client", client } });
    return undefined;
  }

  message(event: NetworkEvent, actor: ActorId | null = null): undefined {
    return this.append({ kind: "message", event }, actor);
  }

  take(): readonly SimulationEvent[] { return this.emitted.splice(0); }
  takePresentation(): readonly SimulationPresentationEvent[] { return this.source.splice(0); }

  capture() {
    return { sequence: this.sequence, presentationSequence: this.presentationSequence, styles: [...this.styles].map(([style, value]) => ({ style, ...value })),
      persistent: [...this.persistent].map(([key, value]) => {
        if (value.kind === "q2" && value.event.kind === "sound") return { key, ...value, event: { ...value.event, actor: value.event.actor === null ? null : savedActorId(value.event.actor) } };
        if (value.kind === "q2" && value.event.kind === "music" || value.kind === "q1" && value.event.kind === "ambient") return { key, ...value };
        throw new Error("Unsupported persistent source event");
      }) };
  }
  restore(reader: SaveReader, reference: (actor: SavedActorId) => ActorId): undefined {
    this.sequence = reader.field("sequence").integer(0); this.presentationSequence = reader.field("presentationSequence").integer(0);
    this.source.length = 0; this.emitted.length = 0; this.styles.clear(); this.persistent.clear();
    reader.field("styles").list(value => this.styles.set(value.field("style").integer(0), { family: value.field("family").choice("q1", "q2"), pattern: value.field("pattern").string() }));
    reader.field("persistent").list(value => {
      const event = value.field("event"), family = value.field("kind").choice("q1", "q2"), kind = event.field("kind").choice("ambient", "music", "sound");
      const base = { sequence: value.field("sequence").integer(0), content: readContentId(value.field("content")), seconds: value.field("seconds").number(), sourceEntity: value.field("sourceEntity").nullable(v => v.integer(0)) };
      let restored: SimulationPresentationEvent;
      if (family === "q1" && kind === "ambient") restored = { ...base, kind: "q1", event: { kind, origin: readVector(event.field("origin")), path: event.field("path").string(), volume: event.field("volume").number(), attenuation: event.field("attenuation").number() } };
      else if (family === "q2" && kind === "music") restored = { ...base, kind: "q2", event: { kind, track: event.field("track").string() } };
      else if (family === "q2" && kind === "sound") restored = { ...base, kind: "q2", event: { kind, actor: event.field("actor").nullable(v => reference(readSavedActor(v))), origin: readVector(event.field("origin")), path: event.field("path").string(), channel: event.field("channel").number(), volume: event.field("volume").number(), attenuation: event.field("attenuation").number(), reliable: event.field("reliable").boolean(), loop: event.field("loop").literal("start") } };
      else return event.fail("Invalid persistent source event family");
      this.persistent.set(value.field("key").string(), restored); this.source.push(restored);
    });
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

  private sound(content: ContentId, path: string, actor: ActorId | null, origin: Vec3, channel: number, volume: number, attenuation: number): undefined {
    const resource = this.resources.get(`${content}/${path}`) ?? this.resources.get(`${content}/sound/${path}`);
    if (resource !== undefined) this.append({ kind: "sound", resource: resource.id, actor, origin, channel, volume, attenuation });
    return undefined;
  }

  private q1(content: ContentId, event: Q1Event): undefined {
    if (event.kind === "sound") {
      const channel = typeof event.channel === "number" ? event.channel : event.channel === "auto" ? 0 : event.channel === "weapon" ? 1 : event.channel === "voice" ? 2 : event.channel === "item" ? 3 : 4;
      this.sound(content, event.path, event.actor, this.bodies.read(event.actor)?.origin ?? zero, channel, event.volume, event.attenuation);
    } else if (event.kind === "ambient") this.sound(content, event.path, null, event.origin, 0, event.volume, event.attenuation);
    else if (event.kind === "message") this.message(event.center ? { kind: "center-print", text: event.text } : { kind: "print", level: 2, text: event.text }, event.player);
    else if (event.kind === "lightstyle") this.styles.set(event.style, { family: "q1", pattern: event.pattern });
    return undefined;
  }

  private q2(content: ContentId, event: Q2PresentationEvent): undefined {
    if (event.kind === "sound") this.sound(content, event.path, event.actor, event.origin, event.channel, event.volume, event.attenuation);
    else if (event.kind === "centerprint") this.message({ kind: "center-print", text: event.text }, event.actor);
    else if (event.kind === "help") this.message({ kind: "print", level: 2, text: event.text });
    else if (event.kind === "lightstyle") this.styles.set(event.style, { family: "q2", pattern: event.pattern });
    return undefined;
  }
}
