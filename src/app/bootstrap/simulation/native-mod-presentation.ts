import type { ContentId } from "../../../contracts/content.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2ProtocolIdentity } from "../../../contracts/protocol.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { createQ2Fog, type Q2FogState } from "../../../content/q2/rerelease/types.ts";
import { Q2ServerMessageReader } from "../../../network/q2/index.ts";
import { readQ2FogState } from "../../../persistence/q2-rerelease-state.ts";
import { SaveReader } from "../../../persistence/value.ts";
import type { ModHostServices } from "../../../world/session/mods.ts";
import { q2ApplicationLayout } from "../network/q2-layout.ts";
import { translateQ2ServiceRecords } from "../network/q2-service-presentation.ts";
import { q2FogFromWire } from "../rerelease-presentation/fog.ts";
import type { ClassicGuestMessage } from "./classic-guest-services.ts";
import type { NativeModHostContext, NativeModProjection } from "./native-mod-host.ts";
import type { SimulationPresentation } from "./types.ts";

export interface NativeModAppearance {
  readonly path: string;
  readonly skin: number;
  readonly skinPath: string | null;
  readonly attachedModels: readonly string[];
  readonly frame: number;
  readonly oldFrame: number;
  readonly effects: number;
  readonly renderFlags: number;
  readonly scale: number;
  readonly alpha: number;
  readonly visible: boolean;
  readonly origin: Vec3;
  readonly angles: Vec3;
}
export interface NativeModPresentationSource {
  readonly edition: "classic" | "rerelease";
  configstrings(): ReadonlyMap<number, string>;
  drainMessages(): readonly ClassicGuestMessage[];
  appearance(slot: number): NativeModAppearance;
  signature(slot: number): string;
}
export interface NativeModPresentationCheckpoint {
  readonly fog: readonly { readonly actor: SavedActorId; readonly value: Q2FogState }[];
}
export function readNativeModPresentation(reader: SaveReader): NativeModPresentationCheckpoint {
  const fog = reader.field("fog").list(entry => ({ actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) }, value: readQ2FogState(entry.field("value")) }));
  if (new Set(fog.map(entry => `${entry.actor.slot}:${entry.actor.generation}`)).size !== fog.length) throw new Error("Duplicate native mod presentation recipient");
  return { fog };
}

/** Each source has its own configstring namespace, decoded by the existing protocol reader. */
export class NativeModPresentation {
  private readonly reader: Q2ServerMessageReader;
  private readonly layout;
  private readonly fog = new Map<ActorId, Q2FogState>();
  private readonly configs = new Map<number, string>();
  constructor(private readonly source: NativeModPresentationSource, private readonly content: ContentId,
    private readonly projection: NativeModProjection, private readonly services: ModHostServices, private readonly context: NativeModHostContext) {
    const protocol: Q2ProtocolIdentity = source.edition === "classic" ? { kind: "q2-classic", version: 34 } : { kind: "q2-rerelease", version: 1038 };
    this.layout = q2ApplicationLayout(protocol);
    this.reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: this.layout.maxConfigStrings, inventorySlots: 256 });
  }
  private recipients(message: ClassicGuestMessage): readonly (ActorId | null)[] {
    if (message.audience.kind === "unicast") {
      const actor = this.projection.actorAt(message.audience.slot);
      if (actor === null || !this.projection.acceptsClient(message.audience.slot)) throw new Error("Native mod message targets an unavailable destination player");
      return [actor];
    }
    const players = this.services.engine?.presentation?.players() ?? [];
    if (players.length === 0) return [null];
    const { scope, origin } = message.audience;
    if (scope === "all") return players;
    const scene = this.context.scene, cluster = scene.leafCluster(scene.pointLeaf(origin));
    return players.filter(actor => { const body = this.services.bodies.read(actor); return body !== null && scene.clusterVisible(cluster, scene.leafCluster(scene.pointLeaf(body.origin)), scope); });
  }
  drain(): void {
    const messages = this.source.drainMessages(); if (messages.length === 0) return;
    const engine = this.services.engine; if (engine === undefined) throw new Error("Native mod output requires presentation services");
    for (const [index, value] of this.source.configstrings()) this.configs.set(index, value);
    const time = this.services.time(), seconds = time.kind === "seconds" ? time.value : time.value / 1000;
    for (const message of messages) {
      const records = this.reader.read(message.bytes);
      for (const recipient of this.recipients(message)) {
        const sourceSlot = recipient === null ? null : this.projection.slotOf(recipient);
        const remaining = translateQ2ServiceRecords(records, {
          edition: this.source.edition, content: () => this.content, seconds, nextSequence: () => 0,
          player: () => recipient === null ? null : { actor: recipient, sourceEntity: sourceSlot ?? 0 },
          actor: slot => this.projection.actorAt(slot),
          entity: slot => { const actor = this.projection.actorAt(slot), body = actor === null ? null : this.services.bodies.read(actor); return body ?? this.source.appearance(slot); },
          soundConfigOffset: this.layout.sounds, imageConfigOffset: this.layout.images, playerSkinConfigOffset: this.layout.playerSkins,
          configString: index => this.configs.get(index), setConfigString: (index, value) => { this.configs.set(index, value); },
          setInventory: counts => { if (engine.message === undefined) throw new Error("Native inventory output requires message services"); engine.message({ kind: "q2-inventory", counts }, recipient); },
          setLayout: program => { if (engine.message === undefined) throw new Error("Native layout output requires message services"); engine.message({ kind: "q2-layout", program }, recipient); },
          fog: value => { if (recipient === null) throw new Error("Native fog requires a destination player"); const next = q2FogFromWire(this.fog.get(recipient) ?? createQ2Fog(), value); this.fog.set(recipient, next); return next; },
          emit: event => { engine.events.emit(this.content, event.kind === "q2" && event.event.kind === "sound" ? { ...event, event: { ...event.event, reliable: message.reliable } } : event, time, recipient ?? undefined); },
        });
        for (const record of remaining) {
          if (record.event.kind === "nop") continue;
          // The original service also sends broadcast text to its server console.
          if (record.event.kind === "print" && recipient === null) continue;
          if (record.event.kind === "command-text" && engine.message !== undefined) engine.message({ kind: "command-text", text: record.event.text }, recipient);
          else throw new Error(`Native mod message ${record.event.kind} needs a shared destination binding`);
        }
      }
    }
  }
  appearance(actor: ActorId, slot: number): readonly SimulationPresentation[] {
    const source = this.source.appearance(slot), body = this.services.bodies.read(actor);
    const base: SimulationPresentation = { actor, content: this.content, family: "q2", ...source, origin: body?.origin ?? source.origin, angles: body?.angles ?? source.angles, viewWeapon: false };
    return [base, ...source.attachedModels.filter(path => path !== "").map(path => ({ ...base, path, skin: 0, skinPath: null }))];
  }
  signature(slot: number): string { return this.source.signature(slot); }
  checkpoint(): NativeModPresentationCheckpoint { return { fog: [...this.fog].filter(([actor]) => this.services.actors.isLive(actor)).map(([actor, value]) => ({ actor: { slot: actor.slot, generation: actor.generation }, value })) }; }
  restore(saved: NativeModPresentationCheckpoint): void {
    const entries = saved.fog.map(entry => ({ actor: this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"), value: entry.value }));
    if (entries.some(entry => !this.services.actors.isLive(entry.actor))) throw new Error("Native mod fog recipient is unavailable");
    this.source.drainMessages(); this.fog.clear(); this.configs.clear(); for (const entry of entries) this.fog.set(entry.actor, entry.value);
  }
}
