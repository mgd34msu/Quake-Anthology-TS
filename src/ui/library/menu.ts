import type { UiControl, UiMenuId } from "../../contracts/ui.ts";
import type { NativeUiController } from "../common/controller.ts";

export interface LibraryEntry { readonly id: string; readonly label: string; readonly detail?: string; readonly unavailable?: string; }
export interface LibraryMenuService {
  scope?(): string;
  entries(): readonly LibraryEntry[];
  status(): string;
  refresh(): void;
  activate(id: string): void;
  readonly create?: { readonly label: string; submit(name: string): void };
  readonly stop?: { readonly label: string; activate(): void };
}
export function registerLibraryMenu(controller: NativeUiController, id: UiMenuId, title: string, service: LibraryMenuService): { readonly root: UiMenuId; dispose(): void } {
  let selected: string | null = null, query = "", name = "", scope = service.scope?.() ?? "";
  const views = new Map<string, { readonly query: string; readonly selected: string | null }>();
  const activate = (value: string): undefined => {
    const entry = service.entries().find(entry => entry.id === value);
    if (entry !== undefined && entry.unavailable === undefined) service.activate(value);
    return undefined;
  };
  const dispose = controller.register(id, () => {
    const nextScope = service.scope?.() ?? "";
    if (nextScope !== scope) {
      views.set(scope, { query, selected });
      const restored = views.get(nextScope); query = restored?.query ?? ""; selected = restored?.selected ?? null; scope = nextScope;
    }
    const entries = service.entries().filter(entry => `${entry.label} ${entry.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()));
    if (!entries.some(entry => entry.id === selected)) selected = entries[0]?.id ?? null;
    const button = (suffix: string, label: string, x: number, y: number, width: number, action: () => void, enabled = true): UiControl => ({
      id: `ui:library:${suffix}`, kind: "button", label, rect: { x, y, width, height: 30 }, enabled, visible: true,
      activate: () => { action(); return undefined; } });
    return { id, title, fullScreen: true, controls: [
      { id: "ui:library:search", kind: "text-entry", label: "Search", text: query, maximumLength: 80,
        rect: { x: 48, y: 94, width: 544, height: 30 }, enabled: true, visible: true,
        change: (_seat, value) => { query = value; return undefined; }, submit: (_seat, value) => { query = value; return undefined; } },
      { id: "ui:library:entries", kind: "list", label: title, rect: { x: 48, y: 132, width: 544, height: 198 }, rowHeight: 33,
        rows: entries.map(entry => ({ id: entry.id, cells: [entry.label, entry.unavailable ?? entry.detail ?? ""], image: null, enabled: entry.unavailable === undefined })),
        selected, select: (_seat, value) => { selected = value; return undefined; }, activate: (_seat, value) => activate(value), enabled: true, visible: true },
      button("open", "Open", 48, 338, 164, () => { if (selected !== null) activate(selected); }, selected !== null && entries.some(entry => entry.id === selected && entry.unavailable === undefined)),
      button("refresh", "Refresh", 222, 338, 164, () => service.refresh()),
      ...(service.stop === undefined ? [] : [button("stop", service.stop.label, 396, 338, 196, () => service.stop?.activate())]),
      ...(service.create === undefined ? [] : [{ id: "ui:library:name", kind: "text-entry", label: "Name", text: name, maximumLength: 128,
        rect: { x: 48, y: 376, width: 354, height: 30 }, enabled: true, visible: true,
        change: (_seat, value) => { name = value; return undefined; }, submit: (_seat, value) => { name = value; return undefined; } } satisfies UiControl,
        button("create", service.create.label, 414, 376, 178, () => service.create?.submit(name), name.trim() !== "")]),
      { id: "ui:library:status", kind: "button", label: service.status() || (entries.length === 0 ? "No matching entries" : ""),
        rect: { x: 48, y: 410, width: 544, height: 22 }, enabled: false, visible: true, activate: () => undefined },
      button("back", "Back", 48, 438, 544, () => controller.closeMenu()),
    ], open: () => { service.refresh(); return undefined; }, close: () => undefined };
  });
  return { root: id, dispose };
}
