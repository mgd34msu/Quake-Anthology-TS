import { MatchState } from "../../team-arena/match.ts";
import { PlayerStateSlots } from "../shared/player-state.ts";
export class GameLevel extends MatchState {
  frameNum = 0;
  previousTime = 0;
  newSession = false;
  frySound = 0;
  readonly teamScores = new PlayerStateSlots(4);

  clear(): void {
    const fresh = new GameLevel();
    const { teamScores, numTeamVotingClients, sortedClients, vote, teamVotes } = this;
    for (let index = 0; index < teamScores.length; index++) teamScores.set(index, 0);
    numTeamVotingClients.fill(0); sortedClients.fill(0);
    Object.assign(vote, fresh.vote);
    Object.assign(teamVotes[0], fresh.teamVotes[0]); Object.assign(teamVotes[1], fresh.teamVotes[1]);
    Object.assign(this, fresh, { teamScores, numTeamVotingClients, sortedClients, vote, teamVotes });
  }
}

