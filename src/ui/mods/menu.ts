// SPDX-License-Identifier: GPL-2.0-or-later
import type { UiControl, UiMenuId } from "../../contracts/ui.ts";
import type { NativeUiController } from "../common/controller.ts";

export interface ModMenuRow {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly enabled: boolean;
  readonly unavailable: string | null;
}

export interface ModMenuService {
  rows(): readonly ModMenuRow[];
  setEnabled(id: string, enabled: boolean): void;
  refresh(): void;
  status(): string;
}

export function registerModMenu(controller: NativeUiController, service: ModMenuService): { readonly root: UiMenuId; dispose(): void } {
  const root: UiMenuId = "menu:mods:root";
  let query = "", selected: string | null = null;
  const toggle = (id: string): undefined => {
    const row = service.rows().find(row => row.id === id);
    if (row !== undefined && (row.enabled || row.unavailable === null)) service.setEnabled(id, !row.enabled);
    return undefined;
  };
  const dispose = controller.register(root, () => {
    const allRows = service.rows(), terms = query.toLocaleLowerCase().trim().split(/\s+/u);
    const rows = allRows.filter(row => {
      const text = `${row.title} ${row.source}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
    const current = rows.find(row => row.id === selected) ?? rows[0];
    selected = current?.id ?? null;
    const button = (suffix: string, label: string, x: number, y: number, width: number, action: () => void, enabled = true): UiControl => ({
      id: `ui:mods:${suffix}`, kind: "button", label, rect: { x, y, width, height: 28 }, enabled, visible: true,
      activate: () => { action(); return undefined; },
    });
    const messages = [
      ...(current === undefined ? [] : [`${current.title} (${current.source})`]),
      ...(current?.unavailable === undefined || current.unavailable === null ? [] : [current.unavailable]),
      service.status() || `${allRows.filter(row => row.enabled).length} enabled`,
    ];
    const lines = messages.flatMap(message => message.match(/.{1,42}(?:\s+|$)|\S{1,42}/gu) ?? []);
    const details = lines.map((line, index) => ({
      ...button(`detail:${index}`, line.trim(), 48, 372 + index * 24, 528, () => undefined, false),
      rect: { x: 48, y: 372 + index * 24, width: 528, height: 24 },
    }));
    const controls: UiControl[] = [
      { id: "ui:mods:search", kind: "text-entry", label: "Search mods", text: query, maximumLength: 80,
        rect: { x: 48, y: 80, width: 544, height: 28 }, enabled: true, visible: true,
        change: (_seat, value) => { query = value; return undefined; }, submit: (_seat, value) => { query = value; return undefined; } },
      button("title", "Mod", 48, 112, 216, () => undefined, false),
      button("source", "Source", 264, 112, 168, () => undefined, false),
      button("state", "State", 432, 112, 160, () => undefined, false),
      { id: "ui:mods:list", kind: "list", label: "Mods", rect: { x: 48, y: 140, width: 544, height: 192 },
        rowHeight: 32, columnWidths: [216, 168, 144], enabled: rows.length > 0, visible: true, selected,
        rows: rows.length === 0 ? [{ id: "empty", cells: [allRows.length === 0 ? "No mods available" : "No matching mods"], image: null, enabled: false }]
          : rows.map(row => ({ id: row.id, cells: [row.title, row.source, row.enabled ? "Enabled" : row.unavailable === null ? "Disabled" : "Unavailable"], image: null, enabled: true })),
        select: (_seat, id) => { selected = id; return undefined; }, activate: (_seat, id) => toggle(id) },
      button("toggle", current?.enabled === true ? "Disable" : "Enable", 48, 340, 176,
        () => { if (selected !== null) toggle(selected); }, current !== undefined && (current.enabled || current.unavailable === null)),
      button("refresh", "Refresh", 232, 340, 176, () => service.refresh()),
      button("back", "Back", 416, 340, 176, () => controller.closeMenu()),
      ...details,
    ];
    return { id: root, title: "Mods", fullScreen: true, controls,
      scroll: { rect: { x: 48, y: 372, width: 544, height: 76 }, contentHeight: lines.length * 24, controls: details.map(control => control.id) },
      open: () => { service.refresh(); return undefined; }, close: () => undefined };
  });
  return { root, dispose };
}
