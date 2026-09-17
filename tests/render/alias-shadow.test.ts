import { expect, test } from "bun:test";
import { q1AliasShadowPoint } from "../../src/render/scene/models/lighting.ts";

test("Q1 alias shadow retains source local floor height and float projection", () => {
  const point = q1AliasShadowPoint({ x: 10, y: 20, z: 30 }, { x: 0.5, y: -0.25, z: 1 }, 100, 80);
  expect(point).toEqual({ x: -15, y: 32.5, z: -19 });
  const value = 1 / 3, f = Math.fround;
  expect(q1AliasShadowPoint({ x: value, y: -value, z: value }, { x: value, y: value, z: 1 }, value, -value)).toEqual({
    x: f(value - f(value * f(value + f(value + value)))),
    y: f(-value - f(value * f(value + f(value + value)))), z: f(-f(value + value) + 1) });
});

import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { registerRenderSettings } from "../../src/app/bootstrap/render-settings.ts";

test("source alias shadow setting defaults off and preserves an existing public value", () => {
  const identity = createIdentityOwner("shadow-settings");
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "local-console" } } });
  registerRenderSettings(cvars); expect(cvars.variableValue("r_shadows")).toBe(0);
  cvars.set("r_shadows", "1"); expect(cvars.variableValue("r_shadows")).toBe(1);
  cvars.set("r_shadows", "NaN"); expect(cvars.variableValue("r_shadows")).toBe(1);
  const restored = new CvarRegistry({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "local-console" } } });
  restored.register("r_shadows", "1", 0); registerRenderSettings(restored);
  expect(restored.variableValue("r_shadows")).toBe(1);
});
