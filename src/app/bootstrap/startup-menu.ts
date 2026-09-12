import type { SeatId } from "../../contracts/identity.ts";
import type { RenderCommand } from "../../contracts/render.ts";
import type { SeatInputEvent, UiControl, UiDrawCommand, UiDrawContext, UiMenuId } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { NativeUiController, renderUiCommands } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { menuBackdrop, menuPanel, menuSkin, menuTitleFont } from "../../ui/common/menu-theme.ts";
import { contains, fitUi, transformUi } from "../../ui/common/layout.ts";
import { settingControl } from "../../ui/settings/index.ts";
import type { SettingBinding } from "../../ui/settings/index.ts";
import { layoutText } from "../../text/layout.ts";
import type { StartupSaveList } from "./startup-saves.ts";
import { UiTextRenderer } from "../../text/ui.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import type { StartupSelectionField, StartupSelectionModel, StartupSelectionRow } from "./startup-selection.ts";

export interface StartupMenuOptions {
  readonly seat: SeatId;
  readonly model: StartupSelectionModel;
  readonly art: NativeUiArt;
  readonly font: TextFontSelection;
  readonly titleFont: TextFontSelection;
  readonly now: () => number;
  readonly play: () => void;
  readonly load: (id: string) => void;
  readonly saves: () => StartupSaveList;
  readonly refreshSaves: () => void;
  readonly quit: () => void;
  readonly settings?: readonly SettingBinding[];
  readonly applyDisplay: () => void;
}
const main: UiMenuId = "menu:startup:main";
const session: UiMenuId = "menu:startup:session";
const optionsMenu: UiMenuId = "menu:startup:options";
const displayMenu: UiMenuId = "menu:startup:display";
const soundMenu: UiMenuId = "menu:startup:sound";
const controlsMenu: UiMenuId = "menu:startup:controls";
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
  private readonly disposers: (() => void)[] = [];
  private status = "";
  private busy = false;
  private group = groups[0];
  private field: StartupSelectionField = "product";
  private page = 0;
  private rosterPage = 0;
  private monsterField: { readonly kind: "none" } | { readonly kind: "class"; readonly classname: string | null } = { kind: "none" };
  private savePage = 0;
  private multiplayer = false;
  private multiplayerMode: "coop" | "deathmatch" = "deathmatch";

  constructor(private readonly options: StartupMenuOptions) {
    this.text = new UiTextRenderer(options.seat);
    this.text.bind(options.art.skin.font, options.font);
    this.text.bind(menuTitleFont, options.titleFont);
    const skin = menuSkin(options.art.skin.font);
    this.controller = new NativeUiController({ seat: options.seat, skin: () => skin, now: options.now, bindings: () => [],
      focus: () => undefined, sound: () => undefined, measureText: (text, scale) => this.measure(text, scale), executeScript: () => { throw new Error("Startup menu has no legacy scripts"); } });
    this.register(main, () => [
      this.button("single", "Single Player", 0, () => this.configure(false)),
      this.button("multi", "Multiplayer", 1, () => this.configure(true)),
      this.button("load", "Load Game", 2, () => { this.savePage = 0; this.controller.openMenu(loadMenu); options.refreshSaves(); }),
      this.button("options", "Options", 3, () => this.controller.openMenu(optionsMenu)),
      this.button("quit", "Quit", 4, options.quit),
    ]);
    this.register(session, () => [...groups.map((group, index) => this.button(`group:${index}`, group.title, index, () => {
      this.group = group; this.controller.openMenu(categoryMenu);
    })), this.button("play", "Play", 6, options.play), this.button("back", "Back", 7, () => this.controller.closeMenu())]);
    this.register(categoryMenu, () => [
      ...this.rows(this.group?.fields ?? []).map((row, index) => this.row(row, index)), this.back(),
    ]);
    this.register(optionsMenu, () => [
      this.button("display", "Display", 0, () => this.controller.openMenu(displayMenu), true),
      this.button("sound", "Sound", 1, () => this.controller.openMenu(soundMenu), true),
      this.button("controls", "Controls", 2, () => this.controller.openMenu(controlsMenu), true), this.back(),
    ]);
    this.register(displayMenu, () => [
      ...this.rows(["renderer", "resolution", "gamma"]).map((row, index) => this.row(row, index)),
      this.button("apply-display", "Apply display settings", 5, options.applyDisplay, true), this.back(),
    ]);
    for (const [id, category] of [[soundMenu, "audio"], [controlsMenu, "input"]] satisfies readonly (readonly [UiMenuId, string])[])
      this.register(id, () => [...(options.settings ?? []).filter(binding => binding.category === category)
        .map((binding, index) => settingControl(binding, { x: 64, y: 118 + index * 38, width: 512, height: 34 }, options.seat)), this.back()]);
    this.register(selectMenu, () => {
      const row = this.selectionRow();
      const choices = row?.choices ?? [], pages = Math.max(1, Math.ceil(choices.length / 7));
      this.page = Math.min(this.page, pages - 1);
      const controls = choices.slice(this.page * 7, this.page * 7 + 7).map((choice, index) => {
        const control = this.button(`choice:${choice.id}`, `${row?.value === choice.id ? "> " : ""}${this.fit(choice.label, 466, 2.6)}`, index, () => {
          if (this.monsterField.kind === "class") options.model.selectMonster(this.monsterField.classname, choice.id);
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
      const controls = rows.slice(this.rosterPage * 7, this.rosterPage * 7 + 7).map((row, index) => {
        const label = row.choices.find(choice => choice.id === row.value)?.label ?? row.value;
        return this.button(`monster:${row.classname ?? "default"}`, this.fit(`${row.label}: ${label}`, 486, 2.6), index, () => {
          this.monsterField = { kind: "class", classname: row.classname }; this.page = 0; this.controller.openMenu(selectMenu);
        }, true);
      });
      if (pages > 1) controls.push(this.button("previous", "Previous page", 7, () => { this.rosterPage = (this.rosterPage + pages - 1) % pages; }, true),
        this.button("next", "Next page", 8, () => { this.rosterPage = (this.rosterPage + 1) % pages; }, true));
      return [...controls, this.back()];
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
    return selected.kind === "class" ? this.options.model.monsterRosterRows().find(row => row.classname === selected.classname)
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
      : active === optionsMenu ? "Options" : active === displayMenu ? "Display" : active === soundMenu ? "Sound" : active === controlsMenu ? "Controls" : "Load Game";
    text(title, 64, 44, active === main ? 6 : 4, true, true);

    if (active === rosterMenu) text("Counts: this map. Choices apply across this campaign.", 64, 82, 1.5);
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
  close(): void { this.controller.closeAll(); for (const dispose of this.disposers) dispose(); this.text.clear(); }
}
