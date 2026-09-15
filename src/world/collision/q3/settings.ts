import { CvarFlag, type CvarRegistry } from "../../../core/cvars/index.ts";

export const collisionMapCvarDefinitions = [
  { name: "cm_noAreas", value: "0", flags: CvarFlag.Cheat },
  { name: "cm_noCurves", value: "0", flags: CvarFlag.Cheat },
  { name: "cm_playerCurveClip", value: "1", flags: CvarFlag.Archive | CvarFlag.Cheat },
];

/** CM_LoadMap registers these common-lived controls before reading or reusing a map. */
export class CollisionMapSettings {
  constructor(private readonly cvars: CvarRegistry) {}

  registerMap(): undefined {
    for (const definition of collisionMapCvarDefinitions) this.cvars.register(definition.name, definition.value, definition.flags);
  }

  get noAreas(): boolean { return this.enabled("cm_noAreas"); }
  get noCurves(): boolean { return this.enabled("cm_noCurves"); }
  get playerCurveClip(): boolean { return this.enabled("cm_playerCurveClip"); }

  private enabled(name: string): boolean {
    const value = this.cvars.get(name);
    if (value === undefined) throw new Error(`Collision map cvar ${name} is not registered`);
    return value.integerValue !== 0;
  }
}
