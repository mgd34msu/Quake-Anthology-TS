import { SaveReader } from "../../../../persistence/value.ts";
import type { GameLevel } from "./level.ts";
import { captureLevelValues, readLevelValues, restoreLevelValues } from "./save-values.ts";
export function captureQ3Level(level: GameLevel) {
  return { values: captureLevelValues(level), teamScores: Array.from(level.teamScores.copy()),
    numTeamVotingClients: [...level.numTeamVotingClients], sortedClients: [...level.sortedClients],
    vote: { time: level.vote.time, yes: level.vote.yes, no: level.vote.no, string: level.vote.string,
      displayString: level.vote.displayString, executeTime: level.vote.executeTime },
    teamVotes: level.teamVotes.map(vote => ({ time: vote.time, yes: vote.yes, no: vote.no, string: vote.string })) };
}
export function restoreQ3Level(level: GameLevel, value: unknown): void {
  const reader = new SaveReader(value, "q3.level");
  restoreLevelValues(level, readLevelValues(reader.field("values")));
  const scores = reader.field("teamScores").list(value => value.number());
  const voting = reader.field("numTeamVotingClients").list(value => value.number());
  const sorted = reader.field("sortedClients").list(value => value.number());
  const teams = reader.field("teamVotes").list(value => ({ time: value.field("time").number(), yes: value.field("yes").number(), no: value.field("no").number(), string: value.field("string").string() }));
  if (scores.length !== level.teamScores.length || voting.length !== 2 || sorted.length !== level.sortedClients.length || teams.length !== 2) reader.fail("Q3 level table length mismatch");
  scores.forEach((score, index) => level.teamScores.set(index, score));
  const first = voting[0], second = voting[1], red = teams[0], blue = teams[1];
  if (first === undefined || second === undefined || red === undefined || blue === undefined) return reader.fail("Q3 level team table missing");
  level.numTeamVotingClients[0] = first; level.numTeamVotingClients[1] = second;
  sorted.forEach((slot, index) => { level.sortedClients[index] = slot; });
  const vote = reader.field("vote");
  level.vote.time = vote.field("time").number(); level.vote.yes = vote.field("yes").number(); level.vote.no = vote.field("no").number();
  level.vote.string = vote.field("string").string(); level.vote.displayString = vote.field("displayString").string(); level.vote.executeTime = vote.field("executeTime").number();
  Object.assign(level.teamVotes[0], red); Object.assign(level.teamVotes[1], blue);
}
