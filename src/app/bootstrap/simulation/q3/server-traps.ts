// SPDX-License-Identifier: GPL-2.0-or-later
import { QvmGameImport } from '../../../../compat/qvm/abi.ts';
import { qvmCommonSyscall } from '../../../../compat/qvm/common-syscalls.ts';
import type { QvmCommonServices } from '../../../../compat/qvm/common-syscalls.ts';
import { qvmFileSyscall } from '../../../../compat/qvm/file-syscalls.ts';
import type { QvmFiles } from '../../../../compat/qvm/file-syscalls.ts';
import { qvmServerGameSyscall } from '../../../../compat/qvm/server-game-syscalls.ts';
import type { QvmServerGameServices } from '../../../../compat/qvm/server-game-syscalls.ts';
import { rejectQvmSyscall } from '../../../../compat/qvm/syscalls.ts';
import type { QvmHostResult, SharedHostCall } from '../../../../compat/qvm/syscalls.ts';

/** The botlib traps a game module may reach once the bot library is attached. */
export interface Q3BotTraps { syscall(call: SharedHostCall): QvmHostResult | null; }

/**
 * sv_game.c's SV_GameSystemCalls for either execution form: an interpreted module and a native module issue the same trap numbers with the
 * same argument words, so one table serves both. Memory access goes through the call's own pointer space.
 */
export class Q3ServerTraps {
  constructor(private readonly services: {
    readonly common: Extract<QvmCommonServices, { readonly role: 'qagame' }>;
    readonly files: QvmFiles;
    readonly game: QvmServerGameServices;
    bots(): Q3BotTraps | null;
    print(text: string): void;
  }) {}

  dispatch(call: SharedHostCall): QvmHostResult {
    const { common, files, game } = this.services;
    return qvmCommonSyscall(call, common) ?? qvmFileSyscall(call, files) ?? qvmServerGameSyscall(call, game)
      ?? this.services.bots()?.syscall(call) ?? this.disabledBot(call) ?? rejectQvmSyscall(call);
  }

  /** Without the bot library, the game's bot entry points see id's "used before being setup" answers. */
  private disabledBot(call: SharedHostCall): number | null {
    if (call.kind !== 'engine' || call.role !== 'qagame') return null;
    switch (call.code) {
      case QvmGameImport.BOTLIB_SETUP: return 0;
      case QvmGameImport.BOTLIB_AAS_INITIALIZED: return 0;
      case QvmGameImport.BOTLIB_SHUTDOWN: this.services.print('BotLibShutdown: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_START_FRAME: this.services.print('BotStartFrame: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_LOAD_MAP: this.services.print('BotLoadMap: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_UPDATENTITY: this.services.print('BotUpdateEntity: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_TEST: return 0;
      default: return null;
    }
  }
}
