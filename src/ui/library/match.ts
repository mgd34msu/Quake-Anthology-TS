import type { UiControl, UiControlId } from "../../contracts/ui.ts";
import type { NativeUiController } from "../common/controller.ts";

/** Commands go through the seat's existing source dispatcher and permission checks. */
export function registerMatchMenu(controller: NativeUiController, command: (name: string, args: readonly string[]) => undefined): { readonly root: "menu:application:match"; dispose(): void } {
  let target = "", team = "red", vote = "map_restart", bot = "sarge", skill = "3";
  const root = "menu:application:match";
  const button = (id: string, label: string, row: number, action: () => void, enabled = true): UiControl => ({ id: `ui:match:${id}`, label,
    kind: "button", rect: { x: 64, y: 96 + row * 34, width: 496, height: 30 }, enabled, visible: true, activate: () => { action(); return undefined; } });
  const dispose = controller.register(root, () => ({ id: root, title: "Match controls", fullScreen: true,
    scroll: { rect: { x: 64, y: 92, width: 512, height: 306 }, contentHeight: 442, controls: ["team", "join", "target", "follow", "vote", "callvote", "yes", "no", "bot", "skill", "addbot", "removebot"].map((id): UiControlId => `ui:match:${id}`) },
    controls: [
      { id: "ui:match:team", kind: "choice", label: "Team", selected: team, choices: [{ id: "red", label: "Red" }, { id: "blue", label: "Blue" }, { id: "free", label: "Free for all" }, { id: "spectator", label: "Spectator" }],
        rect: { x: 64, y: 96, width: 496, height: 30 }, enabled: true, visible: true, select: (_seat, value) => { team = value; return undefined; } },
      button("join", "Join team", 1, () => command("team", [team])),
      { id: "ui:match:target", kind: "text-entry", label: "Player or map", text: target, maximumLength: 64, rect: { x: 64, y: 164, width: 496, height: 30 }, enabled: true, visible: true, change: (_seat, value) => { target = value; return undefined; }, submit: (_seat, value) => { target = value; return undefined; } },
      button("follow", "Follow player", 3, () => command("follow", [target]), target.trim() !== ""),
      { id: "ui:match:vote", kind: "choice", label: "Vote", selected: vote, choices: [{ id: "map_restart", label: "Restart map" }, { id: "nextmap", label: "Next map" }, { id: "map", label: "Change map" }, { id: "kick", label: "Kick player" }],
        rect: { x: 64, y: 232, width: 496, height: 30 }, enabled: true, visible: true, select: (_seat, value) => { vote = value; return undefined; } },
      button("callvote", "Call vote", 5, () => command("callvote", vote === "map" || vote === "kick" ? [vote, target] : [vote]), vote !== "map" && vote !== "kick" || target.trim() !== ""),
      button("yes", "Vote yes", 6, () => command("vote", ["yes"])), button("no", "Vote no", 7, () => command("vote", ["no"])),
      { id: "ui:match:bot", kind: "text-entry", label: "Bot name", text: bot, maximumLength: 64, rect: { x: 64, y: 368, width: 496, height: 30 }, enabled: true, visible: true, change: (_seat, value) => { bot = value; return undefined; }, submit: (_seat, value) => { bot = value; return undefined; } },
      { id: "ui:match:skill", kind: "choice", label: "Bot difficulty", selected: skill, choices: ["1", "2", "3", "4", "5"].map(id => ({ id, label: id })),
        rect: { x: 64, y: 402, width: 496, height: 30 }, enabled: true, visible: true, select: (_seat, value) => { skill = value; return undefined; } },
      button("addbot", "Add bot", 10, () => command("addbot", [bot, skill, team]), bot.trim() !== ""),
      button("removebot", "Remove named bot", 11, () => command("kick", [bot]), bot.trim() !== ""),
      button("back", "Back", 10, () => controller.closeMenu()),
    ], open: () => undefined, close: () => undefined }));
  return { root, dispose };
}
