import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { ServerSettingsOwner, ServerSettingTarget } from "./types.ts";

function projected(target: ServerSettingTarget, value: string): string {
  if (target.kind === "value") return value;
  const enabled = (Number(value) & target.mask) !== 0;
  return enabled !== target.inverted ? "1" : "0";
}
function merged(target: ServerSettingTarget, current: string, value: string): string {
  if (target.kind === "value") return value;
  const enabled = (value === "1") !== target.inverted;
  return String((enabled ? Number(current) | target.mask : Number(current) & ~target.mask) >>> 0);
}
/** Uses the source registry's current and latched values, including mixed-timing masks. */
export function cvarServerSettingsOwner(cvars: CvarRegistry, initializing = false): ServerSettingsOwner {
  const requireValue = (name: string) => {
    const value = cvars.find(name);
    if (value === undefined) throw new Error(`Server setting has no cvar owner: ${name}`);
    return value;
  };
  return {
    read(target) {
      const value = requireValue(target.name);
      return { effective: projected(target, value.value), desired: projected(target, value.latchedValue ?? value.value) };
    },
    write(target, value, applyAt) {
      const current = requireValue(target.name), desired = merged(target, current.latchedValue ?? current.value, value);
      if (initializing) { cvars.set(target.name, desired, true); return; }
      if (applyAt !== "live") {
        cvars.stage(target.name, desired); return;
      }
      const effective = merged(target, current.value, value);
      cvars.set(target.name, effective, true);
      if (desired !== effective) cvars.stage(target.name, desired);
    },
  };
}
