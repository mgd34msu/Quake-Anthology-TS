import type { CompositionDomain, ExpectedCase, InputRequirement } from "../../verification/schema/contracts.ts";
import { hashJson } from "./hash.ts";

function compareId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function unique(values: readonly string[], description: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) throw new Error(`Empty or duplicate ${description}: ${value}`);
    seen.add(value);
  }
}

export function validateDomain(domain: CompositionDomain): void {
  if (domain.schemaVersion !== 1 || domain.id.length === 0) throw new Error("Invalid composition domain identity");
  if (domain.axes.length === 0 || domain.suites.length === 0) throw new Error("A composition domain needs axes and required suites");
  unique(domain.axes.map(axis => axis.id), "axis ID");
  unique(domain.suites.map(suite => suite.id), "suite ID");
  for (const axis of domain.axes) {
    if (axis.values.length === 0) throw new Error(`Empty domain axis ${axis.id}: retain a named missing-input value`);
    unique(axis.values.map(value => value.id), `value ID in ${axis.id}`);
  }
  for (const suite of domain.suites) {
    if (suite.contracts.length === 0) throw new Error(`Suite ${suite.id} has no expected contract`);
    if (suite.profiles.length === 0) throw new Error(`Suite ${suite.id} has no verification profile`);
    unique(suite.contracts.map(contract => contract.id), `contract ID in ${suite.id}`);
    for (const contract of suite.contracts) {
      if (!Number.isSafeInteger(contract.minimumAssertions) || contract.minimumAssertions <= 0) {
        throw new Error(`Contract ${contract.id} must require at least one assertion`);
      }
    }
  }
}

export function compositionSize(domain: CompositionDomain): bigint {
  validateDomain(domain);
  return domain.axes.reduce((total, axis) => total * BigInt(axis.values.length), BigInt(domain.suites.length));
}

function combineRequirements(requirements: readonly InputRequirement[]): readonly InputRequirement[] {
  const combined = new Map<string, InputRequirement>();
  for (const requirement of requirements) {
    const previous = combined.get(requirement.id);
    if (previous !== undefined && hashJson(previous) !== hashJson(requirement)) {
      throw new Error(`Conflicting input requirement ${requirement.id}`);
    }
    combined.set(requirement.id, requirement);
  }
  return [...combined.values()].sort(compareId);
}

export function* generateComposition(domain: CompositionDomain): Generator<ExpectedCase, void, undefined> {
  validateDomain(domain);
  const axes = [...domain.axes].sort(compareId);
  function* visit(index: number, configuration: Readonly<Record<string, string>>, requirements: readonly InputRequirement[]): Generator<ExpectedCase, void, undefined> {
    const axis = axes[index];
    if (axis !== undefined) {
      for (const value of [...axis.values].sort(compareId)) {
        yield* visit(index + 1, { ...configuration, [axis.id]: value.id }, [...requirements, ...value.requirements]);
      }
      return;
    }
    const configurationId = `${domain.id}/${hashJson(configuration)}`;
    for (const suite of [...domain.suites].sort(compareId)) {
      yield {
        id: `${configurationId}/${encodeURIComponent(suite.id)}`,
        configurationId,
        suiteId: suite.id,
        evidenceKind: suite.evidenceKind,
        configuration,
        profiles: suite.profiles,
        requirements: combineRequirements(requirements),
        contracts: suite.contracts,
        seed: domain.seed,
        clockScheduleSha256: domain.clockScheduleSha256,
        networkScheduleSha256: domain.networkScheduleSha256,
        sourcePaths: domain.sourcePaths,
        command: suite.command,
      };
    }
  }
  yield* visit(0, {}, domain.requirements);
}

export interface Shard {
  readonly index: number;
  readonly count: number;
}

export function parseShard(value: string): Shard {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match === null) throw new Error("Shard must be INDEX/COUNT");
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || index < 0 || index >= count) {
    throw new Error("Shard requires 0 <= INDEX < COUNT");
  }
  return { index, count };
}

export function belongsToShard(caseId: string, seed: number, shard: Shard): boolean {
  if (!Number.isSafeInteger(shard.index) || !Number.isSafeInteger(shard.count) || shard.index < 0 || shard.count < 1 || shard.index >= shard.count) {
    throw new Error("Invalid shard");
  }
  return BigInt(`0x${hashJson({ caseId, seed })}`) % BigInt(shard.count) === BigInt(shard.index);
}
