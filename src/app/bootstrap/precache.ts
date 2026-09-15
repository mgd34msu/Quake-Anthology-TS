import type { ResourceRequest } from "../../contracts/content.ts";
import { equipmentResources } from "../../content/catalog/equipment.ts";
import { monsterResources, monsterSources } from "../../content/catalog/monsters.ts";
import { q2RegisteredWeaponResources, weaponResources } from "../../content/catalog/weapons.ts";
import { Q2_TRANSIENT_SOUNDS } from "../../content/q2/foundation/effect-resources.ts";
import type { Q2Entity } from "../../content/q2/foundation/host.ts";
import type { MonsterSourceDefinition } from "../../content/monsters/definitions.ts";
import { rereleaseMedicReinforcements } from "../../content/q2/rerelease/monsters/base-variants/medic.ts";
import { precacheQ1World } from "../../content/q1/foundation/precache-world.ts";
import { Q2_CHARACTER_MODELS, Q2_CHARACTER_SOUNDS } from "../../content/q2/base/player/resources.ts";
import { Q3_CHARACTER_SOUNDS } from "../../content/q3/presentation/character-resources.ts";
import { CUSTOM_SOUND_NAMES } from "../../content/q3/presentation/players.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { ApplicationEffects } from "./effects.ts";
import type { SharedSimulation } from "./simulation/runtime.ts";

type PrecacheSource = Pick<SharedSimulation, "q1Source" | "quakecSource" | "q2Source" | "q1WeaponSource">;
type ResourceContent = Pick<LoadedApplicationContent, "catalog"> & {
  readonly recipe: Pick<LoadedApplicationContent["recipe"], "enemies" | "equipment" | "weapons" | "character"> & {
    readonly map: Pick<LoadedApplicationContent["recipe"]["map"], "entities">;
  };
};

export function characterResourceRequests(content: ResourceContent): readonly ResourceRequest[] {
  const character = content.recipe.character.definition.content, family = content.catalog.product(character).expectation.family;
  const request = (path: string): ResourceRequest => ({ content: character, path });
  if (family === "q3") return [...Object.values(Q3_CHARACTER_SOUNDS), ...CUSTOM_SOUND_NAMES].map(request);
  if (family === "q2") return [...Q2_CHARACTER_MODELS, ...Q2_CHARACTER_SOUNDS.map(path => path.startsWith("*") ? path : `sound/${path}`)].map(request);
  const paths: string[] = [];
  precacheQ1World({ precacheSound: path => {
    if (path.startsWith("player/") || ["misc/h2ohit1.wav", "misc/outwater.wav", "misc/r_tele1.wav", "misc/r_tele2.wav", "misc/r_tele3.wav", "misc/r_tele4.wav", "misc/r_tele5.wav"].includes(path)) paths.push(`sound/${path}`);
    return path;
  }, precacheModel: path => { if (/^progs\/(player|eyes|h_player|gib[123]|s_bubble)\.(mdl|spr)$/.test(path)) paths.push(path); return path; } });
  return paths.map(request);
}

export function nativeQ2MonsterResources(content: ResourceRequest["content"], source: MonsterSourceDefinition | undefined,
  entities: readonly Pick<Q2Entity, "classname" | "spawn">[]): readonly ResourceRequest[] {
  const classnames = new Set(entities.map(entity => entity.classname));
  if (source?.edition === "rerelease") for (const entity of entities) {
    if (entity.classname === "monster_medic" || entity.classname === "monster_medic_commander") {
      for (const reinforcement of rereleaseMedicReinforcements(entity.spawn.values)) classnames.add(reinforcement.classname);
    }
  }
  return [...classnames].flatMap(classname => (source?.creatures[classname]?.resources ?? []).map(path => ({ content, path })));
}

export function applicationResourceRequests(content: ResourceContent,
  simulation: PrecacheSource): readonly ResourceRequest[] {
  const { recipe, catalog } = content, native = recipe.map.entities.content;
  const requests: ResourceRequest[] = [...characterResourceRequests(content), ...monsterResources(recipe.enemies), ...equipmentResources(recipe.equipment),
    ...weaponResources(recipe.map.entities, recipe.weapons, catalog)];
  const append = (content: ResourceRequest["content"], models: readonly string[], sounds: readonly string[]): void => {
    requests.push(...models.filter(path => path !== "" && !path.startsWith("*")).map(path => ({ content, path })),
      ...sounds.filter(path => path !== "").map(path => ({ content, path: path.startsWith("sound/") || path.startsWith("*") ? path : `sound/${path}` })));
  };
  const q1 = simulation.q1Source();
  if (q1 !== null) append(native, q1.game.precaches.models, q1.game.precaches.sounds);
  const qc = simulation.quakecSource();
  if (qc !== null) append(native, qc.precacheNames("model"), qc.precacheNames("sound"));
  const q1Weapons = simulation.q1WeaponSource();
  if (q1Weapons !== null && q1Weapons.game !== q1?.game) {
    const weapon = recipe.weapons.find(weapon => catalog.product(weapon.content).expectation.family === "q1");
    if (weapon !== undefined) append(weapon.content, q1Weapons.game.precaches.models, q1Weapons.game.precaches.sounds);
  }
  const q2 = simulation.q2Source();
  if (q2 !== null) {
    const entities = [...q2.game.entities.values()], classnames = new Set(entities.map(entity => entity.classname));
    const product = catalog.product(native).expectation;
    const source = monsterSources.find(source => source.family === product.family && source.edition === product.edition && source.program === product.campaign);
    requests.push(...nativeQ2MonsterResources(native, source, entities));
    for (const path of q2.items.resourcePaths(classnames)) requests.push({ content: native, path });
    for (const path of q2RegisteredWeaponResources(q2.weapons, q2.game.options.edition === "rerelease")) requests.push({ content: native, path });
    append(native, entities.flatMap(entity => [entity.model, entity.model2, entity.model3, entity.model4]), entities.flatMap(entity => [entity.noise, entity.sound]));
  }
  for (const content of new Set([native, ...requests.map(request => request.content)])) {
    if (catalog.product(content).expectation.family === "q2") append(content, [], Q2_TRANSIENT_SOUNDS);
  }
  return [...new Map(requests.filter(request => /\.(mdl|md2|md3|spr|sp2|wav|ogg)$/i.test(request.path))
    .map(request => [`${request.content}\0${request.path}`, request])).values()];
}

export async function prepareApplicationResources(options: {
  readonly content: ResourceContent;
  readonly simulation: PrecacheSource;
  readonly audio: Pick<ApplicationAudio, "preloadSound" | "preloadCharacterFootsteps">;
  readonly effects: Pick<ApplicationEffects, "preloadModel">;
  readonly progress: (message: string) => void;
  readonly print: (message: string) => void;
}): Promise<void> {
  const requests = applicationResourceRequests(options.content, options.simulation);
  const q2Skins = [...options.simulation.q2Source()?.players.states.values() ?? []].map(player => player.skin);
  for (const [index, request] of requests.entries()) {
    options.progress(`Preparing resources ${index + 1}/${requests.length}...`);
    try {
      if (/\.(wav|ogg)$/i.test(request.path)) {
        if (request.path.startsWith("*") && options.content.catalog.product(request.content).expectation.family === "q2") {
          for (const skin of new Set(q2Skins.length === 0 ? ["male"] : q2Skins)) await options.audio.preloadSound(request.content, request.path, skin.split("/")[0] || "male");
        } else await options.audio.preloadSound(request.content, request.path);
      }
      else await options.effects.preloadModel(request.content, request.path);
    } catch (error: unknown) {
      options.print(`Optional resource preload skipped: ${request.content}/${request.path}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await Bun.sleep(0);
  }
  try { await options.audio.preloadCharacterFootsteps(); }
  catch (error: unknown) { options.print(`Optional character footsteps preload skipped: ${error instanceof Error ? error.message : String(error)}\n`); }
}
