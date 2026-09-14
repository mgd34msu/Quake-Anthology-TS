import type { SeatInputEvent, UiControl, UiMenuId } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { menuRow, NativeUiController } from "../../ui/common/index.ts";
import type { SavedGameMenuService } from "../../ui/saves/menu.ts";

export const playerDeathMenu: UiMenuId = "menu:application:death";

export class SeatPlayerDeath {
  active = false;
  private busy = false;
  private message = "";
  private readonly unregister: () => void;

  constructor(private readonly controller: NativeUiController, private readonly saves: SavedGameMenuService | undefined,
    loadMenu: UiMenuId, quit: () => undefined) {
    const button = (id: string, label: string, row: number, action: () => void, enabled = true): UiControl => ({
      id: `ui:death:${id}`, kind: "button", label, rect: menuRow(row), visible: true, enabled: enabled && !this.busy,
      activate: () => { action(); return undefined; } });
    this.unregister = controller.register(playerDeathMenu, () => ({ id: playerDeathMenu, title: "You died", fullScreen: true,
      controls: [button("load", "Load saved game", 2, () => controller.openMenu(loadMenu), saves?.unavailable("load") === null),
        button("restart", "Restart level", 3, () => { void this.restart(); }), button("quit", "End game", 6, quit),
        ...(this.message === "" ? [] : [button("message", this.message, 8, () => undefined, false)])],
      open: () => undefined, close: () => undefined }));
  }

  observe(health: number): void {
    if (this.saves?.recovery === undefined) return;
    if (health > 0) {
      if (this.active) this.controller.closeAll();
      this.active = false;
      return;
    }
    if (!this.active) { this.controller.closeAll(); this.active = true; }
    if (this.controller.activeMenu === null) this.controller.openMenu(playerDeathMenu);
  }

  input(event: SeatInputEvent): boolean {
    if (!this.active || this.controller.activeMenu !== playerDeathMenu) return false;
    return event.kind === "key" && event.code === KeyCode.Escape
      || event.kind === "controller-button" && (event.button === 1 || event.button === 6)
      || event.kind === "mouse-button" && event.button === 3;
  }

  private async restart(): Promise<void> {
    if (this.busy || this.saves?.recovery === undefined) return;
    this.busy = true;
    this.message = "Restarting level...";
    try { await this.saves.recovery.restart(); }
    catch (error) { this.message = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; }
  }

  close(): void { this.unregister(); }
}
