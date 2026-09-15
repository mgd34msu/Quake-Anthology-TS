import type { ActorId, ClientId } from '../../../contracts/identity.ts';
import type { ActorCommand } from '../../../contracts/session.ts';
import type { WireAdmission } from '../../../network/common/session.ts';
import type { Q3AcceptedConnect } from '../../../network/q3/admission.ts';
import type { WireUserCommand } from '../../../network/q3/message.ts';
import type { Q3PureServer } from '../../../network/q3/pure.ts';
import type { Q3DownloadReadFile } from '../../../network/q3/download.ts';
import type { Q3ServerRate } from '../../../network/q3/server.ts';
import type { Gamestate } from '../../../network/q3/server-message.ts';
import type { Product } from '../../../network/q3/state/product.ts';
import type { EntityStateFields } from '../../../network/q3/state/entity.ts';
import type { PlayerStateFields } from '../../../network/q3/state/player.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
export interface Q3ApplicationPlayer { readonly client: ClientId; readonly actor: ActorId; readonly sourceEntity: number; }
export type Q3ApplicationAdmission = { readonly kind: 'accepted'; readonly player: Q3ApplicationPlayer } | { readonly kind: 'rejected'; readonly reason: string };
export interface Q3SourceRoundBinding {
  preflight(): void;
  rebind(): void;
  reconnect(client: ClientId, userinfo: string, lastCommand: WireUserCommand): Q3ApplicationAdmission | Promise<Q3ApplicationAdmission>;
}
export interface Q3NetworkRoundRestart {
  readonly clients: readonly ClientId[];
  readonly snapshotServerBit: 0 | 4;
  bindSource(): Promise<void>;
  receiveEvents(events: readonly SimulationPresentationEvent[]): Promise<void>;
  reconnectClient(client: ClientId): Promise<boolean>;
}
export interface Q3ApplicationServerHost {
  readonly sourceRound?: Q3SourceRoundBinding;
  readonly product: Product;
  readonly maxClients: number;
  prepare(checksumFeed: number, serverId: number, configstring?: (index: number, value: string) => void | Promise<void>): Promise<void>;
  pure(serverId: number, checksumFeedServerId?: number): Q3PureServer;
  downloadsEnabled(): boolean;
  openDownload(name: string): Q3DownloadReadFile | null;
  rate(player: Q3ApplicationPlayer): Q3ServerRate;
  supportsSourceWire(): WireAdmission;
  time(): number;
  occupiedSlots(): readonly number[];
  admit(request: Q3AcceptedConnect): Q3ApplicationAdmission | Promise<Q3ApplicationAdmission>;
  carriedPlayer(client: ClientId): Q3ApplicationPlayer;
  disconnect(player: Q3ApplicationPlayer, reason: string): void | Promise<void>;
  gameState(player: Q3ApplicationPlayer, serverId: number): Gamestate;
  snapshot(player: Q3ApplicationPlayer): { readonly player: PlayerStateFields; readonly areaMask: Uint8Array; readonly entities: readonly EntityStateFields[] };
  begin?(player: Q3ApplicationPlayer, command: WireUserCommand): void | Promise<void>;
  input(player: Q3ApplicationPlayer, command: WireUserCommand, sequence: number): ActorCommand | null | Promise<ActorCommand | null>;
  command(player: Q3ApplicationPlayer, name: string, args: readonly string[]): void | Promise<void>;
  userinfo(player: Q3ApplicationPlayer, value: string): void | Promise<void>;
  status(challenge: string, detailed: boolean): string;
  print(text: string): void;
}

export class Q3GameCallbackError extends Error {
  constructor(cause: unknown) {
    super(`Q3 game callback failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'Q3GameCallbackError';
  }
}
export async function q3GameCallback<T>(callback: () => T | Promise<T>): Promise<T> {
  try { return await callback(); }
  catch (error) { throw error instanceof Q3GameCallbackError ? error : new Q3GameCallbackError(error); }
}
