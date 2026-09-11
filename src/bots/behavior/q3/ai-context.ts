/*
 * Per-game ownership for id Software's game/ai_main.c and ai_dmq3.c globals.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { BotLibrary } from "./library.ts";
import type { VmCvar } from "../../../core/cvars/index.ts";
import { EntityState } from "../../../content/q3/base/shared/entity-state.ts";
import { ServerEntityFlags } from "../../../content/q3/base/shared/entity-shared.ts";
import type { PlayerState, UserCommand } from "../../../content/q3/base/shared/player-state.ts";
import { GameAiChatState } from "./ai-chat.ts";
import { GameAiCommandState } from "./ai-command.ts";
import { GameAiDeathmatchState, botFreeWaypoints } from "./ai-navigation.ts";
import { BotStateStore } from "./ai-state.ts";
import type { BotState } from "./ai-state.ts";
import { GameAiTeamState } from "./ai-team.ts";
import type { SourceBotGame } from "./game-host.ts";
import type { BotNavigation } from "./navigation-types.ts";
import { BotEntityObservations } from "./observations.ts";
import type { AasBspEntities } from "../library/bsp-entities.ts";

/** Source server traps bound to the real server slots, reliable ring and current map. */
export interface GameAiHost {
  readonly navigation: BotNavigation;
  readonly bspEntities: AasBspEntities;
  pointContents(point: import("../../../contracts/math.ts").Vec3): number;
  getSnapshotEntity(client: number, sequence: number): number;
  getConsoleMessage(client: number): string | null;
  userCommand(client: number, command: UserCommand): void;
  insertConsoleCommand(text: string): void;
  checkBotSpawn(): void;
  loadMap(name: string): number;
}

export interface BotSnapshotEntity {
  readonly nextSequence: number;
  readonly state: EntityState;
}

/** Construction allocates source cells only; every game and botlib service is borrowed. */
export class GameAiContext {
  readonly observations = new BotEntityObservations(1024);
  readonly states: BotStateStore;
  readonly deathmatch = new GameAiDeathmatchState();
  readonly team = new GameAiTeamState();
  readonly chat = new GameAiChatState();
  readonly command = new GameAiCommandState();
  readonly nodeSwitches: string[] = [];
  private readonly vmCvars = new Map<string, VmCvar>();
  time = 0;
  regularUpdateTime = 0;
  numBots = 0;
  interbreed = false;
  interbreedMatchCount = 0;

  constructor(readonly game: SourceBotGame, readonly library: BotLibrary, readonly host: GameAiHost) {
    this.states = new BotStateStore(game.options.product);
  }

  get gameType(): number { return this.deathmatch.gametype; }
  get navigation(): BotNavigation { return this.host.navigation; }
  get maxClients(): number { return this.deathmatch.maxclients; }
  random(): number { return this.game.random.random(); }

  cvar(name: string): VmCvar {
    let cell = this.vmCvars.get(name);
    if (cell === undefined) {
      cell = this.game.options.cvars.createVm();
      this.vmCvars.set(name, cell);
    }
    return cell;
  }

  registerCvar(name: string, defaultValue: string, flags = 0): void {
    this.cvar(name).register(name, defaultValue, flags);
  }

  getClientState(client: number): PlayerState | null {
    const entity = this.game.pool.at(client);
    return !entity.inuse || entity.client === null ? null : entity.client.ps.copy();
  }

  getEntityState(entityNum: number): EntityState | null {
    const entity = this.game.pool.at(entityNum);
    if (!entity.inuse || this.game.world.linkState(entityNum)?.linked !== true || (entity.r.svFlags & ServerEntityFlags.NOCLIENT) !== 0) return null;
    return entity.s.copy();
  }

  getSnapshotEntity(client: number, sequence: number): BotSnapshotEntity {
    const entityNum = this.host.getSnapshotEntity(client, sequence);
    if (entityNum === -1) return { nextSequence: -1, state: new EntityState() };
    const state = this.getEntityState(entityNum);
    return { nextSequence: (sequence + 1) | 0, state: state === null ? new EntityState() : state };
  }

  resetState(state: BotState): void {
    botFreeWaypoints(this, state.checkpoints);
    botFreeWaypoints(this, state.patrolPoints);
    state.resetDecisionState();
    if (state.ms !== 0) this.library.moveStates.reset(state.ms);
    if (state.gs !== 0) this.library.goals.resetGoalState(state.gs);
    if (state.ws !== 0) this.library.weapons.resetState(state.ws);
    if (state.gs !== 0) this.library.goals.resetAvoidGoals(state.gs);
    if (state.ms !== 0) this.library.moveStates.resetAvoidReach(state.ms);
  }
}

export function botResetState(context: GameAiContext, state: BotState): void { context.resetState(state); }
