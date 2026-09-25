import type { ContentId } from "../../../contracts/content.ts";
import type { ActorId, ProviderId } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Q2ProtocolIdentity } from "../../../contracts/protocol.ts";
import type { Q2PlayerState, Q2RereleasePlayerState } from "../../../contracts/protocol.ts";
import type { NativeModClientPresentation } from "../../../contracts/mod-client-presentation.ts";
import type { ModClientPresentationFrame } from "../../../world/session/mod-client-presentation.ts";
import { nativeModCamera } from "./native-mod-camera.ts";
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
  playerState(slot: number): Q2PlayerState | Q2RereleasePlayerState;
  clock(): { readonly serverFrame: number; readonly timeMilliseconds: number; readonly frameTimeMilliseconds?: number };
  state(slot: number): { readonly active: boolean; readonly visible: boolean; readonly sound: number; readonly event: number; readonly origin: Vec3;
    readonly volume: number; readonly attenuation: number };
}
export interface NativeModPresentationCheckpoint {
  readonly fog: readonly { readonly actor: SavedActorId; readonly value: Q2FogState }[];
  readonly clients?: readonly { readonly actor: SavedActorId; readonly layout: string; readonly inventory: readonly number[] }[];
}
interface NativeLoop {
  readonly path: string;
  readonly volume: number;
  readonly attenuation: number;
  readonly origin: Vec3;
}
export function readNativeModPresentation(reader: SaveReader): NativeModPresentationCheckpoint {
  const fog = reader.field("fog").list(entry => ({ actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) }, value: readQ2FogState(entry.field("value")) }));
  if (new Set(fog.map(entry => `${entry.actor.slot}:${entry.actor.generation}`)).size !== fog.length) throw new Error("Duplicate native mod presentation recipient");
  const clients = reader.field("clients").value === undefined ? [] : reader.field("clients").list(entry => ({
    actor: { slot: entry.field("actor").field("slot").integer(0), generation: entry.field("actor").field("generation").integer(0) },
    layout: entry.field("layout").string(), inventory: entry.field("inventory").list(value => value.integer()) }));
  if (new Set(clients.map(entry => `${entry.actor.slot}:${entry.actor.generation}`)).size !== clients.length) reader.fail("Duplicate native client presentation");
  return { fog, clients };
}

/** Each source has its own configstring namespace, decoded by the existing protocol reader. */
export class NativeModPresentation {
  private readonly reader: Q2ServerMessageReader;
  private readonly layout;
  private readonly fog = new Map<ActorId, Q2FogState>();
  private readonly configs = new Map<number, string>();
  private readonly loops = new Map<ActorId, NativeLoop>();
  private readonly entityEvents = new Map<ActorId, number>();
  private readonly clients = new Map<ActorId, { layout: string; inventory: readonly number[] }>();
  private readonly clientFrames = new Map<ActorId, ModClientPresentationFrame>();
  private revision = 0;
  get generation(): number { return this.revision; }
  clientFrame(actor: ActorId): ModClientPresentationFrame | null {
    return this.services.actors.isLive(actor) ? this.clientFrames.get(actor) ?? null : null;
  }
  constructor(private readonly source: NativeModPresentationSource, private readonly content: ContentId,
    private readonly projection: NativeModProjection, private readonly services: ModHostServices, private readonly context: NativeModHostContext,
    private readonly owner: ProviderId, private readonly admission?: NativeModClientPresentation) {
    const protocol: Q2ProtocolIdentity = source.edition === "classic" ? { kind: "q2-classic", version: 34 } : { kind: "q2-rerelease", version: 1038 };
    this.layout = q2ApplicationLayout(protocol);
    this.reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: this.layout.maxConfigStrings, inventorySlots: 256 });
  }
  publish(actors: readonly { readonly actor: ActorId; readonly slot: number }[], events = true): void {
    this.drain();
    this.clientFrames.clear();
    const configstrings = this.admission === undefined ? null : new Map(this.source.configstrings());
    const time = this.services.time();
    const activeActors = new Set(actors.map(entry => entry.actor));
    for (const actor of new Set([...this.entityEvents.keys(), ...this.loops.keys()])) if (!activeActors.has(actor)) this.release(actor);
    for (const { actor, slot } of actors) {
      const state = this.source.state(slot);
      if (!state.active || !this.services.actors.isLive(actor)) { this.release(actor); continue; }
      if (this.admission !== undefined && configstrings !== null && this.projection.acceptsClient(slot)) {
        const player = this.source.playerState(slot), received = this.clients.get(actor);
        this.clientFrames.set(actor, { kind: "native", hud: this.admission.hud === "none" ? null : {
          mode: this.admission.hud, frame: { protocol: player.kind === "q2-classic" ? { kind: "q2-classic", version: 34 } : { kind: "q2-rerelease", version: 1038 },
            stats: player.stats, configstrings, layout: received?.layout ?? "", inventory: received?.inventory ?? [], playerNumber: slot - 1, ...this.source.clock() } },
          view: this.admission.view === "none" ? null : nativeModCamera(player) });
      }
      if (!state.visible) {
        const loop = this.loops.get(actor); if (loop !== undefined) this.stop(actor, loop);
        this.entityEvents.delete(actor); continue;
      }
      const previous = this.entityEvents.get(actor);
      if (events && state.event !== 0 && previous !== state.event) {
        const engine = this.services.engine; if (engine === undefined) throw new Error("Native mod output requires presentation services");
        engine.events.emit(this.content, { kind: "q2", event: { kind: "entity-event", actor, event: state.event } }, time);
      }
      this.entityEvents.set(actor, state.event);
      const loop = this.loops.get(actor);
      if (state.sound === 0) { if (loop !== undefined) this.stop(actor, loop); continue; }
      const path = this.source.configstrings().get(this.layout.sounds + state.sound);
      if (path === undefined || path === "") throw new Error(`Native mod loop sound ${state.sound} has no configstring`);
      const volume = this.source.edition === "rerelease" && state.volume === 0 ? 1 : state.volume;
      const attenuation = this.source.edition === "classic" ? state.attenuation : state.attenuation === -1 ? 0
        : state.attenuation > 0 && state.attenuation !== 3 ? state.attenuation / 5 : 1;
      const origin = this.services.bodies.read(actor)?.origin ?? state.origin;
      if (loop !== undefined && loop.path === path && loop.volume === volume && loop.attenuation === attenuation) {
        this.loops.set(actor, { ...loop, origin });
        continue;
      }
      if (loop !== undefined) this.stop(actor, loop);
      const next = { path, volume, attenuation, origin }; this.loops.set(actor, next);
      this.sound(actor, next, "start");
    }
  }
  beginFrame(): void { this.entityEvents.clear(); }
  private sound(actor: ActorId, loop: NativeLoop, state: "start" | "stop"): void {
    const engine = this.services.engine; if (engine === undefined) throw new Error("Native mod output requires presentation services");
    engine.events.emit(this.content, { kind: "q2", event: { kind: "sound", actor, ...loop, channel: 0, reliable: false, loop: state, loopOwner: this.owner } }, this.services.time());
  }
  private stop(actor: ActorId, loop: NativeLoop): void {
    this.sound(actor, loop, "stop"); this.loops.delete(actor);
  }
  release(actor: ActorId): void {
    const loop = this.loops.get(actor); if (loop !== undefined) this.stop(actor, loop);
    this.entityEvents.delete(actor); this.fog.delete(actor); this.clients.delete(actor); this.clientFrames.delete(actor);
  }
  close(): void { this.revision++; for (const actor of this.loops.keys()) this.release(actor); this.entityEvents.clear(); this.clients.clear(); this.clientFrames.clear(); }
  private clientMessages(actor: ActorId | null) {
    if (actor === null) throw new Error("Native client presentation requires an admitted recipient");
    let state = this.clients.get(actor);
    if (state === undefined) { state = { layout: "", inventory: [] }; this.clients.set(actor, state); }
    return state;
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
          setInventory: counts => { this.clientMessages(recipient).inventory = [...counts]; },
          setLayout: program => { this.clientMessages(recipient).layout = program; },
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
  checkpoint(): NativeModPresentationCheckpoint { return {
    fog: [...this.fog].filter(([actor]) => this.services.actors.isLive(actor)).map(([actor, value]) => ({ actor: { slot: actor.slot, generation: actor.generation }, value })),
    clients: [...this.clients].filter(([actor]) => this.services.actors.isLive(actor)).map(([actor, state]) => ({ actor: { slot: actor.slot, generation: actor.generation }, ...state })) }; }
  restore(saved: NativeModPresentationCheckpoint): void {
    const entries = saved.fog.map(entry => ({ actor: this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current"), value: entry.value }));
    if (entries.some(entry => !this.services.actors.isLive(entry.actor))) throw new Error("Native mod fog recipient is unavailable");
    this.close(); this.source.drainMessages(); this.fog.clear(); this.configs.clear(); for (const entry of entries) this.fog.set(entry.actor, entry.value);
    for (const entry of saved.clients ?? []) {
      const actor = this.services.referenceSaved?.(entry.actor) ?? this.services.actors.referenceSaved(entry.actor, "current");
      if (!this.services.actors.isLive(actor)) throw new Error("Native client presentation recipient is unavailable");
      this.clients.set(actor, { layout: entry.layout, inventory: entry.inventory });
    }
  }
}
