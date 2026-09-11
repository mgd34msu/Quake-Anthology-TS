/* Quake III Arena client/cl_cgame.c and cgame/cg_public.h. GPL-2.0-or-later. */
import type { SeatId } from "../../contracts/identity.ts";
import type { Q3CgameEventHandling, Q3CgameExports, StereoView } from "../../contracts/ui.ts";
import { QvmCgameExport } from "./abi.ts";
import { QvmModule } from "./module.ts";
import type { QvmModuleOptions } from "./module.ts";

export interface QvmCgameLifetime {
  readonly assertCurrentOperation: () => undefined;
  readonly current: () => { readonly generation: number; readonly serverMessageNumber: number; readonly dropped: Error | null };
  readonly beginLoading: () => undefined;
  readonly prime: (generation: number) => undefined;
}
type Phase = { readonly kind: "created" } | { readonly kind: "retired" }
  | { readonly kind: "initializing" | "initialized"; readonly generation: number };

export class QvmCgame implements Q3CgameExports {
  readonly api = { kind: "q3-cgame", version: 4 } satisfies Q3CgameExports["api"];
  readonly module: QvmModule;
  private phase: Phase = { kind: "created" };

  constructor(readonly seat: SeatId, options: QvmModuleOptions, private readonly lifetime: QvmCgameLifetime) {
    if (options.artifact.role !== "cgame") throw new Error("QvmCgame requires a cgame artifact");
    this.module = new QvmModule(options);
  }

  private current(command: QvmCgameExport): void {
    this.lifetime.assertCurrentOperation();
    const phase = this.phase;
    if (phase.kind === "retired") throw new Error("Cgame module has been retired");
    if (command === QvmCgameExport.CG_SHUTDOWN || command === QvmCgameExport.CG_CONSOLE_COMMAND) return;
    if (phase.kind === "created") throw new Error("Cgame module has not initialized");
    const state = this.lifetime.current();
    if (state.dropped !== null) throw state.dropped;
    if (state.generation !== phase.generation) throw new Error("Cgame module belongs to a stale engine gamestate");
  }

  private call(command: QvmCgameExport, values: readonly number[] = []): number {
    this.current(command);
    const result = this.module.call([command, ...values]);
    this.current(command);
    return result;
  }

  init(serverMessageNumber: number, serverCommandSequence: number, clientNumber: number): undefined {
    this.lifetime.assertCurrentOperation();
    if (this.phase.kind === "retired" || this.phase.kind === "initializing") throw new Error("Cgame cannot initialize in its current lifecycle");
    const state = this.lifetime.current();
    if (state.dropped !== null) throw state.dropped;
    if (state.generation === 0) throw new Error("CG_Init requires a live engine gamestate");
    if (state.serverMessageNumber !== serverMessageNumber) throw new Error("CG_Init message differs from the active engine message");
    this.phase = { kind: "initializing", generation: state.generation };
    this.lifetime.beginLoading();
    this.call(QvmCgameExport.CG_INIT, [serverMessageNumber, serverCommandSequence, clientNumber]);
    if (this.lifetime.current().serverMessageNumber !== serverMessageNumber) throw new Error("Engine server message parsing must serialize behind CG_Init");
    this.lifetime.prime(state.generation);
    this.phase = { kind: "initialized", generation: state.generation };
  }
  shutdown(): undefined { this.call(QvmCgameExport.CG_SHUTDOWN); }
  retire(): void { this.phase = { kind: "retired" }; this.module.retire(); }
  consoleCommand(arguments_: readonly string[]): boolean {
    this.current(QvmCgameExport.CG_CONSOLE_COMMAND);
    const result = this.module.command([QvmCgameExport.CG_CONSOLE_COMMAND], arguments_) !== 0;
    this.current(QvmCgameExport.CG_CONSOLE_COMMAND);
    return result;
  }
  drawActiveFrame(time: number, stereo: StereoView, demoPlayback: boolean): undefined {
    this.call(QvmCgameExport.CG_DRAW_ACTIVE_FRAME, [time, stereo === "center" ? 0 : stereo === "left" ? 1 : 2, Number(demoPlayback)]);
  }
  crosshairPlayer(): number | null { const value = this.call(QvmCgameExport.CG_CROSSHAIR_PLAYER); return value < 0 ? null : value; }
  lastAttacker(): number | null { const value = this.call(QvmCgameExport.CG_LAST_ATTACKER); return value < 0 ? null : value; }
  keyEvent(key: number, down: boolean): undefined { this.call(QvmCgameExport.CG_KEY_EVENT, [key, Number(down)]); }
  mouseEvent(dx: number, dy: number): undefined { this.call(QvmCgameExport.CG_MOUSE_EVENT, [dx, dy]); }
  eventHandling(mode: Q3CgameEventHandling): undefined {
    this.call(QvmCgameExport.CG_EVENT_HANDLING, [mode === "none" ? 0 : mode === "team-menu" ? 1 : mode === "scoreboard" ? 2 : 3]);
  }
}
