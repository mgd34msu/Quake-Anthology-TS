import type { LlmSettingsUi } from "../../ui/settings/llm.ts";
import { readSdlClipboard } from "../../platform/sdl.ts";
import { registerSavedGameMenus, type SavedGameMenuService } from "../../ui/saves/menu.ts";
import { hudSkinFont } from "../../ui/common/skin.ts";
import { registerGyroSettingsMenu } from "../../ui/settings/gyro.ts";
import { registerServerSettingsMenu } from "../../ui/settings/server.ts";
import type { HostServerSettingsUi } from "../../ui/settings/server.ts";
import type { CommonHudData } from "../../ui/hud/index.ts";
import { ApplicationWeaponHudAssets } from "./weapon-hud.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { ResourceId } from "../../contracts/content.ts";
import type { Rect, RenderCommand, SceneCamera } from "../../contracts/render.ts";
import type { SeatInputEvent, SeatInputFocus, UiControl, UiDrawContext } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import type { SeatInputSample } from "../../input/seat.ts";
import { NativeUiController, menuRow, renderUiCommands } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { SeatHudMessages, SeatWeaponWheel, hudVitalOccupiedRects, drawCommonHud, emptyHudData } from "../../ui/hud/index.ts";
import { SeatUiPreferences, bindInputSettings, bindAudioSettings, registerSettingsMenus } from "../../ui/settings/index.ts";
import { registerBindingMenus } from "../../ui/settings/bindings.ts";
import { sharedBindingActions } from "../../ui/settings/action-catalog.ts";
import { bindNativeVideoSettings } from "../../ui/settings/services.ts";
import type { SettingBinding, SettingsMenus } from "../../ui/settings/index.ts";
import { UiTextRenderer } from "../../text/ui.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { ApplicationInput, ApplicationInputUi, LocalInput } from "./input.ts";
import type { SimulationPresentationAccess, SimulationPresentationEvent } from "./simulation/types.ts";

import type { MenuTypography } from "./menu-font.ts";
import { menuPanel, menuSkin, menuTitleFont } from "../../ui/common/menu-theme.ts";
import { layoutText } from "../../text/layout.ts";
import { SeatGamePrompt, gamePromptMenu } from "./game-prompt.ts";
import { Q2MatchUi } from "./q2-match-ui.ts";
import { bindImageSettings, bindModelSettings } from "../../ui/settings/images.ts";

import { SeatPlayerDeath, playerDeathMenu } from "./player-death.ts";

export class ApplicationSeatUi implements ApplicationInputUi {
  readonly controller: NativeUiController;
  private manualPause = false;
  get pauseMenuOpen(): boolean { return this.manualPause || this.death.active && this.controller.activeMenu !== playerDeathMenu; }
  private readonly death: SeatPlayerDeath;
  private readonly saves: ReturnType<typeof registerSavedGameMenus>;
  readonly preferences: SeatUiPreferences;
  readonly messages: SeatHudMessages;
  readonly weaponWheel: SeatWeaponWheel;
  readonly text: UiTextRenderer;
  private readonly menuText: UiTextRenderer;
  private readonly match: Q2MatchUi;
  private readonly prompt: SeatGamePrompt;
  private readonly settings: SettingsMenus;
  private readonly gyroSettings: SettingsMenus;
  private readonly serverSettings: SettingsMenus | null;
  private readonly bindings: ReturnType<typeof registerBindingMenus>;
  private readonly disposeInput: () => void;
  private readonly disposeMenu: () => void;
  private readonly now: () => number;
  private readonly measureHudText: (text: string, scale: number) => number;
  private readonly wheelIcons = new Map<ItemId, ResourceId>();
  private weaponAssets: ApplicationWeaponHudAssets | null = null;
  private weaponIcons: { readonly weapon: ResourceId | null; readonly ammo: ResourceId | null } = { weapon: null, ammo: null };
  private font: TextFontSelection;
  private typography: MenuTypography;

  refreshImages(font: TextFontSelection, typography: MenuTypography): void {
    this.font = font; this.typography = typography;
    this.text.bind(this.art.skin.font, font);
    this.menuText.bind(this.art.skin.font, typography.body); this.menuText.bind(menuTitleFont, typography.title);
  }

  prepareImageRefresh(providers: Pick<ApplicationAssets, "provider">): Promise<() => void> {
    return this.weaponAssets?.prepareImageRefresh(providers) ?? Promise.resolve(() => undefined);
  }

  async prepare(assets: ApplicationAssets): Promise<void> {
    this.death.observe(this.simulation.playerUi(this.local.player.actor).health);
    if (this.death.active) this.weaponWheel.close(false);
    await this.prompt.prepare(assets, () => this.local.input.focus);
    this.weaponAssets ??= new ApplicationWeaponHudAssets(assets);
    const ui = this.simulation.playerUi(this.local.player.actor), assetsOwner = this.weaponAssets;
    this.weaponIcons = await assetsOwner.prepare(ui.weaponStatus);
    if (ui.weaponStatus !== null) {
      const status = ui.weaponStatus;
      await Promise.all(ui.items.filter(item => item.kind === "weapon").map(async item => {
        const icons = await assetsOwner.prepare({ ...status, item: item.id });
        if (icons.weapon !== null) this.wheelIcons.set(item.id, icons.weapon);
      }));
    }
  }

  constructor(readonly local: LocalInput, readonly art: NativeUiArt, input: ApplicationInput,
    private readonly simulation: Pick<SimulationPresentationAccess, "playerUi">, font: TextFontSelection, audio: ApplicationAudio, quit: () => undefined,
    command: (name: string, args: readonly string[]) => undefined, typography: MenuTypography, hostSettings?: HostServerSettingsUi, language?: SettingBinding, saves?: SavedGameMenuService, viewSetting?: SettingBinding, llm?: LlmSettingsUi) {
    const seat = local.player.seat.id;
    this.font = font; this.typography = typography;
    this.now = input.now;
    this.measureHudText = (text, scale) => layoutText({ text, font: this.font, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width;
    this.preferences = new SeatUiPreferences(seat);
    this.messages = new SeatHudMessages(seat);
    this.text = new UiTextRenderer(seat);
    this.text.bind(art.skin.font, font);
    this.menuText = new UiTextRenderer(seat);
    this.menuText.bind(art.skin.font, typography.body);
    this.menuText.bind(menuTitleFont, typography.title);
    this.controller = new NativeUiController({ seat, skin: () => this.controller.activeMenu === gamePromptMenu ? { ...menuSkin(art.skin.font), titleFont: art.skin.font, titleScale: 2.6 } : menuSkin(art.skin.font),
      measureText: (text, scale) => layoutText({ text, font: this.typography.body, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width, now: input.now,
      bindings: () => local.input.bindings, appearance: () => this.preferences.values,
      focus: (focus, time) => { local.input.setFocus(focus, time); local.haptics.setActive(local.input.focused && focus.kind === "game"); input.router.updateCapture(); },
      clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); },
      sound: (sound, owner) => audio.uiSound(sound, owner),
      executeScript: script => { throw new Error(`Legacy UI module ${script.module} is not attached to this native menu`); } });
    this.prompt = new SeatGamePrompt(seat, () => local.player.actor, this.controller, value => local.input.setImpulse(value));
    this.match = new Q2MatchUi(local.player.actor, this.controller, command, text => local.console.print(text));
    this.weaponWheel = new SeatWeaponWheel({ seat, now: input.now,
      items: mode => simulation.playerUi(local.player.actor).items.filter(item => item.kind === (mode === "weapons" ? "weapon" : "powerup"))
        .map(item => ({ ...item, sortOrder: item.sourceOrdinal, icon: this.wheelIcons.get(item.id) ?? null, selectedIcon: this.wheelIcons.get(item.id) ?? null })),
      activeItem: () => simulation.playerUi(local.player.actor).activeWeapon,
      select: id => { command("use", [id]); }, changed: owner => audio.uiSound("move", owner) });
    this.bindings = registerBindingMenus(this.controller, local.input,
      () => sharedBindingActions(local.builder.dialect, simulation.playerUi(local.player.actor).items, input.bindingCapabilities));
    const bindingMenu: SettingBinding = { id: "ui:input:bindings", label: "Key and controller bindings", kind: "button", category: "input", enabled: () => true,
      activate: () => { this.controller.openMenu(this.bindings.root); } };
    const volumes = bindAudioSettings({ read: () => ({ effectsVolume: audio.effectsVolume, musicVolume: audio.musicVolume }),
      write: values => { if (values.effectsVolume !== undefined) audio.effectsVolume = values.effectsVolume;
        if (values.musicVolume !== undefined) audio.musicVolume = values.musicVolume; } },
      { selected: () => audio.selectedOutput, devices: () => audio.outputDeviceNames(), select: name => audio.selectOutput(name),
        report: text => local.console.print(`${text}\n`) });
    const display = bindNativeVideoSettings(input.window, input.sharedCvars, message => local.console.print(`${message}\n`));
    const images = input.sharedCvars === null ? [] : [...bindImageSettings(input.sharedCvars), ...bindModelSettings(input.sharedCvars)];
    this.serverSettings = hostSettings === undefined ? null : registerServerSettingsMenu(this.controller, hostSettings);
    const serverMenu: SettingBinding[] = this.serverSettings === null ? [] : [{ id: "ui:network:server-settings", label: "Server settings", kind: "button", category: "network",
      enabled: () => (hostSettings?.bindings().length ?? 0) > 0, activate: () => { if (this.serverSettings !== null) this.controller.openMenu(this.serverSettings.root); } }];
    const gyro = this.gyroSettings = registerGyroSettingsMenu(this.controller, input.controllerSettings.ui(local.input.seat));
    this.settings = registerSettingsMenus(this.controller, [...display, ...(viewSetting === undefined ? [] : [viewSetting]), ...images, ...(language === undefined ? [] : [language]), bindingMenu, { id: "ui:settings:gyro", label: "Gyro controls", kind: "button", category: "input", enabled: () => true, activate: () => { this.controller.openMenu(gyro.root); } }, ...serverMenu, ...bindInputSettings(local.input, local.builder, { read: () => ({ controllerVibration: local.haptics.enabled, controllerVibrationStrength: local.haptics.strength }),
      write: values => { if (values.controllerVibrationStrength !== undefined) local.haptics.setStrength(values.controllerVibrationStrength); if (values.controllerVibration !== undefined) local.haptics.setEnabled(values.controllerVibration); } }), ...volumes, ...this.preferences.bindings()], llm);
    const button = (id: string, label: string, row: number, activate: () => undefined): UiControl => ({ id: `ui:application:${id}`, kind: "button", label,
      rect: menuRow(row), enabled: true, visible: true, activate });
    this.saves = registerSavedGameMenus(this.controller, saves);
    this.death = new SeatPlayerDeath(this.controller, saves, this.saves.load, quit);
    this.disposeMenu = this.controller.register("menu:application:game", () => ({ id: "menu:application:game", title: "Paused", fullScreen: true,
      controls: [button("resume", "Resume game", 1, () => { this.controller.closeAll(); return undefined; }),
        button("save", "Save game", 2, () => this.controller.openMenu(this.saves.save)),
        button("load", "Load game", 3, () => this.controller.openMenu(this.saves.load)),
        button("settings", "Options", 4, () => this.controller.openMenu(this.settings.root)),
        button("console", "Console", 5, () => { this.controller.closeAll(); local.console.toggle(); return undefined; }),
        button("quit", "End game", 8, quit)], open: () => { this.manualPause = true; return undefined; }, close: () => { this.manualPause = false; return undefined; } }));
    this.disposeInput = input.attachUi(seat, this);
  }

  input(event: SeatInputEvent, focus: SeatInputFocus): boolean {
    if (this.death.input(event)) return true;
    if (focus.kind === "console" || focus.kind === "chat") return false;
    if (this.prompt.input(event)) return true;
    if (this.controller.activeMenu === gamePromptMenu && (event.kind === "key" && event.code === KeyCode.Escape && event.down && !event.repeat
      || event.kind === "controller-button" && (event.button === 1 || event.button === 6) && event.down
      || event.kind === "mouse-button" && event.button === 3 && event.down)) { this.controller.openMenu("menu:application:game"); return true; }
    if (this.controller.activeMenu !== null) return this.controller.input(event);
    const menu = event.kind === "key" && event.code === KeyCode.Escape && event.down && !event.repeat
      || event.kind === "controller-button" && event.button === 6 && event.down;
    if (menu) { this.weaponWheel.close(false); this.controller.openMenu("menu:application:game"); return true; }
    return this.weaponWheel.input(event);
  }

  sample(input: SeatInputSample): SeatInputSample {
    this.weaponWheel.update(input.nowMilliseconds);
    const wheel = this.weaponWheel.command(input.buttons.some(button => button.action === "attack" && (button.active || button.pressed)), input.nowMilliseconds);
    if (!wheel.holster && !wheel.consumeAttack && input.nowMilliseconds >= this.weaponWheel.weaponLockUntil) return input;
    return { ...input, buttons: input.buttons.map(button => button.action === "attack" ? { ...button, active: false, pressed: false, fraction: 0 } : button) };
  }

  wheel(mode: "weapons" | "powerups", down: boolean): void { if (down) this.weaponWheel.open(mode); else this.weaponWheel.close(true); }
  closeMenus(): void { this.weaponWheel.close(false); this.controller.closeAll(); }

  clearPrompt(): void { this.prompt.clear(); }

  receive(events: readonly SimulationPresentationEvent[]): void {
    this.prompt.receive(events);
    for (const source of events) {
      if (source.kind === "q2-player" && source.event.kind === "userinfo") this.match.name(source.event.actor, source.event.name);
      if (source.kind === "q2-composition" && (source.event.kind === "ctf" || source.event.kind === "lmctf")) this.match.receive(source.event);
      const duration = { kind: "seconds", value: 3 } satisfies { readonly kind: "seconds"; readonly value: number };
      const starts = { kind: "seconds", value: source.seconds } satisfies { readonly kind: "seconds"; readonly value: number };
      if (source.kind === "q1" && source.event.kind === "message" && source.event.player.equals(this.local.player.actor)) {
        if (source.event.center) this.messages.centerPrint(this.local.player.seat.id, source.event.text, starts, duration);
        else this.messages.notify(this.local.player.seat.id, source.event.text, false, starts, duration);
      } else if (source.kind === "q2" && source.event.kind === "centerprint" && source.event.actor.equals(this.local.player.actor))
        this.messages.centerPrint(this.local.player.seat.id, source.event.text, starts, duration);
      else if (source.kind === "q3-source" && source.event.kind === "server-command"
        && (source.event.client < 0 || source.event.client === this.local.player.seat.client.id.slot)) {
        const [command, text] = tokenizeCommand(source.event.text, "q3").argv;
        if (text === undefined) continue;
        if (command === "cp") this.messages.centerPrint(this.local.player.seat.id, text, starts, duration);
        else if (command === "chat" || command === "tchat") this.messages.notify(this.local.player.seat.id, text, true, starts, duration);
      } else if (source.kind === "q2-player" && source.event.kind === "print" && source.event.level === "chat"
        && (source.event.target === null || source.event.target.equals(this.local.player.actor)))
        this.messages.notify(this.local.player.seat.id, source.event.text, true, starts, duration);
      else if (source.kind === "q2" && source.event.kind === "print" && source.event.level === "chat"
        && (source.event.actor === null || source.event.actor.equals(this.local.player.actor))) {
        this.messages.notify(this.local.player.seat.id, source.event.text, true, starts, duration);
      }
    }
  }

  weaponOcclusion(context: UiDrawContext, gameVisible: boolean): readonly Rect[] {
    if (!gameVisible || this.local.input.focus.kind !== "game") return [];
    const player = this.simulation.playerUi(this.local.player.actor);
    return hudVitalOccupiedRects(context, player.weaponStatus === null ? 2 : 3, this.preferences.values.hudScale, this.art.skin.fontScale * this.preferences.values.textScale, hudSkinFont(this.art.skin, this.font).capInk?.height);
  }

  draw(context: UiDrawContext, camera: SceneCamera, emit: (command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>) => void,
    material: (draw: MaterialTextDraw) => void, gameVisible = true, crosshairVisible = true, nativeStatus = false, showAggregateWarning = true): void {
    const player = this.simulation.playerUi(this.local.player.actor);
    const armor = player.armor.kind === "none" ? 0 : player.armor.points;
    const base = emptyHudData(this.local.player.seat.id);
    const hud: CommonHudData = { ...base, prompts: this.match.prompts, ...this.weaponWheel.drawState(), visible: gameVisible && this.local.input.focus.kind === "game",
      crosshair: { ...base.crosshair, visible: crosshairVisible && !nativeStatus },
      ...(player.weaponStatus === null ? {} : { weapon: { status: player.weaponStatus, warning: showAggregateWarning ? player.arsenalWarning : "none",
        weaponIcon: this.weaponIcons.weapon, ammoIcon: this.weaponIcons.ammo,
        iconAspect: this.weaponAssets?.aspect(this.weaponIcons.weapon ?? this.weaponIcons.ammo) ?? 1, ammoAspect: this.weaponAssets?.aspect(this.weaponIcons.ammo) ?? 1,
        measureText: this.measureHudText, nativeStatus } }),
      vitals: nativeStatus ? [] : [{ label: "Health", value: player.health, icon: null, warning: player.health <= 25 }, { label: "Armor", value: armor, icon: null, warning: false }] };
    const commands = [...drawCommonHud(context, hud, { skin: hudSkinFont(this.art.skin, this.font), measureText: this.measureHudText, preferences: this.preferences.values, messages: this.messages, camera, localize: text => text }),
      ];
    renderUiCommands(context, commands, { text: this.text, white: this.art.white, picture: resource => this.weaponAssets?.picture(resource) ?? this.art.picture(resource), emit, material });
    const panel = menuPanel(context);
    const backdrop = this.controller.activeMenu === playerDeathMenu && panel.kind === "fill" ? { ...panel, color: { ...panel.color, w: 0.45 } } : panel;
    renderUiCommands(context, this.controller.activeMenu === null ? [] : [backdrop, ...this.controller.draw({ ...context, timeMilliseconds: this.now() })],
      { text: this.menuText, white: this.art.white, picture: resource => this.art.picture(resource), emit, material });
  }

  close(): void { this.death.close(); this.prompt.close(); this.match.close(); this.disposeInput(); this.controller.closeAll(); this.disposeMenu(); this.saves.dispose(); this.settings.dispose(); this.gyroSettings.dispose(); this.serverSettings?.dispose(); this.bindings.dispose(); this.text.clear(); this.menuText.clear(); this.messages.clear(); }
}
