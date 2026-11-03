import { expect, test } from "bun:test";
import { aiEnterBattleChase, aiEnterBattleFight, aiEnterBattleNbg, aiEnterBattleRetreat, aiEnterBattleSuicidalFight, aiEnterRespawn,
  aiEnterSeekLtg, aiEnterSeekNbg, aiNodeObserver, aiNodeRespawn } from "../../../src/bots/behavior/q3/ai-decision.ts";
import { BotFlag } from "../../../src/bots/behavior/q3/ai-definitions.ts";
import { BotState } from "../../../src/bots/behavior/q3/ai-state.ts";
import { GameAiContext } from "../../../src/bots/behavior/q3/ai-context.ts";
import { MoveType } from "../../../src/content/q3/base/shared/definitions.ts";

/** The smallest context the node functions touch, assigned onto an uninitialised GameAiContext instance. */
function stub(time = 1): { readonly context: GameAiContext; readonly respawns: number[]; readonly resets: string[] } {
  const respawns: number[] = [], resets: string[] = [], noop = () => undefined;
  const prototype: object = GameAiContext.prototype, created: unknown = Object.create(prototype);
  if (!(created instanceof GameAiContext)) throw new Error("Expected a GameAiContext instance");
  const context = Object.assign(created, { nodeSwitches: [], time, gameType: 0, random: () => 1, cvar: () => ({ integerValue: 1 }),
    game: { options: { configstrings: { get: () => "n\\bot\\t\\0" }, engine: { print: noop } } },
    library: {
      actions: { respawn: (client: number) => { respawns.push(client); }, talk: noop },
      moveStates: { resetLastAvoidReach: () => { resets.push("last-avoid"); }, reset: () => { resets.push("reset"); }, resetAvoidReach: () => { resets.push("avoid"); } },
      goals: { resetGoalState: noop, resetAvoidGoals: noop, getTopGoal: () => null, goalName: () => "" } } });
  return { context, respawns, resets };
}

test("every aiEnter function selects its node and records the switch", () => {
  const table: readonly [BotState["aiNode"], (context: GameAiContext, state: BotState, reason: string) => void, string][] = [
    ["seek-ltg", aiEnterSeekLtg, "seek LTG"], ["seek-nbg", aiEnterSeekNbg, "seek NBG"], ["battle-fight", aiEnterBattleFight, "battle fight"],
    ["battle-chase", aiEnterBattleChase, "battle chase"], ["battle-retreat", aiEnterBattleRetreat, "battle retreat"], ["battle-nbg", aiEnterBattleNbg, "battle NBG"],
    ["respawn", aiEnterRespawn, "respawn"],
  ];
  for (const [node, enter, label] of table) {
    const { context } = stub(), state = new BotState("baseq3");
    enter(context, state, "test");
    expect(state.aiNode).toBe(node);
    expect(context.nodeSwitches.length).toBe(1);
    expect(context.nodeSwitches[0]).toContain(`entered ${label}`);
    expect(context.nodeSwitches[0]).toContain("from test");
  }
});

test("battle fight and chase reset the avoid memory and the chase clock like AIEnter_Battle_*", () => {
  const fight = stub(), state = new BotState("baseq3");
  aiEnterBattleFight(fight.context, state, "seek ltg: found enemy");
  expect(fight.resets).toEqual(["last-avoid"]);
  const chase = stub(7.5), chasing = new BotState("baseq3");
  aiEnterBattleChase(chase.context, chasing, "battle fight: enemy not visible");
  expect(chasing.chaseTime).toBe(7.5);
});

test("the suicidal-fight latch is set by AIEnter_Battle_SuicidalFight and, as in id's code, never cleared by later node entries", () => {
  const { context } = stub(), state = new BotState("baseq3");
  expect((state.flags & BotFlag.FIGHTSUICIDAL) !== 0).toBe(false);
  aiEnterBattleSuicidalFight(context, state, "battle retreat: no way out");
  expect(state.aiNode).toBe("battle-fight");
  for (const enter of [aiEnterSeekLtg, aiEnterBattleFight, aiEnterRespawn, aiEnterBattleFight]) {
    enter(context, state, "later");
    expect((state.flags & BotFlag.FIGHTSUICIDAL) !== 0).toBe(true);
  }
});

test("the observer node returns to stand when the bot stops being a spectator", () => {
  const { context } = stub(10), state = new BotState("baseq3");
  state.curPs.pmType = MoveType.PM_SPECTATOR;
  expect(aiNodeObserver(context, state)).toBe(true);
  expect(state.aiNode).not.toBe("stand");
  state.curPs.pmType = MoveType.PM_NORMAL;
  expect(aiNodeObserver(context, state)).toBe(true);
  expect(state.aiNode).toBe("stand");
  expect(state.standFindEnemyTime).toBe(11);
});

test("the respawn node waits for its timer, presses respawn once, then leaves when alive", () => {
  const { context, respawns } = stub(5), state = new BotState("baseq3");
  state.client = 3; state.curPs.pmType = MoveType.PM_DEAD;
  aiEnterRespawn(context, state, "battle fight: bot dead");
  expect(state.respawnWait).toBe(false);
  expect(state.respawnTime).toBeGreaterThan(6);
  expect(aiNodeRespawn(context, state)).toBe(true);
  expect(respawns).toEqual([]);
  context.time = state.respawnTime + 0.1;
  aiNodeRespawn(context, state);
  expect(state.respawnWait).toBe(true);
  expect(respawns).toEqual([3]);
  aiNodeRespawn(context, state);
  expect(respawns).toEqual([3, 3]);
  expect(state.aiNode).toBe("respawn");
  state.curPs.pmType = MoveType.PM_NORMAL;
  aiNodeRespawn(context, state);
  expect(state.aiNode).toBe("seek-ltg");
});
