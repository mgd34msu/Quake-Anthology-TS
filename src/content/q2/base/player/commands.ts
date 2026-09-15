import type { CommandDocumentation } from "../../../../core/commands/documentation.ts";
import type { Q2PlayerContext } from "./types.ts";
import type { Q2Players } from "./index.ts";
import { q2EnvironmentDamage } from "./environment.ts";

function team(context: Q2PlayerContext, skin: string): string {
  const slash = skin.indexOf("/");
  if (slash < 0) return skin;
  return (context.game.options.deathmatchFlags & 64) !== 0 ? skin.slice(0, slash) : skin.slice(slash + 1);
}
function print(context: Q2PlayerContext, text: string): undefined {
  return context.hooks.emit({ kind: "print", target: context.entity.actor.id, level: "high", text });
}
function select(context: Q2PlayerContext, direction: 1 | -1, filter: "all" | "weapon" | "power"): undefined {
  const { entity, game, state, items } = context;
  const list = items.list(), first = list.findIndex(item => item.id === state.selectedItem);
  for (let index = 1; index <= list.length; index++) {
    const item = list[(first + direction * index + list.length * 2) % list.length];
    if (item !== undefined && item.usable && game.host.inventory.count(entity.actor.id, item.id) > 0 &&
      (filter === "all" || filter === "weapon" && item.kind === "weapon" || filter === "power" && item.kind === "power")) {
      state.selectedItem = item.id; return undefined;
    }
  }
  state.selectedItem = null;
  return undefined;
}
function use(context: Q2PlayerContext, value: string): undefined {
  const { entity, game, state, weapons, items } = context;
  const item = items.lookup(value);
  if (item === null) return print(context, `unknown item: ${value}\n`);
  if (!item.usable) return print(context, "Item is not usable.\n");
  if (game.host.inventory.count(entity.actor.id, item.id) === 0) return print(context, `Out of item: ${item.name}\n`);
  const weapon = weapons.registeredDefinitions().find(candidate => candidate.item === item.id);
  if (weapon !== undefined) {
    const result = weapons.requestWeapon(entity, game, weapon.name);
    if (result === "no-ammo" || result === "not-enough-ammo") return print(context, `Not enough ${weapon.ammo ?? "ammo"} for ${item.name}.\n`);
  } else items.use(entity.actor, item.id, game);
  state.selectedItem = item.id;
  return undefined;
}
function drop(players: Q2Players, context: Q2PlayerContext, value: string): undefined {
  const { entity, game, items, weapons } = context;
  const item = items.lookup(value);
  if (item === null) return print(context, `unknown item: ${value}\n`);
  if (!item.droppable || game.options.mode === "coop" && item.stayCoop && !players.canDropCoopStayItems(game)) return print(context, "Item is not dropable.\n");
  const count = game.host.inventory.count(entity.actor.id, item.id);
  if (count === 0) return print(context, `Out of item: ${item.name}\n`);
  const weapon = weapons.registeredDefinitions().find(candidate => candidate.item === item.id);
  if (weapon !== undefined && !weapons.canDrop(entity, game, weapon.name)) return print(context, "Can't drop current weapon\n");
  const grenade = weapons.states.get(entity.actor.id)?.weapon === "grenades" && item.id === "q2:ammo_grenades";
  const quantity = item.kind === "ammo" ? Math.min(item.quantity, count) : 1;
  if (grenade && count - quantity <= 0) return print(context, "Can't drop current weapon\n");
  const dropped = items.drop(entity, game, item.id, { playerDeath: false });
  if (dropped !== null) { dropped.count = quantity; game.host.inventory.consume(entity.actor, item.id, quantity); }
  return undefined;
}
function weaponCycle(context: Q2PlayerContext, direction: 1 | -1): undefined {
  const current = context.weapons.states.get(context.entity.actor.id)?.weapon;
  const definitions = context.weapons.registeredDefinitions(), index = definitions.findIndex(weapon => weapon.name === current);
  for (let step = 1; step <= definitions.length; step++) {
    const weapon = definitions[(index + direction * step + definitions.length * 2) % definitions.length];
    if (weapon !== undefined && context.weapons.requestWeapon(context.entity, context.game, weapon.name) === "selected") break;
  }
  return undefined;
}
export function q2ChatAllowed(context: Q2PlayerContext): boolean {
  const { state, rules, game } = context, now = game.host.now();
  if (rules.floodMessages !== 0) {
    if (now < state.floodLockUntil) {
      print(context, `You can't talk for ${Math.trunc(state.floodLockUntil - now)} more seconds\n`);
      return false;
    }
    const previous = state.floodTimes[Math.max(0, state.floodTimes.length - Math.min(10, Math.trunc(rules.floodMessages)))];
    if (state.floodTimes.length >= rules.floodMessages && previous !== undefined && now - previous < rules.floodSeconds) {
      state.floodLockUntil = now + rules.floodWaitSeconds;
      print(context, `Flood protection:  You can't talk for ${Math.trunc(rules.floodWaitSeconds)} seconds.\n`);
      return false;
    }
    state.floodTimes.push(now); if (state.floodTimes.length > 10) state.floodTimes.shift();
  }
  return true;
}
function say(players: Q2Players, context: Q2PlayerContext, args: readonly string[], teamOnly: boolean): undefined {
  const { state, game, entity, hooks } = context;
  if (args.length === 0 || !q2ChatAllowed(context)) return undefined;
  const isTeam = teamOnly && (game.options.deathmatchFlags & (64 | 128)) !== 0;
  let words = args.join(" "); if (words.startsWith('"')) words = words.slice(1, words.endsWith('"') ? -1 : undefined);
  const message = `${isTeam ? `(${state.name})` : state.name}: ${words}`.slice(0, 150) + "\n";
  for (const [actor, other] of players.states) {
    if (!other.connected || isTeam && team(context, other.skin) !== team(context, state.skin)) continue;
    hooks.emit({ kind: "print", target: actor, level: "chat", text: message });
  }
  if (!players.states.has(entity.actor.id)) throw new Error("Chat actor disconnected during synchronous command");
  return undefined;
}

type Q2CommandHandler = (players: Q2Players, context: Q2PlayerContext, args: readonly string[], command: string) => void;
export interface Q2ClientCommandDefinition {
  readonly name: string;
  readonly documentation: CommandDocumentation;
  readonly intermission: boolean;
  readonly run: Q2CommandHandler;
}

const chat: Q2CommandHandler = (players, context, args, command) => { say(players, context, args, command === "say_team"); };

const listPlayers: Q2CommandHandler = (players, context, _args, command) => {
  const { game } = context;
  const list = [...players.states.values()].filter(value => value.connected).sort((left, right) => command === "players" ? left.score - right.score : left.slot - right.slot);
  let message = "";
  for (const row of list) {
    const seconds = Math.trunc(game.host.now() - row.enteredAt);
    const line = command === "players" ? `${String(row.score).padStart(3)} ${row.name}\n`
      : `${String(Math.trunc(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} ${String(row.ping).padStart(4)} ${String(row.score).padStart(3)} ${row.name}${row.spectator ? " (spectator)" : ""}\n`;
    if (message.length + line.length > 1280) { message += "...\n"; break; } message += line;
  }
  print(context, message + (command === "players" ? `\n${list.length} players\n` : ""));
};

const score: Q2CommandHandler = (players, context) => {
  const { entity, game, state } = context;
  state.showInventory = false; state.showHelp = false; state.showScores = !state.showScores;
  if (state.showScores && game.options.mode !== "singleplayer") players.scoreboard(entity, game);
};

const showHelp: Q2CommandHandler = (players, context) => {
  const { entity, game, state, hooks } = context;
  state.showInventory = false; state.showScores = false;
  if (game.options.mode === "deathmatch") { state.showScores = true; players.scoreboard(entity, game); }
  else { state.showHelp = !state.showHelp; hooks.emit({ kind: "help", actor: entity.actor.id, visible: state.showHelp }); }
};

const useItem: Q2CommandHandler = (_players, context, args) => {
  use(context, args.join(" "));
};

const dropItem: Q2CommandHandler = (players, context, args) => {
  drop(players, context, args.join(" "));
};

const inventory: Q2CommandHandler = (_players, context) => {
  const { entity, game, state, hooks } = context;
  state.showScores = false; state.showHelp = false; state.showInventory = !state.showInventory;
  if (state.showInventory) hooks.emit({ kind: "inventory", actor: entity.actor.id, entries: game.host.inventory.entries(entity.actor.id) });
};

const selectItem: Q2CommandHandler = (players, context, _args, command) => {
  const { entity, game, state } = context;
  if (state.chaseTarget !== null) players.chase(entity, game, command.startsWith("invnext") ? 1 : -1);
  else select(context, command.startsWith("invnext") ? 1 : -1, command.endsWith("w") ? "weapon" : command.endsWith("p") ? "power" : "all");
};

const selectedItem: Q2CommandHandler = (players, context, _args, command) => {
  const { entity, game, state } = context;
  if (state.selectedItem === null || game.host.inventory.count(entity.actor.id, state.selectedItem) === 0) select(context, 1, "all");
  if (state.selectedItem === null) print(context, "No item to use.\n");
  else if (command === "invuse") use(context, state.selectedItem); else drop(players, context, state.selectedItem);
};

// The original next/previous names traverse the item table in reverse/forward order respectively.
const previousWeapon: Q2CommandHandler = (_players, context) => {
  weaponCycle(context, 1);
};

const nextWeapon: Q2CommandHandler = (_players, context) => {
  weaponCycle(context, -1);
};

const lastWeapon: Q2CommandHandler = (_players, context) => {
  const { entity, game } = context;
  const weapon = context.weapons.states.get(entity.actor.id)?.lastWeapon;
  if (weapon !== null && weapon !== undefined) context.weapons.requestWeapon(entity, game, weapon);
};

const killPlayer: Q2CommandHandler = (_players, context) => {
  const { entity, game, state } = context;
  if (game.options.edition === "rerelease" && state.spectator || game.host.now() - state.respawnTime < 5) return;
  state.god = false; entity.flags &= ~16; game.host.combat.setTraits(entity.actor, { invulnerable: false });
  q2EnvironmentDamage(context, Math.max(1, game.host.combat.read(entity.actor.id)?.health ?? 0) + 1, 23, 32);
};

const putAway: Q2CommandHandler = (_players, context) => {
  const { state } = context;
  state.showScores = false; state.showHelp = false; state.showInventory = false;
};

const gesture: Q2CommandHandler = (_players, context, args) => {
  const { entity, state } = context;
  if (context.movement.ducked || state.animationPriority > 1) return;
  const wave = Number.parseInt(args[0] ?? "0", 10), animations: readonly (readonly [string, number, number])[] = [
    ["flipoff", 72, 83], ["salute", 84, 94], ["taunt", 95, 111], ["wave", 112, 122], ["point", 123, 134],
  ];
  const animation = animations[wave] ?? animations[4];
  if (animation !== undefined) { state.animationPriority = 1; entity.frame = animation[1] - 1; state.animationEnd = animation[2]; print(context, animation[0] + "\n"); }
};

export function q2CheatsAllowed(context: Q2PlayerContext): boolean {
  const { game } = context;
  if ((game.options.edition === "rerelease" ? game.options.maxClients > 1 : game.options.mode === "deathmatch") && !context.rules.cheats) { print(context, "You must run the server with '+set cheats 1' to enable this command.\n"); return false; }
  return true;
}

const cheat: Q2CommandHandler = (_players, context, args, command) => {
  const { entity, game, state, hooks } = context;
  if (!q2CheatsAllowed(context)) return;
  if (command === "god") { state.god = !state.god; entity.flags ^= 16; game.host.combat.setTraits(entity.actor, { invulnerable: state.god }); print(context, `godmode ${state.god ? "ON" : "OFF"}\n`); }
  else if (command === "notarget") { state.notarget = !state.notarget; entity.flags ^= 32; print(context, `notarget ${state.notarget ? "ON" : "OFF"}\n`); }
  else if (command === "noclip") { state.noclip = !state.noclip; hooks.setMovement(entity.actor.id, { kind: "noclip", enabled: state.noclip }); print(context, `noclip ${state.noclip ? "ON" : "OFF"}\n`); }
  else if (command === "target") { for (const target of game.targets(args.join(" "))) game.host.callbacks.use(target.actor, entity.actor.id, entity.actor.id); }
  else give(context, args);
};

export const q2ClientCommands: readonly Q2ClientCommandDefinition[] = [
  { name: "say", documentation: { summary: "Send a chat message.", usage: "say <message>", examples: [] }, intermission: true, run: chat },
  { name: "say_team", documentation: { summary: "Send chat to your team when model or skin teams are enabled.", usage: "say_team <message>", examples: [] }, intermission: true, run: chat },
  { name: "players", documentation: { summary: "List connected players sorted by score.", usage: "players", examples: [] }, intermission: true, run: listPlayers },
  { name: "playerlist", documentation: { summary: "List connected players with time, ping, score, and spectator status.", usage: "playerlist", examples: [] }, intermission: true, run: listPlayers },
  { name: "score", documentation: { summary: "Toggle the scoreboard.", usage: "score", examples: [] }, intermission: true, run: score },
  { name: "help", documentation: { summary: "Toggle mission help, or show the deathmatch scoreboard.", usage: "help", examples: [] }, intermission: true, run: showHelp },
  { name: "use", documentation: { summary: "Use an inventory item or select a weapon by name.", usage: "use <item name>", examples: [] }, intermission: false, run: useItem },
  { name: "drop", documentation: { summary: "Drop an inventory item by name.", usage: "drop <item name>", examples: [] }, intermission: false, run: dropItem },
  { name: "inven", documentation: { summary: "Toggle the inventory display.", usage: "inven", examples: [] }, intermission: false, run: inventory },
  { name: "invnext", documentation: { summary: "Select the next usable item, or cycle chase targets.", usage: "invnext", examples: [] }, intermission: false, run: selectItem },
  { name: "invprev", documentation: { summary: "Select the previous usable item, or cycle chase targets.", usage: "invprev", examples: [] }, intermission: false, run: selectItem },
  { name: "invnextw", documentation: { summary: "Select the next weapon, or cycle chase targets.", usage: "invnextw", examples: [] }, intermission: false, run: selectItem },
  { name: "invprevw", documentation: { summary: "Select the previous weapon, or cycle chase targets.", usage: "invprevw", examples: [] }, intermission: false, run: selectItem },
  { name: "invnextp", documentation: { summary: "Select the next powerup, or cycle chase targets.", usage: "invnextp", examples: [] }, intermission: false, run: selectItem },
  { name: "invprevp", documentation: { summary: "Select the previous powerup, or cycle chase targets.", usage: "invprevp", examples: [] }, intermission: false, run: selectItem },
  { name: "invuse", documentation: { summary: "Use the selected inventory item.", usage: "invuse", examples: [] }, intermission: false, run: selectedItem },
  { name: "invdrop", documentation: { summary: "Drop the selected inventory item.", usage: "invdrop", examples: [] }, intermission: false, run: selectedItem },
  { name: "weapprev", documentation: { summary: "Select the previous available weapon.", usage: "weapprev", examples: [] }, intermission: false, run: previousWeapon },
  { name: "weapnext", documentation: { summary: "Select the next available weapon.", usage: "weapnext", examples: [] }, intermission: false, run: nextWeapon },
  { name: "weaplast", documentation: { summary: "Select the last weapon used.", usage: "weaplast", examples: [] }, intermission: false, run: lastWeapon },
  { name: "kill", documentation: { summary: "Kill yourself after the five-second respawn delay.", usage: "kill", examples: [] }, intermission: false, run: killPlayer },
  { name: "putaway", documentation: { summary: "Close score, help, and inventory displays.", usage: "putaway", examples: [] }, intermission: false, run: putAway },
  { name: "wave", documentation: { summary: "Play a gesture: 0 flipoff, 1 salute, 2 taunt, 3 wave, 4 point.", usage: "wave [0-4]", examples: [] }, intermission: false, run: gesture },
  { name: "god", documentation: { summary: "Toggle invulnerability; deathmatch requires cheats.", usage: "god", examples: [] }, intermission: false, run: cheat },
  { name: "notarget", documentation: { summary: "Toggle monster targeting immunity; deathmatch requires cheats.", usage: "notarget", examples: [] }, intermission: false, run: cheat },
  { name: "noclip", documentation: { summary: "Toggle movement through walls; deathmatch requires cheats.", usage: "noclip", examples: [] }, intermission: false, run: cheat },
  { name: "give", documentation: { summary: "Give items, health, weapons, ammo, or armor; deathmatch requires cheats.", usage: "give <all|health [amount]|weapons|ammo|armor|item name [amount]>", examples: [] }, intermission: false, run: cheat },
  { name: "target", documentation: { summary: "Activate entities with the supplied target name; deathmatch requires cheats.", usage: "target <targetname>", examples: [] }, intermission: false, run: cheat },
];

export function runQ2ClientCommand(players: Q2Players, context: Q2PlayerContext, sourceCommand: string, args: readonly string[]): boolean {
  const command = sourceCommand.toLowerCase();
  if (context.hooks.command?.(context.entity, context.game, command, args) === true) return true;
  const definition = q2ClientCommands.find(candidate => candidate.name === command);
  if (players.intermission.kind !== "playing" && definition?.intermission !== true) return true;
  if (definition === undefined) say(players, context, [sourceCommand, ...args], false);
  else definition.run(players, context, args, command);
  return true;
}

function give(context: Q2PlayerContext, args: readonly string[]): undefined {
  const { entity, game, items, hooks } = context;
  const requested = args.join(" ").toLowerCase(), all = requested === "all", rerelease = game.options.edition === "rerelease";
  const catalog = items.list();
  const write = (item: (typeof catalog)[number], count: number): void => {
    const entry = game.host.inventory.entries(entity.actor.id).find(value => value.item === item.id);
    game.host.inventory.configure(entity.actor, { item: item.id, count, capacity: entry?.capacity ?? item.capacity, countPolicy: { kind: "source-counter", arithmetic: "int32" } });
  };
  const pickup = (classname: string): void => {
    const temporary = game.create(classname);
    if (!items.spawn(temporary, game) || !game.host.actors.isLive(temporary.actor.id)) return;
    game.cancel(temporary); items.touch(temporary, game, entity.actor.id);
    if (game.host.actors.isLive(temporary.actor.id)) game.remove(temporary);
  };
  if (all || args[0]?.toLowerCase() === "health") {
    game.host.combat.setHealth(entity.actor, args.length === 2 ? Number.parseInt(args[1] ?? "0", 10) || 0 : entity.maxHealth);
    if (!all) return undefined;
  }
  if (all || requested === "weapons") {
    if (hooks.grantSelectedArsenal?.(entity.actor.id, "weapons") !== true)
      for (const item of catalog) if (item.weapon && item.consoleGive !== "inventory-only") write(item, game.host.inventory.count(entity.actor.id, item.id) + 1);
    if (!all) return undefined;
  }
  if (all || requested === "ammo") {
    if (hooks.grantSelectedArsenal?.(entity.actor.id, "ammo") !== true) {
      if (all && rerelease) pickup("item_pack");
      for (const item of catalog) if (item.kind === "ammo") {
        const entry = game.host.inventory.entries(entity.actor.id).find(value => value.item === item.id);
        write(item, Math.min((entry?.count ?? 0) + 1000, entry?.capacity ?? item.capacity));
      }
    }
    if (!all) return undefined;
  }
  if (all || requested === "armor") {
    const old = game.host.combat.read(entity.actor.id)?.armor;
    game.host.combat.setArmor(entity.actor, { kind: "q2", item: "q2:item_armor_body", points: 200, normalProtection: 0.8, energyProtection: 0.6, powerArmor: old?.kind === "q2" ? old.powerArmor : { kind: "none" } });
    if (!all) return undefined;
  }
  if (all || !rerelease && requested === "power shield") {
    pickup("item_power_shield");
    if (!all) return undefined;
  }
  if (all) {
    for (const item of catalog) {
      if (item.weapon || item.kind === "ammo" || item.kind === "armor" || item.kind === "shard" || item.consoleGive === "inventory-only") continue;
      if (rerelease && (item.consoleGive === "forbidden" || item.consoleGive === "individual-only" || item.kind === "health" || item.kind === "maximum-health" && item.classname !== "item_adrenaline")) continue;
      write(item, rerelease && item.kind === "key" ? 8 : 1);
    }
    if (rerelease) { entity.powerCubes = 0xff; checkPowerArmorAfterGive(context); }
    return undefined;
  }
  const first = args[0]?.toLowerCase() ?? "";
  const item = catalog.find(value => value.name.toLowerCase() === requested) ?? catalog.find(value => value.name.toLowerCase() === first)
    ?? (rerelease ? catalog.find(value => value.classname.toLowerCase() === first || value.id.toLowerCase() === first) : undefined);
  if (item === undefined) {
    if (hooks.giveSelectedItem?.(entity.actor.id, args) === true) return undefined;
    return print(context, "unknown item\n");
  }
  if (rerelease && item.consoleGive === "forbidden") return print(context, "Item is not giveable.\n");
  if ((item.weapon || item.kind === "ammo") && !items.mapsSupply(item.id)
    && hooks.giveSelectedItem?.(entity.actor.id, [item.id, ...(item.kind === "ammo" && args.length === 2 ? [args[1] ?? "0"] : [])]) === true) return undefined;
  if (item.consoleGive === "inventory-only") {
    if (rerelease) write(item, 1); else print(context, "non-pickup item\n");
  } else if (item.kind === "ammo") {
    items.giveAmmoCount(entity.actor, game, item.id, args.length === 2 ? Number.parseInt(args[1] ?? "0", 10) || 0 : null);
  } else pickup(item.classname);
  return undefined;
}

function checkPowerArmorAfterGive(context: Q2PlayerContext): void {
  const { entity, game, state, items } = context;
  const fields = state.userinfo.split("\\");
  let automatic = -1;
  for (let index = 1; index < fields.length; index += 2) if (fields[index] === "autoshield") automatic = Number.parseInt(fields[index + 1] ?? "0", 10) || 0;
  const cells = game.host.inventory.count(entity.actor.id, "q2:ammo_cells");
  const enough = cells !== 0 && (automatic < 0 || (entity.flags & 0x40000000) !== 0 && cells > automatic);
  const armor = game.host.combat.read(entity.actor.id)?.armor, active = armor?.kind === "q2" && armor.powerArmor.kind !== "none";
  const shield = game.host.inventory.count(entity.actor.id, "q2:item_power_shield") !== 0 ? "q2:item_power_shield" : "q2:item_power_screen";
  if (active && !enough || !active && automatic !== -1 && enough) items.use(entity.actor, shield, game);
}
