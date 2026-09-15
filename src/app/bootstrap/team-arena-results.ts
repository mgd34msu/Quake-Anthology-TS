import type { UiControl } from "../../contracts/ui.ts";
import { menuRow, type NativeUiController } from "../../ui/common/index.ts";

export interface TeamArenaResultService {
  read(): { readonly title: string; readonly won: boolean; readonly score: number; readonly opponent: number; readonly points: number; readonly time: string } | null;
  next(): undefined;
  retry(): undefined;
  quit(): undefined;
}

export class TeamArenaResults {
  active = false;
  private readonly dispose: () => void;
  constructor(private readonly controller: NativeUiController, private readonly service: TeamArenaResultService) {
    this.dispose = controller.register("menu:application:team-arena-results", () => {
      const result = service.read();
      const button = (id: string, label: string, row: number, activate: () => undefined): UiControl => ({
        id: `ui:team-arena:${id}`, kind: "button", label, rect: menuRow(row), visible: true, enabled: result !== null, activate });
      return { id: "menu:application:team-arena-results", title: result === null ? "Match complete"
        : `${result.won ? "Victory" : "Defeat"}: ${result.title} (${result.score} - ${result.opponent})`, fullScreen: true,
        controls: [ { id: "ui:team-arena:score", kind: "button", label: result === null ? "" : `Score ${result.points} · Time ${result.time}`,
          rect: menuRow(0), visible: true, enabled: false, activate: () => undefined }, button("next", "Next match", 2, () => service.next()), button("retry", "Retry match", 3, () => service.retry()),
          button("main-menu", "Main menu", 5, () => service.quit())], open: () => undefined, close: () => undefined };
    });
  }
  update(): void {
    if (this.service.read() === null) return;
    if (!this.active) { this.active = true; this.controller.closeAll(); }
    if (this.controller.activeMenu === null) this.controller.openMenu("menu:application:team-arena-results");
  }
  close(): void { this.dispose(); }
}
