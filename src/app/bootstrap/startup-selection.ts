import { defaultUserContentRoot } from "../../content/user-data.ts";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { openArchive } from "../../content/archive/index.ts";
import type { ArchiveHandle } from "../../content/archive/index.ts";
import { parseQ2Entities } from "../../content/q2/foundation/fields.ts";
import { FileSource } from "../../content/archive/source.ts";
import { parseQ1Entities, q1EntityValue, Q1_BSP_VERSION, Q1_BSP2_VERSION, Q1_2PSB_VERSION } from "../../formats/q1-map/index.ts";
import type { CampaignSelection, EnemySelection, EquipmentSelection, MonsterSelectionTarget, ExecutableRecipe, GameFamily, LaunchChoice, ProviderReference } from "../../contracts/content.ts";
import { discoverInstalledContent, expectedProducts, presetChoice, resolveLaunch } from "../../content/catalog/index.ts";
import type { CatalogProduct, InstalledCatalog } from "../../content/catalog/index.ts";
import { EQUIPMENT_PROVIDERS, disabledEquipment, nativeEquipment } from "../../content/catalog/equipment.ts";
import { campaignMonsterSlots, defaultMonsterRoster, monsterSources } from "../../content/catalog/monsters.ts";
import { nativeProviderTiming } from "../../content/catalog/timing.ts";
import { canonicalWeaponSource } from "../../content/catalog/weapons.ts";
import { applicationPreset } from "./content.ts";
import { CommonParseCursor, CommonParseState } from "../../core/common-parse.ts";
import type { ApplicationOptions } from "./options.ts";

export type StartupSelectionField = "doppler" | "environment" | "product" | "map" | "movement" | "character" | "model" | "weapons" | "enemies" | "grapple" | "grenades" | "mode" | "rules" | "skill" | "seats" | "renderer";
export interface StartupSelectionChoice { readonly id: string; readonly label: string; readonly unavailable: string | null; }
export interface StartupSelectionRow { readonly id: StartupSelectionField; readonly label: string; readonly value: string; readonly choices: readonly StartupSelectionChoice[]; }
export interface MonsterRosterRow { readonly classname: string | null; readonly label: string; readonly value: string; readonly effectiveLabel: string; readonly choices: readonly StartupSelectionChoice[]; }
export interface StartupNativePreset extends StartupSelectionChoice {
  readonly family: GameFamily;
  readonly edition: string;
  readonly difficulties: readonly StartupSelectionChoice[];
  readonly defaultSkill: string;
}
export interface StartupLaunch { readonly options: ApplicationOptions; readonly recipe: ExecutableRecipe; }
const choice = (id: string, label = id, unavailable: string | null = null): StartupSelectionChoice => ({ id, label, unavailable });
const monsterNames: Readonly<Record<string, string>> = { monster_army: "Grunt", monster_demon1: "Fiend", monster_wizard: "Scrag", monster_shalrath: "Vore", monster_tarbaby: "Spawn" };
function monsterLabel(classname: string): string {
  return monsterNames[classname] ?? classname.replace("monster_", "").split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
function monsterProgramSuffix(program: string): string {
  return program === "id1" || program === "baseq2" ? "" : ` ${program}`;
}
function monsterSourceTitle(family: GameFamily, program: string, title: string | undefined): string {
  return program === "id1" || program === "baseq2" ? family === "q1" ? "Quake" : "Quake II" : title ?? program;
}
const baseProduct = (family: GameFamily): string => family === "q1" ? "q1-classic-id1" : family === "q2" ? "q2-classic-baseq2" : "q3-baseq3";
function baseArsenalPair(map: CatalogProduct, weapon: CatalogProduct): boolean {
  if (weapon.expectation.family === "q1" && weapon.expectation.campaign === "hipnotic" && (weapon.expectation.edition === "classic" || weapon.expectation.edition === "rerelease")) return true;
  const family = map.expectation.family, program = family === "q1" ? "id1" : "baseq2";
  return (family === "q1" || family === "q2") && [map, weapon].every(product => product.expectation.family === family && product.expectation.campaign === program
    && (product.expectation.edition === "classic" || product.expectation.edition === "rerelease"));
}
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
  private display: Pick<ApplicationOptions, "width" | "height" | "gamma">;
  private displayOverridesConsumed = false;
  private readonly playableMaps = new Map<string, readonly StartupSelectionChoice[]>();
  private readonly authoredDefaultMaps = new Map<string, string>();
  private readonly looseModels = new Map<string, readonly string[]>();
  private readonly monsterClasses = new Map<string, ReadonlyMap<string, number>>();
  private readonly rosters = new Map<string, { source: string; default: string; readonly byClassname: Map<string, string> }>();
  private readonly selectedModels = new Map<string, string>();
  private readonly modelChoices = new Map<string, readonly StartupSelectionChoice[]>();
  constructor(readonly catalog: InstalledCatalog, private readonly initial: ApplicationOptions) {
    this.display = { width: initial.width, height: initial.height, gamma: initial.gamma };
    const product = catalog.product(initial.product), campaign = product.expectation.campaign;
    const rules = initial.rules ?? (product.expectation.family === "q2" && product.expectation.edition === "classic" && (campaign === "ctf" || campaign === "lmctf") ? campaign : "standard");
    this.values = { product: initial.product, map: initial.map,
      movement: baseProduct(initial.movement), character: baseProduct(initial.character), model: initial.characterModel,
      doppler: "source", environment: "audio-content", weapons: "native", enemies: "native", grapple: "native", grenades: "native", mode: initial.mode, rules,
      skill: String(initial.skill), seats: String(initial.seats), renderer: initial.renderer };
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
            const entities = parseQ1Entities(new TextDecoder().decode(bytes));
            this.cacheMonsterClasses(key, entities.map(entity => q1EntityValue(entity, "classname") ?? ""));
            accepted = entities.some(entity => {
              const classname = q1EntityValue(entity, "classname");
              return classname === "info_player_start" || classname === "info_player_deathmatch" || classname === "info_player_coop" || classname === "info_player_start2";
            });
            playable.set(key, accepted);
          }
          if (accepted !== false) choices.push(choice(map.path));
        }
        const authored = await this.catalog.authoredStartsFor(product.id);
        const starts: StartupSelectionChoice[] = [];
        for (const start of authored?.starts ?? []) {
          if (starts.some(choice => choice.id.toLowerCase() === start.path.toLowerCase())) continue;
          const installed = choices.find(choice => choice.id.toLowerCase() === start.path.toLowerCase());
          starts.push(choice(installed?.id ?? start.path, start.title || start.path, installed === undefined ? `Missing authored start map: ${start.path}` : null));
        }
        const first = starts[0];
        if (first !== undefined) this.authoredDefaultMaps.set(product.expectation.id, first.id);
        const authoredPaths = new Set(starts.map(start => start.id.toLowerCase()));
        this.playableMaps.set(product.expectation.id, [...starts, ...choices.filter(map => !authoredPaths.has(map.id.toLowerCase())).sort((a, b) => a.id.localeCompare(b.id))]);
      }
    } finally {
      for (const archive of archives.values()) archive.close();
      for (const file of files.values()) file.close();
    }
  }
  private async q3TrainingMap(product: CatalogProduct): Promise<string | null> {
    const paths = [...this.files(product)].filter(path => path === "scripts/arenas.txt" || /^scripts\/[^/]+\.arena$/.test(path));
    for (const path of paths) {
      const parser = new CommonParseState(), cursor = new CommonParseCursor(Buffer.from(await this.catalog.read(product.id, path)).toString("latin1"));
      while (parser.parse(cursor) === "{") {
        const fields = new Map<string, string>();
        for (;;) {
          const key = parser.parse(cursor);
          if (key === "}" || key === "") break;
          fields.set(key, parser.parse(cursor, false));
        }
        const map = fields.get("map");
        if (fields.get("special")?.toLowerCase() === "training" && map !== undefined) return `maps/${map}.bsp`;
      }
    }
    return null;
  }
  presets(): readonly StartupNativePreset[] {
    return this.catalog.products.filter(product => product.availability.kind === "installed"
      && expectedProducts.some(expected => expected.id === product.expectation.id)
      && (product.expectation.edition === "classic" || product.expectation.edition === "rerelease")
      && product.expectation.campaign !== "ctf" && product.expectation.campaign !== "lmctf").map(product => {
      const { family, edition, campaign } = product.expectation;
      const difficulties = family === "q3"
        ? [choice("1", "I Can Win"), choice("2", "Bring It On"), choice("3", "Hurt Me Plenty"), choice("4", "Hardcore"), choice("5", "Nightmare")]
        : [choice("0", "Easy"), choice("1", "Normal"), choice("2", "Hard"), choice("3", "Nightmare")];
      return { ...productChoice(product), family, edition, difficulties, defaultSkill: family === "q3" ? "2" : "1",
        unavailable: campaign === "missionpack" ? "Team Arena campaign team setup is not connected yet." : null };
    });
  }
  async resolvePreset(id: string, difficulty?: number): Promise<StartupLaunch> {
    const selected = this.presets().find(preset => preset.id === id);
    if (selected === undefined) throw new Error(`Installed official campaign preset unavailable: ${id}`);
    if (selected.unavailable !== null) throw new Error(selected.unavailable);
    const level = difficulty ?? Number(selected.defaultSkill);
    if (!selected.difficulties.some(choice => Number(choice.id) === level)) throw new Error("Invalid preset difficulty");
    const product = this.catalog.require(id), family = product.expectation.family;
    const preferred = family === "q3" ? await this.q3TrainingMap(product)
      : this.authoredDefaultMaps.get(id) ?? product.expectation.mapWitness ?? (family === "q1" ? "maps/start.bsp" : null);
    const map = this.playableMaps.get(id)?.find(map => map.id.toLowerCase() === preferred?.toLowerCase());
    if (map === undefined || map.unavailable !== null) throw new Error(`${selected.label}: ${map?.unavailable ?? "authored campaign start map is unavailable"}`);
    const characterModel = family === "q1" ? "player" : family === "q2" ? "male" : "sarge";
    const model = this.modelsFor(product).find(model => model.id === characterModel);
    if (model === undefined || model.unavailable !== null) throw new Error(`${selected.label}: native ${characterModel} model is unavailable`);
    const { botSkill: _botSkill, serverProfile: _serverProfile, serverProfilePath: _serverProfilePath,
      quakeCProgram: _quakeCProgram, remoteContent: _remoteContent, q1Protocol: _q1Protocol, q2Protocol: _q2Protocol, ...preferences } = this.initial;
    const skill = family === "q3" ? 1 : level;
    if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Invalid campaign difficulty");
    const bot: Pick<ApplicationOptions, "botSkill"> = family === "q3" && (level === 1 || level === 2 || level === 3 || level === 4 || level === 5) ? { botSkill: level } : {};
    const renderer = this.values.renderer;
    if (renderer !== "gl" && renderer !== "cpu") throw new Error("Invalid renderer selection");
    const options: ApplicationOptions = { ...preferences, ...this.display,
      ...(this.displayOverridesConsumed ? { displayOverrides: {} } : {}), renderer,
      product: id, map: map.id, movement: family, character: family, characterModel, skill, ...bot,
      mode: "singleplayer", rules: "standard", seats: 1, dedicated: false, network: { kind: "offline" } };
    const movement: ProviderReference = { provider: `${family}:movement`, content: product.id };
    const character: ProviderReference = { provider: `${family}:character`, content: product.id };
    const preset = applicationPreset(this.catalog, options, { movement, character });
    return { options, recipe: await resolveLaunch({ catalog: this.catalog, preset, choice: presetChoice(preset.id) }) };
  }
  private maps(): readonly StartupSelectionChoice[] { return this.playableMaps.get(this.geometry().expectation.id) ?? []; }
  private defaultMap(): string {
    const product = this.geometry(), maps = this.maps();
    const preferred = this.authoredDefaultMaps.get(product.expectation.id) ?? product.expectation.mapWitness ?? (product.expectation.family === "q1" ? "maps/start.bsp" : product.expectation.family === "q2" ? "maps/base1.bsp" : "maps/q3dm0.bsp");
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
  private roster() {
    let roster = this.rosters.get(this.values.product);
    if (roster === undefined) { roster = { source: "native", default: "native", byClassname: new Map<string, string>() }; this.rosters.set(this.values.product, roster); }
    return roster;
  }
  private cacheMonsterClasses(key: string, classnames: readonly string[]): void {
    const counts = new Map<string, number>();
    for (const classname of classnames) if (classname.startsWith("monster_")) counts.set(classname, (counts.get(classname) ?? 0) + 1);
    this.monsterClasses.set(key, counts);
  }
  async prepareMonsterRoster(): Promise<void> {
    const product = this.geometry();
    if (product.expectation.family === "q3") throw new Error("This map has no supported authored monster roster");
    const map = this.catalog.mapsFor(product.id).find(map => map.path === this.values.map);
    if (map === undefined) throw new Error("Selected map is unavailable");
    const key = `${map.source}:${map.memberIndex}`;
    if (this.monsterClasses.has(key)) return;
    const file = new FileSource(map.source);
    let archive: ArchiveHandle | null = null;
    try {
      let offset = 0, length = file.byteLength, decoded: Uint8Array | null = null;
      if (map.memberIndex !== null) {
        archive = await openArchive(map.source);
        const entry = archive.entries[map.memberIndex];
        if (entry === undefined) throw new Error("Selected map archive entry is unavailable");
        length = entry.byteLength;
        if (entry.format === "pak") offset = entry.dataOffset; else decoded = await archive.readEntry(entry);
      }
      const q2 = product.expectation.family === "q2", headerLength = q2 ? 16 : 12;
      const header = decoded?.subarray(0, headerLength) ?? await file.read(offset, Math.min(length, headerLength));
      if (header.byteLength < headerLength) throw new Error("Truncated map header");
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (q2 ? !["IBSP", "QBSP"].includes(new TextDecoder().decode(header.subarray(0, 4))) || view.getUint32(4, true) !== 38
        : ![Q1_BSP_VERSION, Q1_BSP2_VERSION, Q1_2PSB_VERSION].includes(view.getUint32(0, true))) throw new Error("Unsupported map header");
      const start = view.getUint32(q2 ? 8 : 4, true), size = view.getUint32(q2 ? 12 : 8, true);
      if (start > length || size > length - start) throw new Error("Invalid map entity lump");
      const bytes = decoded?.subarray(start, start + size) ?? await file.read(offset + start, size), text = new TextDecoder().decode(bytes).replace(/\0+$/, "");
      this.cacheMonsterClasses(key, q2 ? parseQ2Entities(text, product.expectation.edition === "rerelease" ? "rerelease" : "classic").map(entity => entity.classname)
        : parseQ1Entities(text).map(entity => q1EntityValue(entity, "classname") ?? ""));
    } finally { archive?.close(); file.close(); }
  }
  private monsterChoices(): readonly StartupSelectionChoice[] {
    return [choice("native", "Keep native"), ...monsterSources.flatMap(source => {
      const product = this.catalog.products.find(product => product.expectation.family === source.family && product.expectation.edition === source.edition && product.expectation.campaign === source.program);
      const paths = product === undefined ? new Set<string>() : this.files(product);
      return Object.entries(source.creatures).map(([classname, creature]) => choice(`${source.provider}/${classname}`,
        `${monsterLabel(classname)} (${source.family.toUpperCase()}${monsterProgramSuffix(source.program)}, ${source.edition})`,
        product === undefined ? "Source content unavailable" : unavailable(product) ?? (creature.resources.every(path => paths.has(path.toLowerCase())) ? null : "Creature resources are not installed")));
    })];
  }
  monsterSourceRow(): { readonly label: string; readonly value: string; readonly choices: readonly StartupSelectionChoice[] } {
    return { label: "Monster source", value: this.roster().source, choices: [choice("native", "Authored campaign monsters"), ...monsterSources.map(source => {
      const product = this.catalog.products.find(product => product.expectation.family === source.family && product.expectation.edition === source.edition && product.expectation.campaign === source.program);
      return choice(source.provider, `${monsterSourceTitle(source.family, source.program, product?.expectation.title)} (${source.edition})`, product === undefined ? "Source content unavailable" : unavailable(product));
    })] };
  }
  selectMonsterSource(id: string): void {
    if (this.geometry().expectation.family === "q3") throw new Error("This map has no supported authored monster roster");
    const selected = this.monsterSourceRow().choices.find(choice => choice.id === id);
    if (selected === undefined) throw new Error("Unknown monster source");
    if (selected.unavailable !== null) throw new Error(selected.unavailable);
    this.roster().source = id; this.values.enemies = "custom";
  }
  private effectiveMonsterRoster(includeOverrides = true): Extract<EnemySelection, { readonly kind: "replace" }> {
    const roster = this.roster(), family = this.geometry().expectation.family;
    const byClassname: Record<string, MonsterSelectionTarget> = {};
    if (includeOverrides) for (const [classname, id] of roster.byClassname) byClassname[classname] = this.monsterTarget(id);
    const fallback = this.monsterTarget(roster.default);
    if (roster.source === "native" || family === "q3") return { kind: "replace", default: fallback, byClassname };
    const source = monsterSources.find(source => source.provider === roster.source);
    if (source === undefined) throw new Error("Unknown monster source");
    const product = this.catalog.products.find(product => product.expectation.family === source.family && product.expectation.edition === source.edition && product.expectation.campaign === source.program);
    if (product === undefined) throw new Error("Monster source content unavailable");
    return { ...defaultMonsterRoster(family, { provider: source.provider, content: product.id }, byClassname), default: fallback };
  }
  monsterRosterRows(): readonly MonsterRosterRow[] {
    const map = this.catalog.mapsFor(this.geometry().id).find(map => map.path === this.values.map);
    const counts = map === undefined ? undefined : this.monsterClasses.get(`${map.source}:${map.memberIndex}`), roster = this.roster(), choices = this.monsterChoices();
    const defaults = this.effectiveMonsterRoster(false), effective = this.effectiveMonsterRoster(), slots = new Set([...campaignMonsterSlots(this.geometry().expectation.family).map(slot => slot.classname), ...counts?.keys() ?? [], ...roster.byClassname.keys()]);
    const targetLabel = (target: MonsterSelectionTarget): string => {
      if ("kind" in target) return "Keep native";
      const source = monsterSources.find(source => source.provider === target.source.provider);
      return `${monsterLabel(target.classname)} (${source?.family.toUpperCase() ?? target.source.provider}${source === undefined ? "" : monsterProgramSuffix(source.program)} ${source?.edition ?? ""})`;
    };
    return [{ classname: null, label: "Unmatched classes", value: roster.default, effectiveLabel: targetLabel(defaults.default), choices }, ...[...slots].sort((left, right) => Number((counts?.get(right) ?? 0) > 0) - Number((counts?.get(left) ?? 0) > 0) || left.localeCompare(right)).map(classname => {
      const value = roster.byClassname.get(classname) ?? "default", target = effective.byClassname[classname] ?? effective.default;
      const label = targetLabel(target);
      return { classname, label: `${monsterLabel(classname)} (${counts?.get(classname) ?? 0})`, value,
        effectiveLabel: `${label}${value === "default" ? "" : " *"}`, choices: [choice("default", `Use default: ${targetLabel(defaults.byClassname[classname] ?? defaults.default)}`), ...choices] };
    })];
  }
  selectMonster(classname: string | null, id: string): void {
    const row = this.monsterRosterRows().find(row => row.classname === classname), selected = row?.choices.find(choice => choice.id === id);
    if (selected === undefined) throw new Error("Unknown monster roster choice");
    if (selected.unavailable !== null) throw new Error(selected.unavailable);
    const roster = this.roster();
    if (classname === null) roster.default = id;
    else if (id === "default") roster.byClassname.delete(classname); else roster.byClassname.set(classname, id);
  }
  private monsterTarget(id: string): MonsterSelectionTarget {
    if (id === "native") return { kind: "map-defined" };
    const source = monsterSources.find(source => id.startsWith(`${source.provider}/`));
    if (source === undefined) throw new Error("Unknown monster source");
    const product = this.catalog.products.find(product => product.expectation.family === source.family && product.expectation.edition === source.edition && product.expectation.campaign === source.program);
    if (product === undefined) throw new Error("Monster source content unavailable");
    return { source: { provider: source.provider, content: product.id }, classname: id.slice(source.provider.length + 1) };
  }
  private baseChoices(): readonly StartupSelectionChoice[] {
    return this.catalog.products.filter(product => (product.expectation.edition === "classic" || product.expectation.edition === "rerelease")
      && (product.expectation.family === "q1" && product.expectation.campaign === "id1" || product.expectation.family === "q2" && product.expectation.campaign === "baseq2")
      || product.expectation.id === "q3-baseq3").map(productChoice);
  }
  rows(): readonly StartupSelectionRow[] {
    const roster = this.roster(), monsterSource = this.monsterSourceRow();
    const sourceLabel = monsterSource.choices.find(source => source.id === roster.source)?.label ?? "Authored campaign monsters";
    const customized = roster.default !== "native" || roster.byClassname.size > 0;
    const monsterValue = this.values.enemies === "custom" && roster.source !== "native" && !customized ? roster.source : this.values.enemies;
    const row = (id: StartupSelectionField, label: string, choices: readonly StartupSelectionChoice[]): StartupSelectionRow => ({ id, label, value: id === "enemies" ? monsterValue : this.values[id], choices });
    const current = this.product("product"), currentLabel = productChoice(current).label;
    const provider: ProviderReference = { provider: `${current.expectation.family}:official`, content: current.id };
    const rules = this.values.rules === "standard" ? current : this.catalog.product(`q2-classic-${this.values.rules}`);
    const defaults = unavailable(current) !== null || unavailable(rules) !== null ? disabledEquipment()
      : nativeEquipment(this.catalog, provider, this.values.rules === "standard" ? provider : { provider: `q2:${this.values.rules}`, content: rules.id });
    const nativeWeapons = choice("native", `${currentLabel} weapons`);
    const nativeMonsters = choice("native", `${currentLabel} authored monsters`);
    const nativeGrapple = choice("native", defaults.grapple.kind === "disabled" ? "Off (campaign default)" : `${defaults.grapple.mechanic} (${defaults.grapple.binding})`);
    const nativeGrenades = choice("native", defaults.handGrenades.kind === "disabled" ? "Off (campaign default)" : `Q2 ${defaults.handGrenades.edition} offhand grenades`);
    const grapples: StartupSelectionChoice[] = [nativeGrapple, choice("disabled", "Disabled")];
    for (const product of this.catalog.products) {
      const { family, campaign, edition, id } = product.expectation;
      if (family === "q1" && campaign === "ctf" && edition === "rerelease" || family === "q2" && (campaign === "ctf" || campaign === "lmctf" && edition === "classic")) {
        for (const binding of ["slot", "offhand"]) grapples.push(choice(`${id}/${binding}`, `${product.expectation.title} — ${binding === "slot" ? "weapon slot" : "offhand"}`, unavailable(product)));
      }
    }
    const environmentProduct = this.catalog.product("q2-rerelease-baseq2");
    return [row("environment", "Environment", [choice("disabled", "Off"), choice("audio-content", "Game default"),
      choice("q2-rerelease-baseq2", "Quake II environments", unavailable(environmentProduct) === null ? null : "Requires Quake II rerelease data")]), row("doppler", "Doppler", [choice("source", "Game default"), choice("disabled", "Off")]), row("product", "Campaign / map pack", this.catalog.products.map(productChoice)),
      row("map", "Starting map", this.maps()),
      row("movement", "Movement", [...this.baseChoices(), productChoice(this.catalog.product("q1-quakeworld"))]),
      row("character", "Character source", this.baseChoices()), row("model", "Character model", this.models()),
      row("weapons", "Weapons", [nativeWeapons, ...[...this.baseChoices(), ...this.catalog.products.filter(product => product.expectation.family === "q1" && product.expectation.campaign === "hipnotic" && (product.expectation.edition === "classic" || product.expectation.edition === "rerelease")).map(productChoice)].map(option => {
        const product = this.catalog.product(option.id), current = this.product("product");
        return option.unavailable === null && product.expectation.family === current.expectation.family && product.id !== current.id && !baseArsenalPair(current, product)
          ? { ...option, unavailable: "Another edition or campaign within this weapon family is not implemented; use campaign defaults." } : option;
      })]), row("enemies", "Monsters", [nativeMonsters, choice("custom", this.values.enemies === "custom" ? `${sourceLabel} (custom)` : "Custom roster", current.expectation.family === "q3" ? "This map has no supported authored monster roster" : null), ...this.monsterSourceRow().choices.filter(source => source.id !== "native").map(source => ({ ...source, unavailable: current.expectation.family === "q3" ? "This map has no supported authored monster roster" : source.unavailable }))]),
      row("grapple", "Grapple", grapples), row("grenades", "Offhand grenades", [nativeGrenades, choice("disabled", "Disabled"),
        ...this.catalog.products.filter(product => product.expectation.family === "q2" && product.expectation.campaign === "baseq2").map(productChoice)]),
      row("mode", "Game mode", [choice("singleplayer", "Single player"), choice("coop", "Cooperative"), choice("deathmatch", "Deathmatch")]),
      row("rules", "Match rules", [choice("standard", "Standard"), ...["ctf", "lmctf"].map(rule => choice(rule, rule === "ctf" ? "Q2 Capture the Flag" : "Loki's Minions CTF",
        this.product("product").expectation.family !== "q2" || this.product("product").expectation.edition !== "classic" ? "Requires a classic Quake II campaign"
          : this.values.mode !== "deathmatch" ? "Requires deathmatch mode" : unavailable(this.catalog.product(`q2-classic-${rule}`))))]),
      row("skill", "Difficulty", [choice("0", "Easy"), choice("1", "Normal"), choice("2", "Hard"), choice("3", "Nightmare")]),
      row("seats", "Local players", [1, 2, 3, 4].map(value => choice(String(value)))),
      row("renderer", "Renderer", [choice("gl", "OpenGL"), choice("cpu", "Software")])];
  }
  select(field: StartupSelectionField, id: string): void {
    const selected = this.rows().find(row => row.id === field)?.choices.find(option => option.id === id);
    if (selected === undefined) throw new Error(`Unknown ${field} selection: ${id}`);
    if (selected.unavailable !== null) throw new Error(selected.unavailable);
    if (field === "enemies" && id !== "native" && id !== "custom") { this.selectMonsterSource(id); return; }
    this.values[field] = id;
    if (field === "product") {
      this.values.map = this.defaultMap();
      if (this.product("product").expectation.family === "q3") this.values.enemies = "native";
    }
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
  setDisplay(display: Pick<ApplicationOptions, "width" | "height" | "gamma">): void {
    if (![display.width, display.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384)
      || !Number.isFinite(display.gamma) || display.gamma < 0.5 || display.gamma > 3) throw new RangeError("Invalid display settings");
    this.display = { ...display };
    this.displayOverridesConsumed = true;
  }
  get options(): ApplicationOptions {
    const mode = this.values.mode, renderer = this.values.renderer, rules = this.values.rules, skill = Number(this.values.skill);
    if (mode !== "singleplayer" && mode !== "coop" && mode !== "deathmatch" || renderer !== "gl" && renderer !== "cpu"
      || rules !== "standard" && rules !== "ctf" && rules !== "lmctf" || skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new Error("Invalid startup settings");
    return { ...this.initial, product: this.values.product, map: this.values.map, movement: this.product("movement").expectation.family,
      character: this.product("character").expectation.family, characterModel: this.values.model, mode, rules, skill,
      seats: Number(this.values.seats), renderer, ...this.display, ...(this.displayOverridesConsumed ? { displayOverrides: {} } : {}) };
  }
  summary(): readonly string[] {
    return [...this.rows().filter(row => row.id !== "renderer").map(row => `${row.label}: ${row.choices.find(choice => choice.id === row.value)?.label ?? row.value}`),
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
    const environment: ExecutableRecipe["presentation"]["environment"] = this.values.environment === "audio-content" || this.values.environment === "disabled"
      ? { kind: this.values.environment }
      : { kind: "selected", resource: { content: this.catalog.require(this.values.environment).id, path: "sound/default.environments" } };
    const doppler = this.values.doppler;
    if (doppler !== "source" && doppler !== "disabled") throw new Error("Invalid Doppler selection");
    const dopplerSelection: ExecutableRecipe["presentation"]["doppler"] = { kind: doppler };
    const preset = { ...base, timing, presentation: { ...base.presentation, environment, doppler: dopplerSelection } };
    let selections: LaunchChoice = { ...presetChoice(preset.id), map: { kind: "selected", value: { geometry: { content: mapContent.id, path: options.map }, entities: base.map.entities } },
      movement: { kind: "selected", value: movement }, character: { kind: "selected", value: { definition: character, appearance: { provider: `${options.character}:model/${options.characterModel}`, content: character.content } } } };
    const campaign: CampaignSelection = options.mode === "deathmatch" ? { kind: "none" } : base.campaign;
    selections = { ...selections, campaign: { kind: "selected", value: campaign } };
    if (this.values.weapons !== "native") {
      const product = this.catalog.require(this.values.weapons);
      if (product.expectation.family === this.product("product").expectation.family && product.id !== base.map.entities.content
        && !baseArsenalPair(this.product("product"), product))
        throw new Error("Selecting another edition's weapons within the same game family is not implemented; choose campaign weapons or a different family.");
      selections = { ...selections, weapons: { kind: "selected", value: [canonicalWeaponSource(base.map.entities, { provider: `${product.expectation.family}:official`, content: product.id }, this.catalog)] } };
    }
    if (this.values.enemies === "custom") {
      selections = { ...selections, enemies: { kind: "selected", value: this.effectiveMonsterRoster() } };
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
  const model = new StartupSelectionModel(await discoverInstalledContent({ corpusRoot: options.corpusRoot, userContentRoot: options.userContentRoot ?? defaultUserContentRoot() }), options);
  await model.prepareMaps();
  return model;
}
