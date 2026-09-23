import type { ActorId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { savedActorId, readSavedActor } from "../../persistence/save-image.ts";
import { SaveReader } from "../../persistence/value.ts";
import { QuakeCLocalMessages, presentQuakeCLocalMessage } from "../../app/bootstrap/simulation/quakec-local-messages.ts";
import { QcBroadcastMessages } from "./presentation-host.ts";
import type { QcMessageWorld, QcPresentationServices, QcRoutedMessage } from "./presentation-host.ts";
import { receivesQuakeWorldMessage } from "./message-routing.ts";
import { presentQuakeWorldMessage } from "./quakeworld-presentation.ts";

/** The original codec retains each mod's source indices before common presentation routing. */
export class QcModMessages {
  readonly messages: QcBroadcastMessages;
  readonly routes: Pick<QcPresentationServices, "qw" | "nq">;
  private readonly local = new QuakeCLocalMessages();
  private readonly signon: QcRoutedMessage[] = [];
  private readonly admitted = new Map<ActorId, number>();
  private readonly retire: () => undefined;
  private readonly unsubscribe: (() => undefined) | undefined;
  constructor(private readonly world: QcMessageWorld, private readonly services: ModHostServices, private readonly content: ContentId,
    private readonly resourceName: (kind: "model" | "sound", index: number) => string,
    source: { loading(): boolean; phs(): boolean }) {
    const engine = services.engine;
    if (engine === undefined) throw new Error("Source mod messages require destination engine services");
    const client = (actor: ActorId) => services.clients === undefined ? engine.presentation?.players().some(value => value.equals(actor)) === true : services.clients.forActor(actor) !== null;
    if (world.options.program.api.kind === "q1-quakeworld") {
      this.routes = { qw: { ...source, client, route: (entries, destination) => {
        if (destination.kind === "signon") {
          this.signon.push(...entries);
          this.start();
        } else if (destination.kind === "broadcast") {
          this.start();
          for (const entry of entries) presentQuakeWorldMessage(entry, null, this.local, this.host(null));
        } else {
          const recipients = destination.kind === "client" ? [destination.actor] : this.players();
          for (const actor of recipients) if (receivesQuakeWorldMessage(actor, destination, () => {
            const body = services.bodies.read(actor);
            if (body === null) throw new Error("QW multicast recipient has no destination body");
            return body.origin;
          }, () => {
            const visibility = engine.clients?.visibility;
            if (visibility === undefined) throw new Error("QW multicast requires destination PVS/PHS queries");
            return visibility;
          })) {
            if (!client(actor)) { this.retireClient(actor); continue; }
            this.admit(actor);
            for (const entry of entries) presentQuakeWorldMessage(entry, actor, this.local, this.host(actor));
          }
        }
        return undefined;
      } } };
      this.unsubscribe = services.clients?.subscribe(event => {
        if (event.kind === "admitted") this.admit(event.identity.actor);
        else if (event.kind === "disconnecting") this.retireClient(event.identity.actor);
        return undefined;
      });
    } else this.routes = { nq: { native: () => false, loading: source.loading, client, route: (messages, destination, viewTargets) => {
      if (destination.kind === "multicast") throw new Error("NetQuake cannot route a multicast message");
      const target = destination.kind === "client" ? destination.actor : null;
      for (const actor of this.players()) this.local.admit(actor);
      for (const [index, message] of messages.entries()) {
        if (message.kind === "set-view" && !viewTargets?.has(index)) throw new Error("QC camera message has no captured source actor");
        this.local.receive([message], target, viewTargets?.get(index));
        presentQuakeCLocalMessage(message, target, this.local, this.host(target));
      }
      return undefined;
    } } };
    this.messages = new QcBroadcastMessages(world, (event, recipient) => engine.events.emit(content, { kind: "q1", event }, undefined, recipient), this.routes.qw, this.routes.nq);
    this.retire = services.actors.onRelease(actor => { this.retireClient(actor.id); return undefined; });
  }
  private players(): readonly ActorId[] {
    return this.services.clients?.clients().map(client => client.actor) ?? this.services.engine?.presentation?.players() ?? [];
  }
  private host(target: ActorId | null): Parameters<typeof presentQuakeWorldMessage>[3] {
    const engine = this.services.engine, presentation = engine?.presentation;
    if (engine === undefined || presentation === undefined) throw new Error("Source mod messages require destination presentation services");
    const now = this.services.time(), content = this.content;
    return { ...presentation, recipients: this.players(), sourceActor: this.world.actor(0).id,
      seconds: now.kind === "seconds" ? now.value : now.value / 1000,
      actor: slot => this.world.actor(slot).id, sound: index => this.resourceName("sound", index), model: index => this.resourceName("model", index),
      muzzle: actor => {
        if (!this.players().some(player => player.equals(actor))) return null;
        const body = this.services.bodies.read(actor);
        return body === null ? null : { origin: body.origin, angles: presentation.camera(actor).angles };
      },
      emit: (event, recipient = target ?? undefined) => engine.events.emit(content, { kind: "q1", event }, undefined, recipient),
      message: (event, actor) => {
        if (engine.message === undefined) throw new Error("Source mod message requires a destination message sink");
        return engine.message(event, actor);
      },
      music: track => engine.events.emit(content, { kind: "music", event: { kind: "cd-track", track } }, undefined, target ?? undefined),
      angles: (actor, angles) => engine.events.emit(content, { kind: "view-reset", reason: "source", actor, angles }, undefined, target ?? undefined),
      pause: paused => engine.events.emit(content, { kind: "music", event: { kind: "pause", paused } }, undefined, target ?? undefined),
      sky: (name, recipient) => engine.events.emit(content, { kind: "q1-sky", event: { kind: "skybox", name } }, undefined, recipient ?? undefined),
      clientMetadata: (event, recipient) => engine.events.emit(content, { kind: "q1-client", event }, undefined, recipient ?? undefined),
      session: (kind, recipient) => engine.events.emit(content, { kind: "q1-session", event: { kind } }, undefined, recipient ?? undefined),
      prompt: event => engine.events.emit(content, { kind: "q1-composition", event }, undefined, event.actor),
      fog: (value, recipient) => engine.events.emit(content, { kind: "q1-composition", event: { kind: "addon", event: { kind: "fog",
        player: recipient, density: value.density, color: value.color, duration: Math.max(0, value.transitionSeconds), skyFactor: 0.5 } } }, undefined, recipient ?? undefined),
    };
  }
  private admit(actor: ActorId): void {
    this.local.admit(actor);
    const cursor = this.admitted.get(actor) ?? 0;
    for (let index = cursor; index < this.signon.length; index++) {
      const entry = this.signon[index];
      if (entry === undefined) throw new Error("Missing component signon entry");
      presentQuakeWorldMessage(entry, actor, this.local, this.host(actor));
    }
    this.admitted.set(actor, this.signon.length);
  }
  private retireClient(actor: ActorId): void { this.local.retire(actor); this.admitted.delete(actor); }
  clientState(): QuakeCLocalMessages { return this.local; }
  start(): void { if (this.routes.qw !== undefined) for (const actor of this.players()) this.admit(actor); }
  capture() {
    const local = this.local.capture();
    const views = this.local.captureViews();
    const state = { messages: this.messages.capture(), baseline: this.messages.captureNetQuakeMessages(local.baseline),
      clients: local.clients.map(client => ({ actor: savedActorId(client.actor), messages: this.messages.captureNetQuakeMessages(client.messages) })),
      views: { baseline: views.baseline === null ? null : savedActorId(views.baseline),
        clients: views.clients.map(entry => ({ actor: savedActorId(entry.actor), target: savedActorId(entry.target) })) } };
    return this.routes.qw === undefined ? state : { ...state, quakeworld: { signon: this.messages.captureEntries(this.signon),
      admitted: [...this.admitted].map(([actor, cursor]) => ({ actor: savedActorId(actor), cursor })) } };
  }
  restore(reader: SaveReader, resolve: (saved: SavedActorId) => ActorId): void {
    this.messages.restore(reader.field("messages").value, resolve);
    this.local.restore(this.messages.restoreNetQuakeMessages(reader.field("baseline").bytes()),
      reader.field("clients").list(client => ({ actor: resolve(readSavedActor(client.field("actor"))), messages: this.messages.restoreNetQuakeMessages(client.field("messages").bytes()) })));
    const views = reader.field("views");
    if (views.value !== undefined) this.local.restoreViews(views.field("baseline").nullable(entry => resolve(readSavedActor(entry))),
      views.field("clients").list(entry => ({ actor: resolve(readSavedActor(entry.field("actor"))), target: resolve(readSavedActor(entry.field("target"))) })));
    if (this.routes.qw !== undefined) {
      const state = reader.field("quakeworld");
      this.signon.splice(0, this.signon.length, ...this.messages.restoreEntries(state.field("signon").value, resolve));
      this.admitted.clear();
      state.field("admitted").list(entry => {
        const actor = resolve(readSavedActor(entry.field("actor"))), cursor = entry.field("cursor").integer(0);
        if (cursor > this.signon.length || this.admitted.has(actor)) entry.fail("Invalid component signon cursor");
        this.admitted.set(actor, cursor);
      });
    }
  }
  close(): undefined { this.unsubscribe?.(); this.signon.length = 0; this.admitted.clear(); return this.retire(); }
}
