import type { ResolvedGameplayMod } from "../../contracts/mods.ts";
import { modSelectionKey, readModSelection } from "../../contracts/mods.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { CatalogProduct } from "../catalog/index.ts";
import type { MountedContent } from "../mounts/index.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import { parseGameplayModDeclaration } from "./declaration.ts";

/** Packages explicitly declare independent features; filenames do not establish their behavior. */
export async function discoverGameplayMods(product: CatalogProduct, mounted: MountedContent): Promise<readonly ResolvedGameplayMod[]> {
  const document = await mounted.open("gameplay-mods.json", mount => mount.identity.content === product.id);
  if (document === null) return [];
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(document.bytes));
  const reader = new SaveReader(value);
  reader.field("version").literal(1);
  const declared = reader.field("components").list(value => ({
    id: value.field("id").string(), title: value.field("title").string(),
    purpose: value.field("purpose").choice("addition", "game-type"),
    path: normalizeResourcePath(value.field("callbacks").string()),
    requires: value.field("requires").list(value => readModSelection(value.string())),
    conflicts: value.field("conflicts").list(value => readModSelection(value.string())),
  }));
  const result: ResolvedGameplayMod[] = [], seen = new Set<string>();
  for (const entry of declared) {
    const selection = { product: product.expectation.id, id: entry.id }, key = modSelectionKey(selection);
    if (seen.has(key)) throw new Error(`Duplicate mod component: ${key}`);
    seen.add(key);
    if (entry.purpose === "game-type") continue;
    const file = await mounted.open(entry.path);
    if (file === null) throw new Error(`${entry.title}: missing callback declaration ${entry.path}`);
    const declaration = parseGameplayModDeclaration(file.bytes), program = await mounted.open(declaration.program.path);
    if (program === null || program.reference.digest !== declaration.program.digest)
      throw new Error(`${entry.title}: executable differs from its callback declaration`);
    result.push({ selection, title: entry.title,
      sourceTitle: `${product.expectation.title} (${product.expectation.family.toUpperCase()}${product.expectation.edition === "rerelease" ? " rerelease" : ""})`,
      source: { provider: `${product.expectation.family}:official`, content: product.id },
      requires: entry.requires, conflicts: entry.conflicts, declaration, declarationDigest: file.reference.digest });
  }
  return result;
}
