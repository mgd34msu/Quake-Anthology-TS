/* Client module calls follow Q2 rerelease game.h and Q3 cg_public.h/ui_public.h.
 * Copyright (C) id Software. GPL-2.0-or-later. */
import type { PresentationSelection, ResourceId } from "./content.ts";
import type { Q2CgameApiIdentity, Q3ApiIdentity } from "./execution.ts";
import type { ClientId, ProviderId, SeatId } from "./identity.ts";
import type { Vec2, Vec3, Vec4 } from "./math.ts";
import type { Q2RereleaseMovementInput, Q2RereleaseMovementResult } from "./movement.ts";
import type { NetworkSnapshot, Q2RereleasePlayerState } from "./protocol.ts";
import type { Rect } from "./render.ts";
import type { SourceTime } from "./time.ts";

export type UiControlId = `ui:${string}:${string}`;
export type UiMenuId = `menu:${string}:${string}`;
export type InputAction = "attack" | "jump" | "forward" | "back" | "move-left" | "move-right" | "move-up" | "move-down" | "use" | "crouch" | "walk" | "scores" | "next-weapon" | "previous-weapon" | "menu";
export type ControllerAxis = "left-x" | "left-y" | "right-x" | "right-y" | "left-trigger" | "right-trigger";
export type PhysicalInput =
  | { readonly kind: "key"; readonly code: number }
  | { readonly kind: "mouse-button"; readonly button: number }
  | { readonly kind: "controller-button"; readonly device: number; readonly button: number }
  | { readonly kind: "controller-axis"; readonly device: number; readonly axis: ControllerAxis; readonly direction: "positive" | "negative" };
export type InputBindingTarget =
  | { readonly kind: "action"; readonly action: InputAction }
  | { readonly kind: "command"; readonly text: string };
export interface InputBinding {
  readonly input: PhysicalInput;
  readonly target: InputBindingTarget;
}
export type SeatInputEvent = { readonly seat: SeatId; readonly timeMilliseconds: number } & (
  | { readonly kind: "key"; readonly code: number; readonly down: boolean; readonly repeat: boolean }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "mouse-motion"; readonly position: Vec2; readonly delta: Vec2 }
  | { readonly kind: "mouse-button"; readonly button: number; readonly down: boolean }
  | { readonly kind: "mouse-wheel"; readonly delta: Vec2 }
  | { readonly kind: "controller-button"; readonly device: number; readonly button: number; readonly down: boolean }
  | { readonly kind: "controller-axis"; readonly device: number; readonly axis: ControllerAxis; readonly value: number }
  | { readonly kind: "focus"; readonly focused: boolean }
);
export type SeatInputFocus =
  | { readonly kind: "game" }
  | { readonly kind: "menu"; readonly menu: UiMenuId; readonly control: UiControlId | null }
  | { readonly kind: "console" }
  | { readonly kind: "chat"; readonly team: boolean; readonly text: string };
export interface UiNotification {
  readonly sequence: number;
  readonly text: string;
  readonly chat: boolean;
  readonly starts: SourceTime;
  readonly duration: SourceTime;
}
export interface CenterPrintState {
  readonly text: string;
  readonly starts: SourceTime;
  readonly duration: SourceTime;
  readonly instant: boolean;
}
/** No default seat exists. Input, notification, and menu state are seat-owned. */
export interface SeatUiState {
  readonly seat: SeatId;
  readonly focus: SeatInputFocus;
  readonly cursor: Vec2;
  readonly bindings: readonly InputBinding[];
  readonly notifications: readonly UiNotification[];
  readonly centerPrint: CenterPrintState | null;
  readonly showScores: boolean;
}
export interface SeatPresentationBinding {
  readonly seat: SeatId;
  readonly client: ClientId;
  readonly viewport: Rect;
  readonly safeArea: Rect;
  readonly hudScale: number;
  readonly presentation: PresentationSelection;
}
export type UiDrawCommand =
  | { readonly kind: "fill"; readonly rect: Rect; readonly color: Vec4 }
  | { readonly kind: "image"; readonly rect: Rect; readonly resource: ResourceId; readonly texCoords: readonly [Vec2, Vec2]; readonly color: Vec4 }
  | { readonly kind: "text"; readonly origin: Vec2; readonly text: string; readonly font: ResourceId; readonly scale: number; readonly color: Vec4; readonly align: "left" | "center" | "right"; readonly shadow: boolean }
  | { readonly kind: "clip"; readonly rect: Rect | null };
export interface UiDrawContext {
  readonly binding: SeatPresentationBinding;
  readonly timeMilliseconds: number;
}
interface UiControlBase {
  readonly id: UiControlId;
  readonly label: string;
  readonly rect: Rect;
  readonly enabled: boolean;
  readonly visible: boolean;
}
export interface UiChoice { readonly id: string; readonly label: string; }
export interface UiListRow {
  readonly id: string;
  readonly cells: readonly string[];
  readonly image: ResourceId | null;
  readonly enabled: boolean;
}
/** Original owner draws and feeders retain callable behavior alongside native controls. */
export type UiControl = UiControlBase & (
  | { readonly kind: "button"; readonly activate: (seat: SeatId) => undefined }
  | { readonly kind: "toggle"; readonly checked: boolean; readonly change: (seat: SeatId, checked: boolean) => undefined }
  | { readonly kind: "slider"; readonly minimum: number; readonly maximum: number; readonly step: number; readonly value: number; readonly change: (seat: SeatId, value: number) => undefined }
  | { readonly kind: "text-entry"; readonly text: string; readonly maximumLength: number; readonly change: (seat: SeatId, text: string) => undefined; readonly submit: (seat: SeatId, text: string) => undefined }
  | { readonly kind: "choice"; readonly choices: readonly UiChoice[]; readonly selected: string | null; readonly select: (seat: SeatId, choice: string) => undefined }
  | { readonly kind: "list"; readonly rows: readonly UiListRow[]; readonly selected: string | null; readonly select: (seat: SeatId, row: string) => undefined }
  | { readonly kind: "owner-draw"; readonly owner: ProviderId; readonly sourceId: number; readonly draw: (context: UiDrawContext) => readonly UiDrawCommand[]; readonly key: (seat: SeatId, code: number, down: boolean) => boolean }
);
export interface UiMenu {
  readonly id: UiMenuId;
  readonly title: string;
  readonly fullScreen: boolean;
  readonly controls: readonly UiControl[];
  readonly open: (seat: SeatId) => undefined;
  readonly close: (seat: SeatId) => undefined;
}
export interface LegacyUiScript {
  readonly kind: "q3-menu-script";
  readonly module: ProviderId;
  readonly source: string;
}
export interface LegacyUiFeeder {
  readonly module: ProviderId;
  readonly sourceId: number;
  readonly count: (seat: SeatId) => number;
  readonly row: (seat: SeatId, index: number) => UiListRow | null;
  readonly select: (seat: SeatId, index: number) => undefined;
}
export interface SeatUiController {
  readonly seat: SeatId;
  readonly state: () => SeatUiState;
  readonly input: (event: SeatInputEvent) => boolean;
  readonly openMenu: (menu: UiMenuId) => undefined;
  readonly closeMenu: () => undefined;
  readonly executeScript: (script: LegacyUiScript) => undefined;
  readonly draw: (context: UiDrawContext) => readonly UiDrawCommand[];
}
export interface HudFrame {
  readonly binding: SeatPresentationBinding;
  readonly time: SourceTime;
  readonly snapshot: NetworkSnapshot;
  readonly ui: SeatUiState;
}
export interface HudProvider {
  readonly id: ProviderId;
  readonly draw: (frame: HudFrame) => readonly UiDrawCommand[];
}

export interface Q2HudServerData {
  readonly layout: string;
  readonly inventory: readonly number[];
}
export interface Q2HudDraw {
  readonly seat: SeatId;
  readonly serverData: Q2HudServerData;
  readonly viewport: Rect;
  readonly safeArea: Rect;
  readonly scale: number;
  readonly playerNumber: number;
  readonly player: Q2RereleasePlayerState;
}
/** Draw imports are bound to the selected seat before invoking the source module. */
export interface Q2CgameExports {
  readonly api: Q2CgameApiIdentity;
  readonly init: () => undefined;
  readonly shutdown: () => undefined;
  readonly drawHud: (frame: Q2HudDraw) => undefined;
  readonly touchPictures: () => undefined;
  readonly layoutFlags: (player: Q2RereleasePlayerState) => number;
  readonly activeWeaponWheelWeapon: (player: Q2RereleasePlayerState) => number;
  readonly ownedWeaponWheelWeapons: (player: Q2RereleasePlayerState) => number;
  readonly weaponWheelAmmoCount: (player: Q2RereleasePlayerState, ammoId: number) => number;
  readonly powerupWheelCount: (player: Q2RereleasePlayerState, powerupId: number) => number;
  readonly hitMarkerDamage: (player: Q2RereleasePlayerState) => number;
  readonly pmove: (input: Q2RereleaseMovementInput) => Q2RereleaseMovementResult;
  readonly parseConfigString: (index: number, value: string) => undefined;
  readonly parseCenterPrint: (seat: SeatId, text: string, instant: boolean) => undefined;
  readonly clearNotify: (seat: SeatId) => undefined;
  readonly clearCenterPrint: (seat: SeatId) => undefined;
  readonly notifyMessage: (seat: SeatId, text: string, chat: boolean) => undefined;
  readonly monsterFlashOffset: (flashId: number) => Vec3;
}
export type StereoView = "center" | "left" | "right";
export type Q3CgameEventHandling = "none" | "team-menu" | "scoreboard" | "edit-hud";
export interface Q3CgameExports {
  readonly api: Extract<Q3ApiIdentity, { readonly kind: "q3-cgame" }>;
  readonly seat: SeatId;
  readonly init: (serverMessageNumber: number, serverCommandSequence: number, clientNumber: number) => undefined;
  readonly shutdown: () => undefined;
  readonly consoleCommand: (arguments_: readonly string[]) => boolean;
  readonly drawActiveFrame: (serverTimeMilliseconds: number, stereoView: StereoView, demoPlayback: boolean) => undefined;
  readonly crosshairPlayer: () => number | null;
  readonly lastAttacker: () => number | null;
  readonly keyEvent: (key: number, down: boolean) => undefined;
  readonly mouseEvent: (dx: number, dy: number) => undefined;
  readonly eventHandling: (mode: Q3CgameEventHandling) => undefined;
}
export type Q3MenuCommand = "none" | "main" | "ingame" | "need-cd" | "bad-cd-key" | "team" | "postgame";
export interface Q3UiExports {
  readonly api: Extract<Q3ApiIdentity, { readonly kind: "q3-ui" }>;
  readonly seat: SeatId;
  readonly init: (connecting: boolean) => undefined;
  readonly shutdown: () => undefined;
  readonly keyEvent: (key: number, down: boolean) => undefined;
  readonly mouseEvent: (dx: number, dy: number) => undefined;
  readonly refresh: (realTimeMilliseconds: number) => undefined;
  readonly isFullscreen: () => boolean;
  readonly setActiveMenu: (menu: Q3MenuCommand) => undefined;
  readonly consoleCommand: (realTimeMilliseconds: number, arguments_: readonly string[]) => boolean;
  readonly drawConnectScreen: (overlay: boolean) => undefined;
  readonly hasUniqueCdKey: () => boolean;
}
