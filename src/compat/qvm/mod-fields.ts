// SPDX-License-Identifier: GPL-2.0-or-later
import type { QvmModActorField, QvmModActorRecord, QvmModCallbackDeclaration, QvmModScalar } from "../../contracts/qvm-mod-callbacks.ts";
import type { ModHostServices } from "../../world/session/mods.ts";
import { float32ToBits } from "../../core/numeric.ts";
import type { QvmModuleOptions } from "./module.ts";

export type Artifact = QvmModuleOptions["artifact"];
export type SharedField = Extract<
  QvmModActorField,
  { readonly binding: "team" | "score" | "health" | "inventory" | "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" }
>;
/** Imports that read engine state or the clock and write only their output buffer, never a projected entity field. */

export function fieldSize(field: QvmModActorField): number {
  return field.binding === "private"
    ? field.byteLength
    : ["origin", "velocity", "angles", "bounds-min", "bounds-max", "constant-vector"].includes(field.binding)
      ? 12
      : 4;
}
export function shared(field: QvmModActorField): field is SharedField {
  return (
    field.binding === "team" ||
    field.binding === "score" ||
    field.binding === "health" ||
    field.binding === "inventory" ||
    field.binding === "origin" ||
    field.binding === "velocity" ||
    field.binding === "angles" ||
    field.binding === "bounds-min" ||
    field.binding === "bounds-max"
  );
}
export function scalar(value: number, encoding: QvmModScalar): number {
  if (
    !Number.isFinite(value) ||
    (encoding === "float32" && !Number.isFinite(Math.fround(value))) ||
    (encoding === "int32" && (value < -0x80000000 || value > 0x7fffffff))
  )
    throw new Error(`Mod value exceeds ${encoding}`);
  return encoding === "float32" ? float32ToBits(value) | 0 : Math.trunc(value);
}
export function seconds(services: ModHostServices): number {
  const time = services.time();
  return time.kind === "seconds" ? time.value : time.value / 1000;
}
export function clientRecord(declaration: QvmModCallbackDeclaration, record: QvmModActorRecord): boolean {
  return declaration.clients?.records.includes(record.id) === true;
}
