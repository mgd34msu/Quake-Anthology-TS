import { registerModMenu } from "../../ui/mods/menu.ts";
import { registerArenaSelectionMenu } from "./base-arena-select-menu.ts";
import { registerLocalLobbyMenu } from "../../ui/settings/local-lobby.ts";
import type { ApplicationLocalLobby, LocalLobbySelection } from "./local-lobby.ts";
import { captionCommands as mediaCaptionCommands } from "../../ui/common/captions.ts";
import type { ActiveCaption } from "../../text/captions.ts";
import { accessibleColors } from "../../ui/common/accessibility.ts";
import { defaultUiPreferences } from "../../ui/settings/accessibility.ts";
import type { UiPreferenceValues } from "../../ui/settings/index.ts";
import { registerLibraryMenu, type LibraryMenuService } from "../../ui/library/menu.ts";
import type { UiSound } from "../../ui/common/controller.ts";
import { registerBindingMenus } from "../../ui/settings/bindings.ts";
import type { BindingAction } from "../../ui/settings/bindings.ts";
import type { SeatInput } from "../../input/seat.ts";
import { registerLlmSettingsMenu, type LlmSettingsUi } from "../../ui/settings/llm.ts";
import { registerGyroSettingsMenu } from "../../ui/settings/gyro.ts";
import type { GyroSettingsUi } from "../../ui/settings/gyro.ts";
import { addressKey } from "../../network/common/endpoint.ts";
import { browserAddress, browserSortOrders } from "./server-browser.ts";
import type { StartupServerBrowser, BrowserConnection } from "./server-browser.ts";
import type { ResourceId } from "../../contracts/content.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { RenderCommand } from "../../contracts/render.ts";
import type { SeatInputEvent, UiControl, UiDrawCommand, UiDrawContext, UiMenuId } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { NativeUiController, menuRow, renderUiCommands } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { menuBackdrop, menuPanel, menuSkin, menuText, menuTitleFont } from "../../ui/common/menu-theme.ts";
import { contains, fitUi, transformUi } from "../../ui/common/layout.ts";
import { registerSettingsMenus, settingControl } from "../../ui/settings/index.ts";
import type { SettingBinding } from "../../ui/settings/index.ts";
import { layoutText } from "../../text/layout.ts";
import type { StartupSaveList } from "./startup-saves.ts";
import { UiTextRenderer } from "../../text/ui.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import type { StartupHosting, StartupNativePreset, StartupSelectionChoice, StartupSelectionField, StartupSelectionModel, StartupSelectionRow } from "./startup-selection.ts";
import { defaultNetQuakeProfile } from "../../network/q1/profile.ts";
import type { CharacterTurntableView } from "./character-turntable.ts";

const characterAppearanceFields: ReadonlySet<StartupSelectionField> = new Set(["character", "model", "skin", "topColor", "bottomColor"]);

export interface StartupMenuOptions {
  readonly lobby?: { current(): ApplicationLocalLobby | null; selection(): Promise<LocalLobbySelection>; seats(): number };
  readonly sound?: (sound: UiSound) => void;
  readonly llm?: LlmSettingsUi;
  readonly clipboard?: () => string | null;
  readonly seat: SeatId;
  readonly model: StartupSelectionModel;
  readonly characterTurntable?: CharacterTurntableView;
  readonly art: NativeUiArt;
  readonly font: TextFontSelection;
  readonly titleFont: TextFontSelection;
  readonly now: () => number;
  readonly play: () => void;
  readonly playPreset?: (id: string, skill: number, arenaMap?: string) => void;
  readonly browser?: StartupServerBrowser;
  readonly connect?: (connection: BrowserConnection) => void;
  readonly load: (id: string) => void;
  readonly saves: () => StartupSaveList;
  readonly refreshSaves: () => void;
  readonly quit: () => void;
  readonly settings?: readonly SettingBinding[];
  readonly appearance?: () => UiPreferenceValues;
  readonly teamArena?: { choices(): readonly { readonly id: string; readonly label: string }[]; read(): { readonly player: string; readonly opponent: string }; write(side: "player" | "opponent", team: string): void };
  readonly libraries?: { readonly addons?: LibraryMenuService; readonly playerProgress?: LibraryMenuService; readonly demos?: LibraryMenuService; readonly movies?: LibraryMenuService; readonly serverProfiles?: LibraryMenuService; readonly configurations?: LibraryMenuService };
}
const libraryMenu: UiMenuId = "menu:startup:library";
const main: UiMenuId = "menu:startup:main";
const browserMenu: UiMenuId = "menu:startup:servers";
const browserOptionsMenu: UiMenuId = "menu:startup:server-filters";
const browserDetailsMenu: UiMenuId = "menu:startup:server-details";
const nativeFamilyMenu: UiMenuId = "menu:startup:native-family";
const nativeCampaignMenu: UiMenuId = "menu:startup:native-campaign";
const nativeDifficultyMenu: UiMenuId = "menu:startup:native-difficulty";
const session: UiMenuId = "menu:startup:session";
const hostingMenu: UiMenuId = "menu:startup:hosting";
const optionsMenu: UiMenuId = "menu:startup:options";
const displayMenu: UiMenuId = "menu:settings:display:0";
const soundMenu: UiMenuId = "menu:startup:sound";
const controlsMenu: UiMenuId = "menu:settings:input:0";
const accessibilityMenu: UiMenuId = "menu:settings:accessibility:0";
const selectMenu: UiMenuId = "menu:startup:select";
const rosterMenu: UiMenuId = "menu:startup:roster";
const loadMenu: UiMenuId = "menu:startup:load";

export class StartupMenu {
  readonly controller: NativeUiController;
  private readonly text: UiTextRenderer;
  private gyroMenu: UiMenuId | null = null;
  private bindingMenu: UiMenuId | null = null;
  private lobbyMenu: UiMenuId | null = null;
  openLocalLobby(): void { if (this.lobbyMenu !== null) this.controller.openMenu(this.lobbyMenu); }
  private readonly disposers: (() => void)[] = [];
  private status = "";
  private busy = false;
  get isBusy(): boolean { return this.busy; }
  private field: StartupSelectionField = "product";
  private page = 0;
  private monsterField: { readonly kind: "none" } | { readonly kind: "source" } | { readonly kind: "class"; readonly classname: string | null } = { kind: "none" };
  private savePage = 0;
  private nativeFamily: StartupNativePreset["family"] = "q1";
  private nativeEdition = "classic";
  private nativePreset: StartupNativePreset | null = null;
  private nativeSkill = "1";
  private nativeArena: string | undefined;
  private hostDraft: StartupHosting = { kind: "offline", port: 27910, q1Protocol: null };
  private hostPort = "27910";
  private modsMenu: UiMenuId | null = null;
  private builderDropdown: { readonly field: StartupSelectionField; scroll: number; edition: "classic" | "rerelease" | null; collapsed: readonly string[] } | null = null;
  private builderPreviewFocusArmed = false;

  constructor(private readonly options: StartupMenuOptions) {
    this.text = new UiTextRenderer(options.seat);
    this.text.bind(options.art.skin.font, options.font);
    this.text.bind(menuTitleFont, options.titleFont);
    const skin = menuSkin(options.art.skin.font);
    this.controller = new NativeUiController({ seat: options.seat, skin: () => skin, appearance: () => options.appearance?.() ?? defaultUiPreferences, now: options.now, bindings: () => [],
      ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }),
      focus: () => undefined, sound: sound => options.sound?.(sound), measureText: (text, scale) => this.measure(text, scale), executeScript: () => { throw new Error("Startup menu has no legacy scripts"); } });
    this.register(main, () => [
      this.button("native", "Play a game", 0, () => { this.status = ""; this.controller.openMenu(nativeFamilyMenu); }),
      this.button("load", "Load Game", 1, () => { this.savePage = 0; this.controller.openMenu(loadMenu); options.refreshSaves(); }),
      this.button("options", "Options", 2, () => this.controller.openMenu(optionsMenu)),
      ...(options.libraries === undefined ? [] : [this.button("library", "Library", 3, () => this.controller.openMenu(libraryMenu))]),
      this.button("quit", "Quit", options.libraries === undefined ? 3 : 4, options.quit),
    ]);
    const libraryPages = ([
      { name: "addons", label: "Add-ons — Quaddicted", service: options.libraries?.addons },
      { name: "demos", label: "Demos", service: options.libraries?.demos },
      { name: "movies", label: "Movies", service: options.libraries?.movies },
      { name: "configurations", label: "Configurations", service: options.libraries?.configurations },
      { name: "server-profiles", label: "Server profiles", service: options.libraries?.serverProfiles },
      { name: "player-progress", label: "Achievements and progress", service: options.libraries?.playerProgress },
    ]).flatMap(library => {
      if (library.service === undefined) return [];
      const page = registerLibraryMenu(this.controller, `menu:library:${library.name}`, library.label, library.service);
      this.disposers.push(page.dispose); return [{ ...library, root: page.root }];
    });
    this.register(libraryMenu, () => [...libraryPages.map((page, index) => this.button(`library:${page.name}`, page.label, index, () => this.controller.openMenu(page.root), true)), this.back()]);
    this.register(nativeFamilyMenu, () => [
      ...([
        { family: "q1", edition: "classic", label: "Quake classic" },
        { family: "q1", edition: "rerelease", label: "Quake rerelease" },
        { family: "q2", edition: "classic", label: "Quake II classic" },
        { family: "q2", edition: "rerelease", label: "Quake II rerelease" },
        { family: "q3", edition: "classic", label: "Quake III Arena" },
      ] satisfies { family: StartupNativePreset["family"]; edition: string; label: string }[]).map((game, index) => ({
        ...this.button(`game:${game.family}:${game.edition}`, game.label, index, () => {
          this.nativeFamily = game.family; this.nativeEdition = game.edition; this.status = ""; this.controller.openMenu(nativeCampaignMenu);
        }, true), enabled: !this.busy && options.model.presets().some(preset => preset.family === game.family && preset.edition === game.edition),
      })), this.button("custom", "Custom game", 5, () => { this.status = ""; this.controller.openMenu(session); }, true), this.back(),
    ]);
    const arenas: UiMenuId = "menu:library:arena-selection";
    this.disposers.push(registerArenaSelectionMenu(this.controller, arenas, {
      read: () => options.model.baseArenas(),
      choose: map => { this.nativeArena = map; this.controller.openMenu(nativeDifficultyMenu); },
    }));
    this.register(nativeCampaignMenu, () => [
      ...this.nativeCampaigns().map((preset, index) => ({
        ...this.button(`preset:${preset.id}`, this.fit(`${preset.label}${preset.unavailable === null ? "" : " (unavailable)"}`, 486, menuText.body), index, () => {
          this.nativePreset = preset; this.nativeSkill = preset.defaultSkill; this.nativeArena = undefined; this.status = "";
          if (preset.id !== "q3-baseq3") { this.controller.openMenu(nativeDifficultyMenu); return; }
          this.setStatus("Loading arenas...", true);
          options.model.refreshBaseArenas().then(() => { this.setStatus(""); this.controller.openMenu(arenas); })
            .catch((error: unknown) => this.setStatus(error instanceof Error ? error.message : String(error)));
        }, true), enabled: !this.busy && preset.unavailable === null,
      })), this.back(),
    ]);
    this.register(nativeDifficultyMenu, () => {
      const preset = this.nativePreset;
      if (preset === null) return [this.back()];
      return [...preset.difficulties.map((difficulty, index) => ({
        ...this.button(`difficulty:${difficulty.id}`, `${this.nativeSkill === difficulty.id ? "> " : ""}${difficulty.label}`, index, () => {
          this.nativeSkill = difficulty.id;
        }, true), enabled: !this.busy && difficulty.unavailable === null,
      })), ...(preset.id === "q3-missionpack" && options.teamArena !== undefined ? (["player", "opponent"] satisfies ("player" | "opponent")[]).map((side, index): UiControl => ({
        id: `ui:startup:team:${side}`, kind: "choice", label: side === "player" ? "Your team" : "Opponent", rect: menuRow(index + 5), visible: true, enabled: !this.busy,
        choices: options.teamArena?.choices() ?? [], selected: options.teamArena?.read()[side] ?? "", select: (_seat, value) => { options.teamArena?.write(side, value); return undefined; },
      })) : []), { ...this.button("play-preset", "Play", 7, () => options.playPreset?.(preset.id, Number(this.nativeSkill), this.nativeArena), true),
        enabled: !this.busy && preset.unavailable === null && options.playPreset !== undefined }, this.back()];
    });
    this.register(browserMenu, () => this.browserControls());
    this.register(browserOptionsMenu, () => this.browserOptionsControls());
    this.register(browserDetailsMenu, () => this.browserDetailsControls());
    const lobby = options.lobby === undefined ? null : registerLocalLobbyMenu(this.controller, options.lobby.current, options.lobby.selection, options.lobby.seats);
    if (lobby !== null) { this.lobbyMenu = lobby.root; this.disposers.push(lobby.dispose); }
    const mods = registerModMenu(this.controller, options.model.mods);
    this.modsMenu = mods.root;
    this.disposers.push(mods.dispose);
    this.disposers.push(this.controller.register(session, () => {
      // Two-column create-game screen: every field on one page. Section
      // heads, the column divider, and picker values are drawn in draw().
      const spec = this.builderLayout();
      const controls: UiControl[] = [...(spec.dropdown?.items.map(item => item.control) ?? []),
        ...(spec.dropdown?.toggle === null || spec.dropdown?.toggle === undefined ? [] : [spec.dropdown.toggle.classic.control, spec.dropdown.toggle.rerelease.control]),
        ...(spec.viewer === null ? [] : [spec.viewer.control]), ...spec.fields.map(field => field.control), ...spec.footer.map(entry => entry.control)];
      return { id: session, title: "", fullScreen: false, controls, open: () => undefined, close: () => undefined };
    }));
    this.register(hostingMenu, () => [
      { id: "ui:startup:host-kind", kind: "choice", label: "Connections", rect: menuRow(0), visible: true, enabled: !this.busy,
        selected: this.hostDraft.kind, choices: [{ id: "offline", label: "Local only" }, { id: "native-server", label: "Native game clients" }, { id: "unified-server", label: "This client: mixed games" }],
        select: (_seat, kind) => { if (kind === "offline" || kind === "native-server" || kind === "unified-server") this.hostDraft = { ...this.hostDraft, kind }; return undefined; } },
      { id: "ui:startup:host-port", kind: "text-entry", label: "Port", text: this.hostPort, maximumLength: 5, rect: menuRow(1), visible: true, enabled: !this.busy && this.hostDraft.kind !== "offline",
        change: (_seat, value) => { this.hostPort = value; return undefined; }, submit: () => undefined },
      { id: "ui:startup:host-q1-protocol", kind: "choice", label: "Quake protocol", rect: menuRow(2),
        visible: this.hostDraft.kind === "native-server" && this.hostDraft.q1Protocol !== null, enabled: !this.busy,
        selected: String(this.hostDraft.q1Protocol?.version ?? 15), choices: [{ id: "15", label: "NetQuake (15)" }, { id: "666", label: "FitzQuake (666)" }, { id: "999", label: "RMQ (999)" }],
        select: (_seat, id) => { if (id === "15" || id === "666" || id === "999") this.hostDraft = { ...this.hostDraft, q1Protocol: defaultNetQuakeProfile(Number(id)) }; return undefined; } },
      { ...this.button("host-mode", options.model.options.mode === "singleplayer" && this.hostDraft.kind !== "offline"
        ? options.model.catalog.product(options.model.options.product).expectation.family === "q3" ? "Uses Deathmatch. Change rules in Combat." : "Uses Co-op. Change rules in Combat."
        : "Choose game rules and difficulty in Combat.", 3, () => undefined, true), enabled: false },
      this.button("host-apply", "Apply", 4, () => {
        try { options.model.setHosting({ ...this.hostDraft, port: this.hostDraft.kind === "offline" ? this.hostDraft.port : Number(this.hostPort) }); this.status = ""; this.controller.closeMenu(); }
        catch (error) { this.setStatus(error instanceof Error ? error.message : String(error)); }
      }, true), this.back(),
    ]);
    const llm = options.llm === undefined ? null : registerLlmSettingsMenu(this.controller, options.llm);
    if (llm !== null) this.disposers.push(llm.dispose);
    this.register(optionsMenu, () => [
      this.button("display", "Display", 0, () => this.controller.openMenu(displayMenu), true),
      this.button("sound", "Sound", 1, () => this.controller.openMenu(soundMenu), true),
      this.button("controls", "Controls", 2, () => this.controller.openMenu(controlsMenu), true),
      ...(options.settings?.some(binding => binding.category === "accessibility") === true ? [this.button("accessibility", "Accessibility", 3, () => this.controller.openMenu(accessibilityMenu), true)] : []),
      this.button("all-options", "All options", 4, () => this.controller.openMenu("menu:settings:root"), true),
      ...(llm === null ? [] : [this.button("llm", "LLM options", 5, () => this.controller.openMenu(llm.root), true)]), this.back(),
    ]);
    const settings = registerSettingsMenus(this.controller, [
      { id: "ui:startup:bindings", category: "input", kind: "button", label: "Bindings (Player 1)", enabled: () => this.bindingMenu !== null,
        activate: () => { if (this.bindingMenu !== null) this.controller.openMenu(this.bindingMenu); } },
      ...(options.settings ?? []),
      { id: "ui:startup:gyro", category: "input", kind: "button", label: "Gyro controls", enabled: () => this.gyroMenu !== null,
        activate: () => { if (this.gyroMenu !== null) this.controller.openMenu(this.gyroMenu); } }]);
    this.disposers.push(settings.dispose);
    this.disposers.push(this.controller.register(soundMenu, () => {
      const bindings = (options.settings ?? []).filter(binding => binding.category === "audio");
      const rect = (index: number) => ({ x: 64, y: 118 + index * 38, width: 496, height: 34 });
      const rows = this.rows(["environment", "doppler"]);
      const controls = [...rows.map((row, index) => ({ ...this.row(row, index), rect: rect(index) })),
        ...bindings.map((binding, index) => settingControl(binding, rect(index + rows.length), options.seat))];
      return { id: soundMenu, title: "", fullScreen: false,
        scroll: { rect: { x: 64, y: 118, width: 512, height: 298 }, contentHeight: controls.length * 38, controls: controls.map(control => control.id) },
        controls: [...controls, this.back()], open: () => undefined, close: () => undefined };
    }));
    this.disposers.push(this.controller.register(selectMenu, () => {
      const row = this.selectionRow();
      const choices = row?.choices ?? [];
      const controls = choices.map((choice, index) => {
        const control = this.button(`choice:${choice.id}`, `${row?.value === choice.id ? "> " : ""}${this.fit(`${choice.label}${choice.unavailable === null ? "" : " (unavailable)"}`, 466, menuText.body)}`, index, () => {
          if (this.monsterField.kind === "class") options.model.selectMonster(this.monsterField.classname, choice.id);
          else if (this.monsterField.kind === "source") options.model.selectMonsterSource(choice.id);
          else options.model.select(this.field, choice.id);
          this.status = ""; this.controller.closeMenu();
          if (this.monsterField.kind === "none" && this.field === "enemies" && choice.id === "custom") this.openRoster();
        }, true);
        return { ...control, enabled: choice.unavailable === null && !this.busy };
      });
      return { id: selectMenu, title: "", fullScreen: false,
        scroll: { rect: { x: 64, y: 118, width: 512, height: 298 }, contentHeight: controls.length * 34, controls: controls.map(control => control.id) },
        controls: [...controls, this.back()], open: () => undefined, close: () => undefined };
    }));
    this.disposers.push(this.controller.register(rosterMenu, () => {
      const rows = options.model.monsterRosterRows();
      const source = options.model.monsterSourceRow(), sourceLabel = source.choices.find(choice => choice.id === source.value)?.label ?? source.value;
      const controls = rows.map((row, index) => {
        return { ...this.button(`monster:${row.classname ?? "default"}`, this.fit(`${row.label}: ${row.effectiveLabel}`, 486, menuText.body), index, () => {
          this.monsterField = { kind: "class", classname: row.classname }; this.controller.openMenu(selectMenu);
        }, true), rect: { x: 64, y: 118 + index * 34, width: 512, height: 30 } };
      });
      return { id: rosterMenu, title: "", fullScreen: false,
        scroll: { rect: { x: 64, y: 118, width: 512, height: 298 }, contentHeight: controls.length * 34, controls: controls.map(control => control.id) },
        controls: [{ ...this.button("monster-source", this.fit(`Monster source: ${sourceLabel}`, 486, menuText.body), 0, () => {
          this.monsterField = { kind: "source" }; this.controller.openMenu(selectMenu);
        }, true), rect: { x: 64, y: 78, width: 512, height: 26 } }, ...controls, this.back()], open: () => undefined, close: () => undefined };
    }));
    this.register(loadMenu, () => {
      const saves = options.saves(), pages = Math.max(1, Math.ceil(saves.rows.length / 5));
      this.savePage = Math.min(this.savePage, pages - 1);
      return [...saves.rows.slice(this.savePage * 5, this.savePage * 5 + 5).map((save, index) => ({
        ...this.button(`save:${save.id}`, this.fit(`${save.label}  -  ${save.map}`, 486, menuText.body), index, () => options.load(save.id), true),
        rect: { x: 64, y: 118 + index * 46, width: 512, height: 42 },
        enabled: save.unavailable === null && !this.busy,
      })), ...(pages > 1 ? [this.button("older-saves", "Older saves", 7, () => { this.savePage = (this.savePage + 1) % pages; }, true)] : []),
        this.button("refresh-saves", "Refresh", 8, options.refreshSaves, true), this.back()];
    });
    this.ensureActiveMenu();
  }
  private familyLabel(family: StartupNativePreset["family"]): string {
    return family === "q1" ? "Quake" : family === "q2" ? "Quake II" : "Quake III Arena";
  }
  private nativeCampaigns(): readonly StartupNativePreset[] {
    return this.options.model.presets().filter(preset => preset.family === this.nativeFamily && preset.edition === this.nativeEdition);
  }
  /** Menu display must survive a selected product whose content is not installed. */
  private safeRows(): readonly StartupSelectionRow[] {
    try { return this.options.model.rows(); } catch { return []; }
  }
  private rows(fields: readonly StartupSelectionField[]): readonly StartupSelectionRow[] {
    const rows = this.safeRows();
    return fields.flatMap(field => {
      const row = rows.find(row => row.id === field);
      return row === undefined ? [] : [row];
    });
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
        choices: [{ id: "q1", label: "Quake" }, { id: "qw", label: "QuakeWorld" }, { id: "q2", label: "Quake II" }, { id: "q3", label: "Quake III Arena" }], selected: browser.protocol,
        select: (_seat, value) => { browser.choose(value); this.page = 0; return undefined; } },
      text("server-address", "Address", browser.address, 144, value => { browser.address = value; }, () => run(() => browser.query())),
      button("server-query", "Query", 64, 180, 160, () => run(() => browser.query())),
      button("server-lan", "Find LAN", 240, 180, 160, () => browser.scan()),
      button("server-favorite", "Favorite", 416, 180, 160, () => run(() => browser.favorite())),
      text("server-filter", "Filter", browser.filter, 216, value => { browser.filter = value; this.page = 0; }, () => undefined, 320),
      button("server-sort-filter", browser.hideEmpty || browser.hideFull ? "Filters on" : "Sort/filter", 400, 216, 176, () => this.controller.openMenu(browserOptionsMenu)),
      ...entries.slice(this.page * 3, this.page * 3 + 3).map((entry, index) => button(`server:${addressKey(entry.address)}`,
        this.fit(`${entry.sources.includes("favorite") ? "* " : ""}${entry.status?.name || browserAddress(entry.address)}  ${entry.status === null ? "?" : `${entry.status.players}/${entry.status.maxPlayers}`}  ${entry.pingMilliseconds === null ? "" : `${Math.round(entry.pingMilliseconds)}ms`}`, 490, menuText.body),
        64, 252 + index * 34, 512, () => browser.select(addressKey(entry.address)))),
      button("server-page", `Page ${this.page + 1}/${pages}`, 64, 358, 240, () => { this.page = (this.page + 1) % pages; }),
      button("server-favorites", browser.favoritesOnly ? "Favorites only" : "All servers", 320, 358, 256, () => { browser.favoritesOnly = !browser.favoritesOnly; this.page = 0; }),
      button("server-connect", "Connect", 64, 396, 160, () => run(async () => this.options.connect?.(await browser.connection()))),
      button("server-details", "Details", 240, 396, 160, () => { this.page = 0; this.controller.openMenu(browserDetailsMenu); }),
      button("server-back", "Back", 416, 396, 160, () => this.controller.closeMenu()),
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
      { id: "ui:startup:server-master", kind: "text-entry", label: "Master address or HTTP list", text: browser.masterAddress, maximumLength: 2048,
        rect: { x: 64, y: 226, width: 512, height: 30 }, enabled: true, visible: true,
        change: (_seat, value) => { browser.masterAddress = value; return undefined; }, submit: () => undefined },
      this.button("server-discover", "Find Internet servers", 5, () => { void browser.discover().catch((error: unknown) => { browser.status = String(error); }); }, true),
      this.button("server-filters-back", "Back", 7, () => this.controller.closeMenu(), true),
    ];
  }
  private browserDetailsControls(): readonly UiControl[] {
    const browser = this.options.browser;
    if (browser === undefined) return [this.back()];
    const lines = browser.details().flatMap(line => line.length <= 64 ? [line] : Array.from({ length: Math.ceil(line.length / 64) }, (_, index) => line.slice(index * 64, index * 64 + 64)));
    const pages = Math.max(1, Math.ceil(lines.length / 8)); this.page = Math.min(this.page, pages - 1);
    return [...lines.slice(this.page * 8, this.page * 8 + 8).map((line, index) => ({ ...this.button(`server-detail:${index}`, line, index, () => undefined, true), enabled: false })),
      this.button("server-detail-page", `Page ${this.page + 1}/${pages}`, 8, () => { this.page = (this.page + 1) % pages; }, true), this.back()];
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
      : this.safeRows().find(row => row.id === this.field);
  }
  private openRoster(): void {
    this.setStatus("Reading this map's monster roster...", true);
    void this.options.model.prepareMonsterRoster().then(() => {
      this.setStatus(""); this.controller.openMenu(rosterMenu);
    }).catch((error: unknown) => this.setStatus(error instanceof Error ? error.message : String(error)));
  }
  /** Largest scale at or below `maximum` that keeps text inside width (no truncation). */
  private fitScale(value: string, width: number, maximum: number): number {
    if (this.measure(value, maximum) <= width) return maximum;
    let low = 1.2, high = maximum;
    for (let iteration = 0; iteration < 12; iteration++) {
      const middle = (low + high) / 2;
      if (this.measure(value, middle) <= width) low = middle; else high = middle;
    }
    return low;
  }
  private prepareBuilderDropdownScroll(scroll: number): void {
    if (this.builderDropdown === null) return;
    this.builderDropdown = { ...this.builderDropdown, scroll };
    if (this.builderDropdown.field !== "map") return;
    const preparation = this.options.model.prepareMapChoices(scroll, 8);
    if (preparation === null) return;
    this.setStatus("Checking map rules...", true);
    void preparation.then(() => this.setStatus(""))
      .catch((error: unknown) => this.setStatus(error instanceof Error ? error.message : String(error)));
  }
  /** One list for both editions: classic/rerelease variants of the same title collapse to a single entry. */
  private variantKey(choice: StartupSelectionChoice): string {
    return choice.edition === undefined ? choice.id : `${choice.group ?? ""}|${choice.label}`;
  }
  private editionVariant(row: StartupSelectionRow, choice: StartupSelectionChoice, edition: "classic" | "rerelease"): StartupSelectionChoice | undefined {
    const key = this.variantKey(choice);
    return row.choices.find(candidate => candidate.edition === edition && this.variantKey(candidate) === key);
  }
  /** Flatten a picker row into group headers + choices for the dropdown window. */
  private dropdownEntries(row: StartupSelectionRow, edition: "classic" | "rerelease" | null, collapsed: readonly string[]):
    readonly ({ readonly kind: "header"; readonly group: string; readonly expanded: boolean } | { readonly kind: "choice"; readonly choice: StartupSelectionChoice })[] {
    const visible: StartupSelectionChoice[] = [], byKey = new Map<string, StartupSelectionChoice>();
    for (const choice of row.choices) {
      if (choice.edition === undefined) { visible.push(choice); continue; }
      const key = this.variantKey(choice), existing = byKey.get(key);
      if (existing === undefined) { byKey.set(key, choice); visible.push(choice); }
      else if (edition !== null && choice.edition === edition) { visible[visible.indexOf(existing)] = choice; byKey.set(key, choice); }
    }
    const entries: ({ kind: "header"; group: string; expanded: boolean } | { kind: "choice"; choice: StartupSelectionChoice })[] = [];
    for (const choice of visible) if (choice.group === undefined) entries.push({ kind: "choice", choice });
    const groups: string[] = [];
    for (const choice of visible) if (choice.group !== undefined && !groups.includes(choice.group)) groups.push(choice.group);
    for (const group of groups) {
      const expanded = !collapsed.includes(group);
      entries.push({ kind: "header", group, expanded });
      if (expanded) for (const choice of visible) if (choice.group === group) entries.push({ kind: "choice", choice });
    }
    return entries;
  }
  /**
   * One-page create-game layout: two columns of label/value rows. Long lists
   * open as a dropdown panel in the opposite column on this same screen;
   * short lists cycle inline. Section heads, labels, values, and dropdown
   * item text are drawn in draw().
   */
  private builderLayout(): {
    readonly fields: readonly { readonly control: UiControl; readonly rect: { x: number; y: number; width: number; height: number }; readonly label: string;
      readonly value: { readonly text: string; readonly width: number } | null }[];
    readonly heads: readonly { readonly x: number; readonly y: number; readonly label: string }[];
    readonly dropdown: { readonly x: number; readonly title: string; readonly itemScale: number; readonly itemsTop: number;
      readonly scroll: { readonly offset: number; readonly visible: number; readonly total: number };
      readonly toggle: { readonly classic: { readonly control: UiControl; readonly selected: boolean }; readonly rerelease: { readonly control: UiControl; readonly selected: boolean } } | null;
      readonly items: readonly { readonly control: UiControl; readonly choice: string; readonly label: string; readonly selected: boolean; readonly header: boolean; readonly indent: boolean; readonly unavailable: string | null }[] } | null;
    readonly footer: readonly { readonly control: UiControl; readonly rect: { x: number; y: number; width: number; height: number }; readonly label: string }[];
    readonly viewer: { readonly resource: ResourceId;
      readonly panel: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      readonly label: string; readonly control: UiControl } | null;
  } {
    const all = new Map(this.safeRows().map(row => [row.id, row]));
    const dropdown = this.builderDropdown;
    const appearanceDropdown = dropdown !== null && this.options.characterTurntable !== undefined && characterAppearanceFields.has(dropdown.field);
    const panelX = dropdown === null ? -1 : appearanceDropdown ? 64
      : ["product", "mapProduct", "map", "enemies", "character", "model", "skin", "topColor", "bottomColor", "movement", "weapons"].includes(dropdown.field) ? 328 : 64;
    const sections: readonly { readonly title: string; readonly x: number;
      readonly fields: readonly { readonly field: StartupSelectionField; readonly label: string; readonly picker: boolean; readonly indent?: boolean }[] }[] = [
      { title: "WORLD", x: 64, fields: [
        { field: "product", label: "Game", picker: true },
        { field: "mapProduct", label: "Map set", picker: true },
        { field: "map", label: "Map", picker: true, indent: true },
        { field: "enemies", label: "Monsters", picker: true },
      ] },
      { title: "PLAYER", x: 64, fields: [
        { field: "character", label: "Character", picker: true },
        { field: "model", label: "Model", picker: true, indent: true },
        { field: "skin", label: "Skin", picker: true, indent: true },
        { field: "topColor", label: "Shirt", picker: true, indent: true },
        { field: "bottomColor", label: "Pants", picker: true, indent: true },
        { field: "movement", label: "Movement", picker: true },
        { field: "weapons", label: "Weapons", picker: true },
      ] },
      { title: "MATCH", x: 328, fields: [
        { field: "seats", label: "Players", picker: false },
        { field: "mode", label: "Mode", picker: false },
        { field: "rules", label: "Rules", picker: true },
        { field: "skill", label: "Difficulty", picker: false },
      ] },
      { title: "KIT", x: 328, fields: [
        { field: "grapple", label: "Hook", picker: false },
        { field: "grappleStyle", label: "Hook style", picker: true },
        { field: "grenades", label: "Grenades", picker: false },
      ] },
    ];
    const fields: { control: UiControl; rect: { x: number; y: number; width: number; height: number }; label: string;
      value: { text: string; width: number } | null }[] = [];
    const heads: { x: number; y: number; label: string }[] = [];
    const cursorByColumn = new Map<number, number>();
    for (const section of sections) {
      if (appearanceDropdown || section.x === panelX) continue;
      const present = section.fields.filter(spec => all.has(spec.field));
      if (present.length === 0) continue;
      const startY = cursorByColumn.get(section.x) ?? 110;
      heads.push({ x: section.x, y: startY, label: section.title });
      present.forEach((spec, index) => {
        const row = all.get(spec.field);
        if (row === undefined) return;
        const indent = spec.indent === true ? 14 : 0;
        const rect = { x: section.x + indent, y: startY + 15 + index * 23, width: 248 - indent, height: 22 };
        const valueWidth = rect.width - this.measure(spec.label, menuText.field) - 34;
        const enabled = !this.busy && dropdown === null;
        if (spec.picker) {
          const selected = row.choices.find(choice => choice.id === row.value)?.label ?? row.value;
          const display = spec.field === "enemies" ? selected.replace(" authored monsters", "")
            : spec.field === "weapons" ? selected.replace(/ weapons$/, "") : selected;
          fields.push({ control: { ...this.button(row.id, "", 0, () => {
              const current = row.choices.find(choice => choice.id === row.value);
              const editions = new Set(row.choices.flatMap(choice => choice.edition === undefined ? [] : [choice.edition]));
              const edition = editions.size > 1 ? current?.edition ?? "classic" : null;
              const groups = [...new Set(row.choices.flatMap(choice => choice.group === undefined ? [] : [choice.group]))];
              const collapsed = groups.filter(group => group !== current?.group);
              const entries = this.dropdownEntries(row, edition, collapsed);
              const visibleCount = edition === null ? 8 : 7;
              const selectedIndex = Math.max(0, entries.findIndex(entry => entry.kind === "choice" && entry.choice.id === row.value));
              const scroll = Math.max(0, Math.min(selectedIndex, Math.max(0, entries.length - visibleCount)));
              this.builderDropdown = { field: spec.field, scroll, edition, collapsed };
              this.builderPreviewFocusArmed = false;
              if (spec.field === "map") this.prepareBuilderDropdownScroll(scroll);
            }), rect, enabled }, rect, label: spec.label, value: { text: `${display} >`, width: valueWidth } });
        } else {
          const available = row.choices.filter(choice => choice.unavailable === null);
          const fieldEnabled = row.id === "grenades" ? enabled && (row.value === "enabled" || available.some(choice => choice.id === "enabled")) : enabled;
          const selected = row.choices.find(choice => choice.id === row.value)?.label ?? row.value;
          fields.push({ control: { id: `ui:startup:${row.id}`, kind: "choice", label: "", rect, visible: true, enabled: fieldEnabled,
            selected: row.value, choices: available.map(choice => ({ id: choice.id, label: "" })),
            select: (_seat, value) => { this.options.model.select(spec.field, value); return undefined; } }, rect, label: spec.label,
            value: { text: row.id === "grenades" ? (row.value === "enabled" ? "On" : "Off") : selected, width: valueWidth } });
        }
      });
      cursorByColumn.set(section.x, startY + 15 + present.length * 23 + 8);
    }
    let dropdownSpec: { x: number; title: string; itemScale: number; itemsTop: number;
      scroll: { offset: number; visible: number; total: number };
      toggle: { classic: { control: UiControl; selected: boolean }; rerelease: { control: UiControl; selected: boolean } } | null;
      items: { control: UiControl; choice: string; label: string; selected: boolean; header: boolean; indent: boolean; unavailable: string | null }[] } | null = null;
    if (dropdown !== null) {
      const row = all.get(dropdown.field);
      if (row === undefined) this.builderDropdown = null;
      else {
        const entries = this.dropdownEntries(row, dropdown.edition, dropdown.collapsed);
        const visibleCount = dropdown.edition === null ? 8 : 7;
        const itemsTop = dropdown.edition === null ? 138 : 164;
        const scroll = Math.max(0, Math.min(dropdown.scroll, Math.max(0, entries.length - visibleCount)));
        let itemScale: number = menuText.field;
        for (const entry of entries)
          itemScale = Math.min(itemScale, this.fitScale(entry.kind === "header" ? entry.group : entry.choice.label, 216, menuText.field));
        const switchEdition = (edition: "classic" | "rerelease"): void => {
          if (this.builderDropdown === null) return;
          this.builderDropdown = { ...this.builderDropdown, edition, scroll: 0 };
          // The toggle picks which edition of the selected title is in effect;
          // the list itself is unified and does not change.
          const fresh = this.options.model.rows().find(candidate => candidate.id === dropdown.field);
          const current = fresh?.choices.find(choice => choice.id === fresh.value);
          if (fresh === undefined || current === undefined || current.edition === undefined || current.edition === edition) return;
          const counterpart = this.editionVariant(fresh, current, edition);
          if (counterpart !== undefined && counterpart.id !== current.id && counterpart.unavailable === null) {
            this.options.model.select(dropdown.field, counterpart.id);
            this.status = "";
          }
        };
        const toggle = dropdown.edition === null ? null : {
          classic: { control: { ...this.button("edition-classic", "", 0, () => switchEdition("classic")),
            rect: { x: panelX, y: 136, width: 120, height: 22 } }, selected: dropdown.edition === "classic" },
          rerelease: { control: { ...this.button("edition-rerelease", "", 0, () => switchEdition("rerelease")),
            rect: { x: panelX + 128, y: 136, width: 120, height: 22 } }, selected: dropdown.edition === "rerelease" },
        };
        const items = entries.slice(scroll, scroll + visibleCount).map((entry, index) => {
          const rect = { x: panelX, y: itemsTop + index * 27, width: 248, height: 26 };
          if (entry.kind === "header") {
            const group = entry.group;
            const control: UiControl = { id: `ui:startup:group:${group}`, kind: "button", label: "", rect, visible: true, enabled: !this.busy,
              activate: () => {
                if (this.builderDropdown === null) return undefined;
                const collapsed = this.builderDropdown.collapsed.includes(group)
                  ? this.builderDropdown.collapsed.filter(value => value !== group) : [...this.builderDropdown.collapsed, group];
                this.builderDropdown = { ...this.builderDropdown, collapsed };
                return undefined;
              } };
            return { control, choice: row.value, label: `${entry.expanded ? "- " : "+ "}${group}`, selected: false, header: true, indent: false, unavailable: null };
          }
          // If the toggle's edition variant is not installed, the other edition serves.
          let choice = entry.choice;
          if (choice.unavailable !== null) {
            const alternate = row.choices.find(candidate => this.variantKey(candidate) === this.variantKey(choice) && candidate.unavailable === null);
            if (alternate !== undefined) choice = alternate;
          }
          const current = row.choices.find(candidate => candidate.id === row.value);
          const selected = current !== undefined && this.variantKey(current) === this.variantKey(choice);
          const control: UiControl = { id: appearanceDropdown || !selected ? `ui:startup:choice:${choice.id}` : `ui:startup:${row.id}`, kind: "button", label: "", rect,
            visible: true, enabled: choice.unavailable === null && !this.busy,
            activate: () => {
              const wasSelected = this.options.model.rows().find(candidate => candidate.id === dropdown.field)?.value === choice.id;
              this.options.model.select(dropdown.field, choice.id);
              this.status = "";
              if (!appearanceDropdown || wasSelected) { this.builderDropdown = null; this.builderPreviewFocusArmed = false; }
              if (dropdown.field === "enemies" && choice.id === "custom") this.openRoster();
              return undefined;
            } };
          return { control, choice: choice.id, label: `${selected ? "> " : ""}${choice.label}`, selected, header: false, indent: choice.group !== undefined, unavailable: choice.unavailable };
        });
        dropdownSpec = { x: panelX, title: row.label, itemScale, itemsTop, scroll: { offset: scroll, visible: visibleCount, total: entries.length }, toggle, items };
      }
    }
    const footer: { control: UiControl; rect: { x: number; y: number; width: number; height: number }; label: string }[] = [];
    {
      const options = this.options, footerEnabled = dropdown === null;
      const entries: { readonly control: UiControl; readonly label: string; readonly width: number }[] = [
        { control: this.button("hosting", "", 0, () => {
          this.hostDraft = options.model.hosting(); this.hostPort = String(this.hostDraft.port); this.status = ""; this.controller.openMenu(hostingMenu);
        }), label: options.model.hosting().kind === "offline" ? "Network: local only" : "Network: hosting", width: 0 },
        ...(this.modsMenu === null ? [] : [{ control: this.button("mods", "", 0, () => { if (this.modsMenu !== null) this.controller.openMenu(this.modsMenu); }), label: "Mods", width: 72 }]),
        ...(options.browser === undefined ? [] : [{ control: this.button("browse", "", 0, () => this.controller.openMenu(browserMenu)), label: "Find servers", width: 118 }]),
        ...(this.lobbyMenu === null ? [] : [{ control: this.button("local-lobby", "", 0, () => this.openLocalLobby()), label: "Local lobby", width: 102 }]),
      ];
      const gaps = (entries.length - 1) * 8, fixed = entries.reduce((sum, entry) => sum + entry.width, 0);
      let x = 64;
      for (const entry of entries) {
        const width = entry.width === 0 ? 512 - fixed - gaps : entry.width;
        const rect = { x, y: 388, width, height: 24 };
        footer.push({ control: { ...entry.control, rect, enabled: footerEnabled && entry.control.enabled }, rect, label: entry.label });
        x += width + 8;
      }
      const backRect = { x: 64, y: 416, width: 248, height: 26 }, playRect = { x: 328, y: 416, width: 248, height: 26 };
      footer.push(
        { control: { ...this.button("back", "", 0, () => this.controller.closeMenu()), rect: backRect, enabled: footerEnabled }, rect: backRect, label: "Back" },
        { control: { ...this.button("play", "", 0, options.play), rect: playRect, enabled: footerEnabled }, rect: playRect,
          label: options.model.hosting().kind === "offline" ? "Play" : "Start server" },
      );
    }
    let viewer: { resource: ResourceId; panel: { x: number; y: number; width: number; height: number };
      rect: { x: number; y: number; width: number; height: number }; label: string; control: UiControl } | null = null;
    if (appearanceDropdown && dropdown !== null && dropdownSpec !== null && this.options.characterTurntable !== undefined) {
      const state = this.controller.state(), focusedId = state.focus.kind === "menu" ? state.focus.control : null;
      const candidates = dropdownSpec.items.filter(item => !item.header && item.unavailable === null);
      const hoveredCandidate = candidates.find(item => contains(item.control.rect, state.cursor));
      const focusedCandidate = candidates.find(item => item.control.id === focusedId);
      const candidate = hoveredCandidate ?? (focusedCandidate !== undefined
        && (this.builderPreviewFocusArmed || candidates[0] !== focusedCandidate || focusedCandidate.selected)
        ? focusedCandidate : undefined);
      const overrides: Parameters<StartupSelectionModel["characterPreview"]>[0] = {};
      if (candidate !== undefined) {
        if (dropdown.field === "character") overrides.character = candidate.choice;
        else if (dropdown.field === "model") overrides.model = candidate.choice;
        else if (dropdown.field === "skin") overrides.skin = candidate.choice;
        else if (dropdown.field === "topColor") overrides.topColor = candidate.choice;
        else if (dropdown.field === "bottomColor") overrides.bottomColor = candidate.choice;
      }
      const preview = this.options.model.characterPreview(overrides);
      const colorLabel = (field: "topColor" | "bottomColor", value: number): string =>
        all.get(field)?.choices.find(choice => choice.id === String(value))?.label ?? String(value);
      const modelLabel = preview.family === "q1" && preview.model === "player" ? "Quake player" : preview.model;
      const label = preview.family === "q1"
        ? `${modelLabel} · ${colorLabel("topColor", preview.topColor)} / ${colorLabel("bottomColor", preview.bottomColor)}`
        : `${modelLabel} · ${preview.skin === "" ? "Default" : preview.skin}`;
      viewer = {
        resource: this.options.characterTurntable.request(preview, this.options.now()),
        panel: { x: 320, y: 110, width: 264, height: 272 },
        rect: { x: 368, y: 118, width: 168, height: 224 },
        label,
        control: { ...this.button("preview-done", "", 0, () => { this.builderDropdown = null; this.builderPreviewFocusArmed = false; }),
          rect: { x: 328, y: 358, width: 248, height: 20 }, enabled: !this.busy },
      };
    }
    return { fields, heads, dropdown: dropdownSpec, footer, viewer };
  }
  private row(row: StartupSelectionRow, index: number): UiControl {
    const rect = { x: 64, y: 118 + index * 34, width: 512, height: 30 };
    if (row.id === "grapple") return {
      id: "ui:startup:grapple", kind: "choice", label: row.label, rect, visible: true, enabled: !this.busy,
      selected: row.value, choices: row.choices.filter(choice => choice.unavailable === null),
      select: (_seat, value) => { this.options.model.select("grapple", value); return undefined; },
    };
    if (row.id === "grenades") return {
      id: "ui:startup:grenades", kind: "toggle", label: row.label, rect, visible: true,
      enabled: !this.busy && (row.value === "enabled" || row.choices.some(choice => choice.id === "enabled" && choice.unavailable === null)),
      checked: row.value === "enabled", change: (_seat, enabled) => { this.options.model.select("grenades", enabled ? "enabled" : "disabled"); return undefined; },
    };
    const selected = row.choices.find(choice => choice.id === row.value)?.label ?? row.value;
    return this.button(row.id, this.fit(`${row.label}: ${selected}`, 486, menuText.body), index, () => { this.monsterField = { kind: "none" }; this.field = row.id; this.controller.openMenu(selectMenu); this.prepareChoicePage(0); }, true);
  }
  private prepareChoicePage(page: number): void {
    this.page = page;
    if (this.monsterField.kind !== "none" || this.field !== "map") return;
    const preparation = this.options.model.prepareMapChoices(page * 7, 7);
    if (preparation === null) return;
    this.setStatus("Checking map rules...", true);
    void preparation.then(() => this.setStatus(""))
      .catch((error: unknown) => this.setStatus(error instanceof Error ? error.message : String(error)));
  }
  captionCommands(captions: readonly ActiveCaption[], context: UiDrawContext): readonly RenderCommand[] {
    const appearance = this.options.appearance?.() ?? defaultUiPreferences;
    if (!appearance.captions) return [];
    this.text.bind(this.options.art.skin.font, appearance.typeface === "bold" ? this.options.titleFont : this.options.font);
    const area = context.binding.safeArea, commands: RenderCommand[] = [];
    const draws = mediaCaptionCommands(captions, { x: area.x + 8, y: area.y + area.height * 0.65, width: area.width - 16, height: area.height * 0.3 },
      this.options.art.skin.font, appearance.textScale * Math.min(area.width / 640, area.height / 480), (text, scale) => this.measure(text, scale));
    renderUiCommands(context, draws, { text: this.text, white: this.options.art.white, picture: resource => this.options.characterTurntable?.picture(resource) ?? this.options.art.picture(resource),
      emit: command => commands.push(command), material: () => { throw new Error("Caption text requested a material draw"); } });
    return commands;
  }

  private measure(text: string, scale: number): number {
    return layoutText({ text, font: this.options.appearance?.().typeface === "bold" ? this.options.titleFont : this.options.font, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width;
  }
  private fit(text: string, width: number, scale: number): string {
    if (this.measure(text, scale) <= width) return text;
    let end = text.length;
    while (end > 0 && this.measure(`${text.slice(0, end)}...`, scale) > width) end--;
    return `${text.slice(0, end)}...`;
  }
  ensureActiveMenu(): UiMenuId {
    const active = this.controller.activeMenu;
    if (active !== null) return active;
    this.controller.openMenu(main);
    return main;
  }
  resumeDisplayOptions(): void { this.controller.openMenu(optionsMenu); this.controller.openMenu(displayMenu); }
  setStatus(text: string, busy = false): void { this.status = text; this.busy = busy; }
  input(event: SeatInputEvent): boolean {
    if (this.busy) return true;
    if (this.controller.activeMenu === session && this.builderDropdown !== null) {
      if (event.kind === "key" && event.code === KeyCode.Escape) { this.builderDropdown = null; this.builderPreviewFocusArmed = false; return true; }
      if (event.kind === "key" && [KeyCode.Tab, KeyCode.Up, KeyCode.Down, KeyCode.Left, KeyCode.Right,
        KeyCode.PageUp, KeyCode.PageDown, KeyCode.Home, KeyCode.End].includes(event.code)) this.builderPreviewFocusArmed = true;
      if (event.kind === "key" && event.down && (event.code === KeyCode.PageDown || event.code === KeyCode.PageUp)) {
        const row = this.safeRows().find(candidate => candidate.id === this.builderDropdown?.field);
        const entries = row === undefined ? [] : this.dropdownEntries(row, this.builderDropdown.edition, this.builderDropdown.collapsed);
        const visible = this.builderDropdown.edition === null ? 8 : 7;
        this.prepareBuilderDropdownScroll(Math.max(0, Math.min(Math.max(0, entries.length - visible),
          this.builderDropdown.scroll + (event.code === KeyCode.PageDown ? visible : -visible))));
        return true;
      }
      if (event.kind === "mouse-wheel" && event.delta.y !== 0) {
        const row = this.safeRows().find(candidate => candidate.id === this.builderDropdown?.field);
        const entries = row === undefined ? [] : this.dropdownEntries(row, this.builderDropdown.edition, this.builderDropdown.collapsed);
        const visible = this.builderDropdown.edition === null ? 8 : 7;
        this.prepareBuilderDropdownScroll(Math.max(0, Math.min(Math.max(0, entries.length - visible), this.builderDropdown.scroll + (event.delta.y < 0 ? 1 : -1))));
        return true;
      }
    }
    if (event.kind === "mouse-wheel" && event.delta.y !== 0 && this.controller.activeMenu === loadMenu) {
      this.savePage = Math.max(0, Math.min(Math.ceil(this.options.saves().rows.length / 5) - 1, this.savePage + (event.delta.y < 0 ? 1 : -1)));
      return true;
    }
    if (this.controller.activeMenu === main && event.kind === "key" && event.code === KeyCode.Escape) return true;
    try {
      const handled = this.controller.input(event);
      this.ensureActiveMenu();
      return handled;
    }
    catch (error) { this.setStatus(error instanceof Error ? error.message : String(error)); return true; }
  }
  draw(context: UiDrawContext, emit: (command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>) => void,
    material: (draw: MaterialTextDraw) => void): void {
    const appearance = this.options.appearance?.() ?? defaultUiPreferences;
    this.text.bind(this.options.art.skin.font, appearance.typeface === "bold" ? this.options.titleFont : this.options.font);
    const colors = accessibleColors(menuSkin(this.options.art.skin.font).colors, appearance);
    const active = this.controller.activeMenu, transform = fitUi(context.binding.safeArea, appearance.menuScale), commands: UiDrawCommand[] = [], overlayCommands: UiDrawCommand[] = [];
    let overlay = false;
    const text = (value: string, x: number, y: number, scale: number = menuText.body, accent = false, heading = false): void => {
      (overlay ? overlayCommands : commands).push({ kind: "text", origin: { x, y }, text: value, font: heading ? menuTitleFont : this.options.art.skin.font, scale,
        color: accent ? colors.accent : colors.text, align: "left", shadow: true });
    };
    const backdrop = menuBackdrop(context), originalPanel = menuPanel(context, active === main);
    const panel = appearance.highContrast && originalPanel.kind === "fill" ? { ...originalPanel, color: colors.panel } : originalPanel;
    const title = active === main ? "QUAKE" : active === session ? "Custom game" : active === hostingMenu ? "Host a game"
      : active === libraryMenu ? "Library" : active === nativeFamilyMenu ? "Play a game"
      : active === nativeCampaignMenu ? `${this.familyLabel(this.nativeFamily)}${this.nativeFamily === "q3" ? "" : this.nativeEdition === "classic" ? " classic" : " rerelease"}`
      : active === nativeDifficultyMenu ? "Difficulty"
      : active === rosterMenu ? "Custom roster" : active === selectMenu ? this.selectionRow()?.label ?? "Choose"
      : active === this.gyroMenu ? "Gyro controls" : active === browserMenu ? "Find servers" : active === browserDetailsMenu ? "Server details" : active === browserOptionsMenu ? "Server filters" : active === optionsMenu ? "Options" : active === displayMenu ? "Display" : active === soundMenu ? "Sound" : active === controlsMenu ? "Controls" : "Load Game";
    if (!active?.startsWith("menu:settings:") && !active?.startsWith("menu:library:") && !active?.startsWith("menu:bindings:") && !active?.startsWith("menu:mods:") && !active?.startsWith("menu:settings:llm") && !active?.startsWith("menu:settings:display:") && !active?.startsWith("menu:settings:input:") && !active?.startsWith("menu:settings:accessibility:")) text(title, 64, 44, active === main ? menuText.mainTitle : menuText.title, true, true);
    if (active === this.bindingMenu) text(this.fit(`Player 1 - ${this.options.model.catalog.product(this.options.model.options.product).expectation.title}`, 512, menuText.small), 64, 458, menuText.small);

    if (active === nativeDifficultyMenu && this.nativePreset !== null) text(this.fit(this.nativePreset.label, 512, menuText.label), 64, 86, menuText.label);
    if (active === nativeCampaignMenu) {
      const unavailable = this.nativeCampaigns().find(preset => preset.unavailable !== null);
      if (unavailable?.unavailable) text(this.fit(unavailable.unavailable, 512, menuText.label), 64, 395, menuText.label, true);
    }
    if (active === selectMenu && this.status === "") {
      const state = this.controller.state(), focused = state.focus.kind === "menu" ? state.focus.control : null;
      const hovered = this.selectionRow()?.choices.find(choice => focused === `ui:startup:choice:${choice.id}`);
      if (hovered?.unavailable) text(this.fit(hovered.unavailable, 512, menuText.small), 64, 458, menuText.small, true);
    }
    if (active === rosterMenu) text("Map counts shown. * Custom override.", 64, 460, menuText.small);
    commands.push({ kind: "fill", rect: { x: 64, y: 104, width: active === main ? 224 : 512, height: 1 }, color: { x: 0.6, y: 0.39, z: 0.18, w: 0.65 } });

    if (active === session) {
      const spec = this.builderLayout();
      const focus = this.controller.state().focus;
      const focusedId = focus.kind === "menu" ? focus.control : null;
      if (spec.dropdown === null) {
        commands.push({ kind: "fill", rect: { x: 320, y: 120, width: 1, height: 264 }, color: { x: 0.6, y: 0.39, z: 0.18, w: 0.3 } });
      } else {
        const panelColor = { x: 0.6, y: 0.39, z: 0.18, w: 0.55 };
        commands.push({ kind: "fill", rect: { x: spec.dropdown.x - 8, y: 110, width: 264, height: 272 }, color: { x: 0.02, y: 0.03, z: 0.04, w: 0.97 } },
          { kind: "fill", rect: { x: spec.dropdown.x - 8, y: 110, width: 264, height: 1 }, color: panelColor },
          { kind: "fill", rect: { x: spec.dropdown.x - 8, y: 381, width: 264, height: 1 }, color: panelColor },
          { kind: "fill", rect: { x: spec.dropdown.x - 8, y: 110, width: 1, height: 272 }, color: panelColor },
          { kind: "fill", rect: { x: spec.dropdown.x + 255, y: 110, width: 1, height: 272 }, color: panelColor });
        text(spec.dropdown.title.toUpperCase(), spec.dropdown.x, 116, menuText.section, true);
      }
      if (spec.viewer !== null) {
        const panelColor = { x: 0.6, y: 0.39, z: 0.18, w: 0.55 }, panel = spec.viewer.panel;
        commands.push({ kind: "fill", rect: panel, color: { x: 0.02, y: 0.03, z: 0.04, w: 0.97 } },
          { kind: "fill", rect: { x: panel.x, y: panel.y, width: panel.width, height: 1 }, color: panelColor },
          { kind: "fill", rect: { x: panel.x, y: panel.y + panel.height - 1, width: panel.width, height: 1 }, color: panelColor },
          { kind: "fill", rect: { x: panel.x, y: panel.y, width: 1, height: panel.height }, color: panelColor },
          { kind: "fill", rect: { x: panel.x + panel.width - 1, y: panel.y, width: 1, height: panel.height }, color: panelColor },
          { kind: "image", resource: spec.viewer.resource, rect: spec.viewer.rect,
            texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
        text("CHARACTER", panel.x + 8, panel.y + 6, menuText.section, true);
        const labelScale = this.fitScale(spec.viewer.label, 232, menuText.small);
        text(spec.viewer.label, panel.x + (panel.width - this.measure(spec.viewer.label, labelScale)) / 2, 344, labelScale);
      }
      for (const head of spec.heads) text(head.label, head.x, head.y, menuText.section, true);
      overlay = true;
      for (const field of spec.fields) {
        text(field.label, field.rect.x + 10, field.rect.y + 5, menuText.field, focusedId === field.control.id);
        if (field.value === null) continue;
        const scale = this.fitScale(field.value.text, field.value.width, menuText.field);
        text(field.value.text, field.rect.x + field.rect.width - 10 - this.measure(field.value.text, scale), field.rect.y + 5, scale, focusedId === field.control.id);
      }
      if (spec.viewer !== null) {
        const rect = spec.viewer.control.rect;
        overlayCommands.push({ kind: "text", origin: { x: rect.x + 10, y: rect.y + 3 }, text: "Done", font: this.options.art.skin.font,
          scale: menuText.field, color: focusedId === spec.viewer.control.id ? colors.accent : colors.text, align: "left", shadow: true });
      }
      for (const entry of spec.footer) {
        overlayCommands.push({ kind: "text", origin: { x: entry.rect.x + 10, y: entry.rect.y + 4 }, text: entry.label, font: this.options.art.skin.font,
          scale: menuText.field, color: focusedId === entry.control.id ? colors.accent : entry.control.enabled ? colors.text : colors.disabled, align: "left", shadow: true });
      }
      if (spec.dropdown !== null) {
        if (spec.dropdown.toggle !== null) {
          const toggleLabels: readonly (readonly [{ readonly control: UiControl; readonly selected: boolean }, string])[] = [
            [spec.dropdown.toggle.classic, "Classic"], [spec.dropdown.toggle.rerelease, "Rerelease"]];
          for (const [entry, label] of toggleLabels) {
            const rect = entry.control.rect;
            overlayCommands.push({ kind: "text", origin: { x: rect.x + 10, y: rect.y + 3 }, text: label, font: this.options.art.skin.font,
              scale: menuText.field, color: entry.selected || focusedId === entry.control.id ? colors.accent : colors.text, align: "left", shadow: true });
          }
        }
        for (const item of spec.dropdown.items) {
          const rect = item.control.rect, scale = spec.dropdown.itemScale;
          const itemText = this.measure(item.label, scale) <= rect.width - 20 ? item.label : this.fit(item.label, rect.width - 20, scale);
          overlayCommands.push({ kind: "text", origin: { x: rect.x + 10 + (item.indent ? 16 : 0), y: rect.y + 5 }, text: itemText, font: this.options.art.skin.font, scale,
            color: item.header || item.selected ? colors.accent : item.control.enabled ? colors.text : colors.disabled, align: "left", shadow: true });
        }
        const scroll = spec.dropdown.scroll;
        if (scroll.total > scroll.visible) {
          const trackHeight = scroll.visible * 27 - 1, thumbHeight = Math.max(24, trackHeight * scroll.visible / scroll.total);
          const thumbY = spec.dropdown.itemsTop + (trackHeight - thumbHeight) * scroll.offset / (scroll.total - scroll.visible);
          overlayCommands.push(
            { kind: "fill", rect: { x: spec.dropdown.x + 240, y: spec.dropdown.itemsTop, width: 6, height: trackHeight }, color: { x: 0.6, y: 0.39, z: 0.18, w: 0.25 } },
            { kind: "fill", rect: { x: spec.dropdown.x + 240, y: thumbY, width: 6, height: thumbHeight }, color: { x: 0.6, y: 0.39, z: 0.18, w: 0.9 } });
        }
      }
      overlay = false;
    }
    if (active === browserMenu && this.options.browser !== undefined && this.status.length === 0) {
      const browser = this.options.browser, selected = browser.rows().find(entry => addressKey(entry.address) === browser.selected);
      if (browser.rows().length === 0) text(browser.emptyMessage, 64, 430, menuText.small);
      text(this.fit(selected?.status === null || selected === undefined ? browser.status : `${selected.status.map} — ${browser.status}`, 512, menuText.label), 64, 450, menuText.label);
    }
    if (active === loadMenu) {
      const saves = this.options.saves();
      if (saves.rows.length === 0) { text("No saved games", 64, 138, menuText.body); text("Your saved games will appear here.", 64, 174, menuText.label); }
      overlay = true;
      const rows = saves.rows.slice(this.savePage * 5, this.savePage * 5 + 5), state = this.controller.state();
      for (const [index, save] of rows.entries()) {
        const stamp = new Date(save.savedAtMilliseconds).toLocaleString();
        text(this.fit(`${save.game}  -  ${stamp}`, 486, menuText.small), 74, 144 + index * 46, menuText.small);
        if (save.unavailable !== null && contains({ x: 64, y: 118 + index * 46, width: 512, height: 42 }, state.cursor))
          text(this.fit(save.unavailable, 512, menuText.small), 64, 360, menuText.small, true);
      }
      if (saves.error !== null) text(this.fit(saves.error, 512, menuText.small), 64, 390, menuText.small);
    }
    overlay = false;
    if (this.status.length !== 0) text(this.fit(this.status, 512, menuText.small), 64, 450, menuText.small, true);
    else if (active === session) {
      const spec = this.builderLayout(), cursor = this.controller.state().cursor;
      const hoveredItem = spec.dropdown?.items.find(item => contains(item.control.rect, cursor));
      if (hoveredItem?.unavailable) text(this.fit(hoveredItem.unavailable, 512, menuText.small), 64, 450, menuText.small, true);
    }
    renderUiCommands(context, [backdrop, panel, ...commands.map(command => transformUi(command, transform))], { text: this.text, white: this.options.art.white,
      picture: resource => this.options.characterTurntable?.picture(resource) ?? this.options.art.picture(resource), emit, material });
    renderUiCommands(context, this.controller.draw(context), { text: this.text, white: this.options.art.white,
      picture: resource => this.options.characterTurntable?.picture(resource) ?? this.options.art.picture(resource), emit, material });
    renderUiCommands(context, overlayCommands.map(command => transformUi(command, transform)), { text: this.text, white: this.options.art.white,
      picture: resource => this.options.characterTurntable?.picture(resource) ?? this.options.art.picture(resource), emit, material });
  }
  bindGyro(settings: GyroSettingsUi): void {
    const menu = registerGyroSettingsMenu(this.controller, settings, ""); this.gyroMenu = menu.root; this.disposers.push(menu.dispose);
  }
  bindInput(input: SeatInput, actions: () => readonly BindingAction[], reset?: import("../../ui/settings/bindings.ts").BindingReset): void {
    const menu = registerBindingMenus(this.controller, input, actions, reset); this.bindingMenu = menu.root; this.disposers.push(menu.dispose);
  }
  close(): void { this.controller.closeAll(); for (const dispose of this.disposers) dispose(); this.text.clear(); }
}
