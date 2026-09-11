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

export function runQ2ClientCommand(players: Q2Players, context: Q2PlayerContext, sourceCommand: string, args: readonly string[]): boolean {
  const { entity, game, state, hooks } = context, command = sourceCommand.toLowerCase();
  if (hooks.command?.(entity, game, command, args) === true) return true;
  if (command === "say" || command === "say_team") { say(players, context, args, command === "say_team"); return true; }
  if (command === "players" || command === "playerlist") {
    const list = [...players.states.values()].filter(value => value.connected).sort((left, right) => command === "players" ? left.score - right.score : left.slot - right.slot);
    let message = "";
    for (const row of list) {
      const seconds = Math.trunc(game.host.now() - row.enteredAt);
      const line = command === "players" ? `${String(row.score).padStart(3)} ${row.name}\n`
        : `${String(Math.trunc(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} ${String(row.ping).padStart(4)} ${String(row.score).padStart(3)} ${row.name}${row.spectator ? " (spectator)" : ""}\n`;
      if (message.length + line.length > 1280) { message += "...\n"; break; } message += line;
    }
    print(context, message + (command === "players" ? `\n${list.length} players\n` : "")); return true;
  }
  if (command === "score") {
    state.showInventory = false; state.showHelp = false; state.showScores = !state.showScores;
    if (state.showScores && game.options.mode !== "singleplayer") players.scoreboard(entity, game);
    return true;
  }
  if (command === "help") {
    state.showInventory = false; state.showScores = false;
    if (game.options.mode === "deathmatch") { state.showScores = true; players.scoreboard(entity, game); }
    else { state.showHelp = !state.showHelp; hooks.emit({ kind: "help", actor: entity.actor.id, visible: state.showHelp }); }
    return true;
  }
  if (players.intermission.kind !== "playing") return true;
  switch (command) {
    case "use": use(context, args.join(" ")); break;
    case "drop": drop(players, context, args.join(" ")); break;
    case "inven":
      state.showScores = false; state.showHelp = false; state.showInventory = !state.showInventory;
      if (state.showInventory) hooks.emit({ kind: "inventory", actor: entity.actor.id, entries: game.host.inventory.entries(entity.actor.id) });
      break;
    case "invnext": case "invprev": case "invnextw": case "invprevw": case "invnextp": case "invprevp":
      if (state.chaseTarget !== null) players.chase(entity, game, command.startsWith("invnext") ? 1 : -1);
      else select(context, command.startsWith("invnext") ? 1 : -1, command.endsWith("w") ? "weapon" : command.endsWith("p") ? "power" : "all");
      break;
    case "invuse": case "invdrop":
      if (state.selectedItem === null || game.host.inventory.count(entity.actor.id, state.selectedItem) === 0) select(context, 1, "all");
      if (state.selectedItem === null) print(context, "No item to use.\n");
      else if (command === "invuse") use(context, state.selectedItem); else drop(players, context, state.selectedItem);
      break;
    // The original next/previous names traverse the item table in reverse/forward order respectively.
    case "weapprev": weaponCycle(context, 1); break;
    case "weapnext": weaponCycle(context, -1); break;
    case "weaplast": {
      const weapon = context.weapons.states.get(entity.actor.id)?.lastWeapon;
      if (weapon !== null && weapon !== undefined) context.weapons.requestWeapon(entity, game, weapon); break;
    }
    case "kill":
      if (game.host.now() - state.respawnTime < 5) break;
      state.god = false; entity.flags &= ~16; game.host.combat.setTraits(entity.actor, { invulnerable: false });
      q2EnvironmentDamage(context, Math.max(1, game.host.combat.read(entity.actor.id)?.health ?? 0) + 1, 23, 32); break;
    case "putaway": state.showScores = false; state.showHelp = false; state.showInventory = false; break;
    case "wave": {
      if (context.movement.ducked || state.animationPriority > 1) break;
      const wave = Number.parseInt(args[0] ?? "0", 10), animations: readonly (readonly [string, number, number])[] = [
        ["flipoff", 72, 83], ["salute", 84, 94], ["taunt", 95, 111], ["wave", 112, 122], ["point", 123, 134],
      ];
      const animation = animations[wave] ?? animations[4];
      if (animation !== undefined) { state.animationPriority = 1; entity.frame = animation[1] - 1; state.animationEnd = animation[2]; print(context, animation[0] + "\n"); }
      break;
    }
    case "god": case "notarget": case "noclip": case "give": case "target": {
      if (game.options.mode === "deathmatch" && !context.rules.cheats) { print(context, "You must run the server with '+set cheats 1' to enable this command.\n"); break; }
      if (command === "god") { state.god = !state.god; entity.flags ^= 16; game.host.combat.setTraits(entity.actor, { invulnerable: state.god }); print(context, `godmode ${state.god ? "ON" : "OFF"}\n`); }
      else if (command === "notarget") { state.notarget = !state.notarget; entity.flags ^= 32; print(context, `notarget ${state.notarget ? "ON" : "OFF"}\n`); }
      else if (command === "noclip") { state.noclip = !state.noclip; hooks.setMovement(entity.actor.id, { kind: "noclip", enabled: state.noclip }); print(context, `noclip ${state.noclip ? "ON" : "OFF"}\n`); }
      else if (command === "target") { for (const target of game.targets(args.join(" "))) game.host.callbacks.use(target.actor, entity.actor.id, entity.actor.id); }
      else give(context, args);
      break;
    }
    default: say(players, context, [sourceCommand, ...args], false); break;
  }
  return true;
}

function give(context: Q2PlayerContext, args: readonly string[]): undefined {
  const { entity, game, items } = context;
  const requested = args.join(" ").toLowerCase(), all = requested === "all";
  if (all || args[0]?.toLowerCase() === "health") {
    game.host.combat.setHealth(entity.actor, args.length === 2 && args[0]?.toLowerCase() === "health" ? Number.parseInt(args[1] ?? "0", 10) || 0 : entity.maxHealth);
    if (!all) return undefined;
  }
  for (const item of items.list()) {
    if (all && item.kind !== "health" && item.kind !== "armor" && item.kind !== "shard" && item.kind !== "maximum-health" || requested === "weapons" && item.kind === "weapon" || requested === "ammo" && item.kind === "ammo") {
      const existing = game.host.inventory.entries(entity.actor.id).find(entry => entry.item === item.id);
      game.host.inventory.configure(entity.actor, { item: item.id, count: item.kind === "ammo" ? existing?.capacity ?? 1000 : 1, capacity: existing?.capacity ?? 32767 });
    }
  }
  if (all || requested === "armor") {
    const old = game.host.combat.read(entity.actor.id)?.armor;
    game.host.combat.setArmor(entity.actor, { kind: "q2", item: "q2:item_armor_body", points: 200, normalProtection: 0.8, energyProtection: 0.6, powerArmor: old?.kind === "q2" ? old.powerArmor : { kind: "none" } });
  }
  if (all || requested === "weapons" || requested === "ammo" || requested === "armor") return undefined;
  const item = items.lookup(args.length === 2 ? args[0] ?? "" : args.join(" "));
  if (item === null) return print(context, `unknown item: ${requested}\n`);
  if (item.kind === "ammo") {
    const count = args.length === 2 ? Number.parseInt(args[1] ?? "0", 10) || 0 : game.host.inventory.count(entity.actor.id, item.id) + item.quantity;
    const old = game.host.inventory.entries(entity.actor.id).find(entry => entry.item === item.id);
    game.host.inventory.configure(entity.actor, { item: item.id, count: Math.max(0, count), capacity: old?.capacity ?? 1000 });
  } else {
    const temporary = game.create(item.classname);
    if (!items.spawn(temporary, game)) return undefined;
    game.cancel(temporary); items.touch(temporary, game, entity.actor.id);
    if (game.host.actors.isLive(temporary.actor.id)) game.remove(temporary);
  }
  return undefined;
}
