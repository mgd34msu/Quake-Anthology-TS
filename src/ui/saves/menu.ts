import type { UiControl, UiMenuId } from "../../contracts/ui.ts";
import { menuRow, NativeUiController } from "../common/index.ts";
import type { StartupSaveList } from "../../app/bootstrap/startup-saves.ts";

export interface SavedGameMenuService {
  list(): StartupSaveList;
  refresh(): Promise<void>;
  unavailable(action: "save" | "load"): string | null;
  save(name: string, overwrite: string | null): Promise<void>;
  load(id: string): Promise<void>;
}
export function registerSavedGameMenus(controller: NativeUiController, service: SavedGameMenuService | undefined) {
  const save: UiMenuId = "menu:saves:save", load: UiMenuId = "menu:saves:load", name: UiMenuId = "menu:saves:name", confirm: UiMenuId = "menu:saves:overwrite";
  let page = 0, draft = "Save 001", selected: string | null = null, busy = false, message = "";
  const reason = (saving = true): string | null => service?.unavailable(saving ? "save" : "load") ?? (service === undefined ? "Remote games cannot be saved or loaded here." : null);
  const button = (id: string, label: string, row: number, action: () => void, enabled = true): UiControl => ({ id: `ui:saves:${id}`, kind: "button", label, rect: menuRow(row), visible: true, enabled: enabled && !busy, activate: () => { action(); return undefined; } });
  const info = (label: string): readonly UiControl[] => {
    const lines: string[] = []; let line = "";
    for (const word of label.split(/\s+/)) { if (line.length + word.length > 48) { lines.push(line); line = word; } else line += `${line === "" ? "" : " "}${word}`; }
    lines.push(line);
    return lines.slice(0, 2).map((text, index) => button(`message:${index}`, text, 9 + index, () => undefined, false));
  };
  const back = (): UiControl => button("back", "Cancel", 11, () => controller.closeMenu());
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true; message = "Working...";
    try { await operation(); message = ""; }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { busy = false; }
  };
  const refresh = (): void => { void run(async () => { await service?.refresh(); }); };
  const write = (): void => { void run(async () => {
    if (service === undefined) throw new Error(reason() ?? "Saving unavailable");
    await service.save(draft, selected); await service.refresh();
    controller.closeMenu(); message = "Game saved.";
  }); };
  const rows = (saving: boolean): readonly UiControl[] => {
    const list = service?.list() ?? { rows: [], error: null }, pages = Math.max(1, Math.ceil(list.rows.length / 5)); page = Math.min(page, pages - 1);
    const controls: UiControl[] = list.rows.slice(page * 5, page * 5 + 5).map((row, index) => button(`slot:${row.id}`, `${row.label} - ${row.unavailable === null ? row.map : "unavailable"}`, index + 1, () => {
      if (row.unavailable !== null) { message = row.unavailable; return; }
      if (saving) { selected = row.id; draft = row.label; controller.openMenu(confirm); }
      else void run(async () => { if (service !== undefined) await service.load(row.id); });
    }, reason(saving) === null));
    if (saving) controls.unshift(button("new", "New saved game", 0, () => {
      selected = null; let index = 1; while (list.rows.some(row => row.label === `Save ${String(index).padStart(3, "0")}`)) index++;
      draft = `Save ${String(index).padStart(3, "0")}`; controller.openMenu(name);
    }, reason() === null));
    if (pages > 1) controls.push(button("previous", "Previous page", 6, () => { page = (page + pages - 1) % pages; }), button("next", `Next page (${page + 1}/${pages})`, 7, () => { page = (page + 1) % pages; }));
    controls.push(button("refresh", "Refresh", 8, refresh), ...info(message || reason(saving) || list.error || (list.rows.length === 0 ? "No saved games yet." : "")), back());
    return controls;
  };
  const dispose = [controller.register(save, () => ({ id: save, title: "Save game", fullScreen: true, controls: rows(true), open: () => { page = 0; refresh(); return undefined; }, close: () => undefined })),
    controller.register(load, () => ({ id: load, title: "Load game", fullScreen: true, controls: rows(false), open: () => { page = 0; refresh(); return undefined; }, close: () => undefined })),
    controller.register(name, () => ({ id: name, title: "New saved game", fullScreen: true, controls: [
      { id: "ui:saves:name", kind: "text-entry", label: "Name", text: draft, maximumLength: 48, rect: menuRow(1), enabled: !busy, visible: true,
        change: (_seat, value) => { draft = value; return undefined; }, submit: () => { write(); return undefined; } }, button("write", "Save game", 3, write), ...info(message), back()], open: () => undefined, close: () => undefined })),
    controller.register(confirm, () => ({ id: confirm, title: "Overwrite saved game?", fullScreen: true, controls: [button("selected", draft, 1, () => undefined, false), button("overwrite", "Overwrite this saved game", 3, write), ...info(message), back()], open: () => undefined, close: () => undefined }))];
  return { save, load, dispose(): void { for (const remove of dispose.reverse()) remove(); } };
}
