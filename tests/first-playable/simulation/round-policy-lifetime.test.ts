import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/index.ts";
import type { CombatPolicy } from "../../../src/contracts/gameplay.ts";

test("retired combat disposer cannot remove a replacement round's policy", () => {
 const actors = new SessionActorRegistry(createIdentityOwner("round-policy"));
 const authority = new GameplayAuthority(actors, new ActorCallbackTable(actors), { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
 const policy = (): CombatPolicy => ({ id: "q3:combat", decide: () => { throw new Error("No damage in ownership test"); } });
 const previous = authority.register(policy()); previous();
 const current = authority.register(policy()); previous();
 expect(() => authority.register(policy())).toThrow("already registered");
 current(); expect(() => authority.register(policy())).not.toThrow();
 actors.close();
});
