// SPDX-License-Identifier: GPL-2.0-or-later
import type { QvmCheckpoint } from '../../../../contracts/execution.ts';
import { QvmGameExport } from '../../../../compat/qvm/abi.ts';
import { QvmGame } from '../../../../compat/qvm/game.ts';
import { qvmArguments } from '../../../../compat/qvm/module.ts';
import type { QvmModuleOptions } from '../../../../compat/qvm/module.ts';
import type { QvmHostCall, QvmHostResult, SharedHostCall } from '../../../../compat/qvm/syscalls.ts';
import type { Q3GameEngine, Q3GuestCheckpoint } from './engine.ts';

/** An interpreted qagame: every trap reaches the shared trap table, and a trap may enter the module again through the suspended interpreter. */
export class Q3QvmEngine implements Q3GameEngine {
  readonly kind = 'qvm';
  readonly game: QvmGame;
  private currentCall: QvmHostCall | null = null;

  constructor(options: Pick<QvmModuleOptions, 'artifact' | 'semantics' | 'hostState'>, private readonly traps: (call: SharedHostCall) => QvmHostResult, private readonly assertCurrent: () => void) {
    this.game = new QvmGame({ ...options, host: call => this.host(call) });
  }

  get data() { return this.game.data; }
  get module() { return this.game.module.profile.module; }
  get active(): boolean { return this.game.module.interpreter.isActive || this.currentCall !== null; }

  private host(call: QvmHostCall): QvmHostResult {
    this.assertCurrent();
    const previous = this.currentCall;
    this.currentCall = call;
    try {
      const result = this.traps(call);
      if (result instanceof Promise) return result.then(value => { this.assertCurrent(); return value; }).finally(() => { this.currentCall = previous; });
      this.assertCurrent(); this.currentCall = previous; return result;
    } catch (error) { this.currentCall = previous; throw error; }
  }

  initializeAsync(levelTime: number, randomSeed: number, restart: boolean): Promise<void> { return this.game.initializeAsync(levelTime, randomSeed, restart); }
  shutdownAsync(restart: boolean): Promise<void> { return this.game.shutdownAsync(restart); }
  clientConnectAsync(client: number, firstTime: boolean, isBot: boolean): Promise<string | null> { return this.game.clientConnectAsync(client, firstTime, isBot); }
  clientBeginAsync(client: number): Promise<void> { return this.game.clientBeginAsync(client); }
  clientUserinfoChangedAsync(client: number): Promise<void> { return this.game.clientUserinfoChangedAsync(client); }
  async clientDisconnectAsync(client: number): Promise<void> {
    const call = this.currentCall;
    if (call === null) await this.game.clientDisconnectAsync(client);
    else await call.invokeAsync(qvmArguments([QvmGameExport.GAME_CLIENT_DISCONNECT, client]));
  }
  clientCommandAsync(client: number, argv: readonly string[]): Promise<void> { return this.game.clientCommandAsync(client, argv); }
  clientCommand(client: number, argv: readonly string[]): void { this.game.clientCommand(client, argv); }
  clientThinkAsync(client: number): Promise<void> { return this.game.clientThinkAsync(client); }
  runFrameAsync(time: number): Promise<void> { return this.game.runFrameAsync(time); }
  consoleCommandAsync(argv: readonly string[]): Promise<boolean> { return this.game.consoleCommandAsync(argv); }
  async botFrameAsync(time: number): Promise<void> { await this.game.module.callAsync([QvmGameExport.BOTAI_START_FRAME, time]); }
  checkpoint(): QvmCheckpoint { return this.game.module.checkpoint(); }
  restore(checkpoint: Q3GuestCheckpoint): void {
    if (checkpoint.kind !== 'qvm') throw new Error('Interpreted Q3 restore requires a qvm checkpoint');
    this.game.module.restore(checkpoint);
  }
  retire(): void { this.game.retire(); }
}
