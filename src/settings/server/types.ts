import type { CvarSettingSpec } from "../../ui/settings/index.ts";

export type ServerSettingId = `server:${string}`;
export type ServerApplyAt = "live" | "next-match" | "next-map" | "restart";
export type ServerSettingTarget =
  | { readonly kind: "value"; readonly name: string }
  | { readonly kind: "bit"; readonly name: string; readonly mask: number; readonly inverted: boolean };
type Control<Kind extends CvarSettingSpec["kind"]> = Omit<Extract<CvarSettingSpec, { readonly kind: Kind }>, "name" | "category" | "restart">;
interface DefinitionBase {
  readonly id: ServerSettingId;
  readonly description: string;
  readonly applyAt: ServerApplyAt;
  readonly defaultValue: string;
  readonly target: ServerSettingTarget;
}
export type ServerSettingDefinition = DefinitionBase & (
  | Control<"toggle">
  | (Control<"slider"> & { readonly integer: boolean })
  | Control<"choice">
  | Control<"text-entry">
);
/** The caller selects collections from the independently chosen component owners. */
export interface ServerSettingCollection { readonly id: string; readonly definitions: readonly ServerSettingDefinition[]; }
export interface ServerSettingValues { readonly desired: string; readonly effective: string; }
/** State and scheduling remain in the existing source/configuration owner. */
export interface ServerSettingsOwner {
  read(target: ServerSettingTarget): ServerSettingValues;
  write(target: ServerSettingTarget, value: string, applyAt: ServerApplyAt): void;
}
export interface BoundServerSetting { readonly definition: ServerSettingDefinition; readonly owner: ServerSettingsOwner; }
export interface ServerSettingStatus extends ServerSettingValues { readonly pending: boolean; readonly applyAt: ServerApplyAt; }
export interface ServerProfile {
  readonly version: 1;
  readonly overrides: readonly { readonly id: ServerSettingId; readonly value: string }[];
}
