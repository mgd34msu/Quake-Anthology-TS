import { expect, test } from "bun:test";
import type { ProviderReference } from "../../src/contracts/content.ts";
import { createContentId } from "../../src/contracts/content.ts";
import { InstalledCatalog, expectedProducts } from "../../src/content/catalog/index.ts";
import type { CatalogProduct } from "../../src/content/catalog/index.ts";
import { applicationSourceSelection } from "../../src/app/bootstrap/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag } from "../../src/core/cvars/index.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createStartupSource, resolveStartupRules } from "../../src/app/bootstrap/startup-source.ts";

function selection(source: ProviderReference): Parameters<typeof createStartupSource>[1] { return { source, match: source }; }

test("ordinary Q3 startup selects game cvars from map source content rather than provider spelling", () => {
  const command = parseApplicationCommand(["--game", "q3-missionpack", "--map", "mpq3ctf4"]);
  if (command.kind !== "run") throw new Error("Expected ordinary launch");
  const context = { session: createIdentityOwner("startup-q3-product").session, origin: { kind: "server-console" } } satisfies Parameters<typeof createStartupSource>[3];
  const missionpack = createStartupSource(command.options, selection({ provider: "q3:official", content: "q3:classic:missionpack:installed" }), "q3", context, 8, () => {});
  expect(missionpack.get("g_redTeam")).toMatchObject({ name: "g_redteam", value: "Stroggs", resetValue: "Stroggs", flags: CvarFlag.Archive | CvarFlag.ServerInfo | CvarFlag.UserInfo });
  expect(missionpack.get("g_blueTeam")).toMatchObject({ name: "g_blueteam", value: "Pagans", resetValue: "Pagans", flags: CvarFlag.Archive | CvarFlag.ServerInfo | CvarFlag.UserInfo });
  expect(missionpack.get("g_obeliskHealth")).toMatchObject({ value: "2500", resetValue: "2500", flags: 0 });
  expect(missionpack.get("g_obeliskRespawnDelay")).toMatchObject({ value: "10", flags: CvarFlag.ServerInfo });
  const base = createStartupSource(command.options, selection({ provider: "q3:official", content: "q3:classic:baseq3:installed" }), "q3", context, 8, () => {});
  expect(base.get("g_redteam")).toBeUndefined();
  expect(base.get("g_obeliskHealth")).toBeUndefined();
  expect(base.get("g_speed")).toEqual(missionpack.get("g_speed"));
  expect(base.get("g_speed")).toMatchObject({ value: "320", resetValue: "320", flags: 0 });
});

for (const [configured, competitive] of [["0", "0"], ["1", "1"], ["2", "0"], ["2.5", "0"], ["3", "3"], ["4", "4"],
  ["4.5", "4.5"], ["5", "5"], ["6", "6"], ["7", "7"], ["9", "9"]] satisfies readonly (readonly [string, string])[]) {
  for (const mode of ["deathmatch", "singleplayer"] satisfies readonly ("deathmatch" | "singleplayer")[]) test(`explicit Q3 ${mode} resolves configured game type ${configured} using native map semantics`, () => {
    const command = parseApplicationCommand(["--game", "q3-missionpack", "--map", "mpq3ctf4", "--mode", mode]);
    if (command.kind !== "run") throw new Error("Expected ordinary launch");
    const context = { session: createIdentityOwner(`startup-q3-mode-${mode}-${configured}`).session,
      origin: { kind: "server-console" } } satisfies Parameters<typeof createStartupSource>[3];
    const cvars = createStartupSource(command.options, selection({ provider: "q3:official", content: "q3:classic:missionpack:installed" }), "q3", context, 8, () => {});
    cvars.set("g_gametype", configured);
    const resolved = resolveStartupRules(command.options, cvars, 8, []);
    expect(cvars.variableString("g_gametype")).toBe(mode === "singleplayer" ? "2" : competitive);
    expect(cvars.get("g_gametype")?.latchedValue).toBeUndefined();
    expect(resolved.options.mode).toBe(mode);
    expect(resolved.maxClients).toBe(8);
  });
}

function metadataCatalog(): InstalledCatalog {
  const products: CatalogProduct[] = expectedProducts.map(expectation => ({
    expectation,
    id: createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: "installed" }),
    availability: { kind: "installed" }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [],
  }));
  return new InstalledCatalog("/no-content-files", products, [], 0);
}

test("startup providers resolve without a map, archive or executable recipe", () => {
  const catalog = metadataCatalog();
  for (const product of ["q1-classic-id1", "q1-quakeworld", "q2-classic-baseq2", "q2-classic-ctf", "q2-classic-lmctf", "q3-baseq3", "q3-missionpack"]) {
    const selected = applicationSourceSelection(catalog, { product });
    expect(selected.source.content).toBe(catalog.require(product).id);
    expect(selected.source.provider).toBe(`${catalog.require(product).expectation.family}:official`);
    expect(selected.match.provider).toBe(product === "q2-classic-ctf" ? "q2:ctf" : product === "q2-classic-lmctf" ? "q2:lmctf" : selected.source.provider);
  }
  const selected = applicationSourceSelection(catalog, { product: "q3-missionpack" });
  const command = parseApplicationCommand(["--game", "q3-missionpack"]);
  if (command.kind !== "run") throw new Error("Expected ordinary launch");
  const context = { session: createIdentityOwner("mapless-source-metadata").session, origin: { kind: "local-console" } } satisfies Parameters<typeof createStartupSource>[3];
  expect(createStartupSource(command.options, selected, "q3", context, 8, () => {}).variableString("g_redteam")).toBe("Stroggs");
  expect(applicationSourceSelection(catalog, { product: "q2-classic-baseq2", rules: "ctf" }).match.content).toBe(catalog.require("q2-classic-ctf").id);
  expect(() => applicationSourceSelection(catalog, { product: "q3-baseq3", rules: "ctf" })).toThrow("requires a classic Quake II");
});
