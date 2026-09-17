import type { UiControl } from "../../contracts/ui.ts";
import type { NativeUiController } from "../../ui/common/controller.ts";
import type { ArenaPostgamePresentation } from "./base-arena-postgame.ts";

export interface BaseArenaMenuService {
  result(): ArenaPostgamePresentation | null;
  playerName(client: number): string;
  progress(): readonly { readonly label: string; readonly value: string }[];
  retry(): void;
  next(): void;
  quit(): void;
  reset(): void;
}
export class BaseArenaMenus {
  readonly root = "menu:application:arena-progress";
  private shown: string | null = null;
  private readonly disposers: readonly (() => void)[];
  constructor(private readonly controller: NativeUiController, private readonly service: BaseArenaMenuService) {
    const button = (id: string, label: string, y: number, activate: () => void, enabled = true): UiControl => ({
      id: `ui:arena:${id}`, kind: "button", label, rect: { x: 64, y, width: 512, height: 32 }, enabled, visible: true,
      activate: () => { activate(); return undefined; } });
    this.disposers = [controller.register(this.root, () => ({ id: this.root, title: "Arena progress", fullScreen: true,
      controls: [{ id: "ui:arena:progress", kind: "list", label: "Progress and awards", rect: { x: 48, y: 96, width: 544, height: 264 }, rowHeight: 33,
        rows: service.progress().map((row, index) => ({ id: String(index), cells: [row.label, row.value], image: null, enabled: true })), selected: null,
        select: () => undefined, enabled: true, visible: true },
        button("reset", "Reset progress...", 376, () => controller.openMenu("menu:application:arena-reset")),
        button("back", "Back", 424, () => controller.closeMenu())], open: () => undefined, close: () => undefined })),
      controller.register("menu:application:arena-reset", () => ({ id: "menu:application:arena-reset", title: "Reset arena progress and awards?", fullScreen: true,
        controls: [button("cancel", "Keep progress", 180, () => controller.closeMenu()), button("confirm-reset", "Reset progress", 230, () => { service.reset(); controller.closeMenu(); })],
        open: () => undefined, close: () => undefined })),
      controller.register("menu:application:arena-result", () => {
        const result = service.result();
        return { id: "menu:application:arena-result", title: result?.result.rank === 1 ? "Victory" : "Match complete", fullScreen: true,
          controls: [...(result?.podium ?? []).map((player, index) => button(`podium:${index}`, `${player.rank}. ${service.playerName(player.client)}   ${player.score}`, 96 + index * 38, () => undefined, false)),
            button("retry", "Retry", 258, () => service.retry()), button("next", "Next match", 300, () => service.next(), result !== null && result.result.nextLevel >= 0),
            button("awards", "Progress and awards", 342, () => controller.openMenu(this.root)), button("main", "Main menu", 406, () => service.quit())], open: () => undefined, close: () => undefined };
      })];
  }
  update(): void {
    const result = this.service.result();
    if (result === null) { this.shown = null; return; }
    const identity = JSON.stringify([result.result, result.podium]);
    if (this.shown === identity) return;
    this.shown = identity; this.controller.closeAll(); this.controller.openMenu("menu:application:arena-result");
  }
  close(): void { for (const dispose of this.disposers) dispose(); }
}
