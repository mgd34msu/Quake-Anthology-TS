import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";

/** Shared source alias-shadow setting; both rendering backends consume the same geometry. */
export function registerRenderSettings(cvars: CvarRegistry): void {
  cvars.register("r_shadows", "0", CvarFlag.Archive);
  cvars.bindValue("r_shadows", { validate: value => value.trim() !== "" && Number.isFinite(Number(value)) ? null : "Shadows require a finite number", changed: () => undefined });
  cvars.document("r_shadows", { summary: "Quake model shadows projected onto the sampled floor. Zero disables; nonzero enables.",
    usage: "r_shadows [0|1]", examples: ["r_shadows 1", "r_shadows 0"] });
}
