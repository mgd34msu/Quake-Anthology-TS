import { frontendSeatSettings } from "./frontend-preferences.ts";
import type { FrontendPreferenceOverrides } from "./frontend-preferences.ts";
import type { CommandDialect } from "../../contracts/common.ts";
import type { SeatInput } from "../../input/seat.ts";
import { defaultBindings } from "../../input/bindings.ts";
import { defaultMouseTuning } from "../../input/mouse.ts";
import type { ConfigStore, SeatSettings } from "../../settings/config.ts";
import type { WeaponBindingItem } from "../../input/weapon-bindings.ts";

/** The front end edits the same first-seat profile that gameplay loads. */
export class StartupInputProfile {
  private baseline = "";
  private constructor(private readonly settings: ConfigStore, readonly input: SeatInput) {}

  static retained(settings: ConfigStore, input: SeatInput): StartupInputProfile {
    const profile = new StartupInputProfile(settings, input);
    profile.baseline = JSON.stringify(input.bindings);
    return profile;
  }

  static async open(settings: ConfigStore, input: SeatInput, dialect: CommandDialect, items: readonly WeaponBindingItem[] = []): Promise<StartupInputProfile> {
    const profile = new StartupInputProfile(settings, input);
    const saved = await settings.loadSeat("input/seat-1.json");
    input.unbindAll();
    for (const binding of saved?.bindings ?? defaultBindings(0, dialect, items)) input.bind(binding);
    if (saved !== null) input.gamepad.tuning = structuredClone(saved.gamepad);
    profile.baseline = JSON.stringify(input.bindings);
    return profile;
  }

  async save(values: FrontendPreferenceOverrides = {}, history?: readonly string[]): Promise<void> {
    const bindings = this.input.bindings.map(binding => binding.input.kind === "controller-button" || binding.input.kind === "controller-axis"
      ? { ...binding, input: { ...binding.input, device: 0 } } : binding);
    const current = JSON.stringify(this.input.bindings);
    const bindingsChanged = current !== this.baseline;
    if (!bindingsChanged && Object.keys(values).length === 0 && history === undefined) return;
    const saved = await this.settings.loadSeat("input/seat-1.json");
    const baseline: SeatSettings = saved ?? { version: 1, gamepad: structuredClone(this.input.gamepad.tuning),
      mouse: { ...defaultMouseTuning }, history: [], rumble: true, controller: { kind: "automatic" }, bindings };
    const preferences = frontendSeatSettings(values, bindingsChanged ? { ...baseline, bindings } : baseline);
    const selected = history === undefined ? preferences : { ...preferences, history: [...history] };
    if (bindingsChanged || JSON.stringify(selected) !== JSON.stringify(baseline)) await this.settings.saveSeat("input/seat-1.json", selected);
    this.baseline = current;
  }
}
