import type { GameFamily } from "../../../contracts/content.ts";
import type { UiSound } from "../../../ui/common/controller.ts";

export function menuSoundPath(family: GameFamily, event: UiSound): string {
  const index = family === "q1" ? event === "open" ? 2 : event === "move" ? 1 : 3
    : event === "open" ? 1 : event === "close" ? 3 : event === "reject" && family === "q3" ? 4 : 2;
  return `misc/menu${index}.wav`;
}
