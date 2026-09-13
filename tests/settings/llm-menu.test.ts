import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../src/contracts/ui.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { LlmSettingsService, type LlmProvider } from "../../src/llm/settings.ts";
import { NativeUiController, defaultUiSkin } from "../../src/ui/common/index.ts";
import { registerLlmSettingsMenu } from "../../src/ui/settings/llm.ts";

const models = ["test-model", "draft-model"].map(id => ({ id, name: id, reasoningEfforts: [], defaultReasoningEffort: null, reasoningSource: "unknown", recommended: false } satisfies import("../../src/llm/settings.ts").LlmModel));
const testCatalogs = { "chatgpt-subscription": { status: "ready", models }, "chatgpt-api": { status: "ready", models }, "other-api": { status: "ready", models } } satisfies import("../../src/llm/settings.ts").LlmSettingsSnapshot["catalogs"];

for (const width of [640, 320]) test(`LLM ${width} menu masks pasted keys and clears drafts on close`, async () => {
  const directory = await mkdtemp("/tmp/llm-menu-");
  const service = await LlmSettingsService.open({ baseDirectory: directory, request: { fetch: async () => Response.json({ data: [{ id: "test-model" }, { id: "draft-model" }] }) } });
  try {
    await service.selectProvider("other-api");
    await service.saveApiKey("other-api", "stored-secret-never-shown");
    const owner = createIdentityOwner(`llm-menu-${width}`), seat = owner.seat(0);
    const measured: string[] = [];
    const controller = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"), bindings: () => [],
      focus: () => undefined, sound: () => undefined, executeScript: () => undefined, clipboard: () => "pasted-secret",
      measureText: value => { measured.push(value); return value.length * 8; } });
    const menus = registerLlmSettingsMenu(controller, service);
    const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies { readonly provider: "ui:test"; readonly content: "q1:rerelease:id1:retail" };
    const context: UiDrawContext = { timeMilliseconds: 0, binding: { seat, client: owner.client(0, 0), viewport: { x: 0, y: 0, width, height: width * .75 },
      safeArea: { x: 0, y: 0, width, height: width * .75 }, hudScale: 1,
      presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } } };
    const key = (code: number, down = true): void => { controller.input({ seat, timeMilliseconds: 0, kind: "key", code, down, repeat: false }); };
    const draw = (): string => JSON.stringify(controller.draw(context));
    controller.openMenu(menus.root);
    expect(draw()).not.toContain("stored-secret");
    const factor = width / 640;
    controller.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x: 400 * factor, y: 216 * factor }, delta: { x: 0, y: 0 } });
    controller.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    key(KeyCode.Control); key(118); key(KeyCode.Control, false);
    expect(draw()).toContain("*************");
    expect(draw()).not.toContain("pasted-secret");
    expect(measured.join(" ")).not.toContain("pasted-secret");
    key(KeyCode.Escape); controller.openMenu(menus.root);
    expect(draw()).not.toContain("*************");
    expect(service.read().providers["other-api"].configured).toBe(true);
    menus.dispose();
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("LLM saves model and key only on Save; sign-in cancel and disposal abort pending UI work", async () => {
  const directory = await mkdtemp("/tmp/llm-menu-save-");
  const service = await LlmSettingsService.open({ baseDirectory: directory, request: { fetch: async () => Response.json({ data: [{ id: "test-model" }, { id: "draft-model" }] }) } });
  try {
    await service.selectProvider("chatgpt-api");
    const owner = createIdentityOwner("llm-menu-save"), seat = owner.seat(0);
    let pending = false, cancellations = 0, rejectSignIn: (() => void) | null = null;
    const controller = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"), bindings: () => [],
      focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    const menu = registerLlmSettingsMenu(controller, {
      read: () => ({ ...service.read(), catalogs: testCatalogs, subscriptionAuth: pending ? { status: "pending" } : { status: "idle" } }),
      selectProvider: value => service.selectProvider(value), setModel: (provider, value) => service.setModel(provider, value), refreshModels: async () => [], setReasoningEffort: (provider, value) => service.setReasoningEffort(provider, value),
      saveApiKey: (provider, value) => service.saveApiKey(provider, value), removeCredential: provider => service.removeCredential(provider),
      saveOtherService: value => service.saveOtherService(value),
      signInSubscription: () => { pending = true; return new Promise<void>((_resolve, reject) => { rejectSignIn = () => reject(new Error("fake canceled")); }); },
      cancelSignIn: () => { if (pending) { cancellations++; pending = false; rejectSignIn?.(); } },
    });
    const key = (code: number): void => { controller.input({ seat, timeMilliseconds: 0, kind: "key", code, down: true, repeat: false }); };
    const focus = (id: string): void => {
      for (let index = 0; index < 30; index++) { const current = controller.state().focus; if (current.kind === "menu" && current.control === id) return; key(KeyCode.Tab); }
      throw new Error(`No focusable control ${id}`);
    };
    const text = (value: string): void => { controller.input({ seat, timeMilliseconds: 0, kind: "text", text: value }); };
    controller.openMenu(menu.root);
    focus("ui:llm:model"); key(KeyCode.Enter); key(KeyCode.Enter); focus("ui:llm:key"); text("test-secret");
    expect(service.read().model).toBe(""); expect(service.read().providers["chatgpt-api"].configured).toBe(false);
    focus("ui:llm:save"); key(KeyCode.Enter);
    for (let index = 0; index < 50 && !service.read().providers["chatgpt-api"].configured; index++) await Bun.sleep(2);
    expect(service.read().model).toBe("test-model"); expect(service.read().providers["chatgpt-api"].configured).toBe(true);
    controller.closeMenu(); await service.selectProvider("chatgpt-subscription"); controller.openMenu(menu.root);
    focus("ui:llm:signin"); key(KeyCode.Enter); expect(pending).toBe(true);
    focus("ui:llm:cancel-signin"); key(KeyCode.Enter); await Promise.resolve(); expect(pending).toBe(false); expect(cancellations).toBe(1);
    focus("ui:llm:signin"); key(KeyCode.Enter); expect(pending).toBe(true);
    menu.dispose(); await Promise.resolve(); expect(pending).toBe(false); expect(cancellations).toBe(2);
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const draft of ["", "draft-model"]) test(`subscription sign-in preserves model draft and explains the next step: ${draft || "empty"}`, async () => {
  const directory = await mkdtemp("/tmp/llm-menu-signin-");
  const service = await LlmSettingsService.open({ baseDirectory: directory, request: { fetch: async () => Response.json({ data: [{ id: "test-model" }, { id: "draft-model" }] }) } });
  try {
    const owner = createIdentityOwner("llm-signin-feedback"), seat = owner.seat(0);
    const controller = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"), bindings: () => [],
      focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    const menu = registerLlmSettingsMenu(controller, {
      read: () => ({ ...service.read(), catalogs: testCatalogs }), selectProvider: value => service.selectProvider(value), setModel: (provider, value) => service.setModel(provider, value), refreshModels: async () => [], setReasoningEffort: (provider, value) => service.setReasoningEffort(provider, value),
      saveApiKey: (provider, value) => service.saveApiKey(provider, value), removeCredential: provider => service.removeCredential(provider),
      saveOtherService: value => service.saveOtherService(value), signInSubscription: async () => {}, cancelSignIn: () => {},
    });
    const key = (code: number): void => { controller.input({ seat, timeMilliseconds: 0, kind: "key", code, down: true, repeat: false }); };
    const focus = (id: string): void => {
      for (let index = 0; index < 30; index++) { const current = controller.state().focus; if (current.kind === "menu" && current.control === id) return; key(KeyCode.Tab); }
      throw new Error(`No focusable control ${id}`);
    };
    const provider = { provider: "ui:test", content: "q1:rerelease:id1:retail" } satisfies { readonly provider: "ui:test"; readonly content: "q1:rerelease:id1:retail" };
    const context: UiDrawContext = { timeMilliseconds: 0, binding: { seat, client: owner.client(0, 0), viewport: { x: 0, y: 0, width: 640, height: 480 },
      safeArea: { x: 0, y: 0, width: 640, height: 480 }, hudScale: 1,
      presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: provider.content, hud: provider, effects: provider, audio: provider } } };
    controller.openMenu(menu.root);
    if (draft !== "") { focus("ui:llm:model"); key(KeyCode.Enter); key(KeyCode.Down); key(KeyCode.Enter); }
    focus("ui:llm:signin"); key(KeyCode.Enter);
    await Promise.resolve(); await Promise.resolve();
    const drawn = JSON.stringify(controller.draw(context));
    expect(drawn).toContain("Signed in.");
    expect(drawn).toContain(draft === "" ? "Select a model" : "Save settings to use this model");
    expect(service.read().model).toBe("");
    if (draft !== "") {
      expect(drawn).toContain(draft);
      focus("ui:llm:save"); key(KeyCode.Enter);
      for (let index = 0; index < 50 && service.read().model !== draft; index++) await Bun.sleep(2);
      expect(service.read().model).toBe(draft);
    }
    menu.dispose();
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("provider arrow releases preserve focus across sequential asynchronous choices", async () => {
  const directory = await mkdtemp("/tmp/llm-menu-provider-");
  const service = await LlmSettingsService.open({ baseDirectory: directory, request: { fetch: async () => Response.json({ data: [{ id: "test-model" }, { id: "draft-model" }] }) } });
  try {
    await service.selectProvider("other-api");
    const seat = createIdentityOwner("llm-provider-focus").seat(0);
    const controller = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"), bindings: () => [],
      focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    const menu = registerLlmSettingsMenu(controller, service); controller.openMenu(menu.root);
    const right = (): void => { for (const down of [true, false]) controller.input({ seat, timeMilliseconds: 0, kind: "key", code: KeyCode.Right, down, repeat: false }); };
    for (const provider of ["chatgpt-subscription", "chatgpt-api", "other-api"] satisfies readonly LlmProvider[]) {
      right(); right();
      for (let index = 0; index < 100 && service.read().provider !== provider; index++) await Bun.sleep(2);
      await Bun.sleep(2);
      expect(service.read().provider).toBe(provider);
      expect(controller.state().focus).toEqual({ kind: "menu", menu: menu.root, control: "ui:llm:provider" });
    }
    menu.dispose();
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("provider model pages select a real ID and persist supported effort while refresh is pending", async () => {
  const directory = await mkdtemp("/tmp/llm-menu-catalog-");
  let hold = false;
  const service = await LlmSettingsService.open({ baseDirectory: directory, request: { fetch: async (_url, init) => {
    if (hold) await new Promise<void>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("canceled")), { once: true }); });
    return Response.json({ data: Array.from({ length: 12 }, (_, index) => ({ id: `gpt-5-${String(index).padStart(2, "0")}` })) });
  } } });
  try {
    await service.selectProvider("chatgpt-api"); await service.saveApiKey("chatgpt-api", "dummy");
    const seat = createIdentityOwner("llm-catalog").seat(0);
    const controller = new NativeUiController({ seat, now: () => 0, skin: () => defaultUiSkin("resource:test:font"), bindings: () => [], focus: () => undefined, sound: () => undefined, executeScript: () => undefined });
    const menu = registerLlmSettingsMenu(controller, service);
    const key = (code: number): void => { for (const down of [true, false]) controller.input({ seat, timeMilliseconds: 0, kind: "key", code, down, repeat: false }); };
    const focus = (id: string): void => { for (let index = 0; index < 30; index++) { const state = controller.state().focus; if (state.kind === "menu" && state.control === id) return; key(KeyCode.Tab); } throw new Error(`Missing ${id}`); };
    controller.openMenu(menu.root);
    for (let index = 0; index < 100 && service.read().catalogs["chatgpt-api"].status !== "ready"; index++) await Bun.sleep(2);
    expect(service.read().model).toBe("");
    focus("ui:llm:model"); key(KeyCode.Enter); focus("ui:llm-models:next"); key(KeyCode.Enter);
    focus("ui:llm-models:item:0"); key(KeyCode.Enter);
    focus("ui:llm:effort"); key(KeyCode.Right);
    expect(service.read().model).toBe("");
    hold = true; focus("ui:llm:refresh"); key(KeyCode.Enter);
    expect(service.read().catalogs["chatgpt-api"].status).toBe("loading");
    focus("ui:llm:save"); key(KeyCode.Enter);
    for (let index = 0; index < 100 && service.read().reasoningEffort !== "low"; index++) await Bun.sleep(2);
    expect(service.read().model).toBe("gpt-5-08"); expect(service.read().reasoningEffort).toBe("low");
    expect(service.read().catalogs["chatgpt-api"].status).toBe("loading");
    menu.dispose();
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});
