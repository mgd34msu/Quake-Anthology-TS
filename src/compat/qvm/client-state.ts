import type { Q3ClientConnection } from "../../network/q3/client.ts";

/** Client VM services depend on retained engine state, independently of its delivery. */
export interface Q3ClientState extends Pick<Q3ClientConnection,
  "generation" | "serverMessageSequence" | "lastExecutedServerCommand" | "clientNumber" | "snapshotPing" | "getServerCommand"> {
  readonly gameState: Pick<Q3ClientConnection["gameState"], "get" | "copySourceRecord">;
  readonly commands: Pick<Q3ClientConnection["commands"], "currentNumber" | "read">;
}
