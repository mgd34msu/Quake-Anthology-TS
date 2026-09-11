/* Botlib behavior composition; the shared session owns actors, navigation and movement. GPL-2.0-or-later. */
import { ScriptGlobalDefines } from "../../../ui/common/legacy/script/preprocessor.ts";
import type { BotSourceFiles } from "../assets.ts";
import { BotMemory } from "../library/memory.ts";
import { BotLibVars } from "../library/libvars.ts";
import { BotScriptSources } from "../library/script-sources.ts";
import { BotCharacterLibrary } from "../library/character.ts";
import { BotActionBuffer } from "../library/actions.ts";
import { BotChatLibrary } from "../library/chat.ts";
import { WeightConfigStore } from "../library/weights.ts";
import type { BotRandom } from "../library/weights.ts";
import { WeaponAi } from "../library/weapons.ts";
import { BotGoalLibrary } from "../library/goals.ts";
import type { GoalWorld } from "../library/goals.ts";
import { BotLog } from "../library/log.ts";
import type { BotLogOpenResult } from "../library/log.ts";
import { geneticParentsAndChildSelection } from "../library/genetic.ts";
import type { GeneticSelectionInput, GeneticSelectionResult } from "../library/genetic.ts";
import { BotMoveStateStore } from "./movement-state.ts";

export interface SourceBotLibraryOptions {
  readonly files: BotSourceFiles;
  readonly random: BotRandom;
  readonly debug: boolean;
  milliseconds(): number;
  print(severity: 1 | 2 | 3 | 4, text: string): undefined;
  clientCommand(client: number, command: string): undefined;
  openLog(filename: string): BotLogOpenResult;
}

export class BotLibrary {
  readonly memory = new BotMemory();
  readonly variables = new BotLibVars(this.memory);
  readonly globals;
  readonly sources;
  readonly characters;
  readonly actions;
  readonly chat;
  readonly weights;
  readonly weapons;
  readonly goals;
  readonly log;
  readonly moveStates;
  private readonly logGlobals = { time: 0 };
  private initialized = false;
  private closed = false;

  constructor(readonly options: SourceBotLibraryOptions) {
    const variables = this.variables, print = options.print, memory = this.memory;
    const reloadCharacters = (): boolean => variables.getValue("bot_reloadcharacters") !== 0;
    this.globals = new ScriptGlobalDefines(diagnostic => print(diagnostic.severity === "warning" ? 2 : 3, diagnostic.message), memory);
    this.sources = new BotScriptSources(options.files, this.globals, print, text => print(1, text), memory);
    this.log = new BotLog({ variables, globals: this.logGlobals, print, openFile: options.openLog });
    this.weights = new WeightConfigStore(this.sources, { memory, reloadCharacters, print });
    this.characters = new BotCharacterLibrary(this.sources, { memory, log: this.log, reloadCharacters,
      report: diagnostic => print(diagnostic.severity === "warning" ? 2 : 3, diagnostic.message) });
    this.weapons = new WeaponAi({ resolver: this.sources, weights: this.weights }, { memory,
      maxWeaponInfo: () => this.capacity("max_weaponinfo"), maxProjectileInfo: () => this.capacity("max_projectileinfo"),
      report: diagnostic => print(diagnostic.severity === "warning" ? 2 : 3, diagnostic.message) });
    this.goals = new BotGoalLibrary({ memory, resolver: this.sources, weightStore: this.weights, log: this.log,
      random: options.random, clock: () => this.time(), gameType: () => variables.value("g_gametype", "0"),
      maxItemInfo: { get: () => variables.value("max_iteminfo", "256"), set: value => variables.set("max_iteminfo", String(value)) },
      maxLevelItems: () => variables.value("max_levelitems", "256"), droppedWeight: () => variables.value("droppedweight", "1000"),
      developer: () => variables.getValue("bot_developer") !== 0,
      report: diagnostic => print(diagnostic.severity === "warning" ? 2 : diagnostic.severity === "error" ? 3 : 1, diagnostic.message) });
    const commands = { *clientCommand(client: number, command: string) { options.clientCommand(client, command); return undefined; } };
    this.actions = new BotActionBuffer(null, commands, memory);
    this.chat = new BotChatLibrary(this.sources, { random: options.random, time: () => this.time(), clientCommand: commands.clientCommand,
      report: diagnostic => print(diagnostic.severity === "warning" ? 2 : diagnostic.severity === "error" || diagnostic.severity === "fatal" ? 3 : 1, diagnostic.message) },
    { log: this.log, maxMessages: () => variables.value("max_messages", "1024"),
      get synonymFile() { return variables.string("synfile", "syn.c"); },
      get randomFile() { return variables.string("rndfile", "rnd.c"); },
      get matchFile() { return variables.string("matchfile", "match.c"); },
      get replyFile() { return variables.string("rchatfile", "rchat.c"); },
      noChat: () => variables.value("nochat", "0") !== 0, reloadCharacters,
      testInitialChats: () => variables.getValue("bot_testichat") !== 0,
      testReplyChats: () => variables.getValue("bot_testrchat") !== 0,
      developer: () => variables.getValue("bot_developer") !== 0 }, memory);
    this.moveStates = new BotMoveStateStore({ time: () => this.time(), print,
      libVar: (name, value) => variables.getOrCreate(name, value) }, memory);
  }

  get debugBuild(): boolean { return this.options.debug; }
  time(): number { return this.logGlobals.time; }
  private capacity(name: string): number {
    const value = Math.trunc(this.variables.value(name, "32"));
    if (value < 1) { this.variables.set(name, "32"); return 32; }
    return value;
  }
  setup(): number {
    if (this.closed) throw new Error("Bot behavior library is closed");
    this.log.open("botlib.log");
    this.options.print(1, "------- BotLib Initialization -------\n");
    this.actions.setup(Math.trunc(this.variables.value("maxclients", "128")));
    const weapons = this.weapons.setup(this.variables.string("weaponconfig", "weapons.c"));
    if (weapons !== 0) return weapons;
    const goals = this.goals.setup(this.variables.string("itemconfig", "items.c"));
    if (goals !== 0) return goals;
    this.variables.getOrCreate("droppedweight", "1000");
    this.chat.setup();
    const movement = this.moveStates.setup();
    if (movement !== 0) return movement;
    this.initialized = true;
    return 0;
  }
  loadMap(world: GoalWorld): number {
    if (!this.initialized || this.closed) throw new Error("Initialize bot behavior before loading its map goals");
    this.goals.initLevelItems(world);
    return 0;
  }
  startFrame(time: number): number {
    if (!this.initialized || this.closed) throw new Error("Initialize bot behavior before advancing its observations");
    this.logGlobals.time = f32(time);
    return 0;
  }
  geneticSelection(ranks: GeneticSelectionInput): GeneticSelectionResult {
    return geneticParentsAndChildSelection(ranks, this.options.random, text => this.options.print(2, text));
  }
  shutdown(): number {
    if (this.closed) return 0;
    this.chat.shutdown(); this.moveStates.shutdown(); this.goals.shutdown(); this.weapons.shutdown();
    this.weights.shutdown(); this.characters.shutdown(); this.actions.shutdown();
    this.variables.clear(); this.globals.clear(); this.log.shutdown(); this.sources.checkOpenSourceHandles();
    this.sources.disposeResources();
    this.memory.dispose(); this.closed = true; this.initialized = false;
    return 0;
  }
}

function f32(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Bot observation time must be finite");
  return Math.fround(value);
}
