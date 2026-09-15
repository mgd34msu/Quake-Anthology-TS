import { expect, test } from "bun:test";
import { sourceLevelTransition } from "../../src/app/bootstrap/simulation/source-transition.ts";
import { SharedTransitionCoordinator } from "../../src/world/gameplay/transitions.ts";
import type { ExecutableRecipe } from "../../src/contracts/content.ts";
import type { TransitionIntent } from "../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../src/world/actors/registry.ts";

const competitive = { campaign: { kind: "none" }, match: { content: "q3:classic:baseq3:installed", provider: "q3:match" } } satisfies Pick<ExecutableRecipe, "campaign" | "match">;

test("primary native Q1 and Q2 level completion rotates the selected competitive match", () => {
  const transitions = new SharedTransitionCoordinator(() => undefined);
  for (const map of ["q1:dm2", "q2:q2dm2"] satisfies readonly `${string}:${string}`[]) {
    const intent: TransitionIntent = { kind: "campaign-level", campaign: "q2:game", map, spawnPoint: "", gates: [], cause: null };
    const adapted = sourceLevelTransition(intent, competitive, "primary-world");
    expect(adapted).toEqual({ kind: "match-rotation", match: "q3:match", map });
    expect(transitions.resolve({ kind: "competitive", match: "q3:match" }, [adapted])).toEqual({ kind: "travel", map, spawnPoint: "", completeCampaign: false });
    expect(transitions.resolve({ kind: "competitive", match: "q2:other" }, [adapted])).toEqual({ kind: "stay", blocked: [] });
  }
});

test("actor-only sources cannot acquire competitive level authority", () => {
  const intent: TransitionIntent = { kind: "campaign-level", campaign: "q2:game", map: "q2:q2dm2", spawnPoint: "", gates: [], cause: null };
  const adapted = sourceLevelTransition(intent, competitive, "actor-source");
  expect(adapted).toBe(intent);
  expect(new SharedTransitionCoordinator(() => undefined).resolve({ kind: "competitive", match: "q3:match" }, [adapted])).toEqual({ kind: "stay", blocked: [] });
});

test("campaign level completion preserves spawn point, cause, and authored gates", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("source-transition"));
  const actor = actors.allocate("q2:game", "q2:player");
  const recipe = { ...competitive, campaign: { kind: "campaign", mission: { content: "q2:rerelease:baseq2:installed", provider: "q2:campaign" }, gamecode: { content: "q2:rerelease:baseq2:installed", provider: "q2:game" } } } satisfies Pick<ExecutableRecipe, "campaign" | "match">;
  const intent: TransitionIntent = { kind: "campaign-level", campaign: "q2:campaign", map: "q2:base2", spawnPoint: "entry", gates: [{ objective: "q2:key", satisfied: false }], cause: actor.id };
  const adapted = sourceLevelTransition(intent, recipe, "primary-world");
  expect(adapted).toBe(intent);
  expect(new SharedTransitionCoordinator(() => undefined).resolve({ kind: "campaign", campaign: "q2:campaign", allowRoundRestart: false }, [adapted])).toEqual({ kind: "stay", blocked: ["q2:key"] });
});

test("non-level intents keep their existing authority and meaning", () => {
  for (const intent of [
    { kind: "campaign-complete", campaign: "q2:campaign", gates: [] },
    { kind: "round-complete", match: "q2:match", winner: "red" },
    { kind: "match-rotation", match: "q2:match", map: "q2:q2dm1" },
  ] satisfies readonly TransitionIntent[]) expect(sourceLevelTransition(intent, competitive, "primary-world")).toBe(intent);
});
