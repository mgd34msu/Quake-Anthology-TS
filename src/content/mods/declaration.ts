import type { ResolvedGameplayMod } from "../../contracts/mods.ts";
import { SaveReader } from "../../persistence/value.ts";
import { readQuakeCModDeclaration } from "./callbacks.ts";
import { readQvmModDeclaration } from "./qvm-callbacks.ts";
import { readNativeModDeclaration } from "./native-callbacks.ts";

export function readGameplayModDeclaration(reader: SaveReader): ResolvedGameplayMod["declaration"] {
  switch (reader.field("runtime").choice("quakec", "qvm", "native")) {
    case "quakec": return readQuakeCModDeclaration(reader);
    case "qvm": return readQvmModDeclaration(reader);
    case "native": return readNativeModDeclaration(reader);
  }
}

export function parseGameplayModDeclaration(bytes: Uint8Array): ResolvedGameplayMod["declaration"] {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return readGameplayModDeclaration(new SaveReader(value));
}
