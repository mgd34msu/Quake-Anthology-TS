import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountIdentity } from "../../src/contracts/content.ts";
import type { ContentMount, ResolvedMountPlan } from "../../src/contracts/content.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { readBaseArenaCatalog } from "../../src/app/bootstrap/base-arena-catalog.ts";

test("arena discovery uses active loose overlays and preserves restricted mounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-arena-mounts-"));
  try {
    const base = join(root, "base"), user = join(root, "user");
    await mkdir(join(base, "scripts"), { recursive: true });
    await mkdir(join(user, "scripts"), { recursive: true });
    await writeFile(join(base, "scripts/arenas.txt"), '{ map training type single special training bots "crash" }');
    await writeFile(join(base, "scripts/regular.arena"), '{ map old type single longname "Replaced" bots "sarge" }');
    await writeFile(join(user, "scripts/REGULAR.ARENA"), '{ map replacement type single longname "User arena" bots "ranger grunt" }');
    await writeFile(join(user, "scripts/extra.arena"), '{ map extra type single longname "Additional arena" bots "visor" }');
    const sources: ContentMount[] = [
      { kind: "loose", identity: createMountIdentity("mount:arena:user", "q3:classic:baseq3:test", 0), rootPath: user },
      { kind: "loose", identity: createMountIdentity("mount:arena:base", "q3:classic:baseq3:test", 0), rootPath: base },
    ];
    const plan: ResolvedMountPlan = { id: "mount-plan:arena:0", mounts: sources, defaultOrder: sources.map(source => source.identity.id), prefixOrders: [] };
    using mounts = await openMountPlan(plan);
    const catalog = await readBaseArenaCatalog(mounts);
    expect(catalog.arenas[0]?.map).toBe("maps/training.bsp");
    expect(catalog.arenas.map(arena => arena.map).sort()).toEqual(["maps/extra.bsp", "maps/replacement.bsp", "maps/training.bsp"]);
    const replacement = catalog.arenas.find(arena => arena.map === "maps/replacement.bsp");
    expect(replacement?.bots).toEqual(["ranger", "grunt"]);
    expect(replacement?.title).toBe("User arena");
    using restricted = await openMountPlan(plan, { q3Restriction: "demo" });
    expect((await readBaseArenaCatalog(restricted)).arenas).toEqual([]);
    expect((await readBaseArenaCatalog(mounts)).arenas).toEqual(catalog.arenas);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
