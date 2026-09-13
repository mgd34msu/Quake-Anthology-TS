import type { UiSound } from "../../ui/common/controller.ts";
import { registerLlmSettingsMenu, type LlmSettingsUi } from "../../ui/settings/llm.ts";
import { registerGyroSettingsMenu } from "../../ui/settings/gyro.ts";
import type { GyroSettingsUi } from "../../ui/settings/gyro.ts";
import { addressKey } from "../../network/common/endpoint.ts";
import { browserAddress, browserSortOrders } from "./server-browser.ts";
import type { StartupServerBrowser, BrowserConnection } from "./server-browser.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { RenderCommand } from "../../contracts/render.ts";
import type { SeatInputEvent, UiControl, UiDrawCommand, UiDrawContext, UiMenuId } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { NativeUiController, renderUiCommands } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { menuBackdrop, menuPanel, menuSkin, menuTitleFont } from "../../ui/common/menu-theme.ts";
import { contains, fitUi, transformUi } from "../../ui/common/layout.ts";
import { registerSettingsMenus, settingControl } from "../../ui/settings/index.ts";
import type { SettingBinding } from "../../ui/settings/index.ts";
import { layoutText } from "../../text/layout.ts";
import type { StartupSaveList } from "./startup-saves.ts";
import { UiTextRenderer } from "../../text/ui.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import type { StartupSelectionField, StartupSelectionModel, StartupSelectionRow } from "./startup-selection.ts";

export interface StartupMenuOptions {
  readonly sound?: (sound: UiSound) => void;
  readonly llm?: LlmSettingsUi;
  readonly clipboard?: () => string | null;
  readonly seat: SeatId;
  readonly model: StartupSelectionModel;
  readonly art: NativeUiArt;
  readonly font: TextFontSelection;
  readonly titleFont: TextFontSelection;
  readonly now: () => number;
  readonly play: () => void;
  readonly browser?: StartupServerBrowser;
  readonly connect?: (connection: BrowserConnection) => void;
  readonly load: (id: string) => void;
  readonly saves: () => StartupSaveList;
  readonly refreshSaves: () => void;
  readonly quit: () => void;
  readonly settings?: readonly SettingBinding[];
  readonly applyDisplay: () => void;
}
const main: UiMenuId = "menu:startup:main";
const browserMenu: UiMenuId = "menu:startup:servers";
const browserOptionsMenu: UiMenuId = "menu:startup:server-filters";
const session: UiMenuId = "menu:startup:session";
const optionsMenu: UiMenuId = "menu:startup:options";
const displayMenu: UiMenuId = "menu:settings:display:0";
const soundMenu: UiMenuId = "menu:startup:sound";
const controlsMenu: UiMenuId = "menu:settings:input:0";
const selectMenu: UiMenuId = "menu:startup:select";
const rosterMenu: UiMenuId = "menu:startup:roster";
const categoryMenu: UiMenuId = "menu:startup:category";
const loadMenu: UiMenuId = "menu:startup:load";
const groups: readonly { readonly title: string; readonly fields: readonly StartupSelectionField[] }[] = [
  { title: "World", fields: ["product", "map"] },
  { title: "Player", fields: ["movement", "character", "model", "seats"] },
  { title: "Combat", fields: ["weapons", "enemies", "skill", "mode", "rules"] },
  { title: "Equipment", fields: ["grapple", "grenades"] },
];

export class StartupMenu {
  readonly controller: NativeUiController;
  private readonly text: UiTextRenderer;
  private gyroMenu: UiMenuId | null = null;
  private readonly disposers: (() => void)[] = [];
  private status = "";
  private busy = false;
  private group = groups[0];
  private field: StartupSelectionField = "product";
  private page = 0;
  private rosterPage = 0;
  private monsterField: { readonly kind: "none" } | { readonly kind: "source" } | { readonly kind: "class"; readonly classname: string | null } = { kind: "none" };
  private savePage = 0;
  private multiplayer = false;
  private multiplayerMode: "coop" | "deathmatch" = "deathmatch";

  constructor(private readonly options: StartupMenuOptions) {
    this.text = new UiTextRenderer(options.seat);
    this.text.bind(options.art.skin.font, options.font);
    this.text.bind(menuTitleFont, options.titleFont);
    const skin = menuSkin(options.art.skin.font);
    this.controller = new NativeUiController({ seat: options.seat, skin: () => skin, now: options.now, bindings: () => [],
      ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }),
      focus: () => undefined, sound: sound => options.sound?.(sound), measureText: (text, scale) => this.measure(text, scale), executeScript: () => { throw new Error("Startup menu has no legacy scripts"); } });
    this.register(main, () => [
      this.button("single", "Single Player", 0, () => this.configure(false)),
      this.button("multi", "Multiplayer", 1, () => this.configure(true)),
      this.button("load", "Load Game", 2, () => { this.savePage = 0; this.controller.openMenu(loadMenu); options.refreshSaves(); }),
      this.button("options", "Options", 3, () => this.controller.openMenu(optionsMenu)),
      this.button("quit", "Quit", 4, options.quit),
    ]);
    this.register(browserMenu, () => this.browserControls());
    this.register(browserOptionsMenu, () => this.browserOptionsControls());
    this.register(session, () => [...(this.multiplayer && options.browser !== undefined ? [this.button("browse", "Find servers", 8, () => this.controller.openMenu(browserMenu), true)] : []), ...groups.map((group, index) => this.button(`group:${index}`, group.title, index, () => {
      this.group = group; this.controller.openMenu(categoryMenu);
    })), this.button("play", "Play", 6, options.play), this.button("back", "Back", 7, () => this.controller.closeMenu())]);
    this.register(categoryMenu, () => [
      ...this.rows(this.group?.fields ?? []).map((row, index) => this.row(row, index)), this.back(),
    ]);
    const llm = options.llm === undefined ? null : registerLlmSettingsMenu(this.controller, options.llm);
    if (llm !== null) this.disposers.push(llm.dispose);
    this.register(optionsMenu, () => [
      this.button("display", "Display", 0, () => this.controller.openMenu(displayMenu), true),
      this.button("sound", "Sound", 1, () => this.controller.openMenu(soundMenu), true),
      this.button("controls", "Controls", 2, () => this.controller.openMenu(controlsMenu), true),
      ...(llm === null ? [] : [this.button("llm", "LLM options", 3, () => this.controller.openMenu(llm.root), true)]), this.back(),
    ]);
    const settings = registerSettingsMenus(this.controller, [...(options.settings ?? []).filter(binding => binding.category === "display" || binding.category === "input"),
      { id: "ui:startup:renderer", category: "display", kind: "choice", label: "Renderer (requires Apply)", enabled: () => !this.busy,
        read: () => options.model.options.renderer, choices: () => [{ id: "gl", label: "OpenGL" }, { id: "cpu", label: "Software" }],
        write: value => options.model.select("renderer", value) },
      { id: "ui:startup:apply-display", category: "display", kind: "button", label: "Apply renderer change", enabled: () => !this.busy, activate: options.applyDisplay },
      { id: "ui:startup:gyro", category: "input", kind: "button", label: "Gyro controls", enabled: () => this.gyroMenu !== null,
        activate: () => { if (this.gyroMenu !== null) this.controller.openMenu(this.gyroMenu); } }]);
    this.disposers.push(settings.dispose);
    this.register(soundMenu, () => {
      const bindings = (options.settings ?? []).filter(binding => binding.category === "audio");
      const rect = (index: number) => ({ x: 64, y: 118 + (index + 2) * 38, width: 512, height: 34 });
      return [...this.rows(["environment", "doppler"]).map((row, index) => this.row(row, index)),
        ...bindings.map((binding, index) => settingControl(binding, rect(index), options.seat)), this.back()];
    });
    this.register(selectMenu, () => {
      const row = this.selectionRow();
      const choices = row?.choices ?? [], pages = Math.max(1, Math.ceil(choices.length / 7));
      this.page = Math.min(this.page, pages - 1);
      const controls = choices.slice(this.page * 7, this.page * 7 + 7).map((choice, index) => {
        const control = this.button(`choice:${choice.id}`, `${row?.value === choice.id ? "> " : ""}${this.fit(choice.label, 466, 2.6)}`, index, () => {
          if (this.monsterField.kind === "class") options.model.selectMonster(this.monsterField.classname, choice.id);
          else if (this.monsterField.kind === "source") options.model.selectMonsterSource(choice.id);
          else options.model.select(this.field, choice.id);
          this.status = ""; this.controller.closeMenu();
          if (this.monsterField.kind === "none" && this.field === "enemies" && choice.id === "custom") this.openRoster();
        }, true);
        return { ...control, enabled: choice.unavailable === null && !this.busy };
      });
      if (pages > 1) controls.push(this.button("previous", "Previous page", 7, () => { this.page = (this.page + pages - 1) % pages; }, true),
        this.button("next", "Next page", 8, () => { this.page = (this.page + 1) % pages; }, true));
      return [...controls, this.back()];
    });
    this.register(rosterMenu, () => {
      const rows = options.model.monsterRosterRows(), pages = Math.max(1, Math.ceil(rows.length / 7));
      this.rosterPage = Math.min(this.rosterPage, pages - 1);
      const source = options.model.monsterSourceRow(), sourceLabel = source.choices.find(choice => choice.id === source.value)?.label ?? source.value;
      const controls = rows.slice(this.rosterPage * 7, this.rosterPage * 7 + 7).map((row, index) => {
        return this.button(`monster:${row.classname ?? "default"}`, this.fit(`${row.label}: ${row.effectiveLabel}`, 486, 2.6), index, () => {
          this.monsterField = { kind: "class", classname: row.classname }; this.page = 0; this.controller.openMenu(selectMenu);
        }, true);
      });
      if (pages > 1) controls.push(this.button("previous", "Previous page", 7, () => { this.rosterPage = (this.rosterPage + pages - 1) % pages; }, true),
        this.button("next", `Next page (${this.rosterPage + 1}/${pages})`, 8, () => { this.rosterPage = (this.rosterPage + 1) % pages; }, true));
      return [{ ...this.button("monster-source", this.fit(`Monster source: ${sourceLabel}`, 486, 2.6), 0, () => {
        this.monsterField = { kind: "source" }; this.page = 0; this.controller.openMenu(selectMenu);
      }, true), rect: { x: 64, y: 78, width: 512, height: 26 } }, ...controls, this.back()];
    });
    this.register(loadMenu, () => {
      const saves = options.saves(), pages = Math.max(1, Math.ceil(saves.rows.length / 5));
      this.savePage = Math.min(this.savePage, pages - 1);
      return [...saves.rows.slice(this.savePage * 5, this.savePage * 5 + 5).map((save, index) => ({
        ...this.button(`save:${save.id}`, this.fit(`${save.label}  -  ${save.map}`, 486, 2.6), index, () => options.load(save.id), true),
        rect: { x: 64, y: 118 + index * 46, width: 512, height: 42 },
        enabled: save.unavailable === null && !this.busy,
      })), ...(pages > 1 ? [this.button("older-saves", "Older saves", 7, () => { this.savePage = (this.savePage + 1) % pages; }, true)] : []),
        this.button("refresh-saves", "Refresh", 8, options.refreshSaves, true), this.back()];
    });
    this.controller.openMenu(main);
  }
  private rows(fields: readonly StartupSelectionField[]): readonly StartupSelectionRow[] {
    return this.options.model.rows().filter(row => fields.includes(row.id) && (this.multiplayer || row.id !== "mode" && row.id !== "rules"));
  }
  private configure(multiplayer: boolean): void {
    const mode = this.options.model.options.mode;
    if (mode === "coop" || mode === "deathmatch") this.multiplayerMode = mode;
    this.multiplayer = multiplayer;
    this.options.model.select("mode", multiplayer ? this.multiplayerMode : "singleplayer");
    this.status = ""; this.controller.openMenu(session);
  }
  resumeServerBrowser(): void { if (this.options.browser !== undefined) this.controller.openMenu(browserMenu); }

  private browserControls(): readonly UiControl[] {
    const browser = this.options.browser;
    if (browser === undefined) return [this.back()];
    const run = (work: () => Promise<void>): void => { work().catch((error: unknown) => { browser.status = error instanceof Error ? error.message : String(error); }); };
    const button = (id: string, label: string, x: number, y: number, width: number, action: () => void): UiControl =>
      ({ ...this.button(id, label, 0, action), rect: { x, y, width, height: 30 } });
    const text = (id: string, label: string, value: string, y: number, change: (value: string) => void, submit: () => void, width = 512): UiControl => ({
      id: `ui:startup:${id}`, kind: "text-entry", label, text: value, maximumLength: 255, rect: { x: 64, y, width, height: 30 },
      enabled: !this.busy, visible: true, change: (_seat, value) => { change(value); return undefined; }, submit: () => { submit(); return undefined; } });
    const entries = browser.rows(), pages = Math.max(1, Math.ceil(entries.length / 3)); this.page = Math.min(this.page, pages - 1);
    return [
      { id: "ui:startup:server-protocol", kind: "choice", label: "Game", rect: { x: 64, y: 108, width: 512, height: 30 }, enabled: true, visible: true,
        choices: [{ id: "q1", label: "Quake" }, { id: "q2", label: "Quake II" }, { id: "q3", label: "Quake III Arena" }], selected: browser.protocol,
        select: (_seat, value) => { browser.choose(value); this.page = 0; return undefined; } },
      text("server-address", "Address", browser.address, 144, value => { browser.address = value; }, () => run(() => browser.query())),
      button("server-query", "Query", 64, 180, 160, () => run(() => browser.query())),
      button("server-lan", "Find LAN", 240, 180, 160, () => browser.scan()),
      button("server-favorite", "Favorite", 416, 180, 160, () => run(() => browser.favorite())),
      text("server-filter", "Filter", browser.filter, 216, value => { browser.filter = value; this.page = 0; }, () => undefined, 320),
      button("server-sort-filter", browser.hideEmpty || browser.hideFull ? "Filters on" : "Sort/filter", 400, 216, 176, () => this.controller.openMenu(browserOptionsMenu)),
      ...entries.slice(this.page * 3, this.page * 3 + 3).map((entry, index) => button(`server:${addressKey(entry.address)}`,
        this.fit(`${entry.sources.includes("favorite") ? "* " : ""}${entry.status?.name || browserAddress(entry.address)}  ${entry.status === null ? "?" : `${entry.status.players}/${entry.status.maxPlayers}`}  ${entry.pingMilliseconds === null ? "" : `${Math.round(entry.pingMilliseconds)}ms`}`, 490, 2.6),
        64, 252 + index * 34, 512, () => browser.select(addressKey(entry.address)))),
      button("server-page", `Page ${this.page + 1}/${pages}`, 64, 358, 240, () => { this.page = (this.page + 1) % pages; }),
      button("server-favorites", browser.favoritesOnly ? "Favorites only" : "All servers", 320, 358, 256, () => { browser.favoritesOnly = !browser.favoritesOnly; this.page = 0; }),
      button("server-connect", "Connect", 64, 396, 240, () => run(async () => this.options.connect?.(await browser.connection()))),
      button("server-back", "Back", 320, 396, 256, () => this.controller.closeMenu()),
    ];
  }
  private browserOptionsControls(): readonly UiControl[] {
    const browser = this.options.browser;
    if (browser === undefined) return [this.back()];
    return [
      { id: "ui:startup:server-sort", kind: "choice", label: "Sort", rect: { x: 64, y: 118, width: 512, height: 30 }, enabled: true, visible: true,
        choices: browserSortOrders, selected: browser.sortOrder, select: (_seat, value) => { browser.chooseSort(value); this.page = 0; return undefined; } },
      { id: "ui:startup:server-hide-empty", kind: "toggle", label: "Hide empty", rect: { x: 64, y: 152, width: 512, height: 30 }, enabled: true, visible: true,
        checked: browser.hideEmpty, change: (_seat, value) => { browser.hideEmpty = value; this.page = 0; return undefined; } },
      { id: "ui:startup:server-hide-full", kind: "toggle", label: "Hide full", rect: { x: 64, y: 186, width: 512, height: 30 }, enabled: true, visible: true,
        checked: browser.hideFull, change: (_seat, value) => { browser.hideFull = value; this.page = 0; return undefined; } },
      this.button("server-filters-back", "Back", 4, () => this.controller.closeMenu(), true),
    ];
  }
  private register(id: UiMenuId, controls: () => readonly UiControl[]): void {
    this.disposers.push(this.controller.register(id, () => ({ id, title: "", fullScreen: false, controls: controls(), open: () => undefined, close: () => undefined })));
  }
  private button(id: string, label: string, row: number, activate: () => void, wide = false): UiControl {
    return { id: `ui:startup:${id}`, kind: "button", label, rect: { x: 64, y: 118 + row * 34, width: wide ? 512 : 224, height: 30 },
      visible: true, enabled: !this.busy, activate: () => { activate(); return undefined; } };
  }
  private back(): UiControl { return this.button("back", "Back", 9, () => this.controller.closeMenu(), true); }
  private selectionRow() {
    const selected = this.monsterField;
    return selected.kind === "source" ? this.options.model.monsterSourceRow() : selected.kind === "class" ? this.options.model.monsterRosterRows().find(row => row.classname === selected.classname)
      : this.options.model.rows().find(row => row.id === this.field);
  }
  private openRoster(): void {
    this.setStatus("Reading this map's monster roster...", true);
    void this.options.model.prepareMonsterRoster().then(() => {
      this.rosterPage = 0; this.setStatus(""); this.controller.openMenu(rosterMenu);
    }).catch((error: unknown) => this.setStatus(error instanceof Error ? error.message : String(error)));
  }
  private row(row: StartupSelectionRow, index: number): UiControl {
    const selected = row.choices.find(choice => choice.id === row.value)?.label ?? row.value;
    return this.button(row.id, this.fit(`${row.label}: ${selected}`, 486, 2.6), index, () => { this.monsterField = { kind: "none" }; this.field = row.id; this.page = 0; this.controller.openMenu(selectMenu); }, true);
  }
  private measure(text: string, scale: number): number {
    return layoutText({ text, font: this.options.font, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width;
  }
  private fit(text: string, width: number, scale: number): string {
    if (this.measure(text, scale) <= width) return text;
    let end = text.length;
    while (end > 0 && this.measure(`${text.slice(0, end)}...`, scale) > width) end--;
    return `${text.slice(0, end)}...`;
  }
  resumeDisplayOptions(): void { this.controller.openMenu(optionsMenu); this.controller.openMenu(displayMenu); }
  setStatus(text: string, busy = false): void { this.status = text; this.busy = busy; }
  input(event: SeatInputEvent): boolean {
    if (this.busy) return true;
    if (event.kind === "mouse-wheel" && event.delta.y !== 0 && this.controller.activeMenu === selectMenu) {
      const choices = this.selectionRow()?.choices ?? [];
      this.page = Math.max(0, Math.min(Math.ceil(choices.length / 7) - 1, this.page + (event.delta.y < 0 ? 1 : -1)));
      return true;
    }
    if (event.kind === "mouse-wheel" && event.delta.y !== 0 && this.controller.activeMenu === rosterMenu) {
      this.rosterPage = Math.max(0, Math.min(Math.ceil(this.options.model.monsterRosterRows().length / 7) - 1, this.rosterPage + (event.delta.y < 0 ? 1 : -1)));
      return true;
    }
    if (event.kind === "mouse-wheel" && event.delta.y !== 0 && this.controller.activeMenu === loadMenu) {
      this.savePage = Math.max(0, Math.min(Math.ceil(this.options.saves().rows.length / 5) - 1, this.savePage + (event.delta.y < 0 ? 1 : -1)));
      return true;
    }
    if (this.controller.activeMenu === main && event.kind === "key" && event.code === KeyCode.Escape) return true;
    try {
      const handled = this.controller.input(event);
      if (this.controller.activeMenu === null) this.controller.openMenu(main);
      return handled;
    }
    catch (error) { this.setStatus(error instanceof Error ? error.message : String(error)); return true; }
  }
  draw(context: UiDrawContext, emit: (command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>) => void,
    material: (draw: MaterialTextDraw) => void): void {
    const active = this.controller.activeMenu, transform = fitUi(context.binding.safeArea), commands: UiDrawCommand[] = [], overlayCommands: UiDrawCommand[] = [];
    let overlay = false;
    const text = (value: string, x: number, y: number, scale = 2.2, accent = false, heading = false): void => {
      (overlay ? overlayCommands : commands).push({ kind: "text", origin: { x, y }, text: value, font: heading ? menuTitleFont : this.options.art.skin.font, scale,
        color: accent ? { x: 1, y: 0.73, z: 0.35, w: 1 } : { x: 0.86, y: 0.89, z: 0.92, w: 1 }, align: "left", shadow: true });
    };
    const backdrop = menuBackdrop(context), panel = menuPanel(context, active === main);
    const title = active === main ? "QUAKE" : active === session ? this.multiplayer ? "Multiplayer" : "Single Player"
      : active === categoryMenu ? this.group?.title ?? "Session" : active === rosterMenu ? "Custom roster" : active === selectMenu ? this.selectionRow()?.label ?? "Choose"
      : active === this.gyroMenu ? "Gyro controls" : active === browserMenu ? "Find servers" : active === browserOptionsMenu ? "Server filters" : active === optionsMenu ? "Options" : active === displayMenu ? "Display" : active === soundMenu ? "Sound" : active === controlsMenu ? "Controls" : "Load Game";
    if (!active?.startsWith("menu:settings:llm") && !active?.startsWith("menu:settings:display:") && !active?.startsWith("menu:settings:input:")) text(title, 64, 44, active === main ? 6 : 4, true, true);

    if (active === rosterMenu) text("Map counts shown. * Custom override.", 64, 460, 1.5);
    commands.push({ kind: "fill", rect: { x: 64, y: 104, width: active === main ? 224 : 512, height: 1 }, color: { x: 0.6, y: 0.39, z: 0.18, w: 0.65 } });

    if (active === session) {
      text("Your game", 316, 118, 2, true);
      const fields: readonly StartupSelectionField[] = ["product", "map", "movement", "character", "model", "weapons", "enemies", "grapple", "grenades", "mode"];
      for (const [index, row] of this.options.model.rows().filter(row => fields.includes(row.id)).entries()) {
        const value = row.choices.find(choice => choice.id === row.value)?.label ?? row.value;
        text(this.fit(row.label, 260, 1.35), 316, 150 + index * 28, 1.35, true);
        text(this.fit(value.replace(" (campaign default)", "").replace(" authored monsters", " monsters"), 260, 2.1), 316, 161 + index * 28, 2.1);
      }
    }
    if (active === browserMenu && this.options.browser !== undefined && this.status.length === 0) {
      const browser = this.options.browser, selected = browser.rows().find(entry => addressKey(entry.address) === browser.selected);
      if (browser.rows().length === 0) text(browser.emptyMessage, 64, 430, 1.5);
      text(this.fit(selected?.status === null || selected === undefined ? browser.status : `${selected.status.map} — ${browser.status}`, 512, 1.8), 64, 450, 1.8);
    }
    if (active === loadMenu) {
      const saves = this.options.saves();
      if (saves.rows.length === 0) { text("No saved games", 64, 138, 2.5); text("Your saved games will appear here.", 64, 174, 1.8); }
      overlay = true;
      const rows = saves.rows.slice(this.savePage * 5, this.savePage * 5 + 5), state = this.controller.state();
      for (const [index, save] of rows.entries()) {
        const stamp = new Date(save.savedAtMilliseconds).toLocaleString();
        text(this.fit(`${save.game}  -  ${stamp}`, 486, 1.6), 74, 144 + index * 46, 1.6);
        if (save.unavailable !== null && contains({ x: 64, y: 118 + index * 46, width: 512, height: 42 }, state.cursor))
          text(this.fit(save.unavailable, 512, 1.6), 64, 360, 1.6, true);
      }
      if (saves.error !== null) text(this.fit(saves.error, 512, 1.5), 64, 390, 1.5);
    }
    overlay = false;
    if (this.status.length !== 0) text(this.fit(this.status, 512, 1.5), 64, 450, 1.5, true);
    renderUiCommands(context, [backdrop, panel, ...commands.map(command => transformUi(command, transform))], { text: this.text, white: this.options.art.white,
      picture: resource => this.options.art.picture(resource), emit, material });
    renderUiCommands(context, this.controller.draw(context), { text: this.text, white: this.options.art.white,
      picture: resource => this.options.art.picture(resource), emit, material });
    renderUiCommands(context, overlayCommands.map(command => transformUi(command, transform)), { text: this.text, white: this.options.art.white,
      picture: resource => this.options.art.picture(resource), emit, material });
  }
  bindGyro(settings: GyroSettingsUi): void {
    const menu = registerGyroSettingsMenu(this.controller, settings, ""); this.gyroMenu = menu.root; this.disposers.push(menu.dispose);
  }
  close(): void { this.controller.closeAll(); for (const dispose of this.disposers) dispose(); this.text.clear(); }
}
