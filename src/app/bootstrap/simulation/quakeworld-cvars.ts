import type { CvarRegistry } from "../../../core/cvars/index.ts";

export function registerQuakeWorldEngineCvars(cvars: CvarRegistry): void {
  for (const [name, value] of Object.entries({ sv_phs: "1", sv_stopspeed: "100", sv_spectatormaxspeed: "500", sv_accelerate: "10", sv_airaccelerate: "0.7",
    sv_wateraccelerate: "10", sv_friction: "4", sv_waterfriction: "4" })) if (cvars.find(name) === undefined) cvars.register(name, value);
}
