import { SaveReader } from "../../../persistence/value.ts";
import { BotWaypoint, BotGoalState } from "./ai-state.ts";
/*
 * Per-game ownership for id Software's game/ai_main.c and ai_dmq3.c globals.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { BotLibrary } from "./library.ts";
import { CvarFlag, Q2CvarFlag } from "../../../core/cvars/index.ts";
import type { CvarRegistry, VmCvar } from "../../../core/cvars/index.ts";
import { EntityState } from "../../../content/q3/base/shared/entity-state.ts";
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

/** Bot settings borrow the application registry; cached reads retain source frame update timing. */
export class BotCvar implements VmCvar {
  private name: string | null = null;
  value = ""; numericValue = 0; integerValue = 0; modificationCount = 0;
  constructor(private readonly registry: CvarRegistry) {}
  register(name: string, defaultValue: string, flags = 0): void {
    this.name = name;
    const selectedFlags = this.registry.dialect === "q2-classic" || this.registry.dialect === "q2-rerelease"
      ? (flags & (CvarFlag.Archive | CvarFlag.UserInfo | CvarFlag.ServerInfo)) | ((flags & CvarFlag.Latch) !== 0 ? Q2CvarFlag.Latch : 0) | ((flags & (CvarFlag.ReadOnly | CvarFlag.Init)) !== 0 ? Q2CvarFlag.NoSet : 0) : flags;
    this.registry.register(name, defaultValue, selectedFlags); this.modificationCount = -1; this.update();
  }
  captureSaveState() { return { name: this.name, value: this.value, numericValue: this.numericValue, integerValue: this.integerValue, modificationCount: this.modificationCount }; }
  restoreSaveState(value: unknown): void {
    const reader = new SaveReader(value, "bot.cvar");
    this.name = reader.field("name").nullable(cell => cell.string());
    const cachedValue = reader.field("value").string();
    if (cachedValue.length > 255) reader.fail("cached cvar exceeds source storage");
    this.value = cachedValue; this.numericValue = reader.field("numericValue").number();
    this.integerValue = reader.field("integerValue").integer(); this.modificationCount = reader.field("modificationCount").integer();
  }
  update(): void {
    const source = this.name === null ? undefined : this.registry.find(this.name);
    if (source === undefined || source.modificationCount === this.modificationCount) return;
    if (source.value.length > 255) throw new RangeError("Bot cvar value exceeds source storage");
    this.value = source.value; this.numericValue = source.numericValue; this.integerValue = source.integerValue; this.modificationCount = source.modificationCount;
  }
  writeInteger(value: number): void { if (!Number.isSafeInteger(value)) throw new RangeError("Bot cvar integer requires a safe integer"); this.integerValue = value | 0; }
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
  private readonly vmCvars = new Map<string, BotCvar>();
  time = 0;
  regularUpdateTime = 0;
  numBots = 0;
  interbreed = false;
  interbreedMatchCount = 0;

  constructor(readonly game: SourceBotGame, readonly library: BotLibrary, readonly host: GameAiHost) {
    this.states = new BotStateStore(game.options.product);
  }

  captureSaveState() {
    const waypointId = (value: BotWaypoint | null): number | null => {
      if (value === null) return null;
      const id = this.deathmatch.waypoints.indexOf(value);
      if (id < 0) throw new Error("Waypoint pointer escapes AI heap");
      return id;
    };
    const goal = (value: BotGoalState) => ({ origin: { ...value.origin }, area: value.area, mins: { ...value.mins }, maxs: { ...value.maxs }, entity: value.entity, number: value.number, flags: value.flags, itemInfo: value.itemInfo });
    return {
      time: this.time,
      regularUpdateTime: this.regularUpdateTime,
      numBots: this.numBots,
      interbreed: this.interbreed,
      interbreedMatchCount: this.interbreedMatchCount,
      states: this.states.captureSaveState(this.game.memory, waypointId), observations: this.observations.captureSaveState(),
      nodeSwitches: [...this.nodeSwitches], cvars: [...this.vmCvars].map(([name, cell]) => ({ name, state: cell.captureSaveState() })),
      deathmatch: {
        gametype: this.deathmatch.gametype,
        maxclients: this.deathmatch.maxclients,
        lastTeleportTime: this.deathmatch.lastTeleportTime,
        maxBspModelIndex: this.deathmatch.maxBspModelIndex,
        alternateRoutesSetup: this.deathmatch.alternateRoutesSetup,
        ctfRedFlag: goal(this.deathmatch.ctfRedFlag),
        ctfBlueFlag: goal(this.deathmatch.ctfBlueFlag),
        ctfNeutralFlag: goal(this.deathmatch.ctfNeutralFlag),
        redObelisk: goal(this.deathmatch.redObelisk),
        blueObelisk: goal(this.deathmatch.blueObelisk),
        neutralObelisk: goal(this.deathmatch.neutralObelisk),
        lastTeleportOrigin: { ...this.deathmatch.lastTeleportOrigin },
        redAlternateGoals: this.deathmatch.redAlternateGoals.map(value => ({ ...value, origin: { ...value.origin } })),
        blueAlternateGoals: this.deathmatch.blueAlternateGoals.map(value => ({ ...value, origin: { ...value.origin } })),
        waypoints: this.deathmatch.waypoints.map(value => ({ inuse: value.inuse, name: value.name, goal: goal(value.goal), next: waypointId(value.next), prev: waypointId(value.prev) })),
        freeWaypoints: waypointId(this.deathmatch.freeWaypoints),
      },
      team: {
        numTeamMatesMaxClients: this.team.numTeamMatesMaxClients,
        sortTeamMatesMaxClients: this.team.sortTeamMatesMaxClients,
        teamOrdersMaxClients: this.team.teamOrdersMaxClients,
        clientFromNameMaxClients: this.team.clientFromNameMaxClients,
        clientOnSameTeamFromNameMaxClients: this.team.clientOnSameTeamFromNameMaxClients,
        taskPreferences: this.team.taskPreferences.map(value => ({ ...value })),
      },
      chat: [...this.chat.maxClients].map(([name, value]) => ({ name, value })),
      command: { notLeader: [...this.command.notLeader], maxClients: [...this.command.maxClients].map(([name, value]) => ({ name, value })) },
    };
  }

  restoreSaveState(value: unknown, remapObservation: (number: number, generation: number) => { readonly number: number; readonly generation: number }): void {
    const reader = new SaveReader(value, "bot.context"), dm = reader.field("deathmatch"), team = reader.field("team");
    const vector = (cell: SaveReader) => ({ x: cell.field("x").number(), y: cell.field("y").number(), z: cell.field("z").number() });
    const goal = (cell: SaveReader) => ({ origin: vector(cell.field("origin")), area: cell.field("area").integer(), mins: vector(cell.field("mins")), maxs: vector(cell.field("maxs")), entity: cell.field("entity").integer(), number: cell.field("number").integer(), flags: cell.field("flags").integer(), itemInfo: cell.field("itemInfo").integer() });
    const waypoint = (id: number | null): BotWaypoint | null => { if (id === null) return null; const result = this.deathmatch.waypoints[id]; if (result === undefined) return reader.fail("waypoint outside heap"); return result; };
    const points = dm.field("waypoints").list(cell => ({ inuse: cell.field("inuse").boolean(), name: cell.field("name").string(), goal: goal(cell.field("goal")), next: cell.field("next").nullable(id => id.integer(0)), prev: cell.field("prev").nullable(id => id.integer(0)) }));
    if (points.length !== this.deathmatch.waypoints.length) dm.fail("incorrect waypoint heap extent");
    for (const [index, point] of points.entries()) { const target = waypoint(index); if (target === null) return dm.fail("missing waypoint"); target.inuse = point.inuse; target.name = point.name; target.goal.copyFrom(point.goal); target.next = waypoint(point.next); target.prev = waypoint(point.prev); }
    this.deathmatch.freeWaypoints = waypoint(dm.field("freeWaypoints").nullable(id => id.integer(0)));
    this.time = reader.field("time").number();
    this.regularUpdateTime = reader.field("regularUpdateTime").number();
    this.numBots = reader.field("numBots").number();
    this.interbreed = reader.field("interbreed").boolean();
    this.interbreedMatchCount = reader.field("interbreedMatchCount").number();
    this.deathmatch.gametype = dm.field("gametype").number();
    this.deathmatch.maxclients = dm.field("maxclients").number();
    this.deathmatch.lastTeleportTime = dm.field("lastTeleportTime").number();
    this.deathmatch.maxBspModelIndex = dm.field("maxBspModelIndex").number();
    this.deathmatch.alternateRoutesSetup = dm.field("alternateRoutesSetup").boolean();
    this.deathmatch.ctfRedFlag.copyFrom(goal(dm.field("ctfRedFlag")));
    this.deathmatch.ctfBlueFlag.copyFrom(goal(dm.field("ctfBlueFlag")));
    this.deathmatch.ctfNeutralFlag.copyFrom(goal(dm.field("ctfNeutralFlag")));
    this.deathmatch.redObelisk.copyFrom(goal(dm.field("redObelisk")));
    this.deathmatch.blueObelisk.copyFrom(goal(dm.field("blueObelisk")));
    this.deathmatch.neutralObelisk.copyFrom(goal(dm.field("neutralObelisk")));
    Object.assign(this.deathmatch.lastTeleportOrigin, vector(dm.field("lastTeleportOrigin")));
    const alternative = (cell: SaveReader) => ({ origin: vector(cell.field("origin")), area: cell.field("area").integer(), startTravelTime: cell.field("startTravelTime").number(), goalTravelTime: cell.field("goalTravelTime").number(), extraTravelTime: cell.field("extraTravelTime").number() });
    this.deathmatch.redAlternateGoals = dm.field("redAlternateGoals").list(alternative);
    this.deathmatch.blueAlternateGoals = dm.field("blueAlternateGoals").list(alternative);
    this.team.numTeamMatesMaxClients = team.field("numTeamMatesMaxClients").integer();
    this.team.sortTeamMatesMaxClients = team.field("sortTeamMatesMaxClients").integer();
    this.team.teamOrdersMaxClients = team.field("teamOrdersMaxClients").integer();
    this.team.clientFromNameMaxClients = team.field("clientFromNameMaxClients").integer();
    this.team.clientOnSameTeamFromNameMaxClients = team.field("clientOnSameTeamFromNameMaxClients").integer();
    const preferences = team.field("taskPreferences").list(cell => ({ name: cell.field("name").string(), preference: cell.field("preference").integer() }));
    if (preferences.length !== this.team.taskPreferences.length) team.fail("incorrect team preference extent");
    this.team.taskPreferences.splice(0, this.team.taskPreferences.length, ...preferences);
    const restoreMap = (target: Map<string, number>, cell: SaveReader): void => {
      target.clear(); for (const entry of cell.list(entry => ({ name: entry.field("name").string(), value: entry.field("value").integer() }))) {
        if (target.has(entry.name)) cell.fail("duplicate cached cell"); target.set(entry.name, entry.value);
      }
    };
    restoreMap(this.chat.maxClients, reader.field("chat")); restoreMap(this.command.maxClients, reader.field("command").field("maxClients"));
    const leaders = reader.field("command").field("notLeader").list(cell => cell.boolean());
    if (leaders.length !== this.command.notLeader.length) reader.fail("incorrect leader cell extent");
    this.command.notLeader.splice(0, this.command.notLeader.length, ...leaders);
    this.nodeSwitches.splice(0, this.nodeSwitches.length, ...reader.field("nodeSwitches").list(cell => cell.string()));
    this.vmCvars.clear();
    for (const entry of reader.field("cvars").list(cell => ({ name: cell.field("name").string(), state: cell.field("state").value }))) {
      if (this.vmCvars.has(entry.name)) reader.fail("duplicate bot cvar");
      const cvar = new BotCvar(this.game.options.cvars); cvar.restoreSaveState(entry.state); this.vmCvars.set(entry.name, cvar);
    }
    this.observations.restoreSaveState(reader.field("observations").value, remapObservation);
    this.states.restoreSaveState(reader.field("states").value, this.game.memory, waypoint, remapObservation);
  }

  get gameType(): number { return this.deathmatch.gametype; }
  get navigation(): BotNavigation { return this.host.navigation; }
  get maxClients(): number { return this.deathmatch.maxclients; }
  random(): number { return this.game.random.random(); }

  cvar(name: string): VmCvar {
    let cell = this.vmCvars.get(name);
    if (cell === undefined) {
      cell = new BotCvar(this.game.options.cvars);
      this.vmCvars.set(name, cell);
    }
    return cell;
  }

  registerCvar(name: string, defaultValue: string, flags = 0): void {
    this.cvar(name).register(name, defaultValue, flags);
  }

  getClientState(client: number): PlayerState | null {
    const entity = this.game.entity(client);
    return !entity.present || entity.player === null ? null : entity.player.state.copy();
  }

  getEntityState(entityNum: number): EntityState | null {
    const entity = this.game.entity(entityNum);
    if (!entity.present || !entity.linked || entity.hidden) return null;
    return entity.state.copy();
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
