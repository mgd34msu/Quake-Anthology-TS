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

  constructor(readonly seat: SeatId, options: QvmModuleOptions | QvmModule, private readonly assertCurrentOperation: () => undefined) {
    if (!(options instanceof QvmModule) && options.artifact.role !== "ui") throw new Error("QvmUi requires a ui artifact");
    this.assertCurrentOperation();
    this.module = options instanceof QvmModule ? options : new QvmModule(options);
    const api = this.module.profile.api;
    if (api.kind !== "q3-ui") throw new Error("QvmUi execution profile has the wrong role");
    this.api = api;
  }

  static async create(seat: SeatId, options: QvmModuleOptions, assertCurrentOperation: () => undefined): Promise<QvmUi> {
    if (options.artifact.role !== "ui") throw new Error("QvmUi requires a ui artifact");
    assertCurrentOperation();
    const module = await QvmModule.create(options, assertCurrentOperation);
    try { return new QvmUi(seat, module, assertCurrentOperation); }
    catch (error) { module.retire(); throw error; }
  }

  private current(): void {
    this.assertCurrentOperation();
    if (this.retired) throw new Error("UI module has been retired");
  }
  private async call(words: readonly number[]): Promise<number> {
    this.current();
    const result = await this.module.callAsync(words, 0, () => this.current());
    this.current();
    return result;
  }
  async init(connecting: boolean): Promise<undefined> {
    await this.call([QvmUiExport.UI_INIT, Number(connecting)]);
  }
  async shutdown(): Promise<undefined> { await this.call([QvmUiExport.UI_SHUTDOWN]); }
  retire(): void { this.retired = true; this.module.retire(); }
  async keyEvent(key: number, down: boolean): Promise<undefined> { await this.call([QvmUiExport.UI_KEY_EVENT, key, Number(down)]); }
  async mouseEvent(dx: number, dy: number): Promise<undefined> { await this.call([QvmUiExport.UI_MOUSE_EVENT, dx, dy]); }
  async refresh(time: number): Promise<undefined> { await this.call([QvmUiExport.UI_REFRESH, time]); }
  async isFullscreen(): Promise<boolean> { return await this.call([QvmUiExport.UI_IS_FULLSCREEN]) !== 0; }
  async setActiveMenu(menu: Q3MenuCommand): Promise<undefined> { await this.call([QvmUiExport.UI_SET_ACTIVE_MENU, menuNumber(menu)]); }
  async consoleCommand(time: number, arguments_: readonly string[]): Promise<boolean> {
    this.current();
    const result = await this.module.commandAsync([QvmUiExport.UI_CONSOLE_COMMAND, time], arguments_, () => this.current()) !== 0;
    this.current();
    return result;
  }
  async drawConnectScreen(overlay: boolean): Promise<undefined> { await this.call([QvmUiExport.UI_DRAW_CONNECT_SCREEN, Number(overlay)]); }
  async hasUniqueCdKey(): Promise<boolean> { return await this.call([QvmUiExport.UI_HASUNIQUECDKEY]) !== 0; }
}
