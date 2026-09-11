import type { ActorId } from "../../contracts/identity.ts";
import type { UiControl } from "../../contracts/ui.ts";
import type { Q2CompositionEvent } from "../../content/composition/q2/types.ts";
import type { HudPrompt } from "../../ui/hud/index.ts";
import { menuRow, type NativeUiController } from "../../ui/common/index.ts";

/** Match events share the seat's menus, focus and HUD. */
export class Q2MatchUi {
  prompts: readonly HudPrompt[] = [];
  private readonly names = new Map<ActorId, string>();
  name(actor: ActorId, name: string): void { this.names.set(actor, name); }
  private disposeMenu: (() => void) | null = null;
  constructor(private readonly actor: ActorId, private readonly controller: NativeUiController,
    private readonly command: (name: string, args: readonly string[]) => undefined,
    private readonly print: (text: string) => void) {}

  private menu(title: string, entries: readonly { readonly label: string; readonly command: readonly string[] | null }[]): void {
    this.controller.closeAll(); this.disposeMenu?.();
    const id = "menu:application:match";
    this.disposeMenu = this.controller.register(id, () => ({ id, title, fullScreen: true,
      controls: entries.map((entry, index): UiControl => ({ id: `ui:match:${index}`, kind: "button", label: entry.label,
        rect: menuRow(index + 1), enabled: entry.command !== null, visible: true,
        activate: () => { this.controller.closeAll(); const [name, ...args] = entry.command ?? []; return name === undefined ? undefined : this.command(name, args); } })),
      open: () => undefined, close: () => undefined }));
    this.controller.openMenu(id);
  }

  receive(source: Extract<Q2CompositionEvent, { readonly kind: "ctf" | "lmctf" }>): void {
    const event = source.event;
    if ("actor" in event && !event.actor.equals(this.actor)) return;
    switch (event.kind) {
      case "grapple-cable": return;
      case "match-status": this.print(event.text); return;
      case "score-log": this.print(`${event.name}: ${event.amount > 0 ? "+" : ""}${event.amount}\n`); return;
      case "hud": {
        const team = event.team === 1 ? "Red" : event.team === 2 ? "Blue" : "Spectator";
        const values = [team];
        if ("captures" in event) {
          values.push(`Red ${event.captures[0]} (${event.flagStates[0]})`, `Blue ${event.captures[1]} (${event.flagStates[1]})`);
          if (event.tech !== null) values.push(({ item_tech1: "Disruptor Shield", item_tech2: "Power Amplifier", item_tech3: "Time Accel", item_tech4: "AutoDoc" })[event.tech]);
          if (event.match !== "") values.push(event.match);
          if (event.idTarget !== null) { const name = this.names.get(event.idTarget); if (name !== undefined) values.push(name); }
          if (event.blinkTeam !== null) values.push(`${event.blinkTeam === 1 ? "Red" : "Blue"} captured the flag`);
        } else if (event.rune !== null) values.push(`${event.rune} artifact`);
        if (event.carriedFlag) values.push("Carrying flag");
        this.prompts = values.map(action => ({ action, binding: "", icon: null })); return;
      }
      case "scoreboard": {
        const rows = "rows" in event ? event.rows : [...event.red, ...event.blue, ...event.spectators];
        const title = "captures" in event ? `Red ${event.captures[0]} - Blue ${event.captures[1]}` : "Scores";
        this.menu(title, [...rows.map(row => ({ label: `${row.name}   ${row.score}   ${row.ping} ms`, command: null })), { label: "Close", command: ["score"] }]); return;
      }
      case "menu":
        this.menu(event.title, event.entries.map(entry => ({ label: entry.label,
          command: "action" in entry ? entry.action === null ? null : ["ctf-menu", entry.action]
            : entry.command === null ? null : entry.command.split(/\s+/u) }))); return;
      case "admin-settings": {
        this.controller.closeAll(); this.disposeMenu?.();
        const id = "menu:application:match";
        this.disposeMenu = this.controller.register(id, () => ({ id, title: "Match settings", fullScreen: true,
          controls: [...Object.entries({ ...event.settings }).map(([key, value], index): UiControl => {
            const label = key.replace(/([A-Z])/gu, " $1"), base = { id: `ui:match:${key}`, label: label.charAt(0).toUpperCase() + label.slice(1),
              rect: menuRow(index + 1), enabled: true, visible: true } satisfies Pick<UiControl, "id" | "label" | "rect" | "enabled" | "visible">;
            return typeof value === "boolean" ? { ...base, kind: "toggle", checked: value,
              change: (_seat, checked) => this.command("ctf-settings", [key, String(checked)]) }
              : { ...base, kind: "text-entry", text: String(value), maximumLength: 8, change: () => undefined,
                submit: (_seat, text) => this.command("ctf-settings", [key, text]) };
          }), { id: "ui:match:close", label: "Close", rect: menuRow(10), enabled: true, visible: true, kind: "button",
            activate: () => { this.controller.closeAll(); return undefined; } }], open: () => undefined, close: () => undefined }));
        this.controller.openMenu(id); return;
      }
      default: { const exhaustive: never = event; throw new Error(`Unknown match UI event: ${String(exhaustive)}`); }
    }
  }
  close(): void { this.disposeMenu?.(); this.disposeMenu = null; }
}
