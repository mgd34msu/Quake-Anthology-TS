export interface Q2TravelTarget {
  readonly kind: "map" | "cinematic" | "picture" | "demo";
  readonly name: string;
  readonly spawnPoint: string;
  readonly newUnit: boolean;
  readonly next: Q2TravelTarget | null;
}

/** SV_Map consumes the next-server suffix before the spawn point and unit marker. */
export function parseQ2Travel(expression: string): Q2TravelTarget {
  const parts = expression.split("+");
  let next: Q2TravelTarget | null = null;
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part === undefined || part.length === 0) throw new Error("Q2 travel has an empty destination");
    const dollar = part.indexOf("$");
    const level = dollar < 0 ? part : part.slice(0, dollar);
    const spawnPoint = dollar < 0 ? "" : part.slice(dollar + 1);
    const newUnit = level.startsWith("*"), name = newUnit ? level.slice(1) : level;
    if (!/^[a-zA-Z0-9_/-]+(?:\.(?:cin|pcx|dm2))?$/.test(name) || name.startsWith("/") || name.includes("//"))
      throw new Error(`Invalid Q2 travel destination: ${name}`);
    if (!/^[a-zA-Z0-9_-]*$/.test(spawnPoint)) throw new Error(`Invalid Q2 spawn point: ${spawnPoint}`);
    const kind = name.endsWith(".cin") ? "cinematic" : name.endsWith(".pcx") ? "picture" : name.endsWith(".dm2") ? "demo" : "map";
    next = { kind, name, spawnPoint, newUnit, next };
  }
  if (next === null) throw new Error("Q2 travel has no destination");
  return next;
}

/** Preserve the authored SV_Map suffix in the source nextserver command. */
export function q2NextServerCommand(target: Q2TravelTarget): string {
  if (target.next === null) return "";
  const parts: string[] = [];
  for (let next: Q2TravelTarget | null = target.next; next !== null; next = next.next) {
    parts.push(`${next.newUnit ? "*" : ""}${next.name}${next.spawnPoint === "" ? "" : `$${next.spawnPoint}`}`);
  }
  const expression = parts.join("+");
  parseQ2Travel(expression);
  return `gamemap "${expression}"`;
}
