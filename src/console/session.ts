import type { CommandContext, CommandDialect } from "../contracts/common.ts";
import type { SeatId } from "../contracts/identity.ts";
import type { SeatInputEvent, SeatInputFocus } from "../contracts/ui.ts";
import { type CommandBuffer, tokenizeCommand } from "../core/commands/index.ts";
import type { CvarRegistry } from "../core/cvars/index.ts";
import { KeyCode } from "../input/key-codes.ts";
import { ConsoleBuffer } from "./buffer.ts";
import { queryConsoleEntries, type ConsoleDiscoveryEntry } from "./discovery.ts";
import { ConsoleField, ConsoleHistory } from "./field.ts";

export interface SeatConsoleOptions {
  readonly seat: SeatId;
  readonly dialect: CommandDialect;
  readonly context: CommandContext;
  readonly commands: CommandBuffer;
  readonly cvars: CvarRegistry;
  readonly now: () => number;
  readonly connected: () => boolean;
  readonly clipboard: () => string | null;
  readonly focus: (focus: SeatInputFocus) => void;
  readonly chat: (text: string, team: boolean, target: number | null) => void;
}
export class SeatConsole {
  readonly field = new ConsoleField();
  readonly chatField = new ConsoleField(1023, 30);
  readonly history = new ConsoleHistory();
  readonly buffer: ConsoleBuffer;
  private readonly keys = new Set<number>();
  private chatTarget: number | null = null;
  private fraction = 0;
  private opened = false;
  private suppressToggleText = false;
  constructor(private readonly options: SeatConsoleOptions) {
    if (options.context.session !== options.seat.session) throw new Error("Console belongs to another session");
    this.buffer = new ConsoleBuffer(options.dialect);
  }
  get selectedCompletionEntry(): ConsoleDiscoveryEntry | undefined {
    const selected = this.field.selectedCompletion;
    return selected === null ? undefined : queryConsoleEntries(this.options.commands, this.options.context).find(entry => entry.name === selected);
  }
  print(text: string): void { this.buffer.print(text, this.options.now()); }
  open(): void { this.opened = true; this.field.clear(); this.buffer.clearNotify(); this.options.focus({ kind: "console" }); }
  close(): void { this.opened = false; this.field.clear(); this.buffer.clearNotify(); this.options.focus({ kind: "game" }); }
  toggle(): void { if (this.opened) this.close(); else this.open(); }
  toggleFromKey(repeat: boolean): void {
    this.suppressToggleText = true;
    if (!repeat) this.toggle();
  }
  message(team: boolean, target: number | null = null): void {
    this.chatField.clear(); this.chatTarget = target;
    this.options.focus({ kind: "chat", team, text: "" });
  }
  animate(open: boolean, elapsedMilliseconds: number, speed = 3, targetFraction = 0.5): number {
    const target = open ? targetFraction : 0, step = speed * elapsedMilliseconds / 1000;
    this.fraction = this.fraction < target ? Math.min(target, this.fraction + step) : Math.max(target, this.fraction - step);
    return this.fraction;
  }
  submit(): void {
    const text = this.field.text;
    if (text === "") return;
    this.print(`]${text}\n`);
    const commandText = text.trimStart(), explicit = commandText.startsWith("/") || commandText.startsWith("\\");
    const first = tokenizeCommand(explicit ? commandText.slice(1) : commandText, this.options.dialect).argv[0] ?? "";
    const known = queryConsoleEntries(this.options.commands, this.options.context).some(entry => entry.name.toLowerCase() === first.toLowerCase());
    const chat = this.options.connected() && (this.options.dialect === "q1-quakeworld" || this.options.dialect === "q3");
    if (!explicit && !known && chat) this.options.chat(text, false, null);
    else this.options.commands.append(`${explicit ? commandText.slice(1) : commandText}\n`, this.options.context);
    this.history.add(text); this.field.clear(); this.buffer.bottom();
  }
  input(event: SeatInputEvent, focus: SeatInputFocus): boolean {
    if (!event.seat.equals(this.options.seat)) throw new Error("Console event belongs to another seat");
    if (event.kind === "focus") { if (!event.focused) { this.keys.clear(); this.suppressToggleText = false; } return true; }
    if (event.kind === "text" && this.suppressToggleText) {
      this.suppressToggleText = false;
      if (event.text === "`" || event.text === "~") return true;
    }
    if (event.kind === "key" && event.down && event.code !== 96 && event.code !== 126) this.suppressToggleText = false;
    if (focus.kind !== "console" && focus.kind !== "chat") return false;
    const field = focus.kind === "chat" ? this.chatField : this.field;
    if (event.kind === "text") { field.insert(event.text); return true; }
    if (event.kind === "mouse-wheel") { this.buffer.scroll(event.delta.y * (this.keys.has(KeyCode.Control) ? 6 : 2)); return true; }
    if (event.kind !== "key") return false;
    if (event.down) this.keys.add(event.code); else { this.keys.delete(event.code); return true; }
    const code = event.code, control = this.keys.has(KeyCode.Control), shift = this.keys.has(KeyCode.Shift);
    if (code === 96 || code === 126) { this.toggleFromKey(event.repeat); return true; }
    if (code === KeyCode.Escape) { this.close(); return true; }
    if (code === KeyCode.Enter || code === KeyCode.KeypadEnter) {
      if (focus.kind === "chat") {
        if (field.text !== "") this.options.chat(field.text, focus.team, this.chatTarget);
        field.clear(); this.options.focus({ kind: "game" });
      } else this.submit();
      return true;
    }
    if (focus.kind === "console") {
      if (code === KeyCode.Tab) {
        field.complete(queryConsoleEntries(this.options.commands, this.options.context).map(entry => entry.name), shift);
        return true;
      }
      if (code === KeyCode.Up || code === KeyCode.KeypadUp || control && code === 112) { field.setText(this.history.previous(field.text)); return true; }
      if (code === KeyCode.Down || code === KeyCode.KeypadDown || control && code === 110) { field.setText(this.history.next()); return true; }
      if (code === KeyCode.PageUp || code === KeyCode.PageDown) { this.buffer.scroll(code === KeyCode.PageUp ? 2 : -2); return true; }
      if (control && code === KeyCode.Home) { this.buffer.top(); return true; }
      if (control && code === KeyCode.End) { this.buffer.bottom(); return true; }
    }
    return field.key(code, control, shift, this.options.clipboard);
  }
}
