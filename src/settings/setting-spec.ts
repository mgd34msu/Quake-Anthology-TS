// SPDX-License-Identifier: GPL-2.0-or-later
/* Shared description of a cvar-backed setting. GPL-2.0-or-later. */
import type { UiChoice } from "../contracts/ui.ts";
import type { RestartKind } from "./restart.ts";

export type SettingCategory = "display" | "video" | "audio" | "input" | "network" | "accessibility" | "language";
interface CvarSettingBase {
  readonly name: string;
  readonly label: string;
  readonly category: SettingCategory;
  readonly restart: RestartKind | null;
  readonly group?: string;
}
export type CvarSettingSpec = CvarSettingBase &
  (
    | { readonly kind: "toggle" }
    | { readonly kind: "slider"; readonly minimum: number; readonly maximum: number; readonly step: number }
    | { readonly kind: "choice"; readonly choices: readonly UiChoice[] }
    | { readonly kind: "text-entry"; readonly maximumLength: number; readonly submitOnly?: boolean }
  );
