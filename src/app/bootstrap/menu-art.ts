import mainBackground from "../../../assets/ui/main-menu-background.png" with { type: "file" };
import background from "../../../assets/ui/menu-background.png" with { type: "file" };
import panel from "../../../assets/ui/menu-panel.png" with { type: "file" };
import focus from "../../../assets/ui/menu-focus.png" with { type: "file" };

/** Bun embeds these same files in the standalone executable. */
export async function readMenuArt(path: string): Promise<Uint8Array> {
  const file = path === "assets/ui/main-menu-background.png" ? mainBackground : path === "assets/ui/menu-background.png" ? background : path === "assets/ui/menu-panel.png" ? panel
    : path === "assets/ui/menu-focus.png" ? focus : null;
  if (file === null) throw new Error(`Unknown menu artwork: ${path}`);
  return Bun.file(file).bytes();
}
