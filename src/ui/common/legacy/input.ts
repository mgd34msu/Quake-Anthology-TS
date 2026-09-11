import type { SeatId } from "../../../contracts/identity.ts";
import type { Vec2 } from "../../../contracts/math.ts";
import type { SeatInputEvent } from "../../../contracts/ui.ts";
import { KeyCode } from "../../../input/key-codes.ts";
import type { Draw2D } from "../../../text/draw2d.ts";
import type { UiRuntime } from "./runtime.ts";

function mouseKey(button: number): number | undefined {
  switch (button) {
    case 1: return KeyCode.Mouse1;
    case 2: return KeyCode.Mouse3;
    case 3: return KeyCode.Mouse2;
    case 4: return KeyCode.Mouse4;
    case 5: return KeyCode.Mouse5;
    default: return undefined;
  }
}

function controllerKey(button: number): number | undefined {
  switch (button) {
    case 0: return KeyCode.Enter;
    case 1: case 6: return KeyCode.Escape;
    case 11: return KeyCode.Up;
    case 12: return KeyCode.Down;
    case 13: return KeyCode.Left;
    case 14: return KeyCode.Right;
    default: return button >= 0 && button < 32 ? KeyCode.Joy1 + button : undefined;
  }
}

/** One adapter and source runtime belong to one local seat and loaded UI module. */
export class LegacyUiSeat {
  private pointer: Vec2 = { x: 320, y: 240 };
  private readonly held = new Map<string, number>();
  private pending: SeatInputEvent[] = [];
  private focused = true;
  private closed = false;

  constructor(readonly seat: SeatId, readonly runtime: UiRuntime) {}

  get cursor(): Vec2 { return this.pointer; }

  /** Synchronous SeatInput.uiEvent entry; drain the accepted batch before its frame. */
  route(event: SeatInputEvent): boolean {
    if (this.closed) throw new Error("Legacy UI seat is closed");
    if (!event.seat.equals(this.seat)) return false;
    this.pending.push(event);
    return event.kind !== "focus";
  }

  async drain(draw: Draw2D): Promise<void> {
    if (this.closed) throw new Error("Legacy UI seat is closed");
    const pending = this.pending;
    this.pending = [];
    for (const event of pending) await this.input(event, draw);
  }

  private async key(physical: string, code: number | undefined, down: boolean): Promise<boolean> {
    if (code === undefined) return false;
    if (down) this.held.set(physical, code);
    else this.held.delete(physical);
    return this.runtime.handleKey({ kind: "key", code, down }, this.pointer.x, this.pointer.y);
  }

  /** Await input before painting so source actions finish in SDL delivery order. */
  async input(event: SeatInputEvent, draw: Draw2D): Promise<boolean> {
    if (this.closed) throw new Error("Legacy UI seat is closed");
    if (!event.seat.equals(this.seat)) return false;
    if (!draw.commands.seat.equals(this.seat)) throw new Error("Legacy UI drawing belongs to another seat");
    this.runtime.setDisplayTime(event.timeMilliseconds | 0);
    if (event.kind === "focus") {
      this.focused = event.focused;
      if (!event.focused) {
        for (const code of this.held.values()) await this.runtime.handleKey({ kind: "key", code, down: false }, this.pointer.x, this.pointer.y);
        this.held.clear();
      }
      return false;
    }
    if (!this.focused) return false;
    switch (event.kind) {
      case "key": return this.key(`key:${event.code}`, event.code, event.down);
      case "text": {
        let consumed = false;
        for (const character of event.text) {
          const code = character.codePointAt(0);
          if (code !== undefined && code <= 255) {
            consumed = await this.runtime.handleKey({ kind: "character", code }, this.pointer.x, this.pointer.y) || consumed;
          }
        }
        return consumed;
      }
      case "mouse-motion": {
        const target = draw.commands.target;
        this.pointer = {
          x: Math.fround(Math.max(0, Math.min(640, (event.position.x - target.x - draw.biasX) / draw.scaleX))),
          y: Math.fround(Math.max(0, Math.min(480, (event.position.y - target.y) / draw.scaleY))),
        };
        this.runtime.setDisplayCursor(this.pointer.x, this.pointer.y);
        return this.runtime.pointerMove(this.pointer.x, this.pointer.y);
      }
      case "mouse-button": return this.key(`mouse:${event.button}`, mouseKey(event.button), event.down);
      case "mouse-wheel": {
        let consumed = false;
        const code = event.delta.y > 0 ? KeyCode.MouseWheelUp : KeyCode.MouseWheelDown;
        for (let count = 0; count < Math.abs(event.delta.y); count++) {
          consumed = await this.key("wheel", code, true) || consumed;
          await this.key("wheel", code, false);
        }
        return consumed;
      }
      case "controller-button": return this.key(`controller:${event.device}:${event.button}`, controllerKey(event.button), event.down);
      case "controller-axis": {
        if (event.axis !== "left-x" && event.axis !== "left-y") return false;
        const physical = `axis:${event.device}:${event.axis}`;
        const previous = this.held.get(physical);
        const current = Math.abs(event.value) < 0.5 ? undefined : event.axis === "left-x"
          ? event.value < 0 ? KeyCode.Left : KeyCode.Right
          : event.value < 0 ? KeyCode.Up : KeyCode.Down;
        if (current === previous) return current !== undefined;
        let consumed = false;
        if (previous !== undefined) consumed = await this.key(physical, previous, false);
        if (current !== undefined) consumed = await this.key(physical, current, true) || consumed;
        return consumed;
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = [];
    this.held.clear();
    this.runtime.dispose();
  }
}
