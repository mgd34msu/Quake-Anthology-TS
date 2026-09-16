import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../../src/contracts/ui.ts";
import { drawCommonHud, emptyHudData, SeatHudMessages, hudVitalOccupiedRects } from "../../../src/ui/hud/index.ts";
import { defaultUiSkin } from "../../../src/ui/common/skin.ts";
import { SeatUiPreferences } from "../../../src/ui/settings/index.ts";

for (const height of [120, 240, 480]) for (const textScale of [1, 2]) test(`active timers fit both 320x${height} seats at text scale ${textScale}`, () => {
  const owner = createIdentityOwner("powerup-hud"), skin = defaultUiSkin("resource:test:font");
  const measureText = (text: string, scale: number): number => text.length * 8 * scale;
  for (const index of [0, 1]) {
    const seat = owner.seat(index), area = { x: 0, y: index * height, width: 320, height };
    const provider = { provider: "q2:official", content: "q2:rerelease:baseq2:retail" } satisfies import("../../../src/contracts/content.ts").ProviderReference;
    const context: UiDrawContext = { binding: { seat, client: owner.client(index, 0), viewport: area, safeArea: area, hudScale: 1,
      presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 999999 };
    const preferences = { ...new SeatUiPreferences(seat).values, textScale };
    const base = emptyHudData(seat);
    const data = { ...base, crosshair: { ...base.crosshair, visible: false },
      vitals: [{ label: "Health", value: 100, icon: null, warning: false }],
      powerups: index === 0 ? [
        { item: "q2:item_quad", label: "Quad Damage", remainingSeconds: 30.25 },
        { item: "q2:item_quadfire", label: "DualFire Damage", remainingSeconds: 0.25 },
        { item: "q2:item_double", label: "Double Damage", remainingSeconds: 18 },
        { item: "q2:item_invulnerability", label: "Invulnerability", remainingSeconds: 1 },
        { item: "q2:item_enviro", label: "Environment Suit", remainingSeconds: 19 },
        { item: "q2:item_breather", label: "Rebreather", remainingSeconds: 20 },
        { item: "q2:item_ir_goggles", label: "IR Goggles", remainingSeconds: 60 },
        { item: "q2:expired", label: "Expired", remainingSeconds: 0 },
      ] satisfies import("../../../src/contracts/gameplay.ts").ActivePowerupTimer[] : [] };
    const options = { skin, preferences, messages: new SeatHudMessages(seat), camera: null, localize: (text: string) => text, measureText };
    const commands = drawCommonHud(context, data, options);
    const timers = commands.flatMap(command => command.kind === "text" && command.text.endsWith("s") ? [command] : []);
    expect(timers.map(timer => timer.text.split(" ").at(-1))).toEqual(index === 0 ? ["31s", "1s", "18s", "1s", "19s", "20s", "60s"] : []);
    const statusTop = hudVitalOccupiedRects(context, 1, preferences.hudScale, skin.fontScale * preferences.textScale)[0]?.y;
    if (statusTop === undefined) throw new Error("Missing vital layout");
    for (const timer of timers) {
      expect(timer.origin.x - measureText(timer.text, timer.scale)).toBeGreaterThanOrEqual(area.x);
      expect(timer.origin.x).toBeLessThanOrEqual(area.x + area.width);
      expect(timer.origin.y).toBeGreaterThanOrEqual(area.y);
      expect(timer.origin.y + timer.scale * 8).toBeLessThan(statusTop);
      expect(timer.scale * 8).toBeGreaterThanOrEqual(8);
    }
    const panels = commands.flatMap(command => command.kind === "fill" && command.rect.y + command.rect.height < statusTop ? [command.rect] : []);
    for (const [index, first] of panels.entries()) for (const second of panels.slice(index + 1)) {
      expect(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y).toBe(true);
    }
    expect(() => drawCommonHud(context, { ...data, seat: owner.seat(1 - index) }, options)).toThrow("HUD frame belongs to another seat");
  }
});
