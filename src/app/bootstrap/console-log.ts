// SPDX-License-Identifier: GPL-2.0-or-later
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { UserFileStore } from "../../core/files/writable.ts";
import type { WritableBinaryFile } from "../../core/files/writable.ts";
import type { ApplicationHost } from "./application.ts";

/** Console output also goes to `log`, which decides whether the game's trigger asks for it. */
export function hostWithConsoleLog(host: ApplicationHost, log: (text: string) => void): ApplicationHost {
  return {
    ...host,
    print: text => {
      log(text);
      return host.print(text);
    },
  };
}

/** Quake II and Quake III keep the `logfile` variable (Quake III registers it with its server variables already). */
export function registerConsoleLogCvar(cvars: CvarRegistry): void {
  if (cvars.dialect.startsWith("q1") || cvars.find("logfile") !== undefined) return;
  cvars.register("logfile", "0", cvars.dialect.startsWith("q2") ? 0 : CvarFlag.Temporary);
}

/**
 * How much of the console the game asks to keep: 0 none, 1 append, 2 append and flush every write. Quake II and Quake III
 * ask through the `logfile` variable; Quake (WinQuake) asks with the `-condebug` launch flag, which flushes each line.
 */
export function consoleLogMode(cvars: CvarRegistry | null, consoleDebug: boolean | undefined): number {
  const variable = cvars?.find("logfile");
  if (variable !== undefined) return variable.integerValue;
  return consoleDebug === true && (cvars === null || cvars.dialect.startsWith("q1")) ? 2 : 0;
}

/**
 * One append-only log file kept open between writes and reopened when its name or sync mode changes. The engine's
 * console log (`qconsole.log`) and the game's log (`games.log`) are both instances; the owner supplies the folder.
 */
export class AppendLog {
  #open: { readonly name: string; readonly sync: boolean; readonly file: WritableBinaryFile } | null = null;

  /** Appends `text` to `name` in `root`; false when the file could not be opened. */
  write(root: string, name: string, sync: boolean, text: string, report?: (text: string) => void): boolean {
    if (this.#open === null || this.#open.name !== name || this.#open.sync !== sync) {
      this.close();
      const file = new UserFileStore(root).open(name, sync ? "append-sync" : "append", report);
      if (file === null) return false;
      this.#open = { name, sync, file };
    }
    this.#open.file.write(new TextEncoder().encode(text));
    return true;
  }

  close(): void {
    this.#open?.file.close();
    this.#open = null;
  }
}

/** The console log shared by every application type: the owner supplies its mode and its game folder. */
export class ConsoleLog {
  readonly #log = new AppendLog();

  constructor(
    private readonly mode: () => number,
    private readonly root: () => string,
  ) {}

  write(text: string): void {
    const mode = this.mode();
    if (mode === 0) this.#log.close();
    else this.#log.write(this.root(), "qconsole.log", mode >= 2, text);
  }

  close(): void {
    this.#log.close();
  }
}
