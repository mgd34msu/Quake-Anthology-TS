// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { CommandContext } from "../../../../src/contracts/common.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import type { PictureAsset } from "../../../../src/text/draw2d.ts";
import type { RegisteredFont } from "../../../../src/text/q3-font.ts";
import { SceneImageRegistry, rgbaImage } from "../../../../src/render/scene/resources.ts";
import { loadMenuDefinitions, type UiMenuResolver } from "../../../../src/ui/common/legacy/menu.ts";
import { UiRuntime, type UiKeyEvent, type UiRuntimeResources } from "../../../../src/ui/common/legacy/runtime.ts";
import { TeamArenaUiMemory } from "../../../../src/ui/common/legacy/team-arena/memory.ts";

const K_UP = 132,
  K_DOWN = 133,
  K_ENTER = 13;

/** A runtime over in-memory menu text, with every host operation that the menus under test should not reach set to fail. */
async function synthetic(menu: string) {
  const identity = createIdentityOwner("synthetic-ui"),
    seat = identity.seat(0);
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client: identity.client(0, 0) } };
  const images = new SceneImageRegistry({ identity: Symbol("synthetic-ui-images"), session: identity.session, generation: 0 });
  const fail = (): never => {
    throw new Error("synthetic menu reached an unexpected host operation");
  };
  const files = new Map([
    ["ui/test.txt", '{ loadMenu { "ui/test.menu" } }'],
    ["ui/test.menu", menu],
  ]);
  const source = (path: string) => {
    const text = files.get(path);
    return text === undefined ? undefined : { path, text };
  };
  const resolver: UiMenuResolver = { resolveRoot: source, resolve: request => source(request.requestedPath) };
  const definitions = await loadMenuDefinitions(
    { resolver, random: { nextInt: () => 0 } },
    { kind: "hud", setPath: "ui/test.txt" },
    {},
    { memory: { kind: "qvm32", memory: new TeamArenaUiMemory("qvm32", fail) } },
  );
  expect(definitions.diagnostics).toEqual([]);
  const white: PictureAsset = {
    kind: "image",
    name: "*white",
    image: images.register("*white", rgbaImage({ width: 1, height: 1, pixels: Uint8Array.of(255, 255, 255, 255) }), { wrap: "repeat", filter: "nearest" }),
  };
  const glyph = {
    s: 0,
    t: 0,
    s2: 1,
    t2: 1,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    top: 0,
    bottom: 0,
    pitch: 1,
    xSkip: 1,
    imageWidth: 1,
    imageHeight: 1,
    shaderName: "",
    picture: null,
  };
  const font: RegisteredFont = { name: "stub", glyphScale: 1, glyphs: Array.from({ length: 256 }, () => glyph) };
  const printed: string[] = [];
  const resources: UiRuntimeResources = {
    handles: { kind: "diagnostic" },
    registerPicture: fail,
    registeredPicture: () => undefined,
    registerFont: fail,
    registerSound: fail,
    registeredSound: fail,
    registerModel: fail,
    registeredModel: fail,
    prepareCinematic: fail,
  };
  const cvars = new CvarRegistry({ dialect: "q3", context });
  const runtime = await UiRuntime.create({
    definitions,
    cvars,
    resources,
    fonts: { small: font, normal: font, big: font, profile: "ui", smallThreshold: 0.25, bigThreshold: 0.4 },
    widgetAssets: {
      whiteShader: white,
      gradientBar: white,
      scrollBar: white,
      scrollBarArrowDown: white,
      scrollBarArrowUp: white,
      scrollBarArrowLeft: white,
      scrollBarArrowRight: white,
      scrollBarThumb: white,
      sliderBar: white,
      sliderThumb: white,
    },
    zeroPicture: white,
    audio: { playLocal: () => undefined, startBackground: fail, stopBackground: fail },
    cinematics: { play: fail, run: fail, draw: fail, stop: fail },
    paintModel: fail,
    feeder: { count: fail, item: fail, image: fail, select: fail },
    ownerDraw: { visible: fail, width: fail, value: fail, handleKey: fail, paint: fail, closeCinematic: fail },
    externalScript: { run: fail },
    getTeamColor: fail,
    print: text => {
      printed.push(text);
    },
  });
  return {
    runtime,
    printed,
    cvars,
    dispose: () => {
      runtime.retire();
      images.close();
    },
  };
}

const key = (code: number): UiKeyEvent => ({ kind: "key", code, down: true });

test("UI-003 Up and Down in a menu with no other focusable item do not throw", async () => {
  const { runtime, dispose } = await synthetic(`{ menuDef { name "m" rect 0 0 640 480 visible 1
    itemDef { name "only" type 1 rect 10 10 100 20 visible 1 text "A" }
    itemDef { name "decor" type 0 rect 10 40 100 20 visible 1 decoration text "B" } } }`);
  try {
    await runtime.activate("m");
    for (const code of [K_UP, K_UP, K_DOWN, K_DOWN]) await runtime.handleKey(key(code), 20, 20);
  } finally {
    dispose();
  }
});

test("UI-015 a menu whose onOpen opens itself stops at the nesting limit", async () => {
  const { runtime, printed, dispose } = await synthetic(`{ menuDef { name "m" rect 0 0 640 480 visible 1 onOpen { open m } } }`);
  try {
    await runtime.activate("m");
    expect(printed.join("")).toContain("nesting limit");
  } finally {
    dispose();
  }
});

test("UI-023 a bind item with text and an edit field are inert in the cgame context", async () => {
  const { runtime, dispose } = await synthetic(`{ menuDef { name "m" rect 0 0 640 480 visible 1
    itemDef { name "bind" type 13 rect 10 10 100 20 visible 1 text "Fire" cvar "+attack" }
    itemDef { name "edit" type 4 rect 10 40 100 20 visible 1 text "Name" cvar "name" maxChars 8 } } }`);
  try {
    await runtime.activate("m");
    await runtime.handleKey(key(K_ENTER), 20, 50);
  } finally {
    dispose();
  }
});

test("UI-005 repeated lookups of three colliding strings do not consume the pool", () => {
  const memory = new TeamArenaUiMemory("qvm32", () => {
    throw new Error("unexpected host operation");
  });
  const names = ["ui_map3", "team_game1", "g_mode2"];
  for (const name of names) memory.stringAlloc(name);
  const before = memory["stringPoint"];
  for (let round = 0; round < 100; round++) for (const name of names) expect(memory.stringAlloc(name)).toBe(name);
  expect(memory["stringPoint"]).toBe(before);
});

test("UI-016 Enter on the focused yes/no item toggles it without the pointer over it", async () => {
  const { runtime, cvars, dispose } = await synthetic(`{ menuDef { name "m" rect 0 0 640 480 visible 1
    itemDef { name "first" type 11 rect 10 10 100 20 visible 1 text "Other" cvar "other_flag" }
    itemDef { name "yn" type 11 rect 10 40 100 20 visible 1 text "Flag" cvar "my_flag" } } }`);
  try {
    cvars.register("my_flag", "0", 0);
    cvars.register("other_flag", "0", 0);
    await runtime.activate("m");
    await runtime.pointerMove(500, 400);
    await runtime.handleKey(key(K_DOWN), 500, 400);
    await runtime.handleKey(key(K_ENTER), 500, 400);
    expect(cvars.variableString("my_flag")).toBe("1");
  } finally {
    dispose();
  }
});
