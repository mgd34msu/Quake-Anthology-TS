import type { NativeUiController } from "../common/controller.ts";
import type { HudInventoryItem } from "../hud/index.ts";

export function registerInventoryMenu(controller: NativeUiController, items: () => readonly HudInventoryItem[] | null,
  command: (name: string, args: readonly string[]) => undefined): { readonly root: "menu:application:inventory"; dispose(): void } {
  const root = "menu:application:inventory"; let selected: string | null = null;
  const use = (id: string): undefined => command("use", [id]);
  const dispose = controller.register(root, () => {
    const rows = items() ?? [];
    if (!rows.some(item => item.id === selected)) selected = rows.find(item => item.selected)?.id ?? rows[0]?.id ?? null;
    return { id: root, title: "Inventory", fullScreen: false,
      controls: [{ id: "ui:inventory:items", kind: "list", label: "Items", rect: { x: 64, y: 96, width: 512, height: 264 }, rowHeight: 33,
        rows: rows.map(item => ({ id: item.id, cells: [item.label, String(item.count)], image: item.icon, enabled: item.count > 0 })), selected,
        select: (_seat, id) => { selected = id; return undefined; }, activate: (_seat, id) => use(id), enabled: true, visible: true },
        { id: "ui:inventory:use", kind: "button", label: "Use selected item", rect: { x: 64, y: 376, width: 512, height: 32 }, enabled: selected !== null, visible: true,
          activate: () => selected === null ? undefined : use(selected) },
        { id: "ui:inventory:close", kind: "button", label: "Close", rect: { x: 64, y: 424, width: 512, height: 32 }, enabled: true, visible: true, activate: () => controller.closeMenu() }],
      open: () => undefined, close: () => command("putaway", []) };
  });
  return { root, dispose };
}
