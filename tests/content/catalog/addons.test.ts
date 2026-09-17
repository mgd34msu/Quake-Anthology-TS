import { expect, test } from "bun:test";
import { addonInstallPath, parseAddonCatalog, resolveAddonPackages } from "../../../src/content/catalog/addons.ts";
function row(sha256: string, tags: readonly string[], install: object) {
  return { sha256, bytes: 100, tags: ["game=quake", "game_mode=singleplayer", ...tags], install,
    urls: [`https://www.quaddicted.com/files/by-sha256/${sha256.slice(0, 2)}/${sha256}/test.zip`] };
}
test("Quaddicted mappings preserve exact files, directory precedence, exclusions and old base paths", () => {
  const item = parseAddonCatalog([row("a".repeat(64), ["filename=map.zip", "startmap=test"], { extractmapping: { "/": "/id1/", "/docs/": "/id1/maps/", "/banner.png": "/id1/maps/map_banner.png", "/progs.dat": null } })])[0];
  if (item === undefined) throw new Error("Missing package");
  expect(addonInstallPath(item, "maps/test.bsp")).toBe("id1/maps/test.bsp");
  expect(addonInstallPath(item, "docs/readme.txt")).toBe("id1/maps/readme.txt");
  expect(addonInstallPath(item, "banner.png")).toBe("id1/maps/map_banner.png");
  expect(addonInstallPath(item, "progs.dat")).toBeNull();
  expect(() => addonInstallPath(item, "../escape")).toThrow();
  const old = parseAddonCatalog([row("b".repeat(64), ["filename=old.zip"], { extract: "{base}/maps/" })])[0];
  if (old === undefined) throw new Error("Missing legacy package");
  expect(addonInstallPath(old, "test.bsp")).toBe("id1/maps/test.bsp");
});
test("dependencies are ordered before overlays and missing requirements never become base fallback", () => {
  const entries = parseAddonCatalog([
    row("a".repeat(64), ["filename=addon.zip", "depends=('copper>=1.2')", "commandline=-game copper"], { extract: "/copper/maps/" }),
    row("b".repeat(64), ["filename=copper.zip", "provides='copper=1.3'"], { extract: "/copper/" }),
  ]);
  const selected = entries[0]; if (selected === undefined) throw new Error("Missing package");
  expect(resolveAddonPackages(entries, selected).map(item => item.filename)).toEqual(["copper.zip", "addon.zip"]);
  expect(() => resolveAddonPackages([selected], selected)).toThrow("Missing dependency");
  expect(selected.gameDirectory).toBe("copper");
});

function zip(entries: readonly (readonly [string, string])[]): Uint8Array {
  const locals: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of entries) {
    const name = new TextEncoder().encode(path), data = new TextEncoder().encode(text), crc = Bun.hash.crc32(data);
    const local = new Uint8Array(30 + name.length + data.length), a = new DataView(local.buffer);
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint32(14, crc, true);
    a.setUint32(18, data.length, true); a.setUint32(22, data.length, true); a.setUint16(26, name.length, true);
    local.set(name, 30); local.set(data, 30 + name.length); locals.push(local);
    const central = new Uint8Array(46 + name.length), b = new DataView(central.buffer);
    b.setUint32(0, 0x02014b50, true); b.setUint16(4, 20, true); b.setUint16(6, 20, true); b.setUint32(16, crc, true);
    b.setUint32(20, data.length, true); b.setUint32(24, data.length, true); b.setUint16(28, name.length, true); b.setUint32(42, offset, true);
    central.set(name, 46); directory.push(central); offset += local.length;
  }
  const directoryLength = directory.reduce((sum, bytes) => sum + bytes.length, 0), result = new Uint8Array(offset + directoryLength + 22);
  let position = 0;
  for (const bytes of [...locals, ...directory]) { result.set(bytes, position); position += bytes.length; }
  const end = new DataView(result.buffer, position);
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, directoryLength, true); end.setUint32(16, offset, true);
  return result;
}

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddonLibrary } from "../../../src/app/bootstrap/addon-library.ts";
import { managedAddonHidden } from "../../../src/content/catalog/addons.ts";
test("local install/update/remove preserve immutable prior loose bytes", async () => {
  const root=await mkdtemp(join(tmpdir(),"addon-library-"));
  let changes=0;
  const library=new AddonLibrary({root,changed:async()=>{changes++;},launch:()=>{}});
  try {
    const path=join(root,"map.zip");
    await writeFile(path,zip([["maps/example.bsp","first version"]]));
    library.create.submit(path); await library.settle();
    expect(library.status()).toContain("Installed");
    const first=(await readdir(join(root,"q1")))[0]; if(first===undefined)throw new Error("No product");
    await writeFile(path,zip([["maps/example.bsp","second version"]]));
    library.create.submit(path); await library.settle();
    expect(changes).toBe(2);
    expect(await readFile(join(root,"q1",first,"maps/example.bsp"),"utf8")).toBe("first version");
    expect(await managedAddonHidden(root,"q1/"+first)).toBe(true);
    const local=library.entries().find(entry=>entry.id.startsWith("local:")); if(local===undefined)throw new Error("No installed entry");
    library.activate(local.id); library.activate("local-remove"); await library.settle();
    expect(changes).toBe(3);
    expect(library.entries().some(entry=>entry.id.startsWith("local:"))).toBe(false);
    expect((await readdir(join(root,"q1"))).length).toBe(2);
  } finally {await library.close();await rm(root,{recursive:true,force:true});}
});
test("cancel during local import cannot publish and failed catalog publication restores previous version", async () => {
  const root=await mkdtemp(join(tmpdir(),"addon-cancel-"));
  let fail=false, changes=0;
  const library=new AddonLibrary({root,changed:async()=>{if(fail)throw new Error("catalog failed");changes++;},launch:()=>{}});
  try {
    const path=join(root,"map.zip"); await writeFile(path,zip([["maps/example.bsp","first version"]]));
    library.create.submit(path); library.stop.activate(); await library.settle();
    expect(changes).toBe(0); expect(library.status()).toContain("cancelled");
    library.create.submit(path); await library.settle();
    const original=library.entries().find(entry=>entry.id.startsWith("local:")); if(original===undefined)throw new Error("No installed entry");
    fail=true; await writeFile(path,zip([["maps/example.bsp","second version"]]));
    library.create.submit(path); await library.settle();
    expect(library.status()).toContain("catalog failed");
    expect(await managedAddonHidden(root,"q1/"+original.id.slice(6))).toBe(false);
    expect(await readFile(join(root,"q1",original.id.slice(6),"maps/example.bsp"),"utf8")).toBe("first version");
  } finally {await library.close();await rm(root,{recursive:true,force:true});}
});
import { discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import type { ProductExpectation } from "../../../src/content/catalog/products.ts";
test("published addon appears with authored title and tombstone affects only fresh catalogs", async () => {
  const root=await mkdtemp(join(tmpdir(),"addon-discovery-"));
  const base: ProductExpectation={id:"q1-classic-id1",family:"q1",edition:"classic",campaign:"id1",title:"Quake",contentDirectory:"q1/id1",baseProduct:null,requiredContentArchives:[],requiredPrograms:[],mapWitness:null,unresolvedReason:null};
  const library=new AddonLibrary({root,changed:async()=>{},launch:()=>{}});
  try {
    const path=join(root,"Example.zip");await writeFile(path,zip([["maps/example.bsp","geometry"]]));
    library.create.submit(path);await library.settle();
    const catalog=await discoverInstalledContent({corpusRoot:root,userContentRoot:root,products:[base],generation:1});
    const product=catalog.products.find(product=>product.expectation.id!==base.id);if(product===undefined)throw new Error("Addon not discovered");
    expect(product.expectation.title).toBe("Example");expect(catalog.mapsFor(product.id).map(map=>map.path)).toContain("maps/example.bsp");
    const entry=library.entries()[0];if(entry===undefined)throw new Error("No library entry");library.activate(entry.id);library.activate("local-remove");await library.settle();
    const fresh=await discoverInstalledContent({corpusRoot:root,userContentRoot:root,products:[base],generation:2});
    expect(fresh.products.some(candidate=>candidate.expectation.id===product.expectation.id)).toBe(false);
    expect(await readFile(catalog.mapsFor(product.id)[0]?.source ?? "", "utf8")).toBe("geometry");
  } finally {await library.close();await rm(root,{recursive:true,force:true});}
});
test("classic and rerelease package visibility is independent", async () => {
  const root=await mkdtemp(join(tmpdir(),"addon-editions-"));
  const classic=new AddonLibrary({root,edition:"classic",changed:async()=>{},launch:()=>{}});
  const rerelease=new AddonLibrary({root,edition:"rerelease",changed:async()=>{},launch:()=>{}});
  try {
    const path=join(root,"Map.zip");await writeFile(path,zip([["maps/example.bsp","geometry"]]));
    classic.create.submit(path);await classic.settle();rerelease.create.submit(path);await rerelease.settle();
    const item=classic.entries()[0];if(item===undefined)throw new Error("No classic product");
    expect(rerelease.entries()).toHaveLength(1);
    classic.activate(item.id);classic.activate("local-remove");await classic.settle();
    expect(await managedAddonHidden(root,"q1/"+item.id.slice(6))).toBe(true);
    expect(await managedAddonHidden(root,"q1/rerelease/"+item.id.slice(6))).toBe(false);
    expect(await readFile(join(root,"q1/rerelease",item.id.slice(6),"maps/example.bsp"),"utf8")).toBe("geometry");
  } finally {await classic.close();await rerelease.close();await rm(root,{recursive:true,force:true});}
});
