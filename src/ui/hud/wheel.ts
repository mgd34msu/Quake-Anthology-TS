// SPDX-License-Identifier: GPL-2.0-or-later
// Weapon/powerup wheel and carousel state adapted from q2repro client/wheel.c.
import type { ResourceId } from "../../contracts/content.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { Vec2 } from "../../contracts/math.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";

export interface WheelItem {
  readonly id: string;
  readonly sourceOrdinal: number;
  readonly sortOrder: number;
  readonly label: string;
  readonly owned: boolean;
  readonly hasAmmo: boolean;
  readonly count: number | null;
  readonly warningCount: number;
  readonly icon: ResourceId | null;
  readonly selectedIcon: ResourceId | null;
}
export type WheelMode = "weapons" | "powerups";
export interface WheelPresentation {
  readonly mode: WheelMode;
  readonly items: readonly WheelItem[];
  readonly selected: string | null;
  readonly opacity: number;
  readonly cursor: Vec2;
}
export interface CarouselPresentation { readonly items: readonly WheelItem[]; readonly selected: string | null; }
export interface WeaponWheelServices {
  readonly seat: SeatId;
  readonly items: (mode: WheelMode) => readonly WheelItem[];
  readonly activeItem: () => string | null;
  readonly select: (id: string, mode: WheelMode, seat: SeatId) => void;
  readonly now: () => number;
  readonly changed: (seat: SeatId) => void;
}
export interface WheelOptions {
  readonly radius: number;
  readonly selectionDistance: number;
  readonly fadePerSecond: number;
  readonly carouselTimeout: number;
  readonly carouselLock: number;
  /** Retains q2repro's slot-zero deselection quirk for its source profile. */
  readonly q2SlotZeroDeselect: boolean;
}
const defaults: WheelOptions = { radius: 180, selectionDistance: 140, fadePerSecond: 3, carouselTimeout: 400, carouselLock: 300, q2SlotZeroDeselect: true };
type WheelState = { readonly kind: "closed" } | { readonly kind: "closing"; readonly mode: WheelMode } | { readonly kind: "open"; readonly mode: WheelMode };
type CarouselState = { readonly kind: "closed" } | { readonly kind: "open"; readonly until: number } | { readonly kind: "closing"; readonly until: number };

export class SeatWeaponWheel {
  private state: WheelState = { kind: "closed" };
  private carousel: CarouselState = { kind: "closed" };
  private mode: WheelMode = "weapons";
  private selected: string | null = null;
  private carouselSelected: string | null = null;
  private position: Vec2 = { x: 0, y: 0 };
  private analog: Vec2 = { x: 0, y: 0 };
  private deselectTime = 0;
  private opacity = 0;
  private lastUpdate: number;
  private lockUntil = 0;
  constructor(private readonly services: WeaponWheelServices, readonly options: WheelOptions = defaults) {
    if (options.radius <= 0 || options.selectionDistance < 0 || options.selectionDistance >= options.radius) throw new RangeError("Wheel radius must exceed selection distance");
    this.lastUpdate = services.now();
  }
  get seat(): SeatId { return this.services.seat; }
  get isOpen(): boolean { return this.state.kind === "open"; }
  get timeScale(): number { return Math.max(0.1, 1 - this.opacity); }
  get weaponLockUntil(): number { return this.lockUntil; }
  get holster(): boolean { return this.state.kind !== "closed" && this.mode === "weapons" || this.carousel.kind === "open"; }
  private items(mode: WheelMode): readonly WheelItem[] {
    return [...this.services.items(mode)].sort((a, b) => a.sortOrder - b.sortOrder || a.sourceOrdinal - b.sourceOrdinal);
  }
  open(mode: WheelMode): boolean {
    if (this.items(mode).length === 0) return false;
    this.mode = mode; this.state = { kind: "open", mode }; this.selected = null; this.deselectTime = 0;
    this.position = { x: 0, y: 0 }; this.analog = { x: 0, y: 0 }; this.services.changed(this.seat); return true;
  }
  close(select: boolean): void {
    if (this.state.kind !== "open") return;
    this.state = { kind: "closing", mode: this.mode };
    const selected = this.items(this.mode).find(item => item.id === this.selected);
    if (select && selected?.owned) this.services.select(selected.id, this.mode, this.seat);
    this.services.changed(this.seat);
  }
  clearInput(): void {
    if (this.state.kind === "closing") this.state = { kind: "closed" };
  }
  input(event: SeatInputEvent): boolean {
    if (!event.seat.equals(this.seat)) throw new Error("Weapon wheel input belongs to another seat");
    if (this.state.kind === "closed") return false;
    if (event.kind === "focus" && !event.focused) { this.close(false); this.clearInput(); return true; }
    if (this.state.kind !== "open") return true;
    if (event.kind === "mouse-motion") this.move({ x: this.position.x + event.delta.x, y: this.position.y + event.delta.y });
    else if (event.kind === "controller-axis" && (event.axis === "right-x" || event.axis === "right-y")) {
      this.analog = event.axis === "right-x" ? { ...this.analog, x: event.value } : { ...this.analog, y: event.value };
      this.move({ x: this.analog.x * this.options.radius, y: this.analog.y * this.options.radius });
    }
    return event.kind === "mouse-motion" || event.kind === "controller-axis";
  }
  private move(position: Vec2): void {
    const distance = Math.hypot(position.x, position.y), factor = distance > this.options.radius ? this.options.radius / distance : 1;
    this.position = { x: position.x * factor, y: position.y * factor };
  }
  cycle(direction: -1 | 1): void {
    const items = this.items("weapons").filter(item => item.owned);
    if (items.length === 0) { this.carousel = { kind: "closed" }; return; }
    if (this.carousel.kind !== "open") this.carouselSelected = this.services.activeItem();
    let start = items.findIndex(item => item.id === this.carouselSelected);
    if (start < 0) start = direction > 0 ? -1 : 0;
    for (let offset = 1; offset <= items.length; offset++) {
      const candidate = items[(start + offset * direction + items.length) % items.length];
      if (candidate?.hasAmmo) { this.carouselSelected = candidate.id; break; }
    }
    this.carousel = { kind: "open", until: this.services.now() + this.options.carouselTimeout }; this.services.changed(this.seat);
  }
  /** Called once for the seat's command, before its provider encodes source button bits. */
  command(attack: boolean, nowMilliseconds: number): { readonly holster: boolean; readonly consumeAttack: boolean } {
    if (this.carousel.kind === "closing" && nowMilliseconds >= this.carousel.until) this.carousel = { kind: "closed" };
    const selecting = this.carousel.kind === "open";
    if (this.carousel.kind === "open" && (attack || nowMilliseconds >= this.carousel.until)) {
      const selected = this.items("weapons").find(item => item.id === this.carouselSelected && item.owned && item.hasAmmo);
      if (selected !== undefined && selected.id !== this.services.activeItem()) {
        this.services.select(selected.id, "weapons", this.seat); this.lockUntil = nowMilliseconds + this.options.carouselLock;
        this.carousel = { kind: "closing", until: this.lockUntil };
      } else this.carousel = { kind: "closed" };
    }
    return { holster: this.holster || selecting, consumeAttack: attack && selecting };
  }
  update(nowMilliseconds = this.services.now()): void {
    const elapsed = Math.max(0, nowMilliseconds - this.lastUpdate) / 1000; this.lastUpdate = nowMilliseconds;
    this.opacity = Math.max(0, Math.min(1, this.opacity + elapsed * this.options.fadePerSecond * (this.isOpen ? 1 : -1)));
    if (!this.isOpen) return;
    const items = this.items(this.mode), distance = Math.hypot(this.position.x, this.position.y), slice = Math.PI * 2 / items.length;
    if (items.length === 0) { this.close(false); return; }
    const prior = this.selected;
    if (distance > this.options.selectionDistance) {
      for (const [index, item] of items.entries()) if (item.owned) {
        const angle = slice * index, dot = this.position.x / distance * Math.sin(angle) - this.position.y / distance * Math.cos(angle);
        if (dot > Math.cos(slice / 2)) { this.selected = item.id; this.deselectTime = 0; }
      }
    } else {
      const selectedIndex = items.findIndex(item => item.id === this.selected);
      if ((this.options.q2SlotZeroDeselect ? selectedIndex !== 0 : selectedIndex >= 0) && this.deselectTime === 0) this.deselectTime = nowMilliseconds + 200;
    }
    if (this.deselectTime !== 0 && this.deselectTime < nowMilliseconds) { this.selected = null; this.deselectTime = 0; }
    if (prior !== this.selected) this.services.changed(this.seat);
  }
  drawState(): { readonly wheel: WheelPresentation | null; readonly carousel: CarouselPresentation | null } {
    return { wheel: this.opacity > 0 || this.isOpen ? { mode: this.mode, items: this.items(this.mode), selected: this.selected, opacity: this.opacity,
      cursor: { x: this.position.x / this.options.radius, y: this.position.y / this.options.radius } } : null,
      carousel: this.carousel.kind === "open" ? { items: this.items("weapons").filter(item => item.owned), selected: this.carouselSelected } : null };
  }
}
