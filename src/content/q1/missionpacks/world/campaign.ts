/* Mission pack client.qc / hipmisc.qc finale control. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO } from "../../foundation/types.ts";
import { q1Base } from "../../base/provider.ts";
import type { Q1SourceFinale } from "../../base/rules.ts";
import type { Q1MissionPack } from "../types.ts";
import type { MissionpackWorldHooks } from "./index.ts";
import { later, number } from "./common.ts";
import { missionFinaleText } from "./finale-text.ts";

export function startFinaleTimer(game: Q1EntityServices): undefined {
  if (game.options.edition === "classic") return undefined;
  return later(game, game.create("mission_finale_timer"), 1, "mission:finale_check");
}
export function registerMissionCampaign(game: Q1EntityServices, pack: Q1MissionPack, hooks: MissionpackWorldHooks): undefined {
  const base = q1Base(game);
  game.named.register("mission:finale_transition", { action: (g, e) => { if (g.options.coop) g.travel("start", null); else { g.host.emit({ kind: "server-command", text: "menu_credits\n" }); g.host.emit({ kind: "server-command", text: "disconnect\n" }); } return g.remove(e); } });
  game.named.register("mission:finale_check", { action: (g, e) => later(g, e, base.hasFinishedFinale ? 5 : 0.1, base.hasFinishedFinale ? "mission:finale_transition" : "mission:finale_check") });
  const finale = (key: string, track: number): Q1SourceFinale => ({ kind: "finale", text: missionFinaleText(game.options.edition, key), track });
  base.levelRules.registerIntermissionRule({ id: `q1:${pack}:campaign`, finale: stage => {
    const map = game.mapName;
    if (pack === "rogue") {
      if (stage === 2 && map === "r1m7") return finale("$qc_finale_r1", 3);
      if (stage === 2 && map === "r2m8" && game.options.coop && game.options.edition === "rerelease") { game.host.emit({ kind: "server-command", text: "menu_credits\ndisconnect\n" }); base.levelRules.deferExit(game.time + 10000000); return { kind: "finale", text: "", track: 3 }; }
      return undefined;
    }
    if (stage === 2) {
      if (map === "hip1m4") return finale("$qc_finale_hip1", 6);
      if (map === "hip2m5") return finale("$qc_finale_hip2", 6);
      if (map === "hipend") {
        if (game.options.edition === "rerelease" && base.options.officialCampaign !== false) { game.host.emit({ kind: "achievement", player: null, id: "ACH_COMPLETE_HIPEND" }); if (game.options.skill === 3) game.host.emit({ kind: "achievement", player: null, id: "ACH_COMPLETE_HIPEND_NIGHTMARE" }); }
        return finale("$qc_finale_hipend", 2);
      }
    }
    if (stage === 3 && base.options.registered !== false && (base.campaign.readFlags() & 15) !== 15) {
      if (map === "hip1m4") return finale("$qc_finale_hip1m4", 6);
      if (map === "hip2m5") return finale("$qc_finale_hip2m5", 6);
      if (map === "hipend") { base.levelRules.deferExit(game.time + 10000000); startFinaleTimer(game); return finale("$qc_finale_hipend2", 2); }
    }
    return undefined;
  } });
  if (pack !== "hipnotic") return undefined;
  const endText = (g: Q1EntityServices): undefined => {
    if (g.intermission === null) base.levelRules.beginCutscene(g.mapName, null, g.time);
    const result = base.levelRules.advanceFinale(g.time);
    if (result.kind === "finale" || result.kind === "sell-screen") { if (hooks.presentFinale === undefined) throw new Error("Hipnotic end text requires the shared finale journal"); hooks.presentFinale(result); }
    return undefined;
  };
  game.named.register("hip:start_end_text", { action: endText, use: endText });
  game.named.register("hip:effect_finale", { use: (g, e) => {
    if (e.number("finale_state") === 1) return undefined; number(e, "finale_state", 1);
    const point = g.find(e.target)[0]; if (point === undefined) throw new Error("no target in finale");
    g.host.emit({ kind: "finale", text: "", stage: 1 });
    if ((e.spawnflags & 2) === 0) {
      const target = g.find(e.text("mdl"))[0]; if (target === undefined) throw new Error("Hipnotic finale decoy path is missing");
      const player = g.host.players()[0], origin = (e.spawnflags & 1) !== 0 && player !== undefined ? g.host.bodies.read(player)?.origin ?? ZERO : g.body(target).origin;
      if (hooks.becomeDecoy === undefined) throw new Error("Hipnotic finale requires the source decoy controller"); hooks.becomeDecoy(target.target, origin);
    }
    for (const player of g.host.players()) g.controlPlayer(player, { kind: "cutscene", origin: g.body(point).origin, angles: point.mangle, viewOffset: ZERO });
    const callback = e.text("spawnfunction");
    if (callback !== "") { e.fields.set("hip:finale_callback", callback); return later(g, e, e.wait, "hip:finale_callback"); }
    return undefined;
  } });
  game.named.register("hip:finale_callback", { action: (g, e) => {
    const callback = e.text("hip:finale_callback");
    if (callback === "info_startendtext_use") return endText(g);
    if (callback === "SUB_UseTargets") return g.useTargets(e, e.activator);
    if (callback === "SUB_Remove") return g.remove(e);
    if (callback === "SUB_Null") return undefined;
    // Quake map function fields also name spawn routines.
    const previous = e.classname; e.classname = callback;
    try { return g.spawnEntity(e); } finally { if (g.entity(e.actor.id) !== null) e.classname = previous; }
  } });
  game.registerSpawn("effect_finale", (g, e) => { if (g.options.deathmatch !== 0) return g.remove(e); g.setBody(e, { angles: e.mangle }); number(e, "finale_state", 0); e.use = g.named.use(e, "hip:effect_finale"); return undefined; });
  game.registerSpawn("info_startendtext", (g, e) => { e.use = g.named.use(e, "hip:start_end_text"); return undefined; });
  return undefined;
}
