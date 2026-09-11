import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { identifyFile } from "../environment.ts";
import type { FileIdentity } from "../schema.ts";

interface SourceLock {
  readonly path: string;
  readonly sha256: string;
}

export const sourceLocks = {
  classicLocal: { path: "../qsrc/quake-2/game/g_local.h", sha256: "eb04d914a532f0baa87a12e00bc2e39a3d3a8ee1576bcdf87ea5af419919e095" },
  classicMain: { path: "../qsrc/quake-2/game/g_main.c", sha256: "558f05adc5adac93bdc6151f5157b009ac87c255f788240a2a9f41755e3c8fd4" },
  classicPhys: { path: "../qsrc/quake-2/game/g_phys.c", sha256: "31e3b813814c249734550d262d2b4766184849563960c0d9715005a6e5743481" },
  classicItems: { path: "../qsrc/quake-2/game/g_items.c", sha256: "4d55d1d1c83ff7552326efabc520ca07b1107ef37cd7a877af409eddcd6cdc77" },
  classicCombat: { path: "../qsrc/quake-2/game/g_combat.c", sha256: "ee8badcf891215ae3e627a987dadde2e4bf11eb19095e3fca9e1b60c0c658f38" },
  classicMove: { path: "../qsrc/quake-2/qcommon/pmove.c", sha256: "8861daaeff7efd7bc6d3c5e65ef99801567f3e06eb14020787206d39dd0038a8" },
  rereleaseReadme: { path: "../qsrc/quake2-rerelease-dll/README.md", sha256: "5767fe06b561ee01ee2817e82331577bc6b44e4e7b794c87f275d0c165095c9b" },
  rereleaseLocal: { path: "../qsrc/quake2-rerelease-dll/rerelease/g_local.h", sha256: "3257c79f07d9e8ef333342b9a0be0bde7dd514d9de1b9b36173aad157601aecf" },
  rereleaseMain: { path: "../qsrc/quake2-rerelease-dll/rerelease/g_main.cpp", sha256: "438e2dcb631b94ff4501e74230237ea739e210da331dfce6e456c6154338d1b5" },
  rereleasePhys: { path: "../qsrc/quake2-rerelease-dll/rerelease/g_phys.cpp", sha256: "c09d96106cee08d30bfca282159a487d91a93c852870b3f1ed6b21a4df6b4737" },
  rereleaseTarget: { path: "../qsrc/quake2-rerelease-dll/rerelease/g_target.cpp", sha256: "7a620d794956f4dc1bef050cc621984ab51bd7cd4f7a4ce5a0693777e3be4cd9" },
  rereleaseSave: { path: "../qsrc/quake2-rerelease-dll/rerelease/g_save.cpp", sha256: "ec2a980c3dd9412a31754e478b33b400b08e30f7cbdfcd964ec516cdda3597c4" },
  rereleaseSpawn: { path: "../qsrc/quake2-rerelease-dll/rerelease/g_spawn.cpp", sha256: "9b78e2a1c8e2a739a450add01006e4cf39f0aabc1441b55c30be2f425fcb3742" },
  rereleaseClient: { path: "../qsrc/quake2-rerelease-dll/rerelease/p_client.cpp", sha256: "b47a44e43573c1e471ae29b392cd9f603d16310eedecdc84ac09b927aa3cbacf" },
  rereleaseMove: { path: "../qsrc/quake2-rerelease-dll/rerelease/p_move.cpp", sha256: "0bed089782386fa1d9a4872a0bcfdae97f5d967a7d8bc3e6dc3fa3dd23dc2cc5" },
  rereleaseGame: { path: "../qsrc/quake2-rerelease-dll/rerelease/game.h", sha256: "66defbd069c38c4a1740c5087a3f6f2343d603b956ca0d6e1d89e8ad46d0843f" },
  rereleaseShared: { path: "../qsrc/quake2-rerelease-dll/rerelease/bg_local.h", sha256: "0a66fff4539f15603a8563c150b56b4be64bdd36144053730a3eb1301feaad79" },
  rereleaseCgame: { path: "../qsrc/quake2-rerelease-dll/rerelease/cg_main.cpp", sha256: "a673f0092f5fffa968fd3affc3d0cb57b02a535ff7c14a04326578bcd8371c90" },
} satisfies Record<string, SourceLock>;

export type SourceId = keyof typeof sourceLocks;
export interface SourceLocation {
  readonly source: SourceId;
  readonly firstLine: number;
  readonly lastLine: number;
  readonly symbol: string;
}

export interface VerifiedSources {
  readonly identities: readonly (FileIdentity & { readonly id: string })[];
  readonly text: ReadonlyMap<string, string>;
}

export async function loadVerifiedSources(projectRoot: string): Promise<VerifiedSources> {
  const identities: (FileIdentity & { readonly id: string })[] = [];
  const text = new Map<string, string>();
  for (const [id, lock] of Object.entries(sourceLocks)) {
    const path = resolve(projectRoot, lock.path);
    const identity = await identifyFile(path);
    if (identity.sha256 !== lock.sha256) throw new Error(`Q2 source identity changed: ${path}`);
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== lock.sha256) throw new Error(`Q2 source changed before evaluation: ${path}`);
    identities.push({ id, ...identity });
    text.set(id, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  return { identities, text };
}

export function sourceText(sources: ReadonlyMap<string, string>, id: SourceId): string {
  const text = sources.get(id);
  if (text === undefined) throw new Error(`Missing verified Q2 source: ${id}`);
  return text;
}
