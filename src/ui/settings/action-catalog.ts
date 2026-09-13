import type { CommandDialect } from "../../contracts/common.ts";
import type { BindingAction } from "./bindings.ts";

export interface BindingCapabilities {
  readonly chat: boolean;
  readonly scoreCommand: "score" | "+scores" | null;
  readonly offhandGrapple: boolean;
  readonly offhandGrenades: boolean;
}
export interface BindableItem { readonly id: string; readonly label: string; readonly kind: "weapon" | "powerup"; }

/** Movement syntax follows movement; item selection follows the selected arsenal. */
export function sharedBindingActions(dialect: CommandDialect, items: readonly BindableItem[], capabilities: BindingCapabilities): readonly BindingAction[] {
  const rows: readonly (readonly [string, string, string])[] = [
    ["forward", "Move forward", "+forward"], ["back", "Move back", "+back"],
    ["left", "Strafe left", "+moveleft"], ["right", "Strafe right", "+moveright"],
    ["jump", "Jump / swim up", dialect.startsWith("q1") ? "+jump" : "+moveup"],
    ["down", "Crouch / swim down", "+movedown"], ["walk", "Walk / run modifier", "+speed"],
    ["turn-left", "Turn left", "+left"], ["turn-right", "Turn right", "+right"],
    ["look-up", "Look up", "+lookup"], ["look-down", "Look down", "+lookdown"],
    ["attack", "Fire primary weapon", "+attack"], ["use", "Use / activate", "+use"],
    ["next-weapon", "Next weapon", "weapnext"], ["previous-weapon", "Previous weapon", "weapprev"],
    ["weapon-wheel", "Weapon wheel", "+weaponwheel"], ["powerup-wheel", "Powerup wheel", "+powerupwheel"],
    ["console", "Toggle console", "toggleconsole"],
  ];
  const actions: BindingAction[] = rows.map(([id, label, text]) => ({ id, label, target: { kind: "command", text } }));
  const append = (id: string, label: string, text: string): void => { actions.push({ id, label, target: { kind: "command", text } }); };
  if (capabilities.scoreCommand !== null) append("scores", "Show scores", capabilities.scoreCommand);
  if (capabilities.chat) { append("chat", "Chat", "messagemode"); append("team-chat", "Team chat", "messagemode2"); }
  if (capabilities.offhandGrapple) append("grapple", "Offhand grapple (hold)", "+grapple");
  if (capabilities.offhandGrenades) append("grenade", "Cook / throw offhand grenade", "+grenade");
  for (const item of items) append(`item:${item.id}`, `${item.kind === "weapon" ? "Select" : "Use"} ${item.label}`, `use ${item.id}`);
  return actions;
}
