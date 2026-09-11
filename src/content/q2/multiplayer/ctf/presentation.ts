/* Original CTF scoreboard, status, player ID and team communication. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { add, dot, length, normalize, scale, subtract } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { ctfCarriedFlag, ctfName, ctfPlayer, ctfPrint } from "./types.ts";
import type { Q2CtfContext, Q2CtfScoreRow, Q2CtfTech } from "./types.ts";
import { ctfCanSee } from "./flags.ts";
import type { Q2CtfFlags } from "./flags.ts";

const techNames: readonly { readonly classname: Q2CtfTech; readonly name: string }[] = [
  { classname: "item_tech1", name: "Disruptor Shield" }, { classname: "item_tech2", name: "Power Amplifier" }, { classname: "item_tech3", name: "Time Accel" }, { classname: "item_tech4", name: "AutoDoc" },
];
const locations: readonly { readonly classname: string; readonly priority: number }[] = [
  ...["item_flag_team1", "item_flag_team2"].map(classname => ({ classname, priority: 1 })), ...["item_quad", "item_invulnerability"].map(classname => ({ classname, priority: 2 })),
  { classname: "weapon_bfg", priority: 3 }, ...["weapon_railgun", "weapon_rocketlauncher", "weapon_hyperblaster", "weapon_chaingun", "weapon_grenadelauncher", "weapon_machinegun", "weapon_supershotgun", "weapon_shotgun"].map(classname => ({ classname, priority: 4 })),
  ...["item_power_screen", "item_power_shield"].map(classname => ({ classname, priority: 5 })), ...["item_armor_body", "item_armor_combat", "item_armor_jacket"].map(classname => ({ classname, priority: 6 })),
  ...["item_silencer", "item_breather", "item_enviro", "item_adrenaline"].map(classname => ({ classname, priority: 7 })), ...["item_bandolier", "item_pack"].map(classname => ({ classname, priority: 8 })),
];
export function ctfTech(game: Q2GameServices, actor: ActorId): Q2CtfTech | null { return techNames.find(tech => game.host.inventory.count(actor, `q2:${tech.classname}`) !== 0)?.classname ?? null; }
export class Q2CtfPresentation {
  constructor(readonly context: Q2CtfContext, readonly flags: Q2CtfFlags) {}
  scoreboard(entity: Q2Entity, game: Q2GameServices): undefined {
    const rows = (team: number): Q2CtfScoreRow[] => game.host.players().flatMap(actor => {
      const state = this.context.states.get(actor), player = this.context.hooks.player(actor); return state?.team !== team || player === null ? [] : [{ slot: player.slot, name: player.name, score: player.score, ping: Math.min(999, player.ping), carriedFlag: ctfCarriedFlag(game, actor) }];
    }).sort((a, b) => b.score - a.score || a.slot - b.slot);
    const red = rows(1), blue = rows(2), spectators = rows(0), totals: readonly [number, number] = [red.reduce((sum, row) => sum + row.score, 0), blue.reduce((sum, row) => sum + row.score, 0)], match = this.context.match;
    let layout = `if 24 xv 8 yv 8 pic 24 endif xv 40 yv 28 string "${totals[0].toString().padStart(4)}/${red.length.toString().padEnd(3)}" xv 98 yv 12 num 2 18 if 25 xv 168 yv 8 pic 25 endif xv 200 yv 28 string "${totals[1].toString().padStart(4)}/${blue.length.toString().padEnd(3)}" xv 256 yv 12 num 2 20 `;
    const append = (text: string): boolean => { if (layout.length + text.length >= 1000) return false; layout += text; return true; };
    let redShown = 0, blueShown = 0;
    for (let index = 0; index < 16; index++) for (const team of [{ rows: red, x: 0, enemy: 2 }, { rows: blue, x: 160, enemy: 1 }]) {
      const row = team.rows[index]; if (row === undefined) continue;
      const y = 42 + index * 8, text = `ctf ${team.x} ${y} ${row.slot} ${row.score} ${row.ping} ` + (row.carriedFlag === team.enemy ? `xv ${team.x + 56} yv ${y} picn sbfctf${team.enemy} ` : "");
      if (append(text)) { if (team.x === 0) redShown++; else blueShown++; }
    }
    let y = (Math.max(redShown, blueShown) + 1) * 8 + 42;
    if (spectators.length !== 0 && append(`xv 0 yv ${y} string2 "Spectators" `)) { y += 8; for (let index = 0; index < spectators.length; index++) { const row = spectators[index]; if (row !== undefined) append(`ctf ${index % 2 * 160} ${y + Math.floor(index / 2) * 8} ${row.slot} ${row.score} ${row.ping} `); } }
    for (const team of [{ total: red.length, shown: redShown, x: 8 }, { total: blue.length, shown: blueShown, x: 168 }]) if (team.total > team.shown) append(`xv ${team.x} yv ${42 + team.shown * 8} string "..and ${team.total - team.shown} more" `);
    return this.context.hooks.emit({ kind: "scoreboard", actor: entity.actor.id, red, blue, spectators, totals, captures: [match.team1, match.team2], layout });
  }
  identify(entity: Q2Entity, game: Q2GameServices): ActorId | null {
    const origin = game.body(entity).origin, forward = angleVectors(game.host.playerViewState(entity.actor.id)?.viewAngles ?? game.body(entity).angles).forward;
    const trace = game.host.trace({ start: origin, end: add(origin, scale(forward, 1024)), bounds: null, ignore: entity.actor.id, mask: 3 });
    if (trace.hit.kind === "actor" && game.host.isPlayer(trace.hit.actor)) return trace.hit.actor;
    let best: ActorId | null = null, alignment = 0.9;
    for (const actor of game.host.players()) { const other = game.entity(actor); if (other === null || other === entity || other.solid === "none") continue; const candidate = dot(forward, normalize(subtract(game.body(other).origin, origin))); if (candidate > alignment && ctfCanSee(other, entity, game)) { best = actor; alignment = candidate; } }
    return best;
  }
  hud(entity: Q2Entity, game: Q2GameServices, status: string): undefined {
    const state = ctfPlayer(this.context, entity.actor.id), match = this.context.match, blink = Math.trunc(game.host.now() * 10) & 8;
    return this.context.hooks.emit({ kind: "hud", actor: entity.actor.id, team: state.team, captures: [match.team1, match.team2], flagStates: [this.flags.state(game, 1), this.flags.state(game, 2)],
      carriedFlag: ctfCarriedFlag(game, entity.actor.id), tech: ctfTech(game, entity.actor.id), idTarget: state.idView ? this.identify(entity, game) : null,
      blinkTeam: match.lastFlagCapture !== null && game.host.now() - match.lastFlagCapture < 5 && blink !== 0 ? match.lastCaptureTeam : null, match: status });
  }
  location(entity: Q2Entity, game: Q2GameServices): string {
    const origin = game.body(entity).origin;
    const candidates = [...game.entities.values()].flatMap(target => { const entry = locations.find(item => item.classname === target.classname), distance = length(subtract(game.body(target).origin, origin)); return entry === undefined || distance > 1024 ? [] : [{ target, priority: entry.priority, distance, visible: ctfCanSee(target, entity, game) }]; });
    candidates.sort((a, b) => Number(b.visible) - Number(a.visible) || (a.visible ? a.priority - b.priority : 0) || a.distance - b.distance);
    const hot = candidates[0]?.target; if (hot === undefined) return "nowhere";
    let team = "";
    if ([...game.entities.values()].some(other => other !== hot && other.classname === hot.classname)) {
      const red = this.flags.base(game, 1), blue = this.flags.base(game, 2);
      if (red !== null && blue !== null) { const one = length(subtract(game.body(hot).origin, game.body(red).origin)), two = length(subtract(game.body(hot).origin, game.body(blue).origin)); team = one < two ? "red " : one > two ? "blue " : ""; }
    }
    const delta = subtract(origin, game.body(hot).origin), where = Math.abs(delta.z) > Math.abs(delta.x) && Math.abs(delta.z) > Math.abs(delta.y) ? delta.z > 0 ? "above" : "below" : "near";
    const water = (game.host.pointContents(add(origin, { x: 0, y: 0, z: game.body(entity).bounds.min.z + 1 })) & 56) !== 0 ? "in the water " : "";
    return `${water}${where} the ${team}${this.context.hooks.items.itemName(hot.classname) ?? hot.classname}`;
  }
  sayTeam(entity: Q2Entity, game: Q2GameServices, words: string): undefined {
    if (!this.context.hooks.chatAllowed(entity.actor.id, game)) return undefined;
    const state = ctfPlayer(this.context, entity.actor.id), combat = game.host.combat.read(entity.actor.id), health = combat?.health ?? 0;
    const armor = (): string => {
      const value = combat?.armor; if (value === undefined || value.kind === "none") return "no armor";
      if (value.kind !== "q2") return `${value.points} armor`;
      const cells = game.host.inventory.count(entity.actor.id, "q2:ammo_cells"), power = value.powerArmor.kind !== "none" && cells > 0 ? `Power ${value.powerArmor.kind === "screen" ? "Screen" : "Shield"} with ${cells} cells` : "";
      const conventional = value.points > 0 ? `${value.points} units of ${this.context.hooks.items.lookup(value.item)?.name ?? "armor"}` : ""; return [power, conventional].filter(Boolean).join(" and ") || "no armor";
    };
    const sight = (): string => { const names = game.host.players().filter(actor => actor !== entity.actor.id).flatMap(actor => { const target = game.entity(actor); return target !== null && ctfCanSee(target, entity, game) ? [ctfName(this.context, actor)] : []; }); return names.length < 2 ? names[0] ?? "no one" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`; };
    if (words.startsWith('"')) words = words.slice(1, words.endsWith('"') ? -1 : undefined);
    const text = words.replace(/%(.)/g, (_match: string, character: string) => {
      switch (character.toLowerCase()) {
        case "l": return this.location(entity, game);
        case "a": return armor();
        case "h": return health <= 0 ? "dead" : `${health} health`;
        case "t": { const tech = techNames.find(value => value.classname === ctfTech(game, entity.actor.id)); return tech === undefined ? "no powerup" : `the ${tech.name}`; }
        case "w": { const weapon = this.context.hooks.weapons.states.get(entity.actor.id)?.weapon; return weapon === undefined || weapon === null ? "none" : this.context.hooks.items.lookup(this.context.hooks.weapons.definition(weapon).item)?.name ?? weapon; }
        case "n": return sight();
        default: return character;
      }
    }).slice(0, 1023);
    for (const actor of game.host.players()) if (this.context.states.get(actor)?.team === state.team) ctfPrint(game, `(${ctfName(this.context, entity.actor.id)}): ${text}\n`, actor, "chat");
    return undefined;
  }
  joinMenu(entity: Q2Entity): undefined {
    const match = this.context.match, locked = this.context.rules.matchLock && (match.phase === "pregame" || match.phase === "game"), counts = [0, 0]; for (const player of this.context.states.values()) if (player.team === 1) counts[0] = (counts[0] ?? 0) + 1; else if (player.team === 2) counts[1] = (counts[1] ?? 0) + 1;
    return this.context.hooks.emit({ kind: "menu", actor: entity.actor.id, title: "ThreeWave Capture the Flag", entries: [
      { label: `Join Red Team (${counts[0]})`, action: locked || this.context.rules.forceJoin === "blue" ? null : "join-red" }, { label: `Join Blue Team (${counts[1]})`, action: locked || this.context.rules.forceJoin === "red" ? null : "join-blue" },
      { label: "Chase Camera", action: "chase" }, { label: "Credits", action: "credits" }, { label: "Request match", action: this.context.rules.competition !== 0 && match.phase === "none" ? "match" : null }, { label: "Close", action: "close" }] });
  }
  stats(entity: Q2Entity, game: Q2GameServices): undefined {
    let text = "Name             Frags Deaths Caps Base Carrier\n";
    for (const ghost of this.context.match.ghosts.values()) text += `${ghost.name.slice(0, 16).padEnd(16)} ${ghost.kills} ${ghost.deaths} ${ghost.captures} ${ghost.baseDefense} ${ghost.carrierDefense}\n`;
    return ctfPrint(game, text.slice(0, 1399), entity.actor.id);
  }
}
