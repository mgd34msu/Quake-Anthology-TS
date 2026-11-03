import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { userProductDirectory } from "../../src/content/user-data.ts";

/** Launch options plus the per-product settings paths of a native startup, in a caller-owned user-content root. */
export async function startupNativeFixture(tempDirectory: (prefix: string) => Promise<string>, game = "q2-classic-baseq2", map = "base1", extra: readonly string[] = []) {
  const root = await tempDirectory("quake-startup-native-");
  const command = parseApplicationCommand(["--game", game, "--map", map, "--renderer", "cpu", "--hidden", ...extra,
    "--width", "320", "--height", "240", "--user-content-root", root]);
  if (command.kind !== "run") throw new Error("Expected native launch");
  const content = await loadApplicationContent(command.options);
  try {
    const product = content.catalog.product(content.recipe.engineBehavior.content);
    const productRoot = userProductDirectory(root, product.expectation.contentDirectory);
    const sourcePath = join(productRoot, "cvars", "source", encodeURIComponent(content.recipe.map.entities.content), `${encodeURIComponent(content.recipe.map.entities.provider)}.json`);
    const clientPath = join(productRoot, "cvars", "client", encodeURIComponent(content.recipe.engineBehavior.content), encodeURIComponent(content.recipe.engineBehavior.provider), "0.json");
    await mkdir(productRoot, { recursive: true });
    return { root, productRoot, sourcePath, clientPath, options: command.options };
  } finally { await content.close(); }
}
