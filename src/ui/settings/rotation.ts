import type { UiControl, UiControlId } from "../../contracts/ui.ts";
import type { BoundServerSetting } from "../../settings/server/types.ts";
import { readServerSetting, writeServerSetting } from "../../settings/server/profile.ts";
import { moveRotationMap, rotationMapName } from "../../settings/server/rotation.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";
import type { SettingsMenus } from "./index.ts";

export function registerMapRotationMenu(controller: NativeUiController, bindings: () => readonly BoundServerSetting[]): SettingsMenus {
  const root = "menu:server:rotation"; let selected = 0, draft = "", error = "";
  const current = () => bindings().find(binding => binding.definition.id === "server:map-rotation");
  const maps = (): readonly string[] => { const binding = current(); return binding === undefined ? [] : readServerSetting(binding).desired.split(/[\s,]+/).filter(Boolean); };
  const write = (values: readonly string[]): void => { const binding = current(); if (binding === undefined) throw new Error("This source has no map rotation setting"); writeServerSetting(binding, values.join(" ")); };
  const action = (work: () => void): undefined => { try { work(); error = ""; } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); } return undefined; };
  const button = (id: UiControlId, label: string, row: number, work: () => void, enabled = true): UiControl => ({ id, kind: "button", label, rect: menuRow(row), enabled, visible: true, activate: () => action(work) });
  const dispose = controller.register(root, () => {
    const values = maps(); selected = Math.max(0, Math.min(selected, values.length - 1));
    const controls: UiControl[] = [
      { id: "ui:rotation:map", kind: "text-entry", label: "Add map", text: draft, maximumLength: 127, rect: menuRow(0), enabled: current() !== undefined, visible: true,
        change: (_seat, value) => { draft = value; return undefined; }, submit: () => action(() => { write([...maps(), rotationMapName(draft)]); selected = maps().length - 1; draft = ""; }) },
      button("ui:rotation:add", "Add to end", 1, () => { write([...maps(), rotationMapName(draft)]); selected = maps().length - 1; draft = ""; }, current() !== undefined),
      { id: "ui:rotation:selection", kind: "choice", label: "Rotation entry", selected: String(selected), choices: values.length === 0 ? [{ id: "0", label: "Empty: authored exits" }] : values.map((name, index) => ({ id: String(index), label: `${index + 1}. ${name}` })),
        rect: menuRow(2), enabled: values.length > 0, visible: true, select: (_seat, value) => { const index = Number(value); if (Number.isInteger(index) && index >= 0 && index < maps().length) selected = index; return undefined; } },
      button("ui:rotation:up", "Move earlier", 3, () => { write(moveRotationMap(maps(), selected, -1)); selected--; }, selected > 0),
      button("ui:rotation:down", "Move later", 4, () => { write(moveRotationMap(maps(), selected, 1)); selected++; }, selected < values.length - 1),
      button("ui:rotation:remove", "Remove entry", 5, () => write(maps().filter((_name, index) => index !== selected)), values.length > 0),
      button("ui:rotation:clear", "Use authored exits", 6, () => write([]), values.length > 0),
      button("ui:rotation:notice", error || "Save in Server profiles to reuse this order.", 8, () => undefined, false),
      button("ui:rotation:back", "Back", 10, () => controller.closeMenu()),
    ];
    return { id: root, title: "Map rotation", fullScreen: false, controls, open: () => undefined, close: () => undefined };
  });
  return { root, dispose };
}
