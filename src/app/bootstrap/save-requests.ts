export type ApplicationSaveFormat = "shared" | "v5" | "v6";
export function parseSaveRequest(args: readonly string[]): { readonly name: string; readonly format: ApplicationSaveFormat } {
  const name = args[0], format = args[1] ?? "shared";
  if (name === undefined || name.length === 0 || args.length > 2 || format !== "shared" && format !== "v5" && format !== "v6")
    throw new Error("Usage: save <name or path> [shared|v5|v6]");
  return { name, format };
}
export function parseLoadRequest(args: readonly string[]): { readonly name: string; readonly sourceProduct?: string } {
  const name = args[0], sourceProduct = args[1];
  if (name === undefined || name.length === 0 || args.length > 2 || sourceProduct === "") throw new Error("Usage: load <name or path> [source-product]");
  return { name, ...(sourceProduct === undefined ? {} : { sourceProduct }) };
}
export function saveCommandDocumentation(name: string) {
  if (name === "save") return { summary: "Save the world; v5/v6 export the active singleplayer NetQuake source in its original format.", usage: "save <name or path> [shared|v5|v6]", examples: ["save quicksave", "save original v5"] };
  if (name === "load") return { summary: "Restore a save. Specify the source product when an original Quake save has ambiguous content.", usage: "load <name or path> [source-product]", examples: ["load quicksave", "load original q1-classic-id1"] };
  return undefined;
}
