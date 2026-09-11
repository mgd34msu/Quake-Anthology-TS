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
/** Each capture replaces that action's binding in the selected device family. */
export function registerBindingMenus(controller: NativeUiController, input: SeatInput, actions: readonly BindingAction[]): { readonly root: UiMenuId; dispose(): void } {
  if (!controller.seat.equals(input.seat)) throw new Error("Binding menu belongs to another input seat");
  const root: UiMenuId = "menu:bindings:0", unregister: (() => void)[] = [];
  const pages = Math.max(1, Math.ceil(actions.length / 9));
  for (let page = 0; page < pages; page++) {
    const id: UiMenuId = `menu:bindings:${page}`;
    unregister.push(controller.register(id, () => {
      const controls = actions.slice(page * 9, page * 9 + 9).map((action, index): UiControl => ({
        id: `ui:bindings:${action.id}`, kind: "button", label: `${action.label}: ${input.bindings.filter(binding => sameTarget(binding.target, action.target)).map(binding => physicalInputLabel(binding.input)).join(", ") || "Unbound"}`,
        rect: menuRow(index), enabled: true, visible: true,
        activate: () => {
          controller.captureBinding(physical => {
            for (const binding of input.bindings) if (sameTarget(binding.target, action.target) && binding.input.kind === physical.kind) input.unbind(binding.input);
            input.bind({ input: physical, target: action.target });
          }, () => undefined); return undefined;
        },
      }));
      for (const direction of [-1, 1]) if (page + direction >= 0 && page + direction < pages) controls.push({
        id: `ui:bindings:page:${direction}`, kind: "button", label: direction < 0 ? "Previous page" : "Next page",
        rect: menuRow(10, { x: direction < 0 ? 64 : 336, width: 240 }), enabled: true, visible: true,
        activate: () => { controller.closeMenu(); return controller.openMenu(`menu:bindings:${page + direction}`); },
      });
      controls.push({ id: "ui:bindings:back", kind: "button", label: "Back", rect: menuRow(11), enabled: true, visible: true, activate: () => controller.closeMenu() });
      return { id, title: "Key and controller bindings", fullScreen: false, controls, open: () => undefined, close: () => undefined };
    }));
  }
  return { root, dispose() { for (const dispose of unregister.reverse()) dispose(); } };
}
