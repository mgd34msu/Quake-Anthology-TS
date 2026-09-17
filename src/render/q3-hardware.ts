/** Q3 linux_glimp.c startup classification; the shared SDL context uses the ICD driver path. */
export type Q3Hardware = "generic" | "3dfx" | "riva128" | "ragepro" | "permedia2";
export function q3Hardware(renderer: string): Q3Hardware {
  const name = renderer.toLowerCase();
  if (name.includes("banshee") || name.includes("voodoo_graphics")) return "3dfx";
  if (name.includes("rage pro") || name.includes("ragepro")) return "ragepro";
  if (name.includes("permedia2")) return "permedia2";
  if (name.includes("riva 128")) return "riva128";
  return "generic";
}
export function q3HardwareNumber(hardware: Q3Hardware): number {
  switch (hardware) {
    case "generic": return 0;
    case "3dfx": return 1;
    case "riva128": return 2;
    case "ragepro": return 3;
    case "permedia2": return 4;
  }
}
