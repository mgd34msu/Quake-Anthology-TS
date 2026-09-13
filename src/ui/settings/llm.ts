import type { UiControl, UiMenuId } from "../../contracts/ui.ts";
import { LlmSettingsError, type LlmSettingsService } from "../../llm/settings.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";

export type LlmSettingsUi = Pick<LlmSettingsService, "read" | "selectProvider" | "setModel" | "saveApiKey" | "removeCredential" | "saveOtherService" | "signInSubscription" | "cancelSignIn">;
export function registerLlmSettingsMenu(controller: NativeUiController, service: LlmSettingsUi): { readonly root: UiMenuId; dispose(): void } {
  const root: UiMenuId = "menu:settings:llm";
  let key = "", model: string | null = null, baseUrl: string | null = null, busy = false, status = "", generation = 0;
  const clear = (): void => { key = ""; model = null; baseUrl = null; };
  const run = (operation: () => Promise<void>): void => {
    if (busy) return;
    const current = generation;
    busy = true; status = "Working...";
    void (async () => {
      try { await operation(); if (current === generation) { clear(); status = "Saved"; } }
      catch (error) { if (current === generation) status = error instanceof LlmSettingsError ? error.message : "Operation failed. Check settings and retry."; }
      finally { if (current === generation) busy = false; }
    })();
  };
  const unregister = controller.register(root, () => {
    const snapshot = service.read(), provider = snapshot.provider, selected = snapshot.providers[provider];
    const pending = snapshot.subscriptionAuth.status === "pending";
    const button = (id: string, label: string, row: number, action: () => void, enabled = !busy): UiControl => ({
      id: `ui:llm:${id}`, kind: "button", label, rect: menuRow(row), visible: true, enabled,
      activate: () => { action(); return undefined; },
    });
    const field = (id: string, label: string, row: number, text: string, change: (value: string) => void, masked = false): UiControl => ({
      id: `ui:llm:${id}`, kind: "text-entry", label, rect: menuRow(row), visible: true, enabled: !busy,
      text, masked, maximumLength: masked ? 4096 : 512,
      change: (_seat, value) => { change(value); return undefined; }, submit: () => undefined,
    });
    const controls: UiControl[] = [{ id: "ui:llm:provider", kind: "choice", label: "Provider", rect: menuRow(0), visible: true, enabled: !pending,
      selected: provider, choices: [{ id: "chatgpt-subscription", label: "ChatGPT Subscription" }, { id: "chatgpt-api", label: "ChatGPT API" }, { id: "other-api", label: "Other API" }],
      select: (_seat, value) => { if (busy) return undefined; if (value === "chatgpt-subscription" || value === "chatgpt-api" || value === "other-api") { clear(); run(() => service.selectProvider(value)); } return undefined; } },
      button("status", pending ? "Waiting for browser sign-in" : selected.configured ? "Credential stored" : "No credential stored", 1, () => undefined, false),
      field("model", "Model", 2, model ?? selected.model, value => { model = value; }),
    ];
    if (provider === "chatgpt-subscription") {
      controls.push(button("signin", "Sign in with ChatGPT", 3, () => run(() => service.signInSubscription()), !busy && !pending),
        button("cancel-signin", "Cancel sign-in", 4, () => { generation++; service.cancelSignIn(); busy = false; clear(); status = "Sign-in canceled"; }, pending),
        button("signout", "Sign out", 5, () => run(() => service.removeCredential(provider)), !busy && selected.configured));
    } else {
      controls.push(field("key", "Paste API key", 3, key, value => { key = value; }, true),
        button("remove-key", "Remove stored key", 4, () => run(() => service.removeCredential(provider)), !busy && selected.configured));
      if (provider === "other-api") controls.push(field("base-url", "Base URL", 5, baseUrl ?? snapshot.providers["other-api"].baseUrl, value => { baseUrl = value; }),
        button("transport", "OpenAI-compatible Chat Completions", 6, () => undefined, false));
    }
    const message = status || (snapshot.subscriptionAuth.status === "error" ? snapshot.subscriptionAuth.message : snapshot.errors[0]?.message ?? "LLM commands are not active yet");
    const lines = message.match(/.{1,54}(?:\s|$)|.{1,54}/g) ?? [];
    controls.push(button("save", "Save settings", 7, () => {
      const draftKey = key, draftModel = model ?? selected.model, draftBase = baseUrl ?? snapshot.providers["other-api"].baseUrl;
      key = "";
      run(async () => {
        if (provider === "other-api") await service.saveOtherService({ baseUrl: draftBase, model: draftModel, transport: "openai-chat-completions" });
        else await service.setModel(provider, draftModel);
        if (provider !== "chatgpt-subscription" && draftKey !== "") await service.saveApiKey(provider, draftKey);
      });
    }, !busy && !pending), ...lines.slice(0, 2).map((line, index) => button(`message:${index}`, line.trim(), 9 + index, () => undefined, false)),
    button("back", "Back", 11, () => controller.closeMenu(), true));
    return { id: root, title: "LLM options", fullScreen: false, controls,
      open: () => { clear(); status = ""; return undefined; },
      close: () => { generation++; clear(); busy = false; status = ""; service.cancelSignIn(); return undefined; } };
  });
  return { root, dispose() { unregister(); service.cancelSignIn(); clear(); } };
}
