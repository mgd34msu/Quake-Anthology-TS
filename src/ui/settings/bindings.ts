// SPDX-License-Identifier: GPL-2.0-or-later
import type { InputBindingTarget, PhysicalInput, UiControl, UiMenuId } from "../../contracts/ui.ts";
import { physicalInputName } from "../../input/bindings.ts";
import type { SeatInput } from "../../input/seat.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";

export interface BindingAction { readonly id: string; readonly label: string; readonly target: InputBindingTarget; readonly matches?: (target: InputBindingTarget) => boolean; }
export function physicalInputLabel(input: PhysicalInput): string {
  return physicalInputName(input);
}
function sameTarget(a: InputBindingTarget, b: InputBindingTarget): boolean {
  return a.kind === "action" && b.kind === "action" ? a.action === b.action
    : a.kind === "command" && b.kind === "command" && a.text === b.text;
}
export function bindingMatchesAction(target: InputBindingTarget, action: BindingAction): boolean {
  return sameTarget(target, action.target) || action.matches?.(target) === true;
}
/** Binding edits remain seat-owned and conflicts require explicit replacement. */
export function registerBindingMenus(controller: NativeUiController, input: SeatInput, source: readonly BindingAction[] | (() => readonly BindingAction[])): { readonly root: UiMenuId; dispose(): void } {
  if (!controller.seat.equals(input.seat)) throw new Error("Binding menu belongs to another input seat");
  const root: UiMenuId = "menu:bindings:0", conflict: UiMenuId = "menu:bindings:conflict";
  const unregister: (() => void)[] = [];
  const actions = (): readonly BindingAction[] => {
    const available = [...(typeof source === "function" ? source() : source)];
    for (const { target } of input.bindings) if (!available.some(action => bindingMatchesAction(target, action))) {
      available.push({ id: `custom:${JSON.stringify(target)}`, label: target.kind === "command" ? `Command: ${target.text}` : `Action: ${target.action}`, target });
    }
    return available;
  };
  interface BindingRow { readonly id: string; readonly action: BindingAction; readonly physical: PhysicalInput | null; readonly target: InputBindingTarget; }
  let query = "", selected: string | null = null;
  let pending: { readonly physical: PhysicalInput; readonly row: BindingRow; readonly previous: InputBindingTarget } | null = null;
  const targetLabel = (target: InputBindingTarget): string => actions().find(action => bindingMatchesAction(target, action))?.label
    ?? (target.kind === "command" ? target.text : target.action);
  const assign = (row: BindingRow, physical: PhysicalInput): void => {
    if (row.physical !== null) input.unbind(row.physical);
    input.bind({ input: physical, target: row.target });
    selected = `${row.action.id}:${JSON.stringify(physical)}`;
  };
  const capture = (row: BindingRow): undefined => {
    controller.captureBinding(physical => {
      const previous = input.binding(physical);
      if (previous === null || bindingMatchesAction(previous, row.action)) assign(row, physical);
      else { pending = { physical, row, previous }; controller.openMenu(conflict); }
    }, () => undefined);
    return undefined;
  };
  unregister.push(controller.register(conflict, () => {
    if (pending === null) throw new Error("No pending binding conflict");
    const request = pending;
    const controls: UiControl[] = [
      { id: "ui:bindings:old", kind: "button", label: `Currently: ${targetLabel(request.previous)}`, rect: menuRow(1), enabled: false, visible: true, activate: () => undefined },
      { id: "ui:bindings:new", kind: "button", label: `Replace with: ${request.row.action.label}`, rect: menuRow(2), enabled: false, visible: true, activate: () => undefined },
      { id: "ui:bindings:cancel", kind: "button", label: "Cancel", rect: menuRow(4), enabled: true, visible: true, activate: () => controller.closeMenu() },
      { id: "ui:bindings:replace", kind: "button", label: "Replace binding", rect: menuRow(5), enabled: true, visible: true,
        activate: () => { assign(request.row, request.physical); return controller.closeMenu(); } },
    ];
    return { id: conflict, title: `${physicalInputLabel(request.physical)} is already bound`, fullScreen: false, controls, open: () => undefined, close: () => { pending = null; return undefined; } };
  }));
  unregister.push(controller.register(root, () => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/u);
    const rows: BindingRow[] = [];
    for (const action of actions()) {
      const bindings = input.bindings.filter(binding => bindingMatchesAction(binding.target, action));
      const searchable = `${action.label} ${bindings.map(binding => physicalInputLabel(binding.input)).join(" ")}`.toLocaleLowerCase();
      if (!terms.every(term => searchable.includes(term))) continue;
      if (bindings.length === 0) rows.push({ id: action.id, action, physical: null, target: action.target });
      else for (const binding of bindings) rows.push({ id: `${action.id}:${JSON.stringify(binding.input)}`, action, physical: binding.input, target: binding.target });
    }
    const current = rows.find(row => row.id === selected) ?? rows[0];
    selected = current?.id ?? null;
    const controls: UiControl[] = [
      { id: "ui:bindings:search", kind: "text-entry", label: "Search actions", rect: { x: 48, y: 80, width: 544, height: 28 },
        enabled: true, visible: true, text: query, maximumLength: 80, change: (_seat, text) => { query = text; selected = null; return undefined; }, submit: () => undefined },
      { id: "ui:bindings:head", kind: "button", label: "Action", rect: { x: 48, y: 112, width: 316, height: 24 },
        enabled: false, visible: true, activate: () => undefined },
      { id: "ui:bindings:key-head", kind: "button", label: "Key", rect: { x: 364, y: 112, width: 228, height: 24 },
        enabled: false, visible: true, activate: () => undefined },
      { id: "ui:bindings:list", kind: "list", label: "Bindings", rect: { x: 48, y: 136, width: 544, height: 240 },
        enabled: rows.length > 0, visible: true, selected, rowHeight: 24, columnWidths: [316, 208],
        rows: rows.length === 0 ? [{ id: "empty", cells: ["No matching actions"], image: null, enabled: false }]
          : rows.map(row => ({ id: row.id, cells: [row.action.label, row.physical === null ? "Unbound" : physicalInputLabel(row.physical)], image: null, enabled: true,
            ...(row.physical === null ? {} : { action: { label: "X", activate: () => { if (row.physical !== null) input.unbind(row.physical); return undefined; } } }) })),
        select: (_seat, id) => { selected = id; return undefined; },
        activate: (_seat, id) => { const row = rows.find(row => row.id === id); return row === undefined ? undefined : capture(row); } },
      { id: "ui:bindings:add", kind: "button", label: "Add binding", rect: { x: 48, y: 384, width: 176, height: 28 },
        enabled: current !== undefined, visible: true, activate: () => current === undefined ? undefined : capture({ ...current, physical: null, target: current.action.target }) },
      { id: "ui:bindings:remove", kind: "button", label: "Remove key", rect: { x: 232, y: 384, width: 176, height: 28 },
        enabled: current !== undefined && current.physical !== null, visible: true, activate: () => { if (current?.physical !== undefined && current.physical !== null) input.unbind(current.physical); return undefined; } },
      { id: "ui:bindings:clear", kind: "button", label: "Clear action", rect: { x: 416, y: 384, width: 176, height: 28 },
        enabled: current !== undefined && current.physical !== null, visible: true, activate: () => {
          if (current !== undefined) for (const binding of input.bindings) if (bindingMatchesAction(binding.target, current.action)) input.unbind(binding.input);
          return undefined;
        } },
      { id: "ui:bindings:back", kind: "button", label: "Back", rect: { x: 48, y: 420, width: 100, height: 28 }, enabled: true, visible: true, activate: () => controller.closeMenu() },
    ];
    return { id: root, title: "Bindings", fullScreen: false, controls, open: () => undefined, close: () => undefined };
  }));
  return { root, dispose() { for (const dispose of unregister.reverse()) dispose(); } };
}
