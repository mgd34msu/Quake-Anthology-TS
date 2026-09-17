import { CvarFlag, CvarRegistry } from "../core/cvars/index.ts";
import { defaultMouseTuning } from "./mouse.ts";
import type { MouseTuning, MouseTuningStore } from "./mouse.ts";

/** The seat registry owns values; menus and profile restore use MouseInput.tuning. */
export class MouseSettings implements MouseTuningStore {
  constructor(readonly cvars: CvarRegistry) {
    const defaults = defaultMouseTuning;
    for (const [name, value] of [["v_centerspeed", "500"], ["v_centermove", "0.15"]] satisfies readonly (readonly [string, string])[])
      if (cvars.find(name) === undefined || cvars.isConsoleCreated(name)) cvars.register(name, value, CvarFlag.None);
    const declarations: readonly { readonly name: string; readonly value: number; readonly summary: string; readonly example: string }[] = [
      { name: "sensitivity", value: defaults.sensitivity, summary: "Mouse sensitivity multiplier for this seat.", example: "sensitivity 4.5" },
      { name: "cl_mouseAccel", value: defaults.acceleration, summary: "Mouse acceleration added per count per millisecond. Shared extension outside Quake III.", example: "cl_mouseAccel 0" },
      { name: "m_filter", value: Number(defaults.filter), summary: "Mouse smoothing averages the current and previous mouse sample.", example: "m_filter 1" },
      { name: "m_yaw", value: defaults.yaw, summary: "Mouse horizontal turn scale in degrees per scaled count.", example: "m_yaw 0.022" },
      { name: "m_pitch", value: defaults.pitch, summary: "Mouse vertical turn scale. Negative values enable Invert mouse in the menu.", example: "m_pitch -0.022" },
      { name: "m_side", value: defaults.side, summary: "Mouse sideways movement scale while strafing.", example: "m_side 0.8" },
      { name: "m_forward", value: defaults.forward, summary: "Mouse forward movement scale when free look is disabled or strafing.", example: "m_forward 1" },
      { name: "lookspring", value: 0, summary: "Start grounded pitch centering when mouse look is released.", example: "lookspring 1" },
      { name: "lookstrafe", value: 0, summary: "Mouse horizontal motion strafes while holding mouse look.", example: "lookstrafe 1" },
      { name: "freelook", value: Number(defaults.freeLook), summary: "Mouse vertical motion controls view pitch without holding +mlook. Shared name across games.", example: "freelook 1" },
    ];
    for (const declaration of declarations) {
      if (cvars.find(declaration.name) === undefined || cvars.isConsoleCreated(declaration.name))
        cvars.register(declaration.name, String(declaration.value), CvarFlag.Archive);
      cvars.document(declaration.name, { summary: declaration.summary, usage: `${declaration.name} [value]`, examples: [declaration.example] });
    }
  }

  read(): MouseTuning {
    const pitch = this.cvars.variableValue("m_pitch");
    return { sensitivity: this.cvars.variableValue("sensitivity"), acceleration: this.cvars.variableValue("cl_mouseAccel"),
      filter: this.cvars.dialect === "q3" ? (this.cvars.find("m_filter")?.integerValue ?? 0) !== 0 : this.cvars.variableValue("m_filter") !== 0,
      yaw: this.cvars.variableValue("m_yaw"), pitch: Math.abs(pitch), invertPitch: pitch < 0 || Object.is(pitch, -0),
      side: this.cvars.variableValue("m_side"), forward: this.cvars.variableValue("m_forward"), freeLook: this.cvars.variableValue("freelook") !== 0,
      lookSpring: this.cvars.variableValue("lookspring") !== 0, lookStrafe: this.cvars.variableValue("lookstrafe") !== 0 };
  }

  write(value: MouseTuning): void {
    this.cvars.set("sensitivity", String(value.sensitivity));
    this.cvars.set("cl_mouseAccel", String(value.acceleration));
    this.cvars.set("m_filter", value.filter ? "1" : "0");
    this.cvars.set("m_yaw", Object.is(value.yaw, -0) ? "-0" : String(value.yaw));
    const pitch = value.pitch * (value.invertPitch ? -1 : 1);
    this.cvars.set("m_pitch", Object.is(pitch, -0) ? "-0" : String(pitch));
    this.cvars.set("m_side", String(value.side));
    this.cvars.set("m_forward", String(value.forward));
    this.cvars.set("lookspring", value.lookSpring === true ? "1" : "0");
    this.cvars.set("lookstrafe", value.lookStrafe === true ? "1" : "0");
    this.cvars.set("freelook", value.freeLook ? "1" : "0");
  }
}
