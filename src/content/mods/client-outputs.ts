import type { ModClientOutputDeclaration } from "../../contracts/mod-client-outputs.ts";
import type { SaveReader } from "../../persistence/value.ts";

export function readClientOutputDeclarations<S, V>(reader: SaveReader, scalar: (reader: SaveReader) => S, vector: (reader: SaveReader) => V): readonly ModClientOutputDeclaration<S, V>[] {
  return reader.list(entry => {
    const kind = entry.field("kind").choice("view-offset", "movement-mode", "stance", "body-shape");
    if (kind === "body-shape") return { kind, min: vector(entry.field("min")), max: vector(entry.field("max")) };
    if (kind === "view-offset") {
      if (entry.field("height").value === undefined) return { kind, field: vector(entry.field("field")) };
      if (entry.field("field").value !== undefined) return entry.fail("view offset must declare a vector or a scalar height, not both");
      return { kind, height: scalar(entry.field("height")) };
    }
    const field = scalar(entry.field("field")), mask = entry.field("mask").value === undefined ? {} : { mask: entry.field("mask").integer(1) };
    if (kind === "movement-mode") return { kind, field, ...mask, values: entry.field("values").list(value => ({ value: value.field("value").finite(), mode: value.field("mode").choice("normal", "noclip", "freeze") })) };
    return { kind, field, ...mask, values: entry.field("values").list(value => ({ value: value.field("value").finite(), crouched: value.field("crouched").boolean() })) };
  });
}
