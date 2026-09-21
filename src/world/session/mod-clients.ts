import type { ActorId, ClientId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { SourceTime } from "../../contracts/time.ts";
import type { FrameContext } from "../../contracts/time.ts";
import type { UserCommand } from "../../contracts/protocol.ts";
import type { Vec3 } from "../../contracts/math.ts";

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

export interface ModClientApplication {
  readonly identity: ModClientIdentity;
  readonly invocation: number;
  readonly parentInvocation: number | null;
  readonly scope: "client-command" | "movement-slice";
  /** The effective command at this boundary, after source command subdivision. */
  readonly command: UserCommand;
  readonly angleSpace: "absolute" | "source-relative";
  readonly absoluteAim: Vec3;
  readonly frame: FrameContext;
  /** Receipt is distinct from application; initial retained zero input has no receipt. */
  readonly accepted: ModClientCommand | null;
}

export type ModClientApplicationEvent =
  | { readonly phase: "before"; readonly application: ModClientApplication }
  | { readonly phase: "after"; readonly application: ModClientApplication; readonly outcome: "completed" | "actor-removed" | "failed" };

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
  /** Current source movement state, including an input operation's working state. */
  grounded?(client: ClientId): boolean;
  /** Queues the owning host's disconnect after the current source callback completes. */
  drop(client: ClientId, reason: string, content: ContentId): void;
  /** Disconnect notifications run while both handles still resolve; admission follows actor creation. */
  subscribe(listener: (event: ModClientEvent) => undefined): () => undefined;
  /** Ordered source application; restore does not replay these notifications. */
  subscribeApplication(listener: (event: ModClientApplicationEvent) => undefined): () => undefined;
}
