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
export interface Q3ApplicationPlayer { readonly client: ClientId; readonly actor: ActorId; readonly sourceEntity: number; }
export type Q3ApplicationAdmission = { readonly kind: 'accepted'; readonly player: Q3ApplicationPlayer } | { readonly kind: 'rejected'; readonly reason: string };
export interface Q3ApplicationServerHost {
  readonly product: Product;
  readonly maxClients: number;
  prepare(checksumFeed: number, serverId: number): Promise<void>;
  pure(serverId: number): Q3PureServer;
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
  input(player: Q3ApplicationPlayer, command: WireUserCommand, sequence: number): ActorCommand | Promise<ActorCommand>;
  command(player: Q3ApplicationPlayer, name: string, args: readonly string[]): void | Promise<void>;
  userinfo(player: Q3ApplicationPlayer, value: string): void | Promise<void>;
  status(challenge: string, detailed: boolean): string;
  print(text: string): void;
}
