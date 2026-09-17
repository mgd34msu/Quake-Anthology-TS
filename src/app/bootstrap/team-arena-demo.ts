export interface TeamArenaDemo {
  readonly name: string;
  readonly path: string;
}

/** Source postgame demos use the selected map, game type and protocol. */
export async function teamArenaDemo(map: string, gameType: number, protocol: number,
  exists: (path: string) => Promise<boolean>): Promise<TeamArenaDemo | null> {
  if (!/^[a-zA-Z0-9_/-]+$/.test(map) || map.split("/").some(part => part === "" || part === "..")
    || !Number.isInteger(gameType) || gameType < 0 || !Number.isInteger(protocol) || protocol < 0)
    throw new Error("Invalid Team Arena demo selection");
  const name = `${map}_${gameType}`, path = `demos/${name}.dm_${protocol}`;
  return await exists(path) ? { name, path } : null;
}
