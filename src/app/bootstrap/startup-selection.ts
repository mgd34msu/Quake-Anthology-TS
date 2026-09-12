import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { openArchive } from "../../content/archive/index.ts";
import type { ArchiveHandle } from "../../content/archive/index.ts";
import { FileSource } from "../../content/archive/source.ts";
import { parseQ1Entities, q1EntityValue, Q1_BSP_VERSION, Q1_BSP2_VERSION, Q1_2PSB_VERSION } from "../../formats/q1-map/index.ts";
import type { CampaignSelection, EquipmentSelection, ExecutableRecipe, GameFamily, LaunchChoice, ProviderReference } from "../../contracts/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import type { CatalogProduct, InstalledCatalog } from "../../content/catalog/index.ts";
import { EQUIPMENT_PROVIDERS, disabledEquipment, nativeEquipment } from "../../content/catalog/equipment.ts";
import { monsterSources } from "../../content/catalog/monsters.ts";
import { nativeProviderTiming } from "../../content/catalog/timing.ts";
import { applicationPreset } from "./content.ts";
import type { ApplicationOptions } from "./options.ts";

export type StartupSelectionField = "product" | "map" | "movement" | "character" | "model" | "weapons" | "enemies" | "grapple" | "grenades" | "mode" | "rules" | "skill" | "seats" | "renderer" | "gamma" | "resolution";
export interface StartupSelectionChoice { readonly id: string; readonly label: string; readonly unavailable: string | null; }
export interface StartupSelectionRow { readonly id: StartupSelectionField; readonly label: string; readonly value: string; readonly choices: readonly StartupSelectionChoice[]; }
export interface StartupLaunch { readonly options: ApplicationOptions; readonly recipe: ExecutableRecipe; }
const choice = (id: string, label = id, unavailable: string | null = null): StartupSelectionChoice => ({ id, label, unavailable });
const baseProduct = (family: GameFamily): string => family === "q1" ? "q1-classic-id1" : family === "q2" ? "q2-classic-baseq2" : "q3-baseq3";
function unavailable(product: CatalogProduct): string | null {
  const state = product.availability;
  return state.kind === "installed" ? null : state.kind === "unresolved" ? state.reason : `Missing: ${state.requirements.join(", ")}`;
}
function productChoice(product: CatalogProduct): StartupSelectionChoice {
  return choice(product.expectation.id, `${product.expectation.title} (${product.expectation.edition})`, unavailable(product));
}

/** The draft stores UI choices; the existing launch resolver remains the recipe authority. */
export class StartupSelectionModel {
  private readonly values: Record<StartupSelectionField, string>;
  private readonly playableMaps = new Map<string, readonly StartupSelectionChoice[]>();
  private readonly looseModels = new Map<string, readonly string[]>();
  private readonly selectedModels = new Map<string, string>();
  private readonly modelChoices = new Map<string, readonly StartupSelectionChoice[]>();
  constructor(readonly catalog: InstalledCatalog, private readonly initial: ApplicationOptions) {
    const product = catalog.product(initial.product), campaign = product.expectation.campaign;
    const rules = initial.rules ?? (product.expectation.family === "q2" && product.expectation.edition === "classic" && (campaign === "ctf" || campaign === "lmctf") ? campaign : "standard");
    this.values = { product: initial.product, map: initial.map,
      movement: baseProduct(initial.movement), character: baseProduct(initial.character), model: initial.characterModel,
      weapons: "native", enemies: "native", grapple: "native", grenades: "native", mode: initial.mode, rules,
      skill: String(initial.skill), seats: String(initial.seats), renderer: initial.renderer, gamma: String(initial.gamma), resolution: `${initial.width}x${initial.height}` };
    this.selectedModels.set(this.values.character, initial.characterModel);
  }
  async prepareMaps(): Promise<void> {
    const archives = new Map<string, ArchiveHandle>(), files = new Map<string, FileSource>(), playable = new Map<string, boolean>();
    try {
      for (const product of this.catalog.products) {
        if (unavailable(product) !== null) continue;
        if (product.expectation.family === "q2" && product.looseRoot !== null) {
          const directory = join(product.looseRoot, "players"), models: string[] = [];
          if (existsSync(directory)) for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (entry.isDirectory() && existsSync(join(directory, entry.name, "tris.md2"))) models.push(`players/${entry.name}/tris.md2`);
          }
          this.looseModels.set(product.expectation.id, models);
        }
        const choices: StartupSelectionChoice[] = [];
        for (const map of this.catalog.mapsFor(product.id)) {
          const key = `${map.source}:${map.memberIndex}`;
          let accepted = playable.get(key);
          if (accepted === undefined && product.expectation.family === "q1") {
            let file = files.get(map.source);
            if (file === undefined) { file = new FileSource(map.source); files.set(map.source, file); }
            let offset = 0, length = file.byteLength, decoded: Uint8Array | null = null;
            if (map.memberIndex !== null) {
              let archive = archives.get(map.source);
              if (archive === undefined) { archive = await openArchive(map.source); archives.set(map.source, archive); }
              const entry = archive.entries[map.memberIndex];
              if (entry === undefined) throw new Error(`Missing map archive entry: ${map.path}`);
              length = entry.byteLength;
              if (entry.format === "pak") offset = entry.dataOffset;
              else decoded = await archive.readEntry(entry);
            }
            const header = decoded?.subarray(0, 12) ?? await file.read(offset, Math.min(12, length));
            if (header.byteLength < 12) throw new Error(`Truncated map header: ${map.path}`);
            const view = new DataView(header.buffer, header.byteOffset, header.byteLength), version = view.getUint32(0, true);
            if (![Q1_BSP_VERSION, Q1_BSP2_VERSION, Q1_2PSB_VERSION].includes(version)) throw new Error(`Unsupported Quake map header: ${map.path}`);
            const start = view.getUint32(4, true), size = view.getUint32(8, true);
            if (start > length || size > length - start) throw new Error(`Invalid map entity lump: ${map.path}`);
            const bytes = decoded?.subarray(start, start + size) ?? await file.read(offset + start, size);
            accepted = parseQ1Entities(new TextDecoder().decode(bytes)).some(entity => {
              const classname = q1EntityValue(entity, "classname");
              return classname === "info_player_start" || classname === "info_player_deathmatch" || classname === "info_player_coop" || classname === "info_player_start2";
            });
            playable.set(key, accepted);
          }
          if (accepted !== false) choices.push(choice(map.path));
        }
        this.playableMaps.set(product.expectation.id, choices.sort((a, b) => a.id.localeCompare(b.id)));
      }
    } finally {
      for (const archive of archives.values()) archive.close();
      for (const file of files.values()) file.close();
    }
  }
  private maps(): readonly StartupSelectionChoice[] { return this.playableMaps.get(this.geometry().expectation.id) ?? []; }
  private defaultMap(): string {
    const product = this.geometry(), maps = this.maps();
    const preferred = product.expectation.mapWitness ?? (product.expectation.family === "q1" ? "maps/start.bsp" : product.expectation.family === "q2" ? "maps/base1.bsp" : "maps/q3dm0.bsp");
    return maps.find(map => map.id === preferred)?.id ?? "";
  }
  private product(field: "product" | "movement" | "character"): CatalogProduct { return this.catalog.product(this.values[field]); }
  private geometry(): CatalogProduct { return this.product("product"); }
  private files(product: CatalogProduct): ReadonlySet<string> {
    const paths = new Set([...product.archives.flatMap(archive => archive.entries.map(entry => entry.path.toLowerCase())), ...this.looseModels.get(product.expectation.id) ?? []]);
    if (product.expectation.baseProduct !== null) for (const path of this.files(this.catalog.product(product.expectation.baseProduct))) paths.add(path);
    return paths;
  }
  private models(): readonly StartupSelectionChoice[] {
    const product = this.product("character"), existing = this.modelChoices.get(product.expectation.id);
    if (existing !== undefined) return existing;
    const result = this.modelsFor(product); this.modelChoices.set(product.expectation.id, result); return result;
  }
  private modelsFor(product: CatalogProduct): readonly StartupSelectionChoice[] {
    const paths = this.files(product);
    if (product.expectation.family === "q1") return [choice("player", "Quake player", paths.has("progs/player.mdl") ? null : "Player model not installed")];
    const models = new Set<string>();
    for (const path of paths) {
      const match = /^models\/players\/([^/]+)\/lower\.md3$/.exec(path);
      const q2 = /^players\/([^/]+)\/tris\.md2$/.exec(path);
      const name = product.expectation.family === "q3" ? match?.[1] : q2?.[1];
      if (name !== undefined && (product.expectation.family !== "q3" || paths.has(`models/players/${name}/upper.md3`) && paths.has(`models/players/${name}/head.md3`))) models.add(name);
    }
    return [...models].sort().map(name => choice(name));
  }
  private baseChoices(): readonly StartupSelectionChoice[] {
    return this.catalog.products.filter(product => (product.expectation.edition === "classic" || product.expectation.edition === "rerelease")
      && (product.expectation.family === "q1" && product.expectation.campaign === "id1" || product.expectation.family === "q2" && product.expectation.campaign === "baseq2")
      || product.expectation.id === "q3-baseq3").map(productChoice);
  }
  rows(): readonly StartupSelectionRow[] {
    const row = (id: StartupSelectionField, label: string, choices: readonly StartupSelectionChoice[]): StartupSelectionRow => ({ id, label, value: this.values[id], choices });
    const current = this.product("product"), currentLabel = productChoice(current).label;
    const provider: ProviderReference = { provider: `${current.expectation.family}:official`, content: current.id };
    const rules = this.values.rules === "standard" ? current : this.catalog.product(`q2-classic-${this.values.rules}`);
    const defaults = unavailable(current) !== null || unavailable(rules) !== null ? disabledEquipment()
      : nativeEquipment(this.catalog, provider, this.values.rules === "standard" ? provider : { provider: `q2:${this.values.rules}`, content: rules.id });
    const nativeWeapons = choice("native", `${currentLabel} weapons`);
    const nativeMonsters = choice("native", `${currentLabel} authored monsters`);
    const nativeGrapple = choice("native", defaults.grapple.kind === "disabled" ? "Off (campaign default)" : `${defaults.grapple.mechanic} (${defaults.grapple.binding})`);
    const nativeGrenades = choice("native", defaults.handGrenades.kind === "disabled" ? "Off (campaign default)" : `Q2 ${defaults.handGrenades.edition} offhand grenades`);
    const monsters = monsterSources.flatMap(source => {
      const product = this.catalog.products.find(product => product.expectation.family === source.family && product.expectation.edition === source.edition && product.expectation.campaign === source.program);
      return Object.keys(source.creatures).map(classname => choice(`${source.provider}/${classname}`, `${classname.replace("monster_", "")} (${source.family}, ${source.edition})`, product === undefined ? "Source content unavailable" : unavailable(product)));
    });
    const grapples: StartupSelectionChoice[] = [nativeGrapple, choice("disabled", "Disabled")];
    for (const product of this.catalog.products) {
      const { family, campaign, edition, id } = product.expectation;
      if (family === "q1" && campaign === "ctf" && edition === "rerelease" || family === "q2" && (campaign === "ctf" || campaign === "lmctf" && edition === "classic")) {
        for (const binding of ["slot", "offhand"]) grapples.push(choice(`${id}/${binding}`, `${product.expectation.title} — ${binding === "slot" ? "weapon slot" : "offhand"}`, unavailable(product)));
      }
    }
    return [row("product", "Campaign / map pack", this.catalog.products.map(productChoice)),
      row("map", "Starting map", this.maps()),
      row("movement", "Movement", [...this.baseChoices(), productChoice(this.catalog.product("q1-quakeworld"))]),
      row("character", "Character source", this.baseChoices()), row("model", "Character model", this.models()),
      row("weapons", "Weapons", [nativeWeapons, ...this.baseChoices().map(option => {
        const product = this.catalog.product(option.id), current = this.product("product");
        return option.unavailable === null && product.expectation.family === current.expectation.family && product.id !== current.id
          ? { ...option, unavailable: "Another edition or campaign within this weapon family is not implemented; use campaign defaults." } : option;
      })]), row("enemies", "Monsters", [nativeMonsters, ...monsters]),
      row("grapple", "Grapple", grapples), row("grenades", "Offhand grenades", [nativeGrenades, choice("disabled", "Disabled"),
        ...this.catalog.products.filter(product => product.expectation.family === "q2" && product.expectation.campaign === "baseq2").map(productChoice)]),
      row("mode", "Game mode", [choice("singleplayer", "Single player"), choice("coop", "Cooperative"), choice("deathmatch", "Deathmatch")]),
      row("rules", "Match rules", [choice("standard", "Standard"), ...["ctf", "lmctf"].map(rule => choice(rule, rule === "ctf" ? "Q2 Capture the Flag" : "Loki's Minions CTF",
        this.product("product").expectation.family !== "q2" || this.product("product").expectation.edition !== "classic" ? "Requires a classic Quake II campaign"
          : this.values.mode !== "deathmatch" ? "Requires deathmatch mode" : unavailable(this.catalog.product(`q2-classic-${rule}`))))]),
      row("skill", "Difficulty", [choice("0", "Easy"), choice("1", "Normal"), choice("2", "Hard"), choice("3", "Nightmare")]),
      row("seats", "Local players", [1, 2, 3, 4].map(value => choice(String(value)))),
      row("renderer", "Renderer", [choice("gl", "OpenGL"), choice("cpu", "Software")]),
      row("gamma", "Display gamma", [...new Set(["0.5", "0.75", "1", "1.3", "1.5", "2", "2.5", "3", String(this.initial.gamma)])].map(value => choice(value))),
      row("resolution", "Resolution", [...new Set(["640x480", "960x600", "1280x720", "1920x1080", `${this.initial.width}x${this.initial.height}`])].map(value => choice(value)))];
  }
  select(field: StartupSelectionField, id: string): void {
    const selected = this.rows().find(row => row.id === field)?.choices.find(option => option.id === id);
    if (selected === undefined) throw new Error(`Unknown ${field} selection: ${id}`);
    if (selected.unavailable !== null) throw new Error(selected.unavailable);
    this.values[field] = id;
    if (field === "product") this.values.map = this.defaultMap();
    if (field === "mode" || field === "product") {
      const product = this.product("product");
      if (this.values.mode !== "deathmatch" || product.expectation.family !== "q2" || product.expectation.edition !== "classic") this.values.rules = "standard";
    }
    if (field === "model") this.selectedModels.set(this.values.character, id);
    if (field === "character") {
      const family = this.product("character").expectation.family;
      const preferred = this.selectedModels.get(id) ?? (family === "q1" ? "player" : family === "q2" ? "male" : "sarge");
      this.values.model = this.models().find(model => model.id === preferred)?.id ?? this.models()[0]?.id ?? "";
      this.selectedModels.set(id, this.values.model);
    }
  }
  get options(): ApplicationOptions {
    const mode = this.values.mode, renderer = this.values.renderer, rules = this.values.rules, skill = Number(this.values.skill);
    if (mode !== "singleplayer" && mode !== "coop" && mode !== "deathmatch" || renderer !== "gl" && renderer !== "cpu"
      || rules !== "standard" && rules !== "ctf" && rules !== "lmctf" || skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Invalid startup settings");
    const [width, height] = this.values.resolution.split("x").map(Number);
    if (width === undefined || height === undefined) throw new Error("Invalid display resolution");
    return { ...this.initial, product: this.values.product, map: this.values.map, movement: this.product("movement").expectation.family,
      character: this.product("character").expectation.family, characterModel: this.values.model, mode, rules, skill,
      seats: Number(this.values.seats), renderer, gamma: Number(this.values.gamma), width, height };
  }
  summary(): readonly string[] {
    return [...this.rows().filter(row => !["renderer", "gamma", "resolution"].includes(row.id)).map(row => `${row.label}: ${row.choices.find(choice => choice.id === row.value)?.label ?? row.value}`),
      "Pickups: authored map items supply the selected arsenal through its admitted mappings. Independent pickup replacement is not implemented."];
  }
  async resolve(): Promise<StartupLaunch> {
    for (const row of this.rows()) {
      const selected = row.choices.find(choice => choice.id === row.value);
      if (selected === undefined || selected.unavailable !== null) throw new Error(`${row.label}: ${selected?.unavailable ?? "choose an installed option"}`);
    }
    const options = this.options, base = applicationPreset(this.catalog, options), mapContent = this.geometry();
    const movementProduct = this.product("movement"), characterProduct = this.product("character");
    const movement: ProviderReference = { provider: `${movementProduct.expectation.family}:movement`, content: movementProduct.id };
    const character: ProviderReference = { provider: `${characterProduct.expectation.family}:character`, content: characterProduct.id };
    const movementTiming = nativeProviderTiming(movement, movementProduct.expectation.family, movementProduct.expectation.edition === "rerelease");
    const timing = base.timing.map(profile => profile.provider === movement.provider
      ? movementProduct.expectation.id === "q1-quakeworld" ? { ...movementTiming, clock: { kind: "q1-quakeworld", maximumCommandMilliseconds: 255 } } satisfies ExecutableRecipe["timing"][number] : movementTiming
      : profile.provider === character.provider ? nativeProviderTiming(character, characterProduct.expectation.family, characterProduct.expectation.edition === "rerelease") : profile);
    const preset = { ...base, timing };
    let selections: LaunchChoice = { ...presetChoice(preset.id), map: { kind: "selected", value: { geometry: { content: mapContent.id, path: options.map }, entities: base.map.entities } },
      movement: { kind: "selected", value: movement }, character: { kind: "selected", value: { definition: character, appearance: { provider: `${options.character}:model/${options.characterModel}`, content: character.content } } } };
    const campaign: CampaignSelection = options.mode === "deathmatch" ? { kind: "none" } : base.campaign;
    selections = { ...selections, campaign: { kind: "selected", value: campaign } };
    if (this.values.weapons !== "native") {
      const product = this.catalog.require(this.values.weapons);
      if (product.expectation.family === this.product("product").expectation.family && product.id !== base.map.entities.content)
        throw new Error("Selecting another edition's weapons within the same game family is not implemented; choose campaign weapons or a different family.");
      selections = { ...selections, weapons: { kind: "selected", value: [{ provider: `${product.expectation.family}:official`, content: product.id }] } };
    }
    if (this.values.enemies !== "native") {
      const source = monsterSources.find(source => this.values.enemies.startsWith(`${source.provider}/`));
      if (source === undefined) throw new Error("Unknown monster source");
      const product = this.catalog.products.find(product => product.expectation.family === source.family && product.expectation.edition === source.edition && product.expectation.campaign === source.program);
      if (product === undefined) throw new Error("Monster source content unavailable");
      selections = { ...selections, enemies: { kind: "selected", value: { kind: "replace", default: { source: { provider: source.provider, content: product.id }, classname: this.values.enemies.slice(source.provider.length + 1) }, byClassname: {} } } };
    }
    let equipment: EquipmentSelection = base.equipment;
    if (this.values.grapple === "disabled") equipment = { ...equipment, grapple: disabledEquipment().grapple };
    else if (this.values.grapple !== "native") {
      const [id, binding] = this.values.grapple.split("/");
      if (id === undefined || binding !== "slot" && binding !== "offhand") throw new Error("Invalid grapple selection");
      const product = this.catalog.require(id), edition = product.expectation.edition;
      if (product.expectation.family === "q1") equipment = { ...equipment, grapple: { kind: "enabled", source: { provider: EQUIPMENT_PROVIDERS.threewave, content: product.id }, mechanic: "q1-threewave", edition: "rerelease", binding } };
      else if (product.expectation.campaign === "lmctf") equipment = { ...equipment, grapple: { kind: "enabled", source: { provider: EQUIPMENT_PROVIDERS.lmctf, content: product.id }, mechanic: "q2-lmctf", edition: "classic", binding } };
      else {
        if (edition !== "classic" && edition !== "rerelease") throw new Error("Unsupported grapple edition");
        equipment = { ...equipment, grapple: { kind: "enabled", source: { provider: EQUIPMENT_PROVIDERS.ctf, content: product.id }, mechanic: "q2-ctf", edition, binding } };
      }
    }
    if (this.values.grenades === "disabled") equipment = { ...equipment, handGrenades: disabledEquipment().handGrenades };
    else if (this.values.grenades !== "native") {
      const product = this.catalog.require(this.values.grenades), edition = product.expectation.edition;
      if (edition !== "classic" && edition !== "rerelease") throw new Error("Unsupported grenade edition");
      equipment = { ...equipment, handGrenades: { kind: "enabled", source: { provider: EQUIPMENT_PROVIDERS.handGrenades, content: product.id }, edition, binding: "offhand", initialAmmo: 5, capacity: 50 } };
    }
    selections = { ...selections, equipment: { kind: "selected", value: equipment } };
    return { options, recipe: await resolveLaunch({ catalog: this.catalog, preset, choice: selections }) };
  }
}
export async function createStartupSelection(options: ApplicationOptions): Promise<StartupSelectionModel> {
  const model = new StartupSelectionModel(await discoverInstalledContent({ corpusRoot: options.corpusRoot, discoverMods: false }), options);
  await model.prepareMaps();
  return model;
}
