// SPDX-License-Identifier: GPL-2.0-or-later
import { resolve } from "node:path";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { inspectElf } from "../../../../src/guest/elf/index.ts";

export const archivePath = resolve(import.meta.dir, "../../../../../qfiles/quakelive/baseq3/bin.pk3");
export async function quakeLiveFixture(name: "qagamei386.so" | "qagamex64.so") {
  const archive = await openArchive(archivePath);
  try {
    const entry = archive.findEntries(name)[0];
    if (entry === undefined) throw new Error(`Missing fixture ${name}`);
    const bytes = await archive.readEntry(entry);
    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const module: ModuleIdentity = { id: `compat:quakelive:${name}`, artifactPath: `${archivePath}!${name}`, revision: "supplied", digest: createContentDigest(digest) };
    return { bytes, module, elf: inspectElf(bytes) };
  } finally { archive.close(); }
}
if (import.meta.main) {
  for (const name of ["qagamei386.so", "qagamex64.so"] satisfies readonly ("qagamei386.so" | "qagamex64.so")[]) {
    const fixture = await quakeLiveFixture(name);
    console.log(name, fixture.module.digest);
    for (const symbol of fixture.elf.symbols.filter(symbol => symbol.section === 0 && symbol.name !== "" || symbol.binding === 10)) {
      console.log(symbol.name, symbol.version?.library ?? "", symbol.version?.name ?? "", `type=${symbol.type} binding=${symbol.binding} size=${symbol.size}`);
    }
  }
}
