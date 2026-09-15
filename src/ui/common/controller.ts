// SPDX-License-Identifier: GPL-2.0-or-later
// Navigation, wrapping, menu stack and fields follow Q3 ui_qmenu.c/ui_field.c.
// Every mutable cursor, field, list and held controller direction belongs to a seat.
import type { SeatId } from "../../contracts/identity.ts";
import type { Vec2, Vec4 } from "../../contracts/math.ts";
import type { CenterPrintState, InputBinding, LegacyUiScript, PhysicalInput, SeatInputEvent, SeatInputFocus,
  SeatUiController, SeatUiState, UiControl, UiControlId, UiDrawCommand, UiDrawContext, UiMenu, UiMenuId, UiNotification } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { contains, fitUi, intersect, transformUi, uiPoint } from "./layout.ts";
import type { UiTransform } from "./layout.ts";
import { nineSlice } from "./skin.ts";
import type { UiSkin } from "./skin.ts";

export type UiMenuFactory = () => UiMenu;
export type UiSound = "open" | "close" | "move" | "change" | "reject";
export interface NativeUiOptions {
  readonly seat: SeatId;
  readonly skin: () => UiSkin;
  readonly now: () => number;
  readonly bindings: () => readonly InputBinding[];
  readonly focus: (focus: SeatInputFocus, nowMilliseconds: number) => void;
  readonly sound: (sound: UiSound, seat: SeatId) => void;
  readonly executeScript: (script: LegacyUiScript, seat: SeatId) => void;
  readonly localize?: (text: string) => string;
  readonly appearance?: () => { readonly menuScale: number; readonly textScale: number; readonly highContrast: boolean };
  readonly clipboard?: () => string | null;
  readonly measureText?: (text: string, scale: number) => number;
}
interface MenuCursor { readonly id: UiMenuId; focus: UiControlId | null; scroll: number; }
interface FieldCursor { cursor: number; start: number; overstrike: boolean; }
interface HeldDirection { readonly code: number; next: number; }
interface BindingCapture { readonly accept: (input: PhysicalInput) => void; readonly cancel: () => void; }
const white: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
const enabled = (control: UiControl): boolean => control.enabled && control.visible;
const quantize = (control: Extract<UiControl, { readonly kind: "slider" }>, value: number): number =>
  Math.max(control.minimum, Math.min(control.maximum, control.minimum + Math.round((value - control.minimum) / control.step) * control.step));

/** Factories reread live settings and feeders before each input event and draw. */
export class NativeUiController implements SeatUiController {
  readonly seat: SeatId;
  private readonly menus = new Map<UiMenuId, UiMenuFactory>();
  private readonly stack: MenuCursor[] = [];
  private readonly fields = new Map<UiControlId, FieldCursor>();
  private readonly listTops = new Map<UiControlId, number>();
  private readonly listRows = new Map<UiControlId, readonly string[]>();
  private listDragOffset = 0;
  private menuDragOffset: number | null = null;
  private readonly heldAxes = new Map<string, HeldDirection>();
  private cursor: Vec2 = { x: 320, y: 240 };
  private pointerPosition: Vec2 | null = null;
  private transform: UiTransform = { x: 0, y: 0, scale: 1 };
  private dragging: UiControlId | null = null;
  private shift = false;
  private control = false;
  private capture: BindingCapture | null = null;
  private notifications: readonly UiNotification[] = [];
  private centerPrint: CenterPrintState | null = null;
  private scores = false;
  constructor(private readonly options: NativeUiOptions) { this.seat = options.seat; }
  register(id: UiMenuId, factory: UiMenuFactory): () => void {
    if (this.menus.has(id)) throw new Error(`Menu already registered: ${id}`);
    this.menus.set(id, factory);
    return () => {
      const index = this.stack.findIndex(menu => menu.id === id);
      if (index >= 0) while (this.stack.length > index) this.closeMenu();
      this.menus.delete(id);
    };
  }
  get activeMenu(): UiMenuId | null { return this.stack.at(-1)?.id ?? null; }
  get bindingCapture(): boolean { return this.capture !== null; }
  captureBinding(accept: (input: PhysicalInput) => void, cancel: () => void): void {
    this.capture?.cancel(); this.capture = { accept, cancel };
  }
  private active(): { readonly menu: UiMenu; readonly cursor: MenuCursor } | null {
    const cursor = this.stack.at(-1);
    if (cursor === undefined) return null;
    const factory = this.menus.get(cursor.id);
    if (factory === undefined) throw new Error(`Active menu is not registered: ${cursor.id}`);
    const menu = factory();
    if (menu.id !== cursor.id) throw new Error("Menu factory returned a different identity");
    if (!menu.controls.some(control => control.id === cursor.focus && enabled(control))) cursor.focus = menu.controls.find(enabled)?.id ?? null;
    const scroll = menu.scroll;
    if (scroll === undefined) return { menu, cursor };
    cursor.scroll = Math.max(0, Math.min(Math.max(0, scroll.contentHeight - scroll.rect.height), cursor.scroll));
    return { menu: { ...menu, controls: menu.controls.map(control => scroll.controls.includes(control.id)
      ? { ...control, rect: { ...control.rect, y: control.rect.y - cursor.scroll } } : control) }, cursor };
  }
  private focusChanged(): void {
    const top = this.stack.at(-1);
    this.options.focus(top === undefined ? { kind: "game" } : { kind: "menu", menu: top.id, control: top.focus }, this.options.now());
  }
  state(): SeatUiState {
    const top = this.stack.at(-1);
    return { seat: this.seat, focus: top === undefined ? { kind: "game" } : { kind: "menu", menu: top.id, control: top.focus },
      cursor: this.cursor, bindings: this.options.bindings(), notifications: this.notifications, centerPrint: this.centerPrint, showScores: this.scores };
  }
  presentation(state: { readonly notifications: readonly UiNotification[]; readonly centerPrint: CenterPrintState | null; readonly showScores: boolean }): void {
    this.notifications = state.notifications; this.centerPrint = state.centerPrint; this.scores = state.showScores;
  }
  openMenu(id: UiMenuId): undefined {
    const factory = this.menus.get(id);
    if (factory === undefined) throw new Error(`Unknown menu: ${id}`);
    const existing = this.stack.findIndex(menu => menu.id === id);
    if (existing >= 0) {
      while (this.stack.length > existing + 1) this.closeMenu();
      this.focusChanged(); return undefined;
    }
    const menu = factory();
    this.stack.push({ id, focus: menu.controls.find(enabled)?.id ?? null, scroll: 0 });
    this.dragging = null; this.menuDragOffset = null; this.heldAxes.clear(); menu.open(this.seat); this.focusChanged(); this.options.sound("open", this.seat);
    return undefined;
  }
  closeMenu(): undefined {
    const current = this.stack.pop();
    if (current === undefined) return undefined;
    this.capture?.cancel(); this.capture = null; this.dragging = null; this.menuDragOffset = null; this.heldAxes.clear();
    this.menus.get(current.id)?.().close(this.seat);
    this.focusChanged(); this.options.sound("close", this.seat); return undefined;
  }
  closeAll(): void { while (this.stack.length > 0) this.closeMenu(); }
  executeScript(script: LegacyUiScript): undefined { this.options.executeScript(script, this.seat); return undefined; }
  private moveFocus(direction: number): void {
    const active = this.active(); if (active === null) return;
    const controls = active.menu.controls.filter(enabled), index = controls.findIndex(control => control.id === active.cursor.focus);
    const next = controls[(index + direction + controls.length) % controls.length];
    if (next !== undefined && next.id !== active.cursor.focus) {
      active.cursor.focus = next.id; this.reveal(active.menu, active.cursor, next); this.focusChanged(); this.options.sound("move", this.seat);
    }
  }
  private reveal(menu: UiMenu, cursor: MenuCursor, control: UiControl): void {
    const scroll = menu.scroll;
    if (scroll === undefined || !scroll.controls.includes(control.id)) return;
    if (control.rect.y < scroll.rect.y) cursor.scroll -= scroll.rect.y - control.rect.y;
    else if (control.rect.y + control.rect.height > scroll.rect.y + scroll.rect.height)
      cursor.scroll += control.rect.y + control.rect.height - scroll.rect.y - scroll.rect.height;
    cursor.scroll = Math.max(0, Math.min(Math.max(0, scroll.contentHeight - scroll.rect.height), cursor.scroll));
  }
  private hit(menu: UiMenu, control: UiControl): boolean {
    return enabled(control) && contains(control.rect, this.cursor)
      && (menu.scroll === undefined || !menu.scroll.controls.includes(control.id) || contains(menu.scroll.rect, this.cursor));
  }
  private menuThumb(menu: UiMenu): number {
    const scroll = menu.scroll;
    return scroll === undefined ? 0 : Math.min(scroll.rect.height, Math.max(24, scroll.rect.height * scroll.rect.height / Math.max(1, scroll.contentHeight)));
  }
  private menuPointer(menu: UiMenu, cursor: MenuCursor): void {
    const scroll = menu.scroll;
    if (scroll === undefined || this.menuDragOffset === null) return;
    const travel = scroll.rect.height - this.menuThumb(menu), maximum = Math.max(0, scroll.contentHeight - scroll.rect.height);
    cursor.scroll = travel <= 0 ? 0 : Math.max(0, Math.min(maximum, (this.cursor.y - scroll.rect.y - this.menuDragOffset) / travel * maximum));
  }
  private change(control: UiControl, direction: number): void {
    if (!enabled(control)) return;
    if (control.kind === "toggle") control.change(this.seat, !control.checked);
    else if (control.kind === "slider") {
      if (control.step <= 0 || control.minimum > control.maximum) throw new RangeError("Invalid menu slider range");
      control.change(this.seat, quantize(control, control.value + control.step * direction));
    } else if (control.kind === "choice") {
      const count = control.choices.length;
      const next = control.choices[(control.choices.findIndex(choice => choice.id === control.selected) + direction + count) % count];
      if (next !== undefined) control.select(this.seat, next.id);
    } else return;
    this.options.sound("change", this.seat);
  }
  private activate(control: UiControl): void {
    if (!enabled(control)) { this.options.sound("reject", this.seat); return; }
    switch (control.kind) {
      case "button": control.activate(this.seat); this.options.sound("change", this.seat); break;
      case "toggle": case "slider": case "choice": this.change(control, 1); break;
      case "text-entry": control.submit(this.seat, control.text); break;
      case "list": if (control.selected !== null) (control.activate ?? control.select)(this.seat, control.selected); break;
      case "owner-draw": control.key(this.seat, KeyCode.Enter, true); break;
    }
  }
  private field(control: Extract<UiControl, { readonly kind: "text-entry" }>): FieldCursor {
    let field = this.fields.get(control.id);
    const length = Array.from(control.text).length;
    if (field === undefined) { field = { cursor: length, start: 0, overstrike: false }; this.fields.set(control.id, field); }
    field.cursor = Math.min(field.cursor, length); return field;
  }
  private text(control: Extract<UiControl, { readonly kind: "text-entry" }>, text: string): void {
    const field = this.field(control), characters = Array.from(control.text);
    const incoming = Array.from(text).filter(character => !/[\u0000-\u001f\u007f]/u.test(character));
    const room = Math.max(0, control.maximumLength - characters.length + (field.overstrike ? characters.length - field.cursor : 0));
    const accepted = incoming.slice(0, room);
    characters.splice(field.cursor, field.overstrike ? accepted.length : 0, ...accepted); field.cursor += accepted.length;
    control.change(this.seat, characters.join(""));
  }
  private fieldKey(control: Extract<UiControl, { readonly kind: "text-entry" }>, key: number): boolean {
    const field = this.field(control), characters = Array.from(control.text);
    if (key === KeyCode.Left) field.cursor = Math.max(0, field.cursor - 1);
    else if (key === KeyCode.Right) field.cursor = Math.min(characters.length, field.cursor + 1);
    else if (key === KeyCode.Home || this.control && key === 97) field.cursor = 0;
    else if (key === KeyCode.End || this.control && key === 101) field.cursor = characters.length;
    else if (key === KeyCode.Insert) field.overstrike = !field.overstrike;
    else if (key === KeyCode.Backspace || this.control && key === 104) {
      if (field.cursor > 0) { characters.splice(--field.cursor, 1); control.change(this.seat, characters.join("")); }
    } else if (key === KeyCode.Delete) { characters.splice(field.cursor, 1); control.change(this.seat, characters.join("")); }
    else if (this.control && key === 117) { field.cursor = 0; control.change(this.seat, ""); }
    else if (this.control && key === 118) { const text = this.options.clipboard?.(); if (text !== undefined && text !== null) this.text(control, text); }
    else return false;
    return true;
  }
  private listLayout(control: Extract<UiControl, { readonly kind: "list" }>): { readonly top: number; readonly page: number; readonly height: number; readonly maximum: number; readonly thumb: number } {
    const height = Math.max(1, control.rowHeight ?? this.options.skin().lineHeight);
    const page = Math.max(1, Math.floor(control.rect.height / height));
    const maximum = Math.max(0, control.rows.length - page);
    const previous = this.listRows.get(control.id);
    const changed = previous === undefined || previous.length !== control.rows.length || previous.some((id, index) => id !== control.rows[index]?.id);
    if (changed) {
      this.listRows.set(control.id, control.rows.map(row => row.id));
      this.listTops.set(control.id, Math.max(0, control.rows.findIndex(row => row.id === control.selected) - page + 1));
    }
    const top = Math.max(0, Math.min(maximum, this.listTops.get(control.id) ?? 0));
    this.listTops.set(control.id, top);
    return { top, page, height, maximum, thumb: Math.min(control.rect.height, Math.max(24, control.rect.height * page / Math.max(1, control.rows.length))) };
  }
  private listPointer(control: Extract<UiControl, { readonly kind: "list" }>): void {
    const layout = this.listLayout(control), travel = control.rect.height - layout.thumb;
    this.listTops.set(control.id, travel <= 0 ? 0 : Math.max(0, Math.min(layout.maximum,
      Math.round((this.cursor.y - control.rect.y - this.listDragOffset) / travel * layout.maximum))));
  }
  private listKey(control: Extract<UiControl, { readonly kind: "list" }>, key: number): boolean {
    if (key === KeyCode.Delete) {
      const row = control.rows.find(row => row.id === control.selected);
      if (row?.enabled) row.action?.activate(this.seat);
      return true;
    }
    const rows = control.rows.filter(row => row.enabled), current = rows.findIndex(row => row.id === control.selected);
    const { page } = this.listLayout(control);
    let index = current;
    if (key === KeyCode.Up) index--; else if (key === KeyCode.Down) index++;
    else if (key === KeyCode.PageUp) index -= page; else if (key === KeyCode.PageDown) index += page;
    else if (key === KeyCode.Home) index = 0; else if (key === KeyCode.End) index = rows.length - 1; else return false;
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row !== undefined) {
      control.select(this.seat, row.id);
      const source = control.rows.findIndex(candidate => candidate.id === row.id), top = this.listTops.get(control.id) ?? 0;
      this.listTops.set(control.id, source < top ? source : source >= top + page ? source - page + 1 : top);
    }
    return true;
  }
  private key(code: number, down: boolean): boolean {
    if (code === KeyCode.Shift) { this.shift = down; return true; }
    if (code === KeyCode.Control) { this.control = down; return true; }
    const active = this.active(); if (active === null) return false;
    const control = active.menu.controls.find(control => control.id === active.cursor.focus);
    if (control?.kind === "owner-draw" && control.key(this.seat, code, down)) return true;
    if (!down) return true;
    if (code === KeyCode.Escape) { this.closeMenu(); return true; }
    if (control !== undefined) this.reveal(active.menu, active.cursor, control);
    if (control?.kind === "text-entry" && this.fieldKey(control, code)) return true;
    if (control?.kind === "list" && this.listKey(control, code)) return true;
    if (code === KeyCode.Tab) this.moveFocus(this.shift ? -1 : 1);
    else if (code === KeyCode.Up || code === KeyCode.KeypadUp) this.moveFocus(-1);
    else if (code === KeyCode.Down || code === KeyCode.KeypadDown) this.moveFocus(1);
    else if (control !== undefined && (code === KeyCode.Left || code === KeyCode.KeypadLeft)) this.change(control, -1);
    else if (control !== undefined && (code === KeyCode.Right || code === KeyCode.KeypadRight)) this.change(control, 1);
    else if (control !== undefined && (code === KeyCode.Enter || code === KeyCode.KeypadEnter || code === KeyCode.Space && control.kind !== "text-entry")) this.activate(control);
    return true;
  }
  private pointer(position: Vec2): void {
    this.pointerPosition = position;
    this.cursor = uiPoint(position, this.transform);
    const active = this.active(); if (active === null) return;
    if (this.menuDragOffset !== null) { this.menuPointer(active.menu, active.cursor); return; }
    const drag = active.menu.controls.find(control => control.id === this.dragging);
    if (drag?.kind === "slider") { this.sliderPointer(drag); return; }
    if (drag?.kind === "list") { this.listPointer(drag); return; }
    const hovered = [...active.menu.controls].reverse().find(control => this.hit(active.menu, control));
    if (hovered !== undefined && hovered.id !== active.cursor.focus) {
      active.cursor.focus = hovered.id; this.focusChanged(); this.options.sound("move", this.seat);
    }
  }
  private sliderPointer(control: Extract<UiControl, { readonly kind: "slider" }>): void {
    const left = control.rect.x + control.rect.width * 0.6, width = control.rect.width * 0.32;
    control.change(this.seat, quantize(control, control.minimum + (control.maximum - control.minimum) * (this.cursor.x - left) / width));
  }
  private captureEvent(event: SeatInputEvent): boolean {
    const capture = this.capture; if (capture === null) return false;
    if (event.kind === "key" && event.down && event.code === KeyCode.Escape) { this.capture = null; capture.cancel(); return true; }
    let input: PhysicalInput | null = null;
    if (event.kind === "key" && event.down && !event.repeat) input = { kind: "key", code: event.code };
    else if (event.kind === "mouse-button" && event.down) input = { kind: "mouse-button", button: event.button };
    else if (event.kind === "mouse-wheel" && event.delta.y !== 0) input = { kind: "key", code: event.delta.y > 0 ? KeyCode.MouseWheelUp : KeyCode.MouseWheelDown };
    else if (event.kind === "controller-button" && event.down) input = { kind: "controller-button", device: event.device, button: event.button };
    else if (event.kind === "controller-axis" && Math.abs(event.value) > 0.65) input = { kind: "controller-axis", device: event.device, axis: event.axis, direction: event.value < 0 ? "negative" : "positive" };
    if (input !== null) { this.capture = null; capture.accept(input); }
    return true;
  }
  input(event: SeatInputEvent): boolean {
    if (!event.seat.equals(this.seat)) throw new Error("UI input delivered to another seat");
    if (event.kind === "focus" && !event.focused) {
      this.dragging = null; this.menuDragOffset = null; this.heldAxes.clear(); this.shift = false; this.control = false;
      this.capture?.cancel(); this.capture = null;
    }
    if (this.captureEvent(event)) return true;
    const active = this.active(); if (active === null) return false;
    switch (event.kind) {
      case "key": return this.key(event.code, event.down);
      case "text": { const control = active.menu.controls.find(control => control.id === active.cursor.focus);
        if (control?.kind === "text-entry") { this.reveal(active.menu, active.cursor, control); this.text(control, event.text); } break; }
      case "mouse-motion": this.pointer(event.position); break;
      case "mouse-button": {
        if (!event.down) { this.dragging = null; this.menuDragOffset = null; break; }
        if (event.button === 3) { this.closeMenu(); break; }
        if (event.button !== 1) break;
        const scroll = active.menu.scroll;
        if (scroll !== undefined && scroll.contentHeight > scroll.rect.height && contains(scroll.rect, this.cursor)
          && this.cursor.x >= scroll.rect.x + scroll.rect.width - 16) {
          const thumb = this.menuThumb(active.menu), y = scroll.rect.y + (scroll.rect.height - thumb) * active.cursor.scroll / (scroll.contentHeight - scroll.rect.height);
          this.menuDragOffset = this.cursor.y >= y && this.cursor.y < y + thumb ? this.cursor.y - y : thumb / 2;
          this.menuPointer(active.menu, active.cursor); break;
        }
        const control = [...active.menu.controls].reverse().find(control => this.hit(active.menu, control));
        if (control === undefined) break;
        active.cursor.focus = control.id; this.focusChanged();
        if (control.kind === "slider") { this.dragging = control.id; this.sliderPointer(control); }
        else if (control.kind === "text-entry") {
          const field = this.field(control), text = Array.from(control.masked === true ? "*".repeat(Array.from(control.text).length) : control.text), x = this.cursor.x - control.rect.x - control.rect.width * 0.5;
          const scale = this.options.skin().fontScale * (this.options.appearance?.().textScale ?? 1);
          const measure = (value: string): number => this.options.measureText?.(value, scale) ?? Array.from(value).length * 8 * scale;
          field.cursor = field.start;
          while (field.cursor < text.length && measure(text.slice(field.start, field.cursor + 1).join("")) < x) field.cursor++;
        }
        else if (control.kind === "list") {
          const layout = this.listLayout(control);
          if (layout.maximum > 0 && this.cursor.x >= control.rect.x + control.rect.width - 16) {
            const thumbY = control.rect.y + (control.rect.height - layout.thumb) * layout.top / layout.maximum;
            this.listDragOffset = this.cursor.y >= thumbY && this.cursor.y < thumbY + layout.thumb ? this.cursor.y - thumbY : layout.thumb / 2;
            this.dragging = control.id; this.listPointer(control);
          } else {
            const row = control.rows[layout.top + Math.floor((this.cursor.y - control.rect.y) / layout.height)];
            if (row?.enabled) {
              control.select(this.seat, row.id);
              if (row.action !== undefined && this.cursor.x >= control.rect.x + control.rect.width - (layout.maximum > 0 ? 16 : 0) - 28) row.action.activate(this.seat);
              else control.activate?.(this.seat, row.id);
            }
          }
        } else this.activate(control);
        break;
      }
      case "mouse-wheel": {
        const scroll = active.menu.scroll;
        if (scroll !== undefined && contains(scroll.rect, this.cursor)) {
          active.cursor.scroll = Math.max(0, Math.min(Math.max(0, scroll.contentHeight - scroll.rect.height), active.cursor.scroll - Math.sign(event.delta.y) * 84));
          break;
        }
        const hovered = active.menu.controls.find(control => enabled(control) && control.kind === "list" && contains(control.rect, this.cursor));
        const control = hovered ?? active.menu.controls.find(control => control.id === active.cursor.focus);
        if (control?.kind === "list") {
          const layout = this.listLayout(control);
          this.listTops.set(control.id, Math.max(0, Math.min(layout.maximum, layout.top - Math.sign(event.delta.y) * 3)));
        } else if (event.delta.y !== 0) this.key(event.delta.y > 0 ? KeyCode.Up : KeyCode.Down, true);
        break;
      }
      case "controller-button": {
        const codes = new Map([[0, KeyCode.Enter], [1, KeyCode.Escape], [6, KeyCode.Escape], [11, KeyCode.Up], [12, KeyCode.Down], [13, KeyCode.Left], [14, KeyCode.Right]]);
        const code = codes.get(event.button); if (code !== undefined) this.key(code, event.down); break;
      }
      case "controller-axis": {
        if (event.axis !== "left-x" && event.axis !== "left-y") break;
        const id = `${event.device}:${event.axis}`;
        if (Math.abs(event.value) < 0.35) { this.heldAxes.delete(id); break; }
        if (Math.abs(event.value) < 0.6) break;
        const code = event.axis === "left-x" ? event.value < 0 ? KeyCode.Left : KeyCode.Right : event.value < 0 ? KeyCode.Up : KeyCode.Down;
        if (this.heldAxes.get(id)?.code !== code) { this.key(code, true); this.heldAxes.set(id, { code, next: event.timeMilliseconds + 300 }); }
        break;
      }
      case "focus": break;
    }
    return true;
  }
  draw(context: UiDrawContext): readonly UiDrawCommand[] {
    if (!context.binding.seat.equals(this.seat)) throw new Error("UI draw delivered to another seat");
    const appearance = this.options.appearance?.() ?? { menuScale: 1, textScale: 1, highContrast: false };
    this.transform = fitUi(context.binding.safeArea, appearance.menuScale);
    if (this.pointerPosition !== null) this.cursor = uiPoint(this.pointerPosition, this.transform);
    for (const held of this.heldAxes.values()) if (context.timeMilliseconds >= held.next) {
      this.key(held.code, true); held.next = context.timeMilliseconds + 80;
    }
    const active = this.active(); if (active === null) return [];
    const originalSkin = this.options.skin();
    const skin = { ...originalSkin, fontScale: originalSkin.fontScale * appearance.textScale,
      colors: appearance.highContrast ? { ...originalSkin.colors, text: white, accent: { x: 1, y: 1, z: 0, w: 1 },
        panel: { x: 0, y: 0, z: 0, w: 1 }, control: { x: 0, y: 0, z: 0, w: 1 }, focused: { x: 0.2, y: 0.2, z: 0.2, w: 1 } } : originalSkin.colors };
    const commands: UiDrawCommand[] = [];
    const text = (value: string, x: number, y: number, color: Vec4, align: "left" | "center" | "right" = "left"): void => {
      commands.push({ kind: "text", origin: { x, y }, text: this.options.localize?.(value) ?? value, font: skin.font,
        scale: skin.fontScale, color, align, shadow: true });
    };
    if (active.menu.fullScreen && skin.background !== null) commands.push({ kind: "image", resource: skin.background,
      rect: { x: 0, y: 0, width: 640, height: 480 }, texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: white });
    const panel = { x: 32, y: 24, width: 576, height: 432 };
    commands.push({ kind: "fill", rect: panel, color: skin.colors.panel });
    if (skin.panel !== null) commands.push(...nineSlice(skin.panel, panel, white));
    if (skin.titleFont === undefined) text(active.menu.title, 320, 48, skin.colors.accent, "center");
    else commands.push({ kind: "text", origin: { x: 64, y: 44 }, text: this.options.localize?.(active.menu.title) ?? active.menu.title,
      font: skin.titleFont, scale: skin.titleScale ?? skin.fontScale, color: skin.colors.accent, align: "left", shadow: true });
    for (const control of active.menu.controls) {
      if (!control.visible) continue;
      const region = active.menu.scroll;
      const scrolled = region !== undefined && region.controls.includes(control.id);
      if (scrolled && (control.rect.y + control.rect.height <= region.rect.y || control.rect.y >= region.rect.y + region.rect.height)) continue;
      commands.push({ kind: "clip", rect: scrolled ? region.rect : null });
      const focused = control.id === active.cursor.focus;
      const color = !control.enabled ? skin.colors.disabled : focused ? skin.colors.accent : skin.colors.text;
      if (control.kind === "owner-draw") { commands.push(...control.draw({ ...context, binding: { ...context.binding,
        viewport: { x: 0, y: 0, width: 640, height: 480 }, safeArea: { x: 0, y: 0, width: 640, height: 480 } } })); continue; }
      const focusedControl = focused && control.kind !== "list";
      const decoration = focusedControl ? skin.focus ?? skin.button : skin.button;
      commands.push({ kind: "fill", rect: { ...control.rect, height: control.rect.height - 2 }, color: focusedControl ? skin.colors.focused : skin.colors.control });
      if (decoration !== null) commands.push(...nineSlice(decoration, control.rect, white));
      if (control.kind === "list") {
        const layout = this.listLayout(control), contentWidth = control.rect.width - (layout.maximum > 0 ? 16 : 0);
        const clip = { ...control.rect, width: contentWidth };
        commands.push({ kind: "clip", rect: clip });
        for (const [index, row] of control.rows.slice(layout.top, layout.top + layout.page).entries()) {
          const y = control.rect.y + index * layout.height;
          if (row.id === control.selected) commands.push({ kind: "fill", rect: { x: control.rect.x, y, width: contentWidth, height: layout.height }, color: skin.colors.focused });
          const rowColor = !row.enabled ? skin.colors.disabled : row.id === control.selected ? skin.colors.accent : skin.colors.text;
          if (control.columnWidths === undefined) text(row.cells.join("  "), control.rect.x + 8, y, rowColor);
          else {
            let x = control.rect.x;
            for (const [column, value] of row.cells.entries()) {
              const width = Math.min(control.columnWidths[column] ?? contentWidth, control.rect.x + contentWidth - (row.action === undefined ? 0 : 28) - x);
              const measured = this.options.measureText?.(value, skin.fontScale) ?? Array.from(value).length * 8 * skin.fontScale;
              const scale = skin.fontScale * Math.min(1, Math.max(1, width - 16) / Math.max(1, measured));
              commands.push({ kind: "text", origin: { x: x + 8, y: y + (layout.height - 8 * scale) / 2 }, text: value,
                font: skin.font, scale, color: rowColor, align: "left", shadow: true });
              x += width;
            }
          }
          if (row.action !== undefined) text(row.action.label, control.rect.x + contentWidth - 14, y + (layout.height - 8 * skin.fontScale) / 2, rowColor, "center");
        }
        commands.push({ kind: "clip", rect: null });
        if (layout.maximum > 0) {
          const x = control.rect.x + control.rect.width - 14;
          commands.push({ kind: "fill", rect: { x, y: control.rect.y, width: 12, height: control.rect.height }, color: skin.colors.control });
          commands.push({ kind: "fill", rect: { x, y: control.rect.y + (control.rect.height - layout.thumb) * layout.top / layout.maximum, width: 12, height: layout.thumb }, color: focused ? skin.colors.accent : skin.colors.disabled });
        }
        continue;
      }
      if (control.kind !== "slider") text(control.label, control.rect.x + 10, control.rect.y + 6, color);
      const right = control.rect.x + control.rect.width - 10, y = control.rect.y + 6;
      switch (control.kind) {
        case "button": break;
        case "toggle": text(control.checked ? "On" : "Off", right, y, color, "right"); break;
        case "choice": text(control.choices.find(choice => choice.id === control.selected)?.label ?? "", right, y, color, "right"); break;
        case "slider": {
          const x = control.rect.x + control.rect.width * 0.6, width = control.rect.width * 0.32;
          const value = control.valueLabel ?? String(Number(control.value.toFixed(6)));
          const valueRight = x - 12;
          const measure = (content: string): number => this.options.measureText?.(content, skin.fontScale) ?? Array.from(content).length * 8 * skin.fontScale;
          const valueScale = skin.fontScale * Math.min(1, control.rect.width * 0.16 / Math.max(1, measure(value)));
          const labelWidth = valueRight - measure(value) * valueScale / skin.fontScale - 12 - (control.rect.x + 10);
          const labelScale = skin.fontScale * Math.min(1, Math.max(1, labelWidth) / Math.max(1, measure(control.label)));
          commands.push({ kind: "text", origin: { x: control.rect.x + 10, y }, text: control.label, font: skin.font, scale: labelScale, color, align: "left", shadow: true });
          commands.push({ kind: "text", origin: { x: valueRight, y }, text: value, font: skin.font, scale: valueScale, color, align: "right", shadow: true });
          const ratio = control.maximum === control.minimum ? 0 : Math.max(0, Math.min(1, (control.value - control.minimum) / (control.maximum - control.minimum)));
          commands.push({ kind: "fill", rect: { x, y: y + 7, width, height: 2 }, color: skin.colors.disabled });
          commands.push({ kind: "fill", rect: { x: x + width * ratio - 3, y: y + 2, width: 6, height: 12 }, color }); break;
        }
        case "text-entry": {
          const field = this.field(control), all = Array.from(control.masked === true ? "*".repeat(Array.from(control.text).length) : control.text), available = control.rect.width * 0.5 - 12;
          const measure = (value: string): number => this.options.measureText?.(value, skin.fontScale) ?? Array.from(value).length * 8 * skin.fontScale;
          let start = Math.min(field.start, field.cursor), end = field.cursor;
          while (start < field.cursor && measure(all.slice(start, field.cursor).join("")) > available) start++;
          while (end < all.length && measure(all.slice(start, end + 1).join("")) <= available) end++;
          field.start = start;
          const shown = all.slice(start, end).join("");
          const x = control.rect.x + control.rect.width * 0.5;
          text(shown, x, y, color);
          if (focused && Math.floor(context.timeMilliseconds / 256) % 2 === 0) text(field.overstrike ? "_" : "|", x + measure(all.slice(start, field.cursor).join("")), y, color);
          break;
        }
      }
    }
    commands.push({ kind: "clip", rect: null });
    const region = active.menu.scroll;
    if (region !== undefined && region.contentHeight > region.rect.height) {
      const thumb = this.menuThumb(active.menu), x = region.rect.x + region.rect.width - 14;
      commands.push({ kind: "fill", rect: { x, y: region.rect.y, width: 12, height: region.rect.height }, color: skin.colors.control });
      commands.push({ kind: "fill", rect: { x, y: region.rect.y + (region.rect.height - thumb) * active.cursor.scroll / (region.contentHeight - region.rect.height), width: 12, height: thumb }, color: skin.colors.accent });
    }
    if (this.capture !== null) text("Press key/button. Esc cancels.", 380, 432, skin.colors.accent, "center");
    const result: UiDrawCommand[] = [{ kind: "clip", rect: context.binding.safeArea }];
    for (const command of commands) {
      const transformed = transformUi(command, this.transform);
      result.push(transformed.kind === "clip" ? { kind: "clip", rect: transformed.rect === null ? context.binding.safeArea : intersect(context.binding.safeArea, transformed.rect) } : transformed);
    }
    result.push({ kind: "clip", rect: null }); return result;
  }
}
