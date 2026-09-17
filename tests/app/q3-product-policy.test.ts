import { expect, test } from "bun:test";
import { q3ProductPolicy, q3MountRestriction, q3ProductMapCommands, q3TeamArenaCatalogPolicy } from "../../src/core/q3-product-policy.ts";

test("prerelease selectors are independent of each other and content directory", () => {
  for (const demo of [false, true]) for (const ta of [false, true]) {
    const policy = q3ProductPolicy(demo, ta);
    expect(q3MountRestriction(policy, false).kind).toBe(demo ? "demo" : "none");
    expect(q3MountRestriction(policy, true)).toEqual({ kind: "demo", directory: "demota", pakChecksum: 437558517 });
    expect(q3ProductMapCommands(policy)).toEqual(demo ? ["map"] : ["map", "devmap", "spmap", "spdevmap"]);
    expect(q3TeamArenaCatalogPolicy(policy)).toEqual({ gameInfo: ta ? "demogameinfo.txt" : "gameinfo.txt",
      teamInfo: ta ? "demoteaminfo.txt" : "teaminfo.txt", additionalTeams: !ta, additionalArenas: !ta });
  }
});
