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

  private async call(command: QvmCgameExport, values: readonly number[] = []): Promise<number> {
    this.current(command);
    const result = await this.module.callAsync([command, ...values], 0, () => this.current(command));
    this.current(command);
    return result;
  }

  async init(serverMessageNumber: number, serverCommandSequence: number, clientNumber: number): Promise<undefined> {
    this.lifetime.assertCurrentOperation();
    if (this.phase.kind === "retired" || this.phase.kind === "initializing") throw new Error("Cgame cannot initialize in its current lifecycle");
    const state = this.lifetime.current();
    if (state.dropped !== null) throw state.dropped;
    if (state.generation === 0) throw new Error("CG_Init requires a live engine gamestate");
    if (state.serverMessageNumber !== serverMessageNumber) throw new Error("CG_Init message differs from the active engine message");
    this.phase = { kind: "initializing", generation: state.generation };
    this.lifetime.beginLoading();
    try {
      await this.call(QvmCgameExport.CG_INIT, [serverMessageNumber, serverCommandSequence, clientNumber]);
      if (this.lifetime.current().serverMessageNumber !== serverMessageNumber) throw new Error("Engine server message parsing must serialize behind CG_Init");
      this.lifetime.prime(state.generation);
      this.phase = { kind: "initialized", generation: state.generation };
    } catch (error) { this.retire(); throw error; }
  }
  async shutdown(): Promise<undefined> { await this.call(QvmCgameExport.CG_SHUTDOWN); }
  retire(): void { this.phase = { kind: "retired" }; this.module.retire(); }
  async consoleCommand(arguments_: readonly string[]): Promise<boolean> {
    this.current(QvmCgameExport.CG_CONSOLE_COMMAND);
    const result = await this.module.commandAsync([QvmCgameExport.CG_CONSOLE_COMMAND], arguments_, () => this.current(QvmCgameExport.CG_CONSOLE_COMMAND)) !== 0;
    this.current(QvmCgameExport.CG_CONSOLE_COMMAND);
    return result;
  }
  async drawActiveFrame(time: number, stereo: StereoView, demoPlayback: boolean): Promise<undefined> {
    await this.call(QvmCgameExport.CG_DRAW_ACTIVE_FRAME, [time, stereo === "center" ? 0 : stereo === "left" ? 1 : 2, Number(demoPlayback)]);
  }
  async crosshairPlayer(): Promise<number | null> { const value = await this.call(QvmCgameExport.CG_CROSSHAIR_PLAYER); return value < 0 ? null : value; }
  async lastAttacker(): Promise<number | null> { const value = await this.call(QvmCgameExport.CG_LAST_ATTACKER); return value < 0 ? null : value; }
  async keyEvent(key: number, down: boolean): Promise<undefined> { await this.call(QvmCgameExport.CG_KEY_EVENT, [key, Number(down)]); }
  async mouseEvent(dx: number, dy: number): Promise<undefined> { await this.call(QvmCgameExport.CG_MOUSE_EVENT, [dx, dy]); }
  async eventHandling(mode: Q3CgameEventHandling): Promise<undefined> {
    await this.call(QvmCgameExport.CG_EVENT_HANDLING, [mode === "none" ? 0 : mode === "team-menu" ? 1 : mode === "scoreboard" ? 2 : 3]);
  }
}
