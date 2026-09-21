import type { ActorId, ClientId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { SourceTime } from "../../contracts/time.ts";

export interface ModClientIdentity {
  readonly client: ClientId;
  readonly actor: ActorId;
}

export interface ModClientEvent {
  readonly kind: "admitted" | "userinfo" | "disconnecting";
  readonly identity: ModClientIdentity;
}

export interface ModClientCommand {
  readonly input: ActorCommand;
  readonly time: SourceTime;
}

/** Current destination clients; source adapters own their separate private client numbering. */
export interface ModClientServices {
  readonly maximum: number;
  clients(): readonly ModClientIdentity[];
  forActor(actor: ActorId): ClientId | null;
  actor(client: ClientId): ActorId | null;
  userinfo(client: ClientId): string;
  /** Updates the authoritative store without invoking gameplay callbacks or publishing another userinfo event. */
  setUserinfo(client: ClientId, value: string): void;
  command(client: ClientId): ModClientCommand | null;
  /** Queues the owning host's disconnect after the current source callback completes. */
  drop(client: ClientId, reason: string, content: ContentId): void;
  /** Disconnect notifications run while both handles still resolve; admission follows actor creation. */
  subscribe(listener: (event: ModClientEvent) => undefined): () => undefined;
}
