import { describe, expect, test } from "bun:test";
import type { CompositionDomain, InputRequirement } from "../../verification/schema/contracts.ts";
import { parseCase } from "../../verification/schema/parse.ts";
import { belongsToShard, compositionSize, generateComposition, parseShard } from "../../tools/verify/product.ts";

function domain(): CompositionDomain {
  return {
    schemaVersion: 1, id: "declared-domain",
    axes: [
      { id: "map", values: [{ id: "arena", requirements: [] }, { id: "hub", requirements: [] }] },
      { id: "renderer", values: [{ id: "cpu", requirements: [] }, { id: "gl", requirements: [] }] },
      { id: "seats", values: [{ id: "1", requirements: [] }, { id: "2", requirements: [] }, { id: "4", requirements: [] }] },
    ],
    requirements: [],
    suites: ["control", "load"].map(id => ({
      id, evidenceKind: "tooling", profiles: ["dev", "full", "release"], command: null,
      contracts: [{ id: `${id}-contract`, description: "Declared test behavior", oracle: { kind: "project", identity: "product enumeration test", sha256: null }, minimumAssertions: 1, tolerances: [] }],
    })),
    seed: 73, clockScheduleSha256: "a".repeat(64), networkScheduleSha256: "b".repeat(64), sourcePaths: [],
  };
}

describe("declared Cartesian coverage", () => {
  test("enumerates every map, renderer, seat, and suite exactly once", () => {
    const actual = [...generateComposition(domain())];
    const tuples = actual.map(item => `${item.configuration["map"]}:${item.configuration["renderer"]}:${item.configuration["seats"]}:${item.suiteId}`);
    const expected: string[] = [];
    for (const map of ["arena", "hub"]) for (const renderer of ["cpu", "gl"]) for (const seats of ["1", "2", "4"]) for (const suite of ["control", "load"]) expected.push(`${map}:${renderer}:${seats}:${suite}`);
    expect(tuples.sort()).toEqual(expected.sort());
    expect(compositionSize(domain())).toBe(24n);
    expect(new Set(actual.map(item => item.id)).size).toBe(24);
    expect(new Set(actual.map(item => item.configurationId)).size).toBe(12);
    for (const item of actual) expect(parseCase(item)).toEqual(item);
  });

  test("keeps case identities and iteration order through input permutations", () => {
    const original = domain();
    const reordered: CompositionDomain = {
      ...original,
      axes: [...original.axes].reverse().map(axis => ({ ...axis, values: [...axis.values].reverse() })),
      suites: [...original.suites].reverse(),
    };
    expect([...generateComposition(reordered)]).toEqual([...generateComposition(original)]);
  });

  test("retains missing fixtures without changing the declared case IDs", () => {
    const original = domain();
    const missing: InputRequirement = { id: "required-commercial-archive", kind: "content", path: "/intentionally-absent-verification-fixture/archive.pak", sha256: "c".repeat(64) };
    const absent: CompositionDomain = {
      ...original,
      axes: original.axes.map(axis => ({ ...axis, values: axis.values.map(value => ({ ...value, requirements: [missing] })) })),
    };
    const cases = [...generateComposition(absent)];
    expect(cases.map(item => item.id)).toEqual([...generateComposition(original)].map(item => item.id));
    expect(cases).toHaveLength(24);
    for (const item of cases) expect(item.requirements).toEqual([missing]);
    const relocated: CompositionDomain = { ...absent, axes: absent.axes.map(axis => ({ ...axis, values: axis.values.map(value => ({ ...value, requirements: [{ ...missing, path: "available/archive.pak" }] })) })) };
    expect([...generateComposition(relocated)].map(item => item.id)).toEqual(cases.map(item => item.id));
  });

  test("computes cardinality above safe integers and consumes only a bounded prefix", () => {
    const original = domain();
    const huge: CompositionDomain = {
      ...original,
      axes: Array.from({ length: 64 }, (_, index) => ({ id: `axis-${index.toString().padStart(2, "0")}`, values: [{ id: "0", requirements: [] }, { id: "1", requirements: [] }] })),
    };
    expect(compositionSize(huge)).toBe(36_893_488_147_419_103_232n);
    const iterator = generateComposition(huge);
    const ids = new Set<string>();
    for (let index = 0; index < 6; index += 1) {
      const next = iterator.next();
      if (next.done) throw new Error("Large declared domain ended before six cases");
      expect(Object.keys(next.value.configuration)).toHaveLength(64);
      ids.add(next.value.id);
    }
    expect(ids.size).toBe(6);
    expect(iterator.return(undefined).done).toBe(true);
  });

  test("orders Unicode identifiers by code units without locale collation", () => {
    const original = domain();
    const unicode: CompositionDomain = { ...original, axes: [{ id: "__proto__", values: ["é", "a", "😀", "Z", "e\u0301", "ä"].map(id => ({ id, requirements: [] })) }] };
    const cases = [...generateComposition(unicode)];
    expect(cases.filter(item => item.suiteId === "control").map(item => item.configuration["__proto__"])).toEqual(["Z", "a", "e\u0301", "ä", "é", "😀"]);
    expect(new Set(cases.map(item => item.id)).size).toBe(12);
    for (const item of cases) expect(Object.hasOwn(item.configuration, "__proto__")).toBe(true);
  });

  test("rejects empty and duplicate dimensions rather than dropping cells", () => {
    const original = domain();
    const axis = { id: "map", values: [{ id: "arena", requirements: [] }] };
    const invalid: readonly CompositionDomain[] = [
      { ...original, axes: [] }, { ...original, suites: [] },
      { ...original, axes: [axis, axis] },
      { ...original, axes: [{ id: "map", values: [] }] },
      { ...original, axes: [{ id: "", values: axis.values }] },
      { ...original, axes: [{ id: "map", values: [{ id: "", requirements: [] }] }] },
      { ...original, axes: [{ id: "map", values: [...axis.values, ...axis.values] }] },
      { ...original, suites: [...original.suites, ...original.suites] },
    ];
    for (const item of invalid) {
      expect(() => compositionSize(item)).toThrow();
      expect(() => generateComposition(item).next()).toThrow();
    }
  });

  test("rejects contradictory requirements with the same source identity", () => {
    const original = domain();
    const source: InputRequirement = { id: "original-source", kind: "source", path: "source/a.c", sha256: "a".repeat(64) };
    const conflict: CompositionDomain = { ...original, requirements: [source], axes: [{ id: "map", values: [{ id: "arena", requirements: [{ ...source, path: "source/b.c" }] }] }] };
    expect(() => generateComposition(conflict).next()).toThrow(/Conflicting input requirement original-source/);
  });

  test("every case belongs to exactly one shard and reordering cannot move it", () => {
    const original = domain();
    const cases = [...generateComposition(original)];
    const shards = Array.from({ length: 7 }, (_, index) => parseShard(`${index}/7`));
    for (const item of cases) {
      expect(shards.filter(shard => belongsToShard(item.id, original.seed, shard))).toHaveLength(1);
    }
    for (const bad of ["0/0", "7/7", "-1/7", "1/2/3", "1.5/7", "1/9007199254740992", " 0/7"]) expect(() => parseShard(bad)).toThrow();
  });
});
