import { registerRankingAccountMenu } from "../../ui/settings/ranking-account.ts";
import type { RankingAccountActions } from "../../ui/settings/rankings.ts";
import { readSeatLanguage } from "../../ui/settings/language.ts";
import { ApplicationQ2NativeHud } from "./q2-native-hud.ts";
import type { NativeQ2HudFrame, NativeQ2HudArsenal } from "../../ui/hud/q2-native.ts";
import { registerInventoryMenu } from "../../ui/library/inventory.ts";
import { SeatSoundCaptions } from "./sound-captions.ts";
import { BaseArenaMenus, type BaseArenaMenuService } from "./base-arena-menu.ts";
import { bindGameplaySettings, resetGameplaySettings, type GameplaySettingsSource } from "../../ui/settings/gameplay.ts";
import { SeatSourceHud } from "./seat-hud-state.ts";
import { ApplicationQ1Wheel } from "./q1-wheel.ts";
import { captionCommands as mediaCaptionCommands } from "../../ui/common/captions.ts";
import type { ActiveCaption } from "../../text/captions.ts";
import { registerMatchMenu } from "../../ui/library/match.ts";
import { bindConsoleSettings } from "../../ui/settings/console.ts";
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
import type { ContentId, ResourceId } from "../../contracts/content.ts";
import type { Rect, RenderCommand, SceneCamera } from "../../contracts/render.ts";
import type { SeatInputEvent, SeatInputFocus, UiControl, UiDrawContext } from "../../contracts/ui.ts";
import { KeyCode } from "../../input/key-codes.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import type { SeatInputSample } from "../../input/seat.ts";
import { NativeUiController, menuRow, renderUiCommands } from "../../ui/common/index.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import { SeatHudMessages, SeatWeaponWheel, hudVitalOccupiedRects, drawCommonHud, emptyHudData } from "../../ui/hud/index.ts";
import { SeatUiPreferences, bindInputSettings, bindInputRoutingSettings, bindAudioSettings, bindAudioGeometrySettings, bindMusicPlaylistSettings, registerSettingsMenus } from "../../ui/settings/index.ts";
import { registerBindingMenus } from "../../ui/settings/bindings.ts";
import { sharedBindingActions } from "../../ui/settings/action-catalog.ts";
import { bindNativeVideoSettings, bindRendererSettings } from "../../ui/settings/services.ts";
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

import { TeamArenaResults, type TeamArenaResultService } from "./team-arena-results.ts";
import { SeatPlayerDeath, playerDeathMenu } from "./player-death.ts";

export class ApplicationSeatUi implements ApplicationInputUi {
  readonly controller: NativeUiController;
  private manualPause = false;
  get pauseMenuOpen(): boolean { return this.manualPause || this.teamArena?.active === true || this.death.active && this.controller.activeMenu !== playerDeathMenu; }
  private readonly death: SeatPlayerDeath;
  private readonly nativeQ2Hud = new ApplicationQ2NativeHud();
  private readonly inventoryMenu: ReturnType<typeof registerInventoryMenu>;
  private readonly matchMenu: ReturnType<typeof registerMatchMenu> | null;
  private readonly baseArena: BaseArenaMenus | null;
  private readonly soundCaptions: SeatSoundCaptions;
  private readonly sourceHud: SeatSourceHud;
  private readonly authoredWheel = new ApplicationQ1Wheel();
  private readonly teamArena: TeamArenaResults | null;
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
  private readonly rankingMenu: ReturnType<typeof registerRankingAccountMenu> | null;
  private readonly takeRankingMenuRequest: () => boolean;
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

  private get hudFont(): TextFontSelection { return this.preferences.values.typeface === "bold" ? this.typography.title : this.font; }
  private get menuFont(): TextFontSelection { return this.preferences.values.typeface === "bold" ? this.typography.title : this.typography.body; }

  refreshImages(font: TextFontSelection, typography: MenuTypography): void {
    this.font = font; this.typography = typography;
    this.text.bind(this.art.skin.font, font);
    this.menuText.bind(this.art.skin.font, typography.body); this.menuText.bind(menuTitleFont, typography.title);
  }

  async prepareImageRefresh(providers: Pick<ApplicationAssets, "provider">): Promise<() => void> {
    const commit = await (this.weaponAssets?.prepareImageRefresh(providers) ?? Promise.resolve(() => undefined));
    return () => { commit(); this.nativeQ2Hud.clear(); };
  }

  async prepare(assets: ApplicationAssets): Promise<void> {
    if (this.guestUi) {
      this.weaponAssets ??= new ApplicationWeaponHudAssets(assets);
      this.weaponIcons = await this.weaponAssets.prepare(this.simulation.playerUi(this.local.player.actor).weaponStatus);
      return;
    }
    if (this.takeRankingMenuRequest() && this.rankingMenu !== null) this.controller.openMenu(this.rankingMenu.root);
    this.teamArena?.update();
    this.baseArena?.update();
    if (this.teamArena === null) this.death.observe(this.simulation.playerUi(this.local.player.actor).health);
    if (this.death.active) this.weaponWheel.close(false);
    await this.prompt.prepare(assets, () => this.local.input.focus);
    this.weaponAssets ??= new ApplicationWeaponHudAssets(assets);
    const ui = this.simulation.playerUi(this.local.player.actor), assetsOwner = this.weaponAssets;
    this.weaponIcons = await assetsOwner.prepare(ui.weaponStatus);
    await this.authoredWheel.prepare(assets, assetsOwner, ui);
    await this.sourceHud.prepare(assetsOwner);
    for (const message of this.sourceHud.drainObjectivePrints()) this.messages.centerPrint(this.local.player.seat.id, message.text,
      { kind: "seconds", value: message.seconds }, { kind: "seconds", value: 5 }, false, 40);
    await this.soundCaptions.prepare(assets.content);
    if (ui.weaponStatus !== null) {
      const status = ui.weaponStatus;
      await Promise.all(ui.items.filter(item => item.kind === "weapon").map(async item => {
        const icons = await assetsOwner.prepare({ ...status, item: item.id });
        if (icons.weapon !== null) this.wheelIcons.set(item.id, icons.weapon);
      }));
    }
  }

  constructor(readonly local: LocalInput, readonly art: NativeUiArt, input: ApplicationInput, mutateWindow: (operation: () => void) => void,
    private readonly simulation: Pick<SimulationPresentationAccess, "playerUi">, font: TextFontSelection, audio: ApplicationAudio, quit: () => undefined,
    private readonly command: (name: string, args: readonly string[]) => undefined, typography: MenuTypography, hostSettings?: HostServerSettingsUi, language?: SettingBinding, saves?: SavedGameMenuService, viewSetting?: SettingBinding, llm?: LlmSettingsUi, private readonly guestUi = false, teamArena?: TeamArenaResultService, options?: { readonly baseArena?: BaseArenaMenuService; readonly gameplay?: GameplaySettingsSource; readonly lobby?: { readonly returnToLobby: () => void }; readonly rankings?: { readonly current: () => RankingAccountActions | null; readonly takeMenuRequest: () => boolean }; readonly localize?: (content: ContentId, text: string, args?: readonly string[]) => Promise<string> }) {
    const seat = local.player.seat.id;
    const readLanguage = (): string => { const shared = input.sharedSettings(); return shared === null ? "english" : readSeatLanguage(shared, seat.index); };
    this.font = font; this.typography = typography;
    this.now = input.now;
    this.measureHudText = (text, scale) => layoutText({ text, font: this.hudFont, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width;
    this.preferences = new SeatUiPreferences(seat, input.sharedSettings());
    this.messages = new SeatHudMessages(seat);
    this.text = new UiTextRenderer(seat);
    this.text.bind(art.skin.font, font);
    this.menuText = new UiTextRenderer(seat);
    this.menuText.bind(art.skin.font, typography.body);
    this.menuText.bind(menuTitleFont, typography.title);
    this.controller = new NativeUiController({ seat, skin: () => this.controller.activeMenu === gamePromptMenu ? { ...menuSkin(art.skin.font), titleFont: art.skin.font, titleScale: 2.6 } : menuSkin(art.skin.font),
      measureText: (text, scale) => layoutText({ text, font: this.menuFont, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width, now: input.now,
      bindings: () => local.input.bindings, appearance: () => this.preferences.values,
      focus: (focus, time) => { local.input.setFocus(focus, time); local.haptics.setActive(local.input.focused && focus.kind === "game"); input.router.updateCapture(); },
      clipboard: () => { const bytes = readSdlClipboard(); return bytes === null ? null : new TextDecoder().decode(bytes); },
      sound: (sound, owner) => audio.uiSound(sound, owner),
      executeScript: script => { throw new Error(`Legacy UI module ${script.module} is not attached to this native menu`); } });
    this.soundCaptions = new SeatSoundCaptions(seat, audio.engine, readLanguage);
    this.sourceHud = new SeatSourceHud(local.player.actor, options?.localize);
    this.inventoryMenu = registerInventoryMenu(this.controller, () => this.sourceHud.inventoryItems(), command);
    this.matchMenu = local.builder.dialect === "q3" ? registerMatchMenu(this.controller, command) : null;
    this.baseArena = options?.baseArena === undefined ? null : new BaseArenaMenus(this.controller, options.baseArena);
    this.teamArena = teamArena === undefined ? null : new TeamArenaResults(this.controller, teamArena);
    this.prompt = new SeatGamePrompt(seat, () => local.player.actor, this.controller, value => local.input.setImpulse(value), readLanguage);
    this.match = new Q2MatchUi(local.player.actor, this.controller, command, text => local.console.print(text));
    this.weaponWheel = new SeatWeaponWheel({ seat, now: input.now,
      items: mode => (mode === "weapons" && !this.guestUi ? this.authoredWheel.items(simulation.playerUi(local.player.actor)) : null) ?? (this.guestUi ? [] : simulation.playerUi(local.player.actor).items).filter(item => item.kind === (mode === "weapons" ? "weapon" : "powerup"))
        .map(item => ({ ...item, sortOrder: item.sourceOrdinal, icon: this.wheelIcons.get(item.id) ?? null, selectedIcon: this.wheelIcons.get(item.id) ?? null })),
      activeItem: () => this.guestUi ? null : simulation.playerUi(local.player.actor).activeWeapon,
      select: id => { command("use", [id]); }, changed: owner => audio.uiSound("move", owner) });
    this.bindings = registerBindingMenus(this.controller, local.input,
      () => sharedBindingActions(local.builder.dialect, this.guestUi ? [] : simulation.playerUi(local.player.actor).items, input.bindingCapabilities),
      { available: () => input.canResetBindings(seat), reset: () => input.resetBindings(seat) });
    const bindingMenu: SettingBinding = { id: "ui:input:bindings", label: "Key and controller bindings", kind: "button", category: "input", enabled: () => true,
      activate: () => { this.controller.openMenu(this.bindings.root); } };
    const volumes = bindAudioSettings({ read: () => ({ effectsVolume: audio.effectsVolume, musicVolume: audio.musicVolume }),
      write: values => { if (values.effectsVolume !== undefined) audio.effectsVolume = values.effectsVolume;
        if (values.musicVolume !== undefined) audio.musicVolume = values.musicVolume; } },
      { format: { read: () => audio.outputFormat, select: format => audio.selectOutputFormat(format) },
        selected: () => audio.selectedOutput, devices: () => audio.outputDeviceNames(), select: name => audio.selectOutput(name),
        report: text => local.console.print(`${text}\n`) });
    const shared = input.sharedSettings();
    const reportDisplay = (message: string): void => local.console.print(`${message}\n`);
    const display = [...bindRendererSettings({ current: () => input.window.backend, report: reportDisplay,
      ...(shared === null ? {} : { worker: { read: () => shared.variableValue("r_smp") !== 0, write: (value: boolean) => { shared.set("r_smp", value ? "1" : "0"); } } }),
      apply: backend => input.commands.append(`vid_restart ${backend}\n`, { session: seat.session,
        origin: { kind: "local-seat", seat, client: local.player.seat.client.id } }) }),
      ...bindNativeVideoSettings(() => input.window, shared, reportDisplay, mutateWindow)];
    const images = shared === null ? [] : [...bindImageSettings(shared), ...bindModelSettings(shared), ...bindConsoleSettings(shared)];
    this.rankingMenu = options?.rankings === undefined ? null : registerRankingAccountMenu(this.controller, options.rankings.current);
    this.takeRankingMenuRequest = options?.rankings?.takeMenuRequest ?? (() => false);
    const rankingSettings: SettingBinding[] = this.rankingMenu === null ? [] : [{ id: "ui:network:rankings", label: "Ranking account", kind: "button", category: "network",
      enabled: () => options?.rankings?.current() !== null, activate: () => { if (this.rankingMenu !== null) this.controller.openMenu(this.rankingMenu.root); } }];
    this.serverSettings = hostSettings === undefined ? null : registerServerSettingsMenu(this.controller, hostSettings);
    const serverMenu: SettingBinding[] = this.serverSettings === null ? [] : [{ id: "ui:network:server-settings", label: "Server settings", kind: "button", category: "network",
      enabled: () => (hostSettings?.bindings().length ?? 0) > 0, activate: () => { if (this.serverSettings !== null) this.controller.openMenu(this.serverSettings.root); } }];
    const gyro = this.gyroSettings = registerGyroSettingsMenu(this.controller, input.controllerSettings.ui(local.input.seat));
    this.settings = registerSettingsMenus(this.controller, [...display, ...(viewSetting === undefined ? [] : [viewSetting]), ...images, ...(language === undefined ? [] : [language]), bindingMenu, { id: "ui:settings:gyro", label: "Gyro controls", kind: "button", category: "input", enabled: () => true, activate: () => { this.controller.openMenu(gyro.root); } }, ...serverMenu, ...rankingSettings, ...input.inputDevices.bindings(), ...bindInputRoutingSettings(() => input.router, () => input.controllers.devices), ...([
      {id:"ui:input:local-join",label:"Add local player",kind:"button",category:"input",enabled:()=>input.locals.length<Math.min(4,input.localPlayerCapacity),activate:()=>{command("local_join",[]);}},
      {id:"ui:input:local-drop",label:"Remove this player",kind:"button",category:"input",enabled:()=>input.canRemoveLocalPlayer(seat),activate:()=>{command("local_drop",[String(seat.index+1)]);}},
    ] satisfies readonly SettingBinding[]), ...bindInputSettings(local.input, local.builder, { read: () => ({ controllerVibration: local.haptics.enabled, controllerVibrationStrength: local.haptics.strength }),
      write: values => { if (values.controllerVibrationStrength !== undefined) local.haptics.setStrength(values.controllerVibrationStrength); if (values.controllerVibration !== undefined) local.haptics.setEnabled(values.controllerVibration); } }), ...volumes, ...bindAudioGeometrySettings(shared), ...bindMusicPlaylistSettings(shared), ...this.preferences.bindings(), ...(options?.gameplay === undefined ? [] : bindGameplaySettings(options.gameplay))], llm, options?.gameplay === undefined ? undefined : { label: "Reset player preferences...", apply: () => { if (options.gameplay !== undefined) resetGameplaySettings(options.gameplay); } });
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
        ...(this.baseArena === null ? [] : [button("progress", "Arena progress", 6, () => this.controller.openMenu("menu:application:arena-progress"))]),
        ...(this.matchMenu === null ? [] : [button("match", "Match controls", 7, () => this.controller.openMenu("menu:application:match"))]),
        ...(options?.lobby === undefined ? [] : [button("lobby", "Return to lobby", 8, () => { options.lobby?.returnToLobby(); return undefined; })]),
        button("quit", "End game", options?.lobby === undefined ? 8 : 9, quit)], open: () => { this.manualPause = true; return undefined; }, close: () => { this.manualPause = false; return undefined; } }));
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
    this.sourceHud.scores(input.buttons.some(button => button.action === "scores" && button.active));
    const wheel = this.weaponWheel.command(input.buttons.some(button => button.action === "attack" && (button.active || button.pressed)), input.nowMilliseconds);
    if (!wheel.holster && !wheel.consumeAttack && input.nowMilliseconds >= this.weaponWheel.weaponLockUntil) return input;
    return { ...input, buttons: input.buttons.map(button => button.action === "attack" ? { ...button, active: false, pressed: false, fraction: 0 } : button) };
  }

  wheel(mode: "weapons" | "powerups", down: boolean): void { if (down) this.weaponWheel.open(mode); else this.weaponWheel.close(true); }
  switchWeapon(first: number, second: number): boolean {
    if (this.guestUi) return false;
    const player = this.simulation.playerUi(this.local.player.actor);
    if (!player.activeWeapon?.startsWith("q1:")) return false;
    const selected = this.authoredWheel.switchWeapon(player, first, second);
    if (selected !== null) this.command("use", [selected]);
    return true;
  }
  cycleWeapon(direction: -1 | 1): boolean {
    if (this.guestUi || this.local.builder.dialect !== "q2-rerelease") return false;
    this.weaponWheel.cycle(direction); return true;
  }
  closeMenus(): void { this.weaponWheel.close(false); this.controller.closeAll(); }

  clearPrompt(): void { this.prompt.clear(); }

  centerPrint(text: string, timeMilliseconds: number, durationMilliseconds: number): void {
    this.messages.centerPrint(this.local.player.seat.id, text, { kind: "milliseconds", value: timeMilliseconds }, { kind: "milliseconds", value: durationMilliseconds });
  }
  receive(events: readonly SimulationPresentationEvent[]): void {
    this.prompt.receive(events);
    for (const source of events) {
      this.sourceHud.receive(source);
      if (source.kind === "q2-player" && source.event.kind === "inventory" && source.event.actor.equals(this.local.player.actor)) {
        if (source.event.visible === true && this.controller.activeMenu !== this.inventoryMenu.root) this.controller.openMenu(this.inventoryMenu.root);
        else if (source.event.visible === false && this.controller.activeMenu === this.inventoryMenu.root) this.controller.closeMenu();
      }
      if (source.kind === "q2-player" && source.event.kind === "userinfo") this.match.name(source.event.actor, source.event.name);
      if (source.kind === "q2-composition" && (source.event.kind === "ctf" || source.event.kind === "lmctf")) this.match.receive(source.event);
      const duration = { kind: "seconds", value: 3 } satisfies { readonly kind: "seconds"; readonly value: number };
      const starts = { kind: "seconds", value: source.seconds } satisfies { readonly kind: "seconds"; readonly value: number };
      if (source.kind === "q1" && source.event.kind === "message" && source.event.player.equals(this.local.player.actor)) {
        if (source.event.center) this.messages.centerPrint(this.local.player.seat.id, source.event.text, starts, duration);
        else this.messages.notify(this.local.player.seat.id, source.event.text, false, starts, duration);
      } else if (source.kind === "q2" && source.event.kind === "centerprint" && source.event.actor.equals(this.local.player.actor))
        this.messages.centerPrint(this.local.player.seat.id, source.event.text, starts, { kind: "seconds", value: source.event.durationSeconds ?? 5 }, source.event.instant ?? true, 40);
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
    if (this.guestUi || !gameVisible || this.local.input.focus.kind !== "game") return [];
    const player = this.simulation.playerUi(this.local.player.actor);
    return hudVitalOccupiedRects(context, player.weaponStatus === null ? 2 : 3, this.preferences.values.hudScale, this.art.skin.fontScale * this.preferences.values.textScale, hudSkinFont(this.art.skin, this.hudFont).capInk?.height);
  }

  draw(context: UiDrawContext, camera: SceneCamera, emit: (command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>) => void,
    material: (draw: MaterialTextDraw) => void, gameVisible = true, crosshairVisible = true, nativeStatus = false, showAggregateWarning = true, nativeCrosshair = nativeStatus,
    sourceStatus?: { readonly kind: "vitals"; readonly health: number; readonly armor: number } | { readonly kind: "native" }): void {
    const sourceVitals = sourceStatus?.kind === "vitals" ? sourceStatus : undefined;
    this.text.bind(this.art.skin.font, this.hudFont); this.menuText.bind(this.art.skin.font, this.menuFont);
    if (this.guestUi && sourceStatus?.kind !== "native" && gameVisible && this.local.input.focus.kind === "game") {
      const status = this.simulation.playerUi(this.local.player.actor).weaponStatus;
      if (status !== null) {
        const base = emptyHudData(this.local.player.seat.id);
        const hud: CommonHudData = { ...base, visible: true, crosshair: { ...base.crosshair, visible: false },
          weapon: { status, warning: "none", weaponIcon: this.weaponIcons.weapon, ammoIcon: this.weaponIcons.ammo,
            iconAspect: this.weaponAssets?.aspect(this.weaponIcons.weapon ?? this.weaponIcons.ammo) ?? 1,
            measureText: this.measureHudText, nativeStatus: true } };
        renderUiCommands(context, drawCommonHud(context, hud, { skin: hudSkinFont(this.art.skin, this.hudFont), measureText: this.measureHudText,
          preferences: this.preferences.values, messages: this.messages, camera, localize: text => text }),
          { text: this.text, white: this.art.white, picture: resource => this.weaponAssets?.picture(resource) ?? this.art.picture(resource), emit, material });
      }
    }
    if (!this.guestUi || sourceVitals !== undefined) {
      const player = this.simulation.playerUi(this.local.player.actor);
      this.messages.setSourcePoints(this.local.player.seat.id, this.sourceHud.points());
      const sourceHud = this.sourceHud.presentation(context.timeMilliseconds);
      const armor = player.armor.regular.kind === "none" ? 0 : player.armor.regular.points;
      const base = emptyHudData(this.local.player.seat.id);
      const hud: CommonHudData = { ...base, ...sourceHud, captions: this.soundCaptions.active({ subtitles: true, soundCaptions: this.preferences.values.captions, speakers: true }), powerups: player.powerups, prompts: [...this.match.prompts, ...sourceHud.prompts,
        ...(player.armor.powered.kind !== "none" ? [{ action: `Power ${player.armor.powered.kind} ${player.armor.powered.cells}`, binding: "", icon: null }] : [])], ...this.weaponWheel.drawState(), visible: gameVisible && this.local.input.focus.kind === "game",
        crosshair: { ...base.crosshair, visible: crosshairVisible && !nativeCrosshair },
        ...(player.weaponStatus === null || sourceStatus?.kind === "native" || this.guestUi || nativeStatus && player.selectedArsenal === true ? {} : { weapon: { status: player.weaponStatus, warning: showAggregateWarning ? player.arsenalWarning : "none",
          weaponIcon: this.weaponIcons.weapon, ammoIcon: this.weaponIcons.ammo,
          iconAspect: this.weaponAssets?.aspect(this.weaponIcons.weapon ?? this.weaponIcons.ammo) ?? 1, ammoAspect: this.weaponAssets?.aspect(this.weaponIcons.ammo) ?? 1,
          measureText: this.measureHudText, nativeStatus } }),
        vitals: nativeStatus && sourceVitals === undefined ? [] : [{ label: "Health", value: sourceVitals?.health ?? player.health, icon: null, warning: (sourceVitals?.health ?? player.health) <= 25 }, { label: "Armor", value: sourceVitals?.armor ?? armor, icon: null, warning: false }] };
      const commands = [...drawCommonHud(context, hud, { skin: hudSkinFont(this.art.skin, this.hudFont), measureText: this.measureHudText, preferences: this.preferences.values, messages: this.messages, camera, localize: text => text }),
        ];
      renderUiCommands(context, commands, { text: this.text, white: this.art.white, picture: resource => this.weaponAssets?.picture(resource) ?? this.art.picture(resource), emit, material });
    }
    const panel = menuPanel(context);
    const backdrop = this.controller.activeMenu === playerDeathMenu && panel.kind === "fill" ? { ...panel, color: { ...panel.color, w: 0.45 } } : panel;
    renderUiCommands(context, this.controller.activeMenu === null ? [] : [backdrop, ...this.controller.draw({ ...context, timeMilliseconds: this.now() })],
      { text: this.menuText, white: this.art.white, picture: resource => this.art.picture(resource), emit, material });
  }

  private nativeQ2Arsenal(): NativeQ2HudArsenal | undefined {
    const ui = this.simulation.playerUi(this.local.player.actor);
    if (ui.selectedArsenal !== true) return undefined;
    const icon = this.weaponIcons.ammo;
    return { ammo: ui.ammo?.count ?? null,
      ammoIcon: icon === null ? null : { resource: icon, aspect: this.weaponAssets?.aspect(icon) ?? 1 } };
  }

  prepareNativeQ2Hud(frame: NativeQ2HudFrame, content: ContentId, assets: ApplicationAssets, context: UiDrawContext,
    component?: { readonly renderer: ApplicationQ2NativeHud; readonly mode: "layout-overlay" | "replace-status"; assertCurrent(): void }): Promise<void> {
    return (component?.renderer ?? this.nativeQ2Hud).prepare(content, assets, frame, context, this.preferences.values.hudScale * context.binding.hudScale,
      component?.mode, component?.assertCurrent, component === undefined ? this.nativeQ2Arsenal() : undefined);
  }
  drawNativeQ2Hud(frame: NativeQ2HudFrame, context: UiDrawContext, emit: (command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>) => void,
    material: (draw: MaterialTextDraw) => void, binding?: (command: string) => string,
    component?: { readonly renderer: ApplicationQ2NativeHud; readonly mode: "layout-overlay" | "replace-status" }): void {
    const renderer = component?.renderer ?? this.nativeQ2Hud;
    renderUiCommands(context, renderer.commands(frame, context, this.preferences.values.hudScale * context.binding.hudScale, binding, component?.mode,
      component === undefined ? this.nativeQ2Arsenal() : undefined),
      { text: this.text, white: this.art.white, picture: resource => renderer.picture(resource) ?? this.weaponAssets?.picture(resource) ?? this.art.picture(resource), emit, material });
  }

  captionCommands(captions: readonly ActiveCaption[], context: UiDrawContext): readonly Exclude<RenderCommand, { readonly kind: "swap-buffers" }>[] {
    if (!this.preferences.values.captions) return [];
    const commands: Exclude<RenderCommand, { readonly kind: "swap-buffers" }>[] = [];
    this.menuText.bind(this.art.skin.font, this.menuFont);
    const area = context.binding.safeArea;
    const draws = mediaCaptionCommands(captions, { x: area.x + 8, y: area.y + area.height * 0.65, width: area.width - 16, height: area.height * 0.3 },
      this.art.skin.font, this.preferences.values.textScale * Math.min(area.width / 640, area.height / 480),
      (text, scale) => layoutText({ text, font: this.menuFont, scale, color: { x: 1, y: 1, z: 1, w: 1 } }).width);
    renderUiCommands(context, draws, { text: this.menuText, white: this.art.white, picture: resource => this.art.picture(resource), emit: command => commands.push(command), material: () => { throw new Error("Caption text requested a material draw"); } });
    return commands;
  }

  close(): void { this.inventoryMenu.dispose(); this.soundCaptions.close(); this.matchMenu?.dispose(); this.baseArena?.close(); this.teamArena?.close(); this.death.close(); this.prompt.close(); this.match.close(); this.disposeInput(); this.controller.closeAll(); this.disposeMenu(); this.saves.dispose(); this.settings.dispose(); this.gyroSettings.dispose(); this.serverSettings?.dispose(); this.rankingMenu?.dispose(); this.bindings.dispose(); this.text.clear(); this.menuText.clear(); this.messages.clear(); }
}
