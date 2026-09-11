/* Quake III Arena client/cl_ui.c and ui/ui_public.h. GPL-2.0-or-later. */
import type { SeatId } from "../../contracts/identity.ts";
import type { Q3MenuCommand, Q3UiExports } from "../../contracts/ui.ts";
import { QvmUiExport, QvmUiMenu } from "./abi.ts";
import { QvmModule } from "./module.ts";
import type { QvmModuleOptions } from "./module.ts";

function menuNumber(menu: Q3MenuCommand): QvmUiMenu {
  switch (menu) {
    case "none": return QvmUiMenu.UIMENU_NONE;
    case "main": return QvmUiMenu.UIMENU_MAIN;
    case "ingame": return QvmUiMenu.UIMENU_INGAME;
    case "need-cd": return QvmUiMenu.UIMENU_NEED_CD;
    case "bad-cd-key": return QvmUiMenu.UIMENU_BAD_CD_KEY;
    case "team": return QvmUiMenu.UIMENU_TEAM;
    case "postgame": return QvmUiMenu.UIMENU_POSTGAME;
  }
}

export class QvmUi implements Q3UiExports {
  readonly api: Q3UiExports["api"];
  readonly module: QvmModule;
  private retired = false;

  constructor(readonly seat: SeatId, options: QvmModuleOptions, private readonly assertCurrentOperation: () => undefined) {
    if (options.artifact.role !== "ui") throw new Error("QvmUi requires a ui artifact");
    this.assertCurrentOperation();
    this.module = new QvmModule(options);
    const api = this.module.profile.api;
    if (api.kind !== "q3-ui") throw new Error("QvmUi execution profile has the wrong role");
    this.api = api;
  }

  private current(): void {
    this.assertCurrentOperation();
    if (this.retired) throw new Error("UI module has been retired");
  }
  private call(words: readonly number[]): number {
    this.current();
    const result = this.module.call(words);
    this.current();
    return result;
  }
  init(connecting: boolean): undefined {
    this.call([QvmUiExport.UI_INIT, Number(connecting)]);
  }
  shutdown(): undefined { this.call([QvmUiExport.UI_SHUTDOWN]); }
  retire(): void { this.retired = true; this.module.retire(); }
  keyEvent(key: number, down: boolean): undefined { this.call([QvmUiExport.UI_KEY_EVENT, key, Number(down)]); }
  mouseEvent(dx: number, dy: number): undefined { this.call([QvmUiExport.UI_MOUSE_EVENT, dx, dy]); }
  refresh(time: number): undefined { this.call([QvmUiExport.UI_REFRESH, time]); }
  isFullscreen(): boolean { return this.call([QvmUiExport.UI_IS_FULLSCREEN]) !== 0; }
  setActiveMenu(menu: Q3MenuCommand): undefined { this.call([QvmUiExport.UI_SET_ACTIVE_MENU, menuNumber(menu)]); }
  consoleCommand(time: number, arguments_: readonly string[]): boolean {
    this.current();
    const result = this.module.command([QvmUiExport.UI_CONSOLE_COMMAND, time], arguments_) !== 0;
    this.current();
    return result;
  }
  drawConnectScreen(overlay: boolean): undefined { this.call([QvmUiExport.UI_DRAW_CONNECT_SCREEN, Number(overlay)]); }
  hasUniqueCdKey(): boolean { return this.call([QvmUiExport.UI_HASUNIQUECDKEY]) !== 0; }
}
