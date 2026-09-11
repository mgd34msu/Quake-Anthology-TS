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

const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** Retains source events until the application resolves their content-owned media. */
export class SimulationEvents {
  private sequence = 0;
  private presentationSequence = 0;
  private readonly source: SimulationPresentationEvent[] = [];
  private readonly emitted: SimulationEvent[] = [];
  private readonly resources = new Map<string, ResolvedResourceReference>();
  private readonly styles = new Map<number, { readonly family: "q1" | "q2"; readonly pattern: string }>();

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
    this.source.push({ ...source, sequence: this.presentationSequence++, content, seconds });
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
      const channel = event.channel === "auto" ? 0 : event.channel === "weapon" ? 1 : event.channel === "voice" ? 2 : event.channel === "item" ? 3 : 4;
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
