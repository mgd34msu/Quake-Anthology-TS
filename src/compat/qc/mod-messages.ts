import type { ActorId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { savedActorId, readSavedActor } from "../../persistence/save-image.ts";
import { SaveReader } from "../../persistence/value.ts";
import { QuakeCLocalMessages, presentQuakeCLocalMessage } from "../../app/bootstrap/simulation/quakec-local-messages.ts";
import { QcBroadcastMessages } from "./presentation-host.ts";
import type { QcMessageWorld, QcNetQuakeMessageServices } from "./presentation-host.ts";

/** The original codec retains each mod's source indices before common presentation routing. */
export class QcModMessages {
  readonly messages: QcBroadcastMessages;
  readonly route: QcNetQuakeMessageServices;
  private readonly local = new QuakeCLocalMessages();
  private readonly retire: () => undefined;
  constructor(world: QcMessageWorld, services: ModHostServices, content: ContentId,
    resourceName: (kind: "model" | "sound", index: number) => string) {
    const engine = services.engine;
    if (engine === undefined) throw new Error("Source mod messages require destination engine services");
    this.route = { native: () => false, loading: () => false,
      client: actor => services.clients === undefined ? engine.presentation?.players().some(client => client.equals(actor)) === true : services.clients.forActor(actor) !== null,
      route: (messages, destination) => {
        if (destination.kind === "multicast") throw new Error("NetQuake cannot route a multicast message");
        const presentation = engine.presentation;
        if (presentation === undefined) throw new Error("Source mod messages require destination presentation services");
        const target = destination.kind === "client" ? destination.actor : null, recipients = presentation.players();
        for (const actor of recipients) this.local.admit(actor);
        for (const message of messages) {
          this.local.receive([message], target);
          const now = services.time();
          presentQuakeCLocalMessage(message, target, this.local, { ...presentation, recipients,
            sourceActor: world.actor(0).id, seconds: now.kind === "seconds" ? now.value : now.value / 1000,
            actor: slot => world.actor(slot).id, sound: index => resourceName("sound", index), model: index => resourceName("model", index),
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
          });
        }
        return undefined;
      } };
    this.messages = new QcBroadcastMessages(world, (event, recipient) => engine.events.emit(content, { kind: "q1", event }, undefined, recipient), undefined, this.route);
    this.retire = services.actors.onRelease(actor => { this.local.retire(actor.id); return undefined; });
  }
  capture() {
    const local = this.local.capture();
    return { messages: this.messages.capture(), baseline: this.messages.captureNetQuakeMessages(local.baseline),
      clients: local.clients.map(client => ({ actor: savedActorId(client.actor), messages: this.messages.captureNetQuakeMessages(client.messages) })) };
  }
  restore(reader: SaveReader, resolve: (saved: SavedActorId) => ActorId): void {
    this.messages.restore(reader.field("messages").value, resolve);
    this.local.restore(this.messages.restoreNetQuakeMessages(reader.field("baseline").bytes()),
      reader.field("clients").list(client => ({ actor: resolve(readSavedActor(client.field("actor"))), messages: this.messages.restoreNetQuakeMessages(client.field("messages").bytes()) })));
  }
  close(): undefined { return this.retire(); }
}
