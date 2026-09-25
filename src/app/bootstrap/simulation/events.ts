import type { ContentId } from "../../../contracts/content.ts";
import type { ActorId, ClientId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NetworkEvent } from "../../../contracts/protocol.ts";
import type { PresentationOwner } from "../../../contracts/presentation.ts";
import type { SavedActorId, SimulationEvent, SimulationEventPayload } from "../../../contracts/session.ts";
import type { SourceTime } from "../../../contracts/time.ts";
import type { Q1Event } from "../../../content/q1/foundation/types.ts";
import type { Q2PresentationEvent } from "../../../content/q2/foundation/host.ts";
import type { SharedBodyTable } from "../../../world/actors/index.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import { PresentationState } from "../presentation-state.ts";
import type { SimulationQ1FogOptions } from "./q1-fog.ts";
import type { SimulationPresentationEvent, SourcePresentationEvent } from "./types.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** Adds authoritative native protocol output to the shared presentation history. */
export class SimulationEvents extends PresentationState {
  private sequence = 0;
  private readonly emitted: SimulationEvent[] = [];
  constructor(private readonly bodies: SharedBodyTable, now: () => SourceTime,
    private readonly clientFor: (actor: ActorId) => ClientId | null, sourceSlot: (actor: ActorId) => number | null,
    fogOptions: SimulationQ1FogOptions | null = null) { super(now, sourceSlot, fogOptions); }

  get nextSequence(): number { return this.sequence; }

  protected override emitOwned(owner: PresentationOwner | undefined, content: ContentId, source: SourcePresentationEvent,
    time: SourceTime = this.now(), recipient?: ActorId): SimulationPresentationEvent {
    const presentation = super.emitOwned(owner, content, source, time, recipient);
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
    return presentation;
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
  override assertOutputConsumed(): undefined {
    super.assertOutputConsumed();
    if (this.emitted.length !== 0) throw new Error("Save requires consumed source output");
    return undefined;
  }

  override capture() { return { ...super.capture(), sequence: this.sequence }; }

  override restore(reader: SaveReader, reference: (actor: SavedActorId) => ActorId): undefined {
    this.sequence = reader.field("sequence").integer(0); this.emitted.length = 0;
    return super.restore(reader, reference);
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
    return undefined;
  }

  private q2(content: ContentId, event: Q2PresentationEvent, sequence: number): undefined {
    if (event.kind === "sound") this.sound(content, event.path, event.actor, event.origin, event.channel, event.volume, event.attenuation);
    else if (event.kind === "centerprint") this.message({ kind: "center-print", text: event.text }, event.actor, sequence);
    else if (event.kind === "help") this.message({ kind: "print", level: 2, text: event.text }, null, sequence);
    return undefined;
  }
}
