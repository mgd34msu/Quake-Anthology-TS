/* hipspawn.qc SUB_CopyEntity master molds. Copyright id Software. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import { callbackName } from "../../foundation/callbacks.ts";
import { spawnTeleportFog } from "../../foundation/spawns.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import type { Q1Solid } from "../../foundation/types.ts";
import type { MissionpackWorldHooks } from "./index.ts";
import { later, vector } from "./common.ts";

function solid(value: string): Q1Solid {
  switch (value) { case "none": case "trigger": case "bbox": case "slidebox": case "bsp": case "corpse": return value; default: throw new Error(`Invalid func_spawn saved solid ${value}`); }
}
function template(game: Q1EntityServices, mold: Q1Actor, classname: string): Q1Actor {
  const entity = game.create(classname, { properties: [...mold.fields].filter(([key]) => key !== "classname").map(([key, value]) => ({ key, value })).concat({ key: "classname", value: classname }) });
  game.setBody(entity, game.body(mold)); game.spawnEntity(entity, { deathmatch: 0 });
  if (!game.live(entity)) throw new Error(`func_spawn template ${classname} removed itself`);
  const body = game.body(entity); entity.fields.set("spawnmodel", entity.model); entity.fields.set("spawnsolidtype", entity.solid);
  const think = callbackName(entity.think); if (think === null) entity.fields.delete("spawnthink"); else entity.fields.set("spawnthink", think);
  vector(entity, "spawnmins", body.bounds.min); vector(entity, "spawnmaxs", body.bounds.max);
  entity.model = ""; entity.solid = "none"; later(game, entity, 1, "hip:spawn_think"); game.link(entity); return entity;
}
export function registerHipnoticSpawn(game: Q1EntityServices, hooks: MissionpackWorldHooks): undefined {
  game.named.register("hip:spawn_think", { action: (g, e) => later(g, e, 1, "hip:spawn_think") });
  game.named.register("hip:spawn_use", { use: (g, e) => {
    const master = g.entity(e.references.get("spawnmaster") ?? null); if (master === null) throw new Error("func_spawn lost its initialized master");
    const charmer = hooks.charmer?.() ?? null, entity = e.number("spawnmulti") === 1 || charmer !== null ? g.cloneEntity(master) : master;
    entity.model = entity.text("spawnmodel"); entity.solid = solid(entity.text("spawnsolidtype"));
    const think = entity.text("spawnthink"); entity.think = think === "" ? null : g.named.action(entity, think);
    g.setBounds(entity, { min: entity.vector("spawnmins"), max: entity.vector("spawnmaxs") }); g.link(entity);
    if (e.number("spawnsilent") === 0) spawnTeleportFog(g, g.body(entity).origin);
    if (charmer !== null) {
      if (hooks.charm === undefined) throw new Error("Horn func_spawn requires the selected monster charm implementation");
      hooks.charm(entity, charmer);
    }
    if ((entity.movementFlags & 32) !== 0) { if (e.number("spawnmulti") !== 0 && charmer === null) g.totalMonsters++; if (charmer !== null) entity.effects |= 8; }
    return e.number("spawnmulti") === 0 && charmer === null ? g.remove(e) : undefined;
  } });
  for (const classname of ["func_spawn", "func_spawn_small"]) game.registerSpawn(classname, (g, e) => {
    const count = g.totalMonsters; let master: Q1Actor;
    if (e.text("spawnfunction") === "") {
      const chance = g.host.random(), dog = template(g, e, "monster_dog"), ogre = template(g, e, "monster_ogre"), demon = template(g, e, "monster_demon1"), zombie = template(g, e, "monster_zombie"), shambler = template(g, e, "monster_shambler");
      master = chance < 0.5 ? dog : chance < 0.8 ? ogre : chance < 0.92 ? demon : chance < 0.97 ? zombie : shambler; g.totalMonsters = count + 1;
    } else {
      const spawnClass = e.text("spawnclassname"); if (spawnClass === "") throw new Error("No spawnclassname defined");
      master = template(g, e, spawnClass); if (e.number("spawnmulti") !== 0) g.totalMonsters = count;
    }
    e.solid = "none"; e.movement = "none"; e.model = ""; e.use = g.named.use(e, "hip:spawn_use"); e.references.set("spawnmaster", master.actor.id); return undefined;
  });
  return undefined;
}
