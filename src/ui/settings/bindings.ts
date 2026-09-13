// SPDX-License-Identifier: GPL-2.0-or-later
import type { InputBindingTarget, PhysicalInput, UiControl, UiMenuId } from "../../contracts/ui.ts";
import { keynumToString } from "../../input/keys.ts";
import type { SeatInput } from "../../input/seat.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";

export interface BindingAction { readonly id: string; readonly label: string; readonly target: InputBindingTarget; }
export function physicalInputLabel(input: PhysicalInput): string {
  switch (input.kind) {
    case "key": return keynumToString(input.code);
    case "mouse-button": return `Mouse ${input.button}`;
    case "controller-button": return `Pad ${input.device} button ${input.button}`;
    case "controller-axis": return `Pad ${input.device} ${input.axis} ${input.direction === "negative" ? "-" : "+"}`;
  }
}
function sameTarget(a: InputBindingTarget, b: InputBindingTarget): boolean {
  return a.kind === "action" && b.kind === "action" ? a.action === b.action
    : a.kind === "command" && b.kind === "command" && a.text === b.text;
}
/** Bindings remain seat-owned; conflicting assignments require explicit replacement. */
export function registerBindingMenus(controller: NativeUiController, input: SeatInput, source: readonly BindingAction[] | (() => readonly BindingAction[])): { readonly root: UiMenuId; dispose(): void } {
  if (!controller.seat.equals(input.seat)) throw new Error("Binding menu belongs to another input seat");
  const root: UiMenuId = "menu:bindings:0", unregister: (() => void)[] = [];
  const actions = (): readonly BindingAction[] => typeof source === "function" ? source() : source;
  const details: UiMenuId = "menu:bindings:action", conflict: UiMenuId = "menu:bindings:conflict";
  let selected: BindingAction | null = null, bindingPage = 0;
  let pending: { readonly physical: PhysicalInput; readonly action: BindingAction; readonly previous: InputBindingTarget } | null = null;
  const targetLabel = (target: InputBindingTarget): string => actions().find(action => sameTarget(action.target, target))?.label
    ?? (target.kind === "command" ? target.text : target.action);
  unregister.push(controller.register(conflict, () => {
    if (pending === null) throw new Error("No pending binding conflict");
    const request = pending;
    const controls: UiControl[] = [
      { id: "ui:bindings:old", kind: "button", label: `Currently: ${targetLabel(request.previous)}`, rect: menuRow(1), enabled: false, visible: true, activate: () => undefined },
      { id: "ui:bindings:new", kind: "button", label: `Replace with: ${request.action.label}`, rect: menuRow(2), enabled: false, visible: true, activate: () => undefined },
      { id: "ui:bindings:cancel", kind: "button", label: "Cancel", rect: menuRow(4), enabled: true, visible: true, activate: () => controller.closeMenu() },
      { id: "ui:bindings:replace", kind: "button", label: "Replace binding", rect: menuRow(5), enabled: true, visible: true,
        activate: () => { input.bind({ input: request.physical, target: request.action.target }); return controller.closeMenu(); } },
    ];
    return { id: conflict, title: `${physicalInputLabel(request.physical)} is already bound`, fullScreen: false, controls, open: () => undefined, close: () => undefined };
  }));
  unregister.push(controller.register(details, () => {
    if (selected === null) throw new Error("No selected binding action");
    const action = selected, bindings = input.bindings.filter(binding => sameTarget(binding.target, action.target));
    const pages = Math.max(1, Math.ceil(bindings.length / 7));
    bindingPage = Math.min(bindingPage, pages - 1);
    const controls: UiControl[] = [
      { id: "ui:bindings:add", kind: "button", label: "Add binding", rect: menuRow(0), enabled: true, visible: true,
        activate: () => { controller.captureBinding(physical => {
          const previous = input.binding(physical);
          if (previous === null || sameTarget(previous, action.target)) input.bind({ input: physical, target: action.target });
          else { pending = { physical, action, previous }; controller.openMenu(conflict); }
        }, () => undefined); return undefined; } },
      { id: "ui:bindings:clear-action", kind: "button", label: "Clear action", rect: menuRow(1), enabled: bindings.length > 0, visible: true,
        activate: () => { for (const binding of bindings) input.unbind(binding.input); return undefined; } },
    ];
    for (const [index, binding] of bindings.slice(bindingPage * 7, bindingPage * 7 + 7).entries()) controls.push({
      id: `ui:bindings:remove:${index}`, kind: "button", label: `Remove ${physicalInputLabel(binding.input)}`, rect: menuRow(index + 2), enabled: true, visible: true,
      activate: () => { input.unbind(binding.input); return undefined; },
    });
    for (const direction of [-1, 1]) if (bindingPage + direction >= 0 && bindingPage + direction < pages) controls.push({
      id: `ui:bindings:more:${direction}`, kind: "button", label: direction < 0 ? "Previous bindings" : "More bindings",
      rect: menuRow(10, { x: direction < 0 ? 64 : 336, width: 240 }), enabled: true, visible: true,
      activate: () => { bindingPage += direction; return undefined; },
    });
    controls.push({ id: "ui:bindings:done", kind: "button", label: "Back", rect: menuRow(11), enabled: true, visible: true, activate: () => controller.closeMenu() });
    return { id: details, title: action.label, fullScreen: false, controls, open: () => undefined, close: () => undefined };
  }));
  const registered = new Set<number>();
  const registerPage = (page: number): void => {
    if (registered.has(page)) return;
    registered.add(page);
    const id: UiMenuId = `menu:bindings:${page}`;
    unregister.push(controller.register(id, () => {
      const currentActions = actions();
      const pages = Math.max(1, Math.ceil(currentActions.length / 9));
      const controls: UiControl[] = [];
      for (const [index, action] of currentActions.slice(page * 9, page * 9 + 9).entries()) {
        const count = input.bindings.filter(binding => sameTarget(binding.target, action.target)).length;
        controls.push({
        id: `ui:bindings:${action.id}`, kind: "button", label: `${action.label}: ${count === 0 ? "Unbound" : `${count} binding${count === 1 ? "" : "s"}`}`,
        rect: menuRow(index, { x: 48, width: 464 }), enabled: true, visible: true,
        activate: () => {
          selected = action; bindingPage = 0; return controller.openMenu(details);
        },
        });
        controls.push({ id: `ui:bindings:clear:${action.id}`, kind: "button", label: "Clear",
          rect: menuRow(index, { x: 520, width: 80 }), enabled: input.bindings.some(binding => sameTarget(binding.target, action.target)), visible: true,
          activate: () => { for (const binding of input.bindings) if (sameTarget(binding.target, action.target)) input.unbind(binding.input); return undefined; } });
      }
      for (const direction of [-1, 1]) if (page + direction >= 0 && page + direction < pages) controls.push({
        id: `ui:bindings:page:${direction}`, kind: "button", label: direction < 0 ? "Previous page" : "Next page",
        rect: menuRow(10, { x: direction < 0 ? 64 : 336, width: 240 }), enabled: true, visible: true,
        activate: () => { registerPage(page + direction); controller.closeMenu(); return controller.openMenu(`menu:bindings:${page + direction}`); },
      });
      controls.push({ id: "ui:bindings:back", kind: "button", label: "Back", rect: menuRow(11), enabled: true, visible: true, activate: () => controller.closeMenu() });
      return { id, title: `Bindings (${page + 1}/${pages})`, fullScreen: false, controls, open: () => undefined, close: () => undefined };
    }));
  };
  registerPage(0);
  return { root, dispose() { for (const dispose of unregister.reverse()) dispose(); } };
}
