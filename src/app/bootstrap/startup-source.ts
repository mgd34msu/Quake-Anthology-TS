import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { ExecutableRecipe } from "../../contracts/content.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { registerQ2ServerCvars, applyServerProfile, cvarServerSettingsOwner, serverDefinitionsForRecipe } from "../../settings/server/index.ts";
import { q3GameCvarDefinitions } from "../../content/q3/base/settings.ts";
import { registerQuakeWorldEngineCvars } from "./simulation/quakeworld-cvars.ts";
import { registerQ3ServerCvars } from "./simulation/q3/server-state.ts";
import { registerFrameTimeCvars } from "./frame-time.ts";
import type { ApplicationOptions } from "./options.ts";

export function createStartupSource(options: ApplicationOptions, recipe: ExecutableRecipe, dialect: CommandDialect,
  context: CommandContext, maxClients: number, print: (text: string) => void): CvarRegistry {
  const cvars = new CvarRegistry({ dialect, context, print });
  if (dialect === "q2-classic" || dialect === "q2-rerelease") registerQ2ServerCvars(cvars, recipe.match.provider);
  else if (dialect === "q3") {
    for (const definition of q3GameCvarDefinitions(recipe.map.entities.content.includes("missionpack") ? "missionpack" : "baseq3"))
      cvars.register(definition.name, definition.value, definition.flags);
  } else for (const [name, value] of Object.entries({ skill: "1", deathmatch: "0", coop: "0", teamplay: "0", sv_cheats: "0", sv_aim: "0.93",
    sv_gravity: "800", sv_maxspeed: "320", samelevel: "0", timelimit: "0", fraglimit: "0", gamecfg: "0", registered: "1", footsteps: "1" })) cvars.register(name, value);
  for (const [name, value] of Object.entries({ skill: String(options.skill), deathmatch: options.mode === "deathmatch" ? "1" : "0",
    coop: options.mode === "coop" ? "1" : "0", g_gametype: options.mode === "singleplayer" ? "2" : "0",
    [dialect === "q3" ? "sv_maxclients" : "maxclients"]: String(maxClients) })) {
    if (cvars.find(name) === undefined) cvars.register(name, value);
    else cvars.set(name, value, true);
  }
  if (dialect === "q1-quakeworld") registerQuakeWorldEngineCvars(cvars);
  if (dialect === "q3") registerQ3ServerCvars(cvars, { maxClients, mapName: options.map });
  registerFrameTimeCvars(cvars);
  return cvars;
}

export function resolveStartupRules(options: ApplicationOptions, cvars: CvarRegistry, defaultCapacity: number, definitions: ReturnType<typeof serverDefinitionsForRecipe>, applyExplicit = true): {
  readonly options: ApplicationOptions; readonly maxClients: number;
} {
  cvars.applyLatched();
  if (applyExplicit && options.explicitRules?.skill) cvars.set("skill", String(options.skill), true);
  if (applyExplicit && options.explicitRules?.mode) {
    cvars.set("deathmatch", options.mode === "deathmatch" ? "1" : "0", true);
    cvars.set("coop", options.mode === "coop" ? "1" : "0", true);
    if (cvars.dialect === "q3") cvars.set("g_gametype", options.mode === "singleplayer" ? "2" : "0", true);
  }
  if (applyExplicit && options.serverProfile !== undefined) applyServerProfile(options.serverProfile,
    definitions.map(definition => ({ definition, owner: cvarServerSettingsOwner(cvars, true) })));
  cvars.applyLatched();
  const skillValue = Math.max(0, Math.min(3, Math.floor(cvars.variableValue("skill"))));
  if (skillValue !== 0 && skillValue !== 1 && skillValue !== 2 && skillValue !== 3) throw new Error("Invalid source startup difficulty");
  const mode = applyExplicit && options.explicitRules?.mode ? options.mode : cvars.dialect === "q3"
    ? cvars.variableValue("g_gametype") === 2 ? "singleplayer" : "deathmatch"
    : cvars.variableValue("deathmatch") !== 0 ? "deathmatch" : cvars.variableValue("coop") !== 0 ? "coop" : "singleplayer";
  const capacityName = cvars.dialect === "q3" ? "sv_maxclients" : "maxclients";
  const requested = applyExplicit && options.explicitRules?.capacity ? defaultCapacity : cvars.variableValue(capacityName);
  const nativeCapacity = (cvars.dialect === "q2-classic" || cvars.dialect === "q2-rerelease") && requested <= 1
    ? mode === "deathmatch" ? 8 : mode === "coop" ? 4 : requested : requested;
  const maxClients = Math.max(options.dedicated ? 1 : options.seats, Math.trunc(nativeCapacity));
  if (!Number.isSafeInteger(maxClients) || maxClients < 1 || maxClients > 64) throw new Error("Source startup client capacity must be between 1 and 64");
  cvars.set(capacityName, String(maxClients), true);
  return { options: { ...options, skill: skillValue, mode }, maxClients };
}
