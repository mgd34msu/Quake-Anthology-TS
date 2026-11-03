// SPDX-License-Identifier: GPL-2.0-or-later
import type { ModuleIdentity, NativeGuestCheckpoint, QvmCheckpoint } from '../../../../contracts/execution.ts';
import type { QvmGameData } from '../../../../compat/qvm/game-data.ts';

/** A saved qagame: interpreted memory or a native process image. Both carry the server game's host record. */
export type Q3GuestCheckpoint = QvmCheckpoint | NativeGuestCheckpoint;

/**
 * The game module as the Q3 server game drives it: id's GAME_* entry points over whichever execution form the mod ships, with its
 * located entity and player tables, its saved image and its lifetime. Traps the module issues reach the server game's shared trap table.
 */
export interface Q3GameEngine {
  readonly kind: 'qvm' | 'native';
  readonly module: ModuleIdentity;
  readonly data: QvmGameData;
  /** True while a call into the module is running or waiting on a host operation. */
  readonly active: boolean;
  initializeAsync(levelTime: number, randomSeed: number, restart: boolean): Promise<void>;
  shutdownAsync(restart: boolean): Promise<void>;
  clientConnectAsync(client: number, firstTime: boolean, isBot: boolean): Promise<string | null>;
  clientBeginAsync(client: number): Promise<void>;
  clientUserinfoChangedAsync(client: number): Promise<void>;
  /** From inside a trap this enters the module again, as SV_DropClient does in id's engine. */
  clientDisconnectAsync(client: number): Promise<void>;
  clientCommandAsync(client: number, argv: readonly string[]): Promise<void>;
  clientCommand(client: number, argv: readonly string[]): void;
  clientThinkAsync(client: number): Promise<void>;
  runFrameAsync(time: number): Promise<void>;
  consoleCommandAsync(argv: readonly string[]): Promise<boolean>;
  botFrameAsync(time: number): Promise<void>;
  checkpoint(): Q3GuestCheckpoint;
  restore(checkpoint: Q3GuestCheckpoint): void;
  /** Releases the module without running its shutdown entry point. */
  retire(): void;
}
