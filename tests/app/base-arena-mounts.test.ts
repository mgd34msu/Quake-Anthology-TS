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

// A malformed arena file or a row without a usable map is skipped with the
// rest of the catalog intact, as in UI_LoadArenas -- never a failed launch.
test("malformed arena files and unusable rows are skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-arena-bad-"));
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts/arenas.txt"),
      '{ map good type single bots "sarge" }\n{ type single bots "visor" }\n{ map "bad name!" type single bots "grunt" }');
    await writeFile(join(root, "scripts/broken.arena"), "this is not an arena file {");
    const sources: ContentMount[] = [
      { kind: "loose", identity: createMountIdentity("mount:arena:bad", "q3:classic:baseq3:test", 0), rootPath: root },
    ];
    const plan: ResolvedMountPlan = { id: "mount-plan:arena-bad:0", mounts: sources, defaultOrder: sources.map(source => source.identity.id), prefixOrders: [] };
    using mounts = await openMountPlan(plan);
    const catalog = await readBaseArenaCatalog(mounts);
    expect(catalog.arenas.map(arena => arena.map)).toEqual(["maps/good.bsp"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
