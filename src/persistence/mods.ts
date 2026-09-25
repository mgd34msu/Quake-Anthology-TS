import type { ModIdentity, ModSessionCheckpoint, ResolvedGameplayMod } from "../contracts/mods.ts";
import { modSelectionKey, readModSelection } from "../contracts/mods.ts";
import { readGameplayModDeclaration } from "../content/mods/declaration.ts";
import { readGuest, readModule } from "./execution.ts";
import { readProvider } from "./recipe.ts";
import { readDigest } from "./shared.ts";
import { namespaced, SaveReader } from "./value.ts";

export function readGameplayMod(reader: SaveReader): ResolvedGameplayMod {
  const selection = reader.field("selection");
  const selected = { product: selection.field("product").string(), id: selection.field("id").string() };
  try { modSelectionKey(selected); } catch { return selection.fail("invalid mod selection"); }
  const dependency = (value: SaveReader) => readModSelection(`${value.field("product").string()}/${value.field("id").string()}`);
  return { selection: selected, source: readProvider(reader.field("source")),
    title: reader.field("title").string(), sourceTitle: reader.field("sourceTitle").string(),
    requires: reader.field("requires").list(dependency), conflicts: reader.field("conflicts").list(dependency),
    declaration: readGameplayModDeclaration(reader.field("declaration")),
    declarationDigest: readDigest(reader.field("declarationDigest")) };
}

export function readModSession(reader: SaveReader): ModSessionCheckpoint {
  const identities = new Set<string>();
  return { version: reader.field("version").literal(1), mods: reader.field("mods").list(entry => {
    const identity = entry.field("identity"), selection = identity.field("selection"), state = entry.field("state");
    const selected = { product: selection.field("product").string(), id: selection.field("id").string() };
    let key: string;
    try { key = modSelectionKey(selected); } catch { return selection.fail("invalid mod selection"); }
    if (identities.has(key)) return selection.fail("duplicate saved mod selection");
    identities.add(key);
    const provider = (value: SaveReader) => ({ provider: namespaced(value.field("provider")), schema: namespaced(value.field("schema")), version: value.field("version").integer(0) });
    return { identity: readModIdentity(identity),
      state: { guests: state.field("guests").list(readGuest), providers: state.field("providers").list(value => ({ ...provider(value), bytes: value.field("bytes").bytes() })) } };
  }) };
}

export function readModIdentity(reader: SaveReader): ModIdentity {
  const selection = reader.field("selection"), selected = { product: selection.field("product").string(), id: selection.field("id").string() };
  try { modSelectionKey(selected); } catch { return selection.fail("invalid mod selection"); }
  return { selection: selected, source: readProvider(reader.field("source")), declarationDigest: readDigest(reader.field("declarationDigest")),
    modules: reader.field("modules").list(readModule), providers: reader.field("providers").list(value => ({
      provider: namespaced(value.field("provider")), schema: namespaced(value.field("schema")), version: value.field("version").integer(0) })) };
}
