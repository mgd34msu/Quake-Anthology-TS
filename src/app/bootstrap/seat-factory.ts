// SPDX-License-Identifier: GPL-2.0-or-later
import { WorldSeatPresentation } from "./presentation.ts";
import { ApplicationSeatUi } from "./ui.ts";

type UiArguments = ConstructorParameters<typeof ApplicationSeatUi>;
type PresentationArguments = ConstructorParameters<typeof WorldSeatPresentation>;

/** Everything a seat's menu and HUD controller is built from, by name; omitted members take the controller's defaults. */
export interface SeatUiSpec {
  readonly local: UiArguments[0];
  readonly art: UiArguments[1];
  readonly input: UiArguments[2];
  readonly mutateWindow: UiArguments[3];
  readonly simulation: UiArguments[4];
  readonly font: UiArguments[5];
  readonly audio: UiArguments[6];
  readonly quit: UiArguments[7];
  readonly command: UiArguments[8];
  readonly typography: UiArguments[9];
  readonly hostSettings?: UiArguments[10];
  readonly language?: UiArguments[11];
  readonly saves?: UiArguments[12];
  readonly view: UiArguments[13];
  readonly llm?: UiArguments[14];
  readonly guestUi?: UiArguments[15];
  readonly teamArena?: UiArguments[16];
  readonly options?: UiArguments[17];
}

/** Everything a seat's world presentation is built from, by name; omitted members take the presentation's defaults. */
export interface SeatPresentationSpec {
  readonly local: PresentationArguments[0];
  readonly assets: PresentationArguments[1];
  readonly renderer: PresentationArguments[2];
  readonly simulation: PresentationArguments[3];
  readonly seatCount: PresentationArguments[4];
  readonly font: PresentationArguments[5];
  readonly characters: PresentationArguments[6];
  readonly ui: PresentationArguments[7];
  readonly effects: PresentationArguments[8];
  readonly q3Client?: PresentationArguments[9];
  readonly rerelease?: PresentationArguments[10];
  readonly worldTextCullFactor?: PresentationArguments[11];
  readonly fieldOfView?: PresentationArguments[12];
  readonly debugShapes?: PresentationArguments[13];
  readonly consoleScale?: PresentationArguments[14];
  readonly viewSize?: PresentationArguments[15];
  readonly planarShadows?: PresentationArguments[16];
  readonly cameraOverride?: PresentationArguments[17];
  readonly graphOverlay?: PresentationArguments[18];
  readonly nativeQ2?: PresentationArguments[19];
}

/** The one place a seat's menu and HUD controller is constructed: local, replaced and remote worlds all build it here. */
export function createSeatUi(spec: SeatUiSpec): ApplicationSeatUi {
  return new ApplicationSeatUi(
    spec.local,
    spec.art,
    spec.input,
    spec.mutateWindow,
    spec.simulation,
    spec.font,
    spec.audio,
    spec.quit,
    spec.command,
    spec.typography,
    spec.hostSettings,
    spec.language,
    spec.saves,
    spec.view,
    spec.llm,
    spec.guestUi,
    spec.teamArena,
    spec.options,
  );
}

/** The one place a seat's world presentation is constructed: local, replaced and remote worlds all build it here. */
export function createSeatPresentation(spec: SeatPresentationSpec): WorldSeatPresentation {
  return new WorldSeatPresentation(
    spec.local,
    spec.assets,
    spec.renderer,
    spec.simulation,
    spec.seatCount,
    spec.font,
    spec.characters,
    spec.ui,
    spec.effects,
    spec.q3Client,
    spec.rerelease,
    spec.worldTextCullFactor,
    spec.fieldOfView,
    spec.debugShapes,
    spec.consoleScale,
    spec.viewSize,
    spec.planarShadows,
    spec.cameraOverride,
    spec.graphOverlay,
    spec.nativeQ2,
  );
}
