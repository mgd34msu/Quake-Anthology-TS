// SPDX-License-Identifier: GPL-2.0-or-later
// Shared per-seat overlay drawing; gameplay providers retain their source HUD/stat layouts.
import type { ResourceId } from "../../contracts/content.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { Vec2, Vec3, Vec4 } from "../../contracts/math.ts";
import type { Rect, SceneCamera } from "../../contracts/render.ts";
import type { SourceTime } from "../../contracts/time.ts";
import type { CenterPrintState, UiDrawCommand, UiDrawContext, UiNotification } from "../../contracts/ui.ts";
import { createViewProjector } from "../../render/scene/view.ts";
import type { ActiveCaption } from "../../text/captions.ts";
import { fitUi, transformUi } from "../common/layout.ts";
import type { UiSkin } from "../common/skin.ts";
import type { UiPreferenceValues } from "../settings/index.ts";
import type { CarouselPresentation, WheelPresentation } from "./wheel.ts";
export * from "./wheel.ts";
export * from "./q1-wheel.ts";

export interface HudValue { readonly label: string; readonly value: number; readonly icon: ResourceId | null; readonly warning: boolean; }
export interface HudInventoryItem { readonly id: string; readonly label: string; readonly count: number; readonly selected: boolean; readonly binding: string | null; readonly icon: ResourceId | null; }
export interface HudPrompt { readonly action: string; readonly binding: string; readonly icon: ResourceId | null; }
export interface HudHealthBar { readonly id: string; readonly label: string; readonly value: number; readonly maximum: number; readonly color: Vec4; }
export interface HudHelp { readonly title: string; readonly lines: readonly string[]; readonly objectives: readonly { readonly text: string; readonly complete: boolean }[]; }
export interface HudPointOfInterest {
  readonly id: number;
  readonly origin: Vec3;
  readonly image: ResourceId;
  readonly width: number;
  readonly height: number;
  readonly color: Vec4;
  readonly hideOnAim: boolean;
  readonly expiresMilliseconds: number;
}
export interface CommonHudData {
  readonly seat: SeatId;
  readonly visible: boolean;
  readonly vitals: readonly HudValue[];
  readonly inventory: readonly HudInventoryItem[] | null;
  readonly prompts: readonly HudPrompt[];
  readonly healthBars: readonly HudHealthBar[];
  readonly help: HudHelp | null;
  readonly captions: readonly ActiveCaption[];
  readonly wheel: WheelPresentation | null;
  readonly carousel: CarouselPresentation | null;
  readonly crosshair: { readonly visible: boolean; readonly color: Vec4; readonly image: ResourceId | null };
  readonly hitMarker: { readonly damage: number; readonly expiresMilliseconds: number } | null;
}
export function emptyHudData(seat: SeatId): CommonHudData {
  return { seat, visible: true, vitals: [], inventory: null, prompts: [], healthBars: [], help: null, captions: [], wheel: null,
    carousel: null, crosshair: { visible: true, color: { x: 1, y: 1, z: 1, w: 1 }, image: null }, hitMarker: null };
}
function milliseconds(time: SourceTime): number { return time.kind === "seconds" ? time.value * 1000 : time.value; }
function alive(starts: SourceTime, duration: SourceTime, now: number): boolean {
  const start = milliseconds(starts); return now >= start && now < start + milliseconds(duration);
}
/** Source private messages and POIs are stored on the recipient seat, never a global HUD. */
export class SeatHudMessages {
  private sequence = 0;
  private notices: UiNotification[] = [];
  private center: CenterPrintState | null = null;
  private readonly points: HudPointOfInterest[] = [];
  constructor(readonly seat: SeatId) {}
  notify(seat: SeatId, text: string, chat: boolean, starts: SourceTime, duration: SourceTime): void {
    this.requireSeat(seat); this.notices.push({ sequence: this.sequence++, text, chat, starts, duration });
  }
  centerPrint(seat: SeatId, text: string, starts: SourceTime, duration: SourceTime, instant = true): void {
    this.requireSeat(seat); this.center = { text, starts, duration, instant };
  }
  clearNotify(): void { this.notices = []; }
  clearCenterPrint(): void { this.center = null; }
  clear(): void { this.clearNotify(); this.clearCenterPrint(); this.points.length = 0; }
  /** Keyed POIs replace matching IDs; unkeyed POIs replace only expired or oldest unkeyed entries. */
  addPoint(seat: SeatId, point: HudPointOfInterest, nowMilliseconds: number, capacity = 64): boolean {
    this.requireSeat(seat);
    let index = point.id === 0 ? -1 : this.points.findIndex(existing => existing.id === point.id);
    if (index < 0) index = this.points.findIndex(existing => existing.expiresMilliseconds <= nowMilliseconds);
    if (index < 0 && this.points.length < capacity) { this.points.push(point); return true; }
    if (index < 0) {
      let oldest = Infinity;
      for (const [candidate, existing] of this.points.entries()) if (existing.id === 0 && existing.expiresMilliseconds < oldest) {
        oldest = existing.expiresMilliseconds; index = candidate;
      }
    }
    if (index < 0) return false;
    this.points[index] = point; return true;
  }
  removePoint(id: number): void {
    if (id === 0) return;
    const index = this.points.findIndex(point => point.id === id); if (index >= 0) this.points.splice(index, 1);
  }
  active(nowMilliseconds: number): { readonly notifications: readonly UiNotification[]; readonly centerPrint: CenterPrintState | null; readonly points: readonly HudPointOfInterest[] } {
    this.notices = this.notices.filter(notice => milliseconds(notice.starts) + milliseconds(notice.duration) > nowMilliseconds);
    if (this.center !== null && milliseconds(this.center.starts) + milliseconds(this.center.duration) <= nowMilliseconds) this.center = null;
    return { notifications: this.notices.filter(notice => alive(notice.starts, notice.duration, nowMilliseconds)),
      centerPrint: this.center !== null && alive(this.center.starts, this.center.duration, nowMilliseconds) ? this.center : null,
      points: this.points.filter(point => point.expiresMilliseconds > nowMilliseconds) };
  }
  private requireSeat(seat: SeatId): void { if (!seat.equals(this.seat)) throw new Error("HUD message belongs to another seat"); }
}

export interface CommonHudDrawOptions {
  readonly skin: UiSkin;
  readonly preferences: UiPreferenceValues;
  readonly messages: SeatHudMessages;
  readonly camera: SceneCamera | null;
  readonly localize: (text: string) => string;
}
export function drawCommonHud(context: UiDrawContext, data: CommonHudData, options: CommonHudDrawOptions): readonly UiDrawCommand[] {
  if (!data.seat.equals(context.binding.seat) || !data.seat.equals(options.messages.seat)) throw new Error("HUD frame belongs to another seat");
  if (!data.visible) return [];
  const preferences = options.preferences, skin = options.skin;
  const commands: { readonly command: UiDrawCommand; readonly anchor: Vec2; readonly scale: number }[] = [];
  let anchor: Vec2 = { x: 320, y: 240 }, groupScale = preferences.hudScale * context.binding.hudScale;
  const color = preferences.highContrast ? { x: 1, y: 1, z: 1, w: 1 } : skin.colors.text;
  const accent = preferences.highContrast ? { x: 1, y: 1, z: 0, w: 1 } : skin.colors.accent;
  const background = preferences.highContrast ? { x: 0, y: 0, z: 0, w: 1 } : skin.colors.panel;
  const textScale = skin.fontScale * preferences.textScale, lineHeight = skin.lineHeight * preferences.textScale;
  const text = (value: string, x: number, y: number, tint: Vec4 = color, align: "left" | "center" | "right" = "left"): void => {
    commands.push({ command: { kind: "text", origin: { x, y }, text: options.localize(value), font: skin.font, scale: textScale, color: tint, align, shadow: true }, anchor, scale: groupScale });
  };
  const image = (resource: ResourceId, rect: Rect, tint: Vec4 = color): void => {
    commands.push({ command: { kind: "image", resource, rect, texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: tint }, anchor, scale: groupScale });
  };
  const fill = (rect: Rect, tint: Vec4): void => { commands.push({ command: { kind: "fill", rect, color: tint }, anchor, scale: groupScale }); };
  const state = options.messages.active(context.timeMilliseconds);
  if (preferences.crosshair && data.crosshair.visible && data.help === null && data.inventory === null && data.wheel === null) {
    const size = preferences.crosshairSize;
    if (data.crosshair.image !== null) image(data.crosshair.image, { x: 320 - size / 2, y: 240 - size / 2, width: size, height: size }, data.crosshair.color);
    else { fill({ x: 320 - size / 2, y: 239, width: size, height: 2 }, data.crosshair.color); fill({ x: 319, y: 240 - size / 2, width: 2, height: size }, data.crosshair.color); }
    if (data.hitMarker !== null && data.hitMarker.expiresMilliseconds > context.timeMilliseconds && !preferences.reducedFlashes) {
      const opacity = Math.max(0, Math.min(1, (data.hitMarker.expiresMilliseconds - context.timeMilliseconds) / 150));
      for (const x of [-1, 1]) for (const y of [-1, 1]) fill({ x: 320 + x * (size + 2) - 2, y: 240 + y * (size + 2) - 2, width: 4, height: 4 }, { ...accent, w: opacity });
    }
  }
  if (data.vitals.length > 0) {
    anchor = { x: 320, y: 480 };
    const width = Math.min(600 / groupScale / data.vitals.length, 160), start = 320 - width * data.vitals.length / 2;
    for (const [index, vital] of data.vitals.entries()) {
      const x = start + index * width;
      fill({ x, y: 434, width: width - 4, height: 42 }, background);
      if (vital.icon !== null) image(vital.icon, { x: x + 6, y: 442, width: 24, height: 24 });
      text(`${vital.label} ${vital.value}`, x + (vital.icon === null ? 8 : 34), 446, vital.warning ? accent : color);
    }
  }
  anchor = { x: 320, y: 0 };
  for (const [index, bar] of data.healthBars.entries()) {
    const x = 160, y = 24 + index * (lineHeight + 16);
    text(bar.label, 320, y, color, "center"); fill({ x, y: y + lineHeight + 2, width: 320, height: 8 }, background);
    fill({ x, y: y + lineHeight + 2, width: 320 * Math.max(0, Math.min(1, bar.maximum <= 0 ? 0 : bar.value / bar.maximum)), height: 8 }, bar.color);
  }
  anchor = { x: 0, y: 0 };
  for (const [index, notice] of state.notifications.slice(-6).entries()) text(notice.text, 12, 12 + index * lineHeight, notice.chat ? accent : color);
  anchor = { x: 320, y: 240 };
  if (state.centerPrint !== null) {
    const print = state.centerPrint;
    const elapsed = context.timeMilliseconds - milliseconds(print.starts);
    const value = print.instant ? print.text : Array.from(print.text).slice(0, Math.max(0, Math.floor(elapsed * 0.008))).join("");
    const lines = value.split("\n"), start = 160 - lines.length * lineHeight / 2;
    lines.forEach((line, index) => text(line, 320, start + index * lineHeight, color, "center"));
  }
  if (data.inventory !== null) {
    fill({ x: 128, y: 72, width: 384, height: 328 }, background);
    text("Inventory", 320, 88, accent, "center");
    const selected = Math.max(0, data.inventory.findIndex(item => item.selected)), rows = Math.max(1, Math.floor(270 / lineHeight));
    const start = Math.max(0, Math.min(data.inventory.length - rows, selected - Math.floor(rows / 2)));
    data.inventory.slice(start, start + rows).forEach((item, index) => {
      const y = 114 + index * lineHeight;
      if (item.selected) fill({ x: 136, y, width: 368, height: lineHeight }, skin.colors.focused);
      text(item.binding ?? "", 144, y, accent);
      if (item.icon !== null) image(item.icon, { x: 188, y, width: lineHeight, height: lineHeight });
      text(item.label, 212, y, item.selected ? accent : color); text(String(item.count), 494, y, color, "right");
    });
  }
  anchor = { x: 320, y: 480 };
  for (const [index, prompt] of data.prompts.entries()) {
    const y = 394 - (data.prompts.length - index - 1) * (lineHeight + 4);
    if (prompt.icon !== null) image(prompt.icon, { x: 176, y: y - 2, width: lineHeight + 4, height: lineHeight + 4 });
    text(`[${prompt.binding}] ${options.localize(prompt.action)}`, 320, y, accent, "center");
  }
  if (preferences.captions) for (const [index, caption] of data.captions.entries()) {
    const y = 360 - (data.captions.length - index - 1) * (lineHeight + 6);
    fill({ x: 40, y: y - 3, width: 560, height: lineHeight + 6 }, background);
    text(`${caption.localizedSpeaker === null ? "" : `${caption.localizedSpeaker}: `}${caption.localizedText}`, 320, y, color, "center");
  }
  if (data.help !== null) {
    anchor = { x: 320, y: 240 }; groupScale = 1;
    fill({ x: 48, y: 48, width: 544, height: 360 }, background); text(data.help.title, 320, 68, accent, "center");
    let y = 104;
    for (const line of data.help.lines) { text(line, 68, y); y += lineHeight; }
    y += lineHeight;
    for (const objective of data.help.objectives) { text(`${objective.complete ? "[x]" : "[ ]"} ${options.localize(objective.text)}`, 68, y, objective.complete ? color : accent); y += lineHeight; }
  }
  if (data.wheel !== null) {
    anchor = { x: 320, y: 240 }; groupScale = Math.min(1, preferences.hudScale * context.binding.hudScale);
    const wheel = data.wheel, opacity = preferences.reducedFlashes ? 1 : wheel.opacity;
    fill({ x: 128, y: 48, width: 384, height: 384 }, { ...background, w: background.w * opacity });
    for (const [index, item] of wheel.items.entries()) {
      const angle = index * 2 * Math.PI / wheel.items.length, x = 320 + Math.sin(angle) * 136, y = 240 - Math.cos(angle) * 136;
      const selected = item.id === wheel.selected, tint = { ...(selected ? accent : item.owned ? color : skin.colors.disabled), w: opacity };
      const icon = selected ? item.selectedIcon ?? item.icon : item.icon;
      if (icon !== null) image(icon, { x: x - 20, y: y - 20, width: 40, height: 40 }, tint);
      else text(item.label, x, y - 8, tint, "center");
      if (item.count !== null) text(String(item.count), x, y + 24, { ...(item.count <= item.warningCount ? accent : tint), w: opacity }, "center");
      if (selected) text(item.label, 320, 220, tint, "center");
    }
    fill({ x: 318 + wheel.cursor.x * 150, y: 238 + wheel.cursor.y * 150, width: 4, height: 4 }, accent);
  }
  if (data.carousel !== null) {
    anchor = { x: 320, y: 480 }; groupScale = preferences.hudScale * context.binding.hudScale;
    const width = Math.min(48, 600 / Math.max(1, data.carousel.items.length)), start = 320 - data.carousel.items.length * width / 2;
    for (const [index, item] of data.carousel.items.entries()) {
      const x = start + index * width, selected = item.id === data.carousel.selected;
      if (selected) fill({ x, y: 324, width: width - 2, height: 50 }, skin.colors.focused);
      const icon = selected ? item.selectedIcon ?? item.icon : item.icon;
      if (icon !== null) image(icon, { x: x + 4, y: 328, width: width - 10, height: width - 10 });
      if (item.count !== null) text(String(item.count), x + width / 2, 358, selected ? accent : color, "center");
    }
  }
  const transform = fitUi(context.binding.safeArea);
  const result: UiDrawCommand[] = [{ kind: "clip", rect: context.binding.safeArea }];
  result.push(...commands.map(item => transformUi(item.command, { scale: transform.scale * item.scale,
    x: transform.x + item.anchor.x * transform.scale * (1 - item.scale), y: transform.y + item.anchor.y * transform.scale * (1 - item.scale) })));
  if (options.camera !== null) {
    const project = createViewProjector(options.camera), area = context.binding.safeArea;
    for (const point of state.points) {
      const clip = project(point.origin), divisor = clip.w === 0 ? 1 : clip.w;
      let x = area.x + (clip.x / divisor * 0.5 + 0.5) * area.width, y = area.y + (-clip.y / divisor * 0.5 + 0.5) * area.height;
      if (clip.w < 0) { x = area.x * 2 + area.width - x; y = area.y * 2 + area.height - y;
        if (y > area.y) { x = x < area.x + area.width / 2 ? area.x : area.x + area.width; y = Math.min(y, area.y + area.height * 0.75); } }
      const width = point.width * transform.scale, height = point.height * transform.scale;
      const distance = Math.hypot(x - area.x - area.width / 2, y - area.y - area.height / 2);
      result.push({ kind: "image", resource: point.image,
        rect: { x: Math.max(area.x, Math.min(area.x + area.width - width, x - width / 2)), y: Math.max(area.y, Math.min(area.y + area.height - height, y - height / 2)), width, height },
        texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { ...point.color,
          w: point.color.w * (point.hideOnAim ? Math.max(0.25, Math.min(1, distance / Math.max(1, width * 3))) : 1) } });
    }
  }
  result.push({ kind: "clip", rect: null }); return result;
}
