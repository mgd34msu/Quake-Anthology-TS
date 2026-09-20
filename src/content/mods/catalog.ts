import type { ModDescription, ResolvedGameplayMod } from "../../contracts/mods.ts";
import { modSelectionKey, readModSelection } from "../../contracts/mods.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { CatalogProduct } from "../catalog/index.ts";
import type { MountedContent } from "../mounts/index.ts";
import { normalizeResourcePath } from "../mounts/paths.ts";
import { parseGameplayModDeclaration } from "./declaration.ts";

export type DiscoveredGameplayMod =
  | { readonly kind: "available"; readonly mod: ResolvedGameplayMod }
  | { readonly kind: "unavailable"; readonly description: Omit<ModDescription, "availability"> & {
    readonly availability: Extract<ModDescription["availability"], { readonly kind: "unavailable" }>;
  } };

/** Packages explicitly declare independent features; filenames do not establish their behavior. */
export async function discoverGameplayMods(product: CatalogProduct, mounted: MountedContent): Promise<readonly DiscoveredGameplayMod[]> {
  const document = await mounted.open("gameplay-mods.json", mount => mount.identity.content === product.id);
  if (document === null) return [];
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(document.bytes));
  const reader = new SaveReader(value);
  reader.field("version").literal(1);
  const declared = reader.field("components").list(value => ({
    id: value.field("id").string(), title: value.field("title").string(),
    purpose: value.field("purpose").choice("addition", "game-type"),
    reader: value,
  }));
  const result: DiscoveredGameplayMod[] = [], seen = new Set<string>();
  for (const entry of declared) {
    const selection = { product: product.expectation.id, id: entry.id }, key = modSelectionKey(selection);
    if (seen.has(key)) throw new Error(`Duplicate mod component: ${key}`);
    seen.add(key);
    if (entry.purpose === "game-type") continue;
    const description = { selection, title: entry.title,
      sourceTitle: `${product.expectation.title} (${product.expectation.family.toUpperCase()}${product.expectation.edition === "rerelease" ? " rerelease" : ""})`,
      source: { provider: `${product.expectation.family}:official`, content: product.id }, requires: [], conflicts: [],
    } satisfies Omit<ModDescription, "purpose" | "availability">;
    try {
      const path = normalizeResourcePath(entry.reader.field("callbacks").string());
      const requires = entry.reader.field("requires").list(value => readModSelection(value.string()));
      const conflicts = entry.reader.field("conflicts").list(value => readModSelection(value.string()));
      const file = await mounted.open(path);
      if (file === null) throw new Error(`Missing callback declaration ${path}`);
      const declaration = parseGameplayModDeclaration(file.bytes), program = await mounted.open(declaration.program.path);
      if (program === null || program.reference.digest !== declaration.program.digest)
        throw new Error("Executable differs from its callback declaration");
      result.push({ kind: "available", mod: { ...description, requires, conflicts, declaration, declarationDigest: file.reference.digest } });
    } catch (error) {
      result.push({ kind: "unavailable", description: { ...description, purpose: "addition",
        availability: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) } } });
    }
  }
  return result;
}
