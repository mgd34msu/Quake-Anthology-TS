import type { ServerApplyAt, ServerSettingDefinition, ServerSettingId, ServerSettingTarget } from "./types.ts";

export function serverLimit(id: ServerSettingId, name: string, label: string, defaultValue: number, description: string, applyAt: ServerApplyAt = "live", integer = true): ServerSettingDefinition {
  return { id, label, description, defaultValue: String(defaultValue), applyAt, target: { kind: "value", name },
    kind: "slider", minimum: 0, maximum: 2147483647, step: integer ? 1 : 0.25, integer };
}
export function serverToggle(id: ServerSettingId, target: ServerSettingTarget, label: string, defaultValue: boolean, description: string, applyAt: ServerApplyAt = "live"): ServerSettingDefinition {
  return { id, target, label, description, applyAt, defaultValue: defaultValue ? "1" : "0", kind: "toggle" };
}
export function serverFriendlyFire(target: ServerSettingTarget, defaultValue: boolean): ServerSettingDefinition {
  return serverToggle("server:friendly-fire", target, "Friendly fire", defaultValue, "Allow damage to teammates using the selected combat rules. Self-damage follows those rules.");
}
