// SPDX-License-Identifier: GPL-2.0-or-later
import { frontendSeatSettings } from "./frontend-preferences.ts";
import type { FrontendPreferenceOverrides } from "./frontend-preferences.ts";
import type { CommandDialect } from "../../contracts/common.ts";
import type { SeatInput } from "../../input/seat.ts";
import { archivedBindingPairs, defaultBindings, namedPhysicalInput } from "../../input/bindings.ts";
import { defaultMouseTuning } from "../../input/mouse.ts";
import type { ConfigStore, SeatSettings } from "../../settings/config.ts";
import type { NativeConfig } from "../../settings/native-config.ts";
import type { WeaponBindingItem } from "../../input/weapon-bindings.ts";

/** The front end edits the same first-seat profile that gameplay loads. */
export class StartupInputProfile {
  private baseline = "";
  private gamepadBaseline = "";
  private constructor(
    private readonly settings: ConfigStore,
    readonly input: SeatInput,
    private readonly native: NativeConfig | null = null,
  ) {}

  static retained(settings: ConfigStore, input: SeatInput, native: NativeConfig | null = null): StartupInputProfile {
    const profile = new StartupInputProfile(settings, input, native);
    profile.baseline = JSON.stringify(input.bindings);
    profile.gamepadBaseline = JSON.stringify(input.gamepad.tuning);
    return profile;
  }

  static async open(
    settings: ConfigStore,
    input: SeatInput,
    dialect: CommandDialect,
    items: readonly WeaponBindingItem[] = [],
    native: NativeConfig | null = null,
  ): Promise<StartupInputProfile> {
    const profile = new StartupInputProfile(settings, input, native);
    const saved = await settings.loadSeat("input/seat-1.json");
    const own = await native?.readBindings();
    input.unbindAll();
    // A stock game's own file outranks the user store.
    if (own !== null && own !== undefined) {
      for (const binding of defaultBindings(0, dialect, items)) input.bind(binding);
      for (const [key, command] of own) {
        const physical = namedPhysicalInput(key);
        if (physical !== null) input.bind({ input: physical, target: { kind: "command", text: command } });
      }
    } else for (const binding of saved?.bindings ?? defaultBindings(0, dialect, items)) input.bind(binding);
    if (saved !== null) input.gamepad.tuning = structuredClone(saved.gamepad);
    profile.baseline = JSON.stringify(input.bindings);
    profile.gamepadBaseline = JSON.stringify(input.gamepad.tuning);
    return profile;
  }

  async save(values: FrontendPreferenceOverrides = {}, history?: readonly string[]): Promise<void> {
    const bindings = this.input.bindings.map(binding =>
      binding.input.kind === "controller-button" || binding.input.kind === "controller-axis" ? { ...binding, input: { ...binding.input, device: 0 } } : binding,
    );
    const current = JSON.stringify(this.input.bindings);
    const bindingsChanged = current !== this.baseline;
    const gamepadCurrent = JSON.stringify(this.input.gamepad.tuning);
    const gamepadChanged = gamepadCurrent !== this.gamepadBaseline;
    if (!bindingsChanged && !gamepadChanged && Object.keys(values).length === 0 && history === undefined) return;
    const saved = await this.settings.loadSeat("input/seat-1.json");
    const baseline: SeatSettings = saved ?? {
      version: 1,
      gamepad: structuredClone(this.input.gamepad.tuning),
      mouse: { ...defaultMouseTuning },
      history: [],
      rumble: true,
      controller: { kind: "automatic" },
      bindings,
    };
    const preferences = frontendSeatSettings(values, {
      ...baseline,
      ...(bindingsChanged ? { bindings } : {}),
      ...(gamepadChanged ? { gamepad: structuredClone(this.input.gamepad.tuning) } : {}),
    });
    const selected = history === undefined ? preferences : { ...preferences, history: [...history] };
    if (bindingsChanged || gamepadChanged || JSON.stringify(selected) !== JSON.stringify(baseline)) await this.settings.saveSeat("input/seat-1.json", selected);
    if (bindingsChanged && this.native !== null) await this.native.writeBindings(archivedBindingPairs(this.input));
    this.baseline = current;
    this.gamepadBaseline = gamepadCurrent;
  }
}
