import type { UiControl, UiControlId } from "../../contracts/ui.ts";
import type { ConfigStore } from "../../settings/config.ts";
import { applyServerProfile, captureServerProfile, loadServerProfile, readServerSetting, saveServerProfile, writeServerSetting } from "../../settings/server/index.ts";
import type { BoundServerSetting, ServerSettingId, ServerSettingStatus } from "../../settings/server/index.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";
import { settingControl } from "./index.ts";
import type { SettingsMenus } from "./index.ts";

export interface HostServerSettingsUi {
  readonly bindings: () => readonly BoundServerSetting[];
  readonly store: ConfigStore;
}
function timing(status: ServerSettingStatus): string {
  const when = status.applyAt === "live" ? "next source update" : status.applyAt === "next-match" ? "next match"
    : status.applyAt === "next-map" ? "next map" : "server restart";
  return status.pending ? `Pending: applies on ${when}` : status.applyAt === "live" ? "Applies during play" : `Changes apply on ${when}`;
}
function lines(text: string): readonly string[] {
  const result: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length > 60) { result.push(line); line = word; }
    else line += `${line === "" ? "" : " "}${word}`;
  }
  if (line !== "") result.push(line); return result;
}
export function registerServerSettingsMenu(controller: NativeUiController, host: HostServerSettingsUi): SettingsMenus {
  const root = "menu:server:settings", detail = "menu:server:detail", profiles = "menu:server:profiles";
  let page = 0, selected: ServerSettingId | null = null, draft = "", error = "", profileName = "default", profileMessage = "", busy = false;
  const button = (id: UiControlId, label: string, row: number, activate: () => void, enabled = true): UiControl => ({ id, kind: "button", label,
    rect: menuRow(row), enabled, visible: true, activate: () => { activate(); return undefined; } });
  const info = (id: string, label: string, row: number): UiControl => button(`ui:server:info-${id}`, label, row, () => undefined, false);
  const back = (): UiControl => button("ui:server:back", "Back", 11, () => controller.closeMenu());
  const binding = (): BoundServerSetting | undefined => host.bindings().find(candidate => candidate.definition.id === selected);
  const apply = (): void => {
    const current = binding(); if (current === undefined) { error = "This setting is no longer available."; return; }
    try { draft = writeServerSetting(current, draft).desired; error = ""; }
    catch (cause) { error = cause instanceof Error ? cause.message : "Unable to apply setting."; }
  };
  const profile = async (action: "save" | "load"): Promise<void> => {
    if (busy) return;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(profileName)) { profileMessage = "Use 1–32 letters, digits, hyphens or underscores."; return; }
    busy = true; profileMessage = "";
    const name = profileName, path = `servers/${name}.json`;
    try {
      const current = host.bindings(), definitions = current.map(value => value.definition);
      if (action === "save") await saveServerProfile(host.store, path, captureServerProfile(current), definitions);
      else {
        const saved = await loadServerProfile(host.store, path, definitions);
        if (saved === null) throw new Error(`Profile ${name} does not exist.`);
        applyServerProfile(saved, host.bindings());
      }
      profileMessage = `${action === "save" ? "Saved" : "Loaded"} ${name}.`;
    } catch (cause) { profileMessage = cause instanceof Error ? cause.message : "Profile operation failed."; }
    finally { busy = false; }
  };
  const disposers = [controller.register(root, () => {
    const available = host.bindings(), pages = Math.max(1, Math.ceil(available.length / 7)); page = Math.min(page, pages - 1);
    const controls = available.slice(page * 7, page * 7 + 7).map((current, index) => {
      const status = readServerSetting(current);
      return button(`ui:server:${current.definition.id}`, `${current.definition.label}: ${status.desired}${status.pending ? " (pending)" : ""}`, index, () => {
        selected = current.definition.id; draft = readServerSetting(current).desired; error = ""; controller.openMenu(detail);
      });
    });
    controls.push(button("ui:server:previous", "Previous page", 7, () => { page--; }, page > 0),
      button("ui:server:next", "Next page", 8, () => { page++; }, page + 1 < pages),
      button("ui:server:profiles", "Save or load profile", 9, () => controller.openMenu(profiles)), back());
    return { id: root, title: `Server settings ${page + 1}/${pages}`, fullScreen: false, controls, open: () => undefined, close: () => undefined };
  }), controller.register(detail, () => {
    const current = binding(), controls: UiControl[] = [];
    if (current !== undefined) {
      const definition = current.definition, status = readServerSetting(current);
      const common = { id: "ui:server:value", label: "Requested value", category: "network", enabled: () => true } satisfies { id: UiControlId; label: string; category: "network"; enabled: () => boolean };
      if (definition.kind === "toggle") controls.push(settingControl({ ...common, kind: "toggle", read: () => draft === "1", write: value => { draft = value ? "1" : "0"; } }, menuRow(0), controller.seat));
      else if (definition.kind === "choice") controls.push(settingControl({ ...common, kind: "choice", read: () => draft, choices: () => definition.choices, write: value => { draft = value; } }, menuRow(0), controller.seat));
      else controls.push({ id: common.id, kind: "text-entry", label: common.label, rect: menuRow(0), visible: true, enabled: true, text: draft,
        maximumLength: definition.kind === "text-entry" ? definition.maximumLength : 24,
        change: (_seat, value) => { draft = value; return undefined; }, submit: () => { apply(); return undefined; } });
      controls.push(info("desired", `Desired: ${status.desired}   Effective: ${status.effective}`, 1), info("default", `Default: ${definition.defaultValue}`, 2), info("timing", timing(status), 3));
      lines(definition.description).slice(0, 2).forEach((line, index) => controls.push(info(`description-${index}`, line, 4 + index)));
      if (definition.kind === "slider") controls.push(info("range", `${definition.integer ? "Whole numbers" : "Numbers"} from ${definition.minimum} to ${definition.maximum}`, 6));
      controls.push(button("ui:server:apply", "Apply", 7, apply), button("ui:server:default", "Use default", 8, () => { draft = definition.defaultValue; error = ""; }));
    } else controls.push(info("missing", "This setting is no longer available.", 0));
    lines(error).slice(0, 2).forEach((line, index) => controls.push(info(`error-${index}`, line, 9 + index)));
    controls.push(back());
    return { id: detail, title: current?.definition.label ?? "Server setting", fullScreen: false, controls, open: () => undefined, close: () => undefined };
  }), controller.register(profiles, () => ({ id: profiles, title: "Server profiles", fullScreen: false, controls: [
    { id: "ui:server:profile-name", kind: "text-entry", label: "Profile name", text: profileName, maximumLength: 32, rect: menuRow(0), enabled: !busy, visible: true,
      change: (_seat, value) => { profileName = value; return undefined; }, submit: () => undefined },
    info("profile-help", "A short name, such as league-night. No file paths.", 1),
    button("ui:server:save", "Save current desired settings", 3, () => { void profile("save"); }, !busy),
    button("ui:server:load", "Load and apply profile", 4, () => { void profile("load"); }, !busy),
    info("profile-timing", "Loaded settings keep their normal apply timing.", 5),
    ...lines(busy ? "Working…" : profileMessage).slice(0, 3).map((line, index) => info(`profile-message-${index}`, line, 7 + index)), back(),
  ], open: () => undefined, close: () => undefined }))];
  return { root, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}
