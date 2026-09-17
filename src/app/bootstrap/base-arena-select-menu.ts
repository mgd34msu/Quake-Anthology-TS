import type { UiControl, UiMenuId } from "../../contracts/ui.ts";
import type { NativeUiController } from "../../ui/common/controller.ts";
import type { ArenaSelection } from "./base-arena-selection.ts";

export function registerArenaSelectionMenu(controller: NativeUiController, id: UiMenuId, service: {
  read(): ArenaSelection | null;
  choose(map: string): void;
}): () => void {
  let tier = "", selected: string | null = null;
  return controller.register(id, () => {
    const selection = service.read();
    if (selection !== null && !selection.tiers.some(row => row.id === tier)) {
      tier = selection.rows.find(row => row.arena.map === selection.current)?.tier ?? selection.tiers[0]?.id ?? "";
    }
    const rows = selection?.rows.filter(row => row.tier === tier) ?? [];
    if (!rows.some(row => row.arena.map === selected)) selected = rows.find(row => row.arena.map === selection?.current)?.arena.map ?? rows[0]?.arena.map ?? null;
    const current = rows.find(row => row.arena.map === selected);
    const choose = (): undefined => { if (current?.available) service.choose(current.arena.map); return undefined; };
    const label = (suffix: string, text: string, y: number): UiControl => ({
      id: `ui:arena-select:${suffix}`, kind: "button", label: text, rect: { x: 48, y, width: 544, height: 30 },
      visible: true, enabled: false, activate: () => undefined,
    });
    return { id, title: "Choose an arena", fullScreen: true, controls: [
      { id: "ui:arena-select:tier", kind: "choice", label: "Tier", rect: { x: 48, y: 94, width: 544, height: 32 },
        visible: true, enabled: selection !== null, choices: selection?.tiers ?? [], selected: tier,
        select: (_seat, value) => { tier = value; selected = null; return undefined; } },
      { id: "ui:arena-select:arenas", kind: "list", label: "Arenas", rect: { x: 48, y: 144, width: 544, height: 156 }, rowHeight: 39,
        visible: true, enabled: rows.length > 0, selected,
        rows: rows.map(row => ({ id: row.arena.map, cells: [row.arena.title, row.available ? row.record : "Locked"], image: null, enabled: true })),
        select: (_seat, value) => { selected = value; return undefined; },
        activate: (_seat, value) => { const row = rows.find(row => row.arena.map === value); if (row?.available) service.choose(value); return undefined; } },
      label("opponents", current === undefined ? "No single-player arenas are available." : `Opponents: ${current.arena.bots.join(", ") || "None"}`, 318),
      label("limits", current === undefined ? "" : [current.arena.fragLimit > 0 ? `${current.arena.fragLimit} frags` : "", current.arena.timeLimit > 0 ? `${current.arena.timeLimit} minutes` : ""].filter(Boolean).join(" · "), 350),
      { id: "ui:arena-select:play", kind: "button", label: current?.available === false ? "Win the preceding tier to unlock" : "Choose difficulty", rect: { x: 48, y: 392, width: 544, height: 32 },
        visible: true, enabled: current?.available === true, activate: choose },
      { id: "ui:arena-select:back", kind: "button", label: "Back", rect: { x: 48, y: 436, width: 544, height: 32 },
        visible: true, enabled: true, activate: () => { controller.closeMenu(); return undefined; } },
    ], open: () => { tier = ""; selected = null; }, close: () => undefined };
  });
}
