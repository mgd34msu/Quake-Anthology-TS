import type { NativeWeaponBehaviorDeclaration } from "../contracts/native-weapon-behavior.ts";
import { sameWeaponBehavior, type WeaponBehaviorDefinition } from "../contracts/weapon-behavior.ts";
import { readNativeWeaponDeclaration } from "../compat/q2/rerelease/native-weapon-declaration.ts";
import { builtInRereleaseWeaponDeclaration, rereleaseWeaponDefinition } from "../compat/q2/rerelease/weapon-behavior-profile.ts";
import type { SaveReader } from "./value.ts";

/** Only the former built-in profile can supply declaration identity omitted by old saves. */
export function readSavedNativeWeaponDeclaration(reader: SaveReader, definition: WeaponBehaviorDefinition): NativeWeaponBehaviorDeclaration {
  const declaration = reader.value === undefined ? builtInRereleaseWeaponDeclaration(definition.module)
    : readNativeWeaponDeclaration(reader.value, definition.module);
  if (declaration === null) return reader.fail("native weapon save has no retained declaration or matching legacy profile");
  const expected = rereleaseWeaponDefinition(definition.module, declaration);
  if (expected === null || !sameWeaponBehavior(definition, expected))
    return reader.fail("native weapon declaration differs from saved behavior identity");
  return declaration;
}
