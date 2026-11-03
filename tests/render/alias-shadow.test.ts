// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { q1AliasShadowPoint } from "../../src/render/scene/models/lighting.ts";

test("Q1 alias shadow retains source local floor height and float projection", () => {
  const point = q1AliasShadowPoint({ x: 10, y: 20, z: 30 }, { x: 0.5, y: -0.25, z: 1 }, 100, 80);
  expect(point).toEqual({ x: -15, y: 32.5, z: -19 });
  const value = 1 / 3,
    f = Math.fround;
  expect(q1AliasShadowPoint({ x: value, y: -value, z: value }, { x: value, y: value, z: 1 }, value, -value)).toEqual({
    x: f(value - f(value * f(value + f(value + value)))),
    y: f(-value - f(value * f(value + f(value + value)))),
    z: f(-f(value + value) + 1),
  });
});

import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { registerRenderSettings } from "../../src/app/bootstrap/render-settings.ts";

test("source alias shadow setting defaults off and preserves an existing public value", () => {
  const identity = createIdentityOwner("shadow-settings");
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "local-console" } } });
  registerRenderSettings(cvars);
  expect(cvars.variableValue("r_shadows")).toBe(0);
  cvars.set("r_shadows", "1");
  expect(cvars.variableValue("r_shadows")).toBe(1);
  cvars.set("r_shadows", "NaN");
  expect(cvars.variableValue("r_shadows")).toBe(1);
  const restored = new CvarRegistry({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "local-console" } } });
  restored.register("r_shadows", "1", 0);
  registerRenderSettings(restored);
  expect(restored.variableValue("r_shadows")).toBe(1);
});

import { q3RendererSettings, shaderProfileFromCvars } from "../../src/app/bootstrap/render-settings.ts";

test("GAPMAT-004 renderer cvars reach the shader profile, rail widths and curve error", () => {
  const identity = createIdentityOwner("renderer-cvars");
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "local-console" } } });
  expect(q3RendererSettings(null).curveError).toBe(250);
  registerRenderSettings(cvars);
  expect(shaderProfileFromCvars(cvars)).toMatchObject({ vertexLight: false, detailTextures: true });
  expect(q3RendererSettings(cvars)).toEqual({ rail: { coreWidth: 6, ringWidth: 16, segmentLength: 32 }, curveError: 250 });
  cvars.set("r_vertexLight", "1");
  cvars.set("r_detailTextures", "0");
  cvars.set("r_railWidth", "24");
  cvars.set("r_railCoreWidth", "3");
  cvars.set("r_railSegmentLength", "64");
  cvars.set("r_lodCurveError", "100");
  cvars.set("r_railWidth", "-5");
  expect(shaderProfileFromCvars(cvars)).toMatchObject({ vertexLight: true, detailTextures: false });
  expect(q3RendererSettings(cvars)).toEqual({ rail: { coreWidth: 3, ringWidth: 24, segmentLength: 64 }, curveError: 100 });
});
