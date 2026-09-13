import type { InputRouter } from "../../input/router.ts";
import type { ControllerDevice } from "../../platform/controller.ts";
import type { UiControl, UiControlId } from "../../contracts/ui.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";
import type { SettingsMenus } from "./index.ts";

export interface GyroSettingsUi {
  readonly router: InputRouter;
  device(): ControllerDevice | null;
  busy(): boolean;
  message(): string;
  save(): Promise<void>;
}
export function registerGyroSettingsMenu(controller: NativeUiController, settings: GyroSettingsUi, title = "Gyro controls"): SettingsMenus {
  const root = "menu:settings:gyro";
  let error = "";
  const button = (id: UiControlId, label: string, row: number, activate: () => void, enabled = true): UiControl => ({ id, kind: "button", label,
    rect: menuRow(row), enabled, visible: true, activate: () => { activate(); return undefined; } });
  const save = (): void => { void settings.save().catch((cause: unknown) => { error = cause instanceof Error ? cause.message : String(cause); }); };
  const dispose = controller.register(root, () => {
    const seat = controller.seat, device = settings.device(), input = settings.router.seat(seat);
    const capable = device?.capabilities.sensors.some(sensor => sensor.kind === "gyro") ?? false;
    const enabled = capable && !settings.busy(), calibration = settings.router.gyroCalibration(seat);
    const status = device === null ? "No controller connected." : !capable ? "This controller has no gyroscope."
      : calibration.kind === "calibrating" ? `Keep still: ${Math.round(calibration.progress * 100)}% (${calibration.samples} samples)`
      : calibration.kind === "ready" ? "Calibration complete." : "Place the controller on a steady surface.";
    const controls: UiControl[] = [button("ui:gyro:device", (device?.name ?? "Controller").slice(0, 50), 0, () => undefined, false),
      { id: "ui:gyro:enabled", kind: "toggle", label: "Gyro aiming", rect: menuRow(1), visible: true, enabled,
        checked: input?.gamepad.tuning.gyro.enabled ?? false, change: (_, value) => {
          const result = settings.router.setGyroEnabled(seat, value); error = result.kind === "accepted" ? "" : result.reason;
          if (result.kind === "accepted") save(); return undefined;
        } },
      button("ui:gyro:calibrate", calibration.kind === "ready" ? "Recalibrate" : "Calibrate", 2, () => {
        const result = settings.router.beginGyroCalibration(seat); error = result.kind === "accepted" ? "" : result.reason;
      }, enabled && calibration.kind !== "calibrating"),
      button("ui:gyro:cancel", "Cancel calibration", 3, () => settings.router.cancelGyroCalibration(seat), calibration.kind === "calibrating"),
      button("ui:gyro:status", error || status, 4, () => undefined, false),
      button("ui:gyro:reset", "Reset calibration", 5, () => { settings.router.resetGyroCalibration(seat); error = ""; }, enabled),
      button("ui:gyro:reconnect", "Recalibrate after reconnecting.", 6, () => undefined, false),
      button("ui:gyro:saved", settings.message(), 7, () => undefined, false),
      ...(["yawSensitivity", "pitchSensitivity"] satisfies readonly ("yawSensitivity" | "pitchSensitivity")[]).map((axis, index): UiControl => ({
        id: `ui:gyro:${axis}`, kind: "slider", label: axis === "yawSensitivity" ? "Gyro yaw sensitivity" : "Gyro pitch sensitivity",
        rect: menuRow(8 + index), visible: true, enabled, minimum: 0, maximum: 10, step: 0.1,
        value: input?.gamepad.tuning.gyro[axis] ?? 1, change: (_, value) => {
          if (input !== null) { input.gamepad.tuning = { ...input.gamepad.tuning, gyro: { ...input.gamepad.tuning.gyro, [axis]: value } }; save(); }
          return undefined;
        } })),
      button("ui:gyro:back", "Back", 11, () => controller.closeMenu())];
    return { id: root, title, fullScreen: false, controls, open: () => undefined,
      close: () => { settings.router.cancelGyroCalibration(seat); return undefined; } };
  });
  return { root, dispose };
}
