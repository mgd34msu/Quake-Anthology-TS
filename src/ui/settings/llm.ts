import type { UiControl, UiMenuId } from "../../contracts/ui.ts";
import { LlmSettingsError, type LlmSettingsService } from "../../llm/settings.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";

export type LlmSettingsUi = Pick<LlmSettingsService, "read" | "selectProvider" | "setModel" | "saveApiKey" | "removeCredential" | "saveOtherService" | "signInSubscription" | "cancelSignIn" | "refreshModels" | "setReasoningEffort">;
export function registerLlmSettingsMenu(controller: NativeUiController, service: LlmSettingsUi): { readonly root: UiMenuId; dispose(): void } {
  const root: UiMenuId = "menu:settings:llm";
  let key = "", model: string | null = null, baseUrl: string | null = null, busy = false, status = "", generation = 0;
  let effort: string | null | undefined, discovery: AbortController | undefined, page = 0;
  const refresh = (): void => {
    discovery?.abort();
    const snapshot = service.read();
    if (!snapshot.providers[snapshot.provider].configured) return;
    const request = new AbortController(); discovery = request;
    void service.refreshModels(snapshot.provider, request.signal).catch(() => undefined);
  };
  const clear = (): void => { key = ""; model = null; baseUrl = null; effort = undefined; };
  const run = (operation: () => Promise<void>, success = (): void => { clear(); status = "Saved"; }): void => {
    if (busy) return;
    const current = generation;
    busy = true; status = "Working...";
    void (async () => {
      try { await operation(); if (current === generation) success(); }
      catch (error) { if (current === generation) status = error instanceof LlmSettingsError ? error.message : "Operation failed. Check settings and retry."; }
      finally { if (current === generation) busy = false; }
    })();
  };
  const unregister = controller.register(root, () => {
    const snapshot = service.read(), provider = snapshot.provider, selected = snapshot.providers[provider];
    const pending = snapshot.subscriptionAuth.status === "pending";
    const catalog = snapshot.catalogs[provider], chosenModel = model ?? selected.model;
    const metadata = catalog.models.find(item => item.id === chosenModel);
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
      select: (_seat, value) => { if (busy) return undefined; if (value === "chatgpt-subscription" || value === "chatgpt-api" || value === "other-api") { clear(); discovery?.abort(); run(() => service.selectProvider(value), () => { status = ""; refresh(); }); } return undefined; } },
      button("status", pending ? "Waiting for browser sign-in" : selected.configured ? "Credential stored" : "No credential stored", 1, () => undefined, false),
      button("model", `Model: ${chosenModel || "Select a model"}`, 2, () => { page = 0; controller.openMenu("menu:settings:llm-models"); }),
      { id: "ui:llm:effort", kind: "choice", label: "Reasoning effort", rect: menuRow(3), visible: true, enabled: !busy && (metadata?.reasoningEfforts.length ?? 0) > 0,
        selected: (effort === undefined ? snapshot.reasoningEffort : effort) ?? "",
        choices: [{ id: "", label: "Model default" }, ...(metadata?.reasoningEfforts ?? []).map(value => ({ id: value, label: value }))],
        select: (_seat, value) => { effort = value === "" ? null : value; return undefined; } },
    ];
    if (provider === "chatgpt-subscription") {
      controls.push(button("signin", "Sign in with ChatGPT", 4, () => run(() => service.signInSubscription(), () => {
        key = "";
        status = (model ?? selected.model).trim() === "" ? "Signed in. Select a model, then save settings."
          : model !== null ? "Signed in. Save settings to use this model." : "Signed in.";
        refresh();
      }), !busy && !pending),
        button("cancel-signin", "Cancel sign-in", 5, () => { generation++; service.cancelSignIn(); busy = false; clear(); status = "Sign-in canceled"; }, pending),
        button("signout", "Sign out", 6, () => run(() => service.removeCredential(provider)), !busy && selected.configured));
    } else {
      controls.push(field("key", "Paste API key", 4, key, value => { key = value; }, true),
        button("remove-key", "Remove stored key", 5, () => run(() => service.removeCredential(provider)), !busy && selected.configured));
      if (provider === "other-api") controls.push(field("base-url", "Base URL", 6, baseUrl ?? snapshot.providers["other-api"].baseUrl, value => { baseUrl = value; }),
        button("transport", "OpenAI-compatible Chat Completions", 7, () => undefined, false));
    }
    const message = busy ? status : catalog.status === "loading" ? "Loading models... Settings can still be saved."
      : catalog.status === "error" ? catalog.message
      : status || (snapshot.subscriptionAuth.status === "error" ? snapshot.subscriptionAuth.message : snapshot.errors[0]?.message ??
        (chosenModel === "" ? "Select a model after signing in or saving an API key." : "Console: llm_ask or llm_exec"));
    const lines = message.match(/.{1,54}(?:\s|$)|.{1,54}/g) ?? [];
    controls.push(button("save", "Save settings", 8, () => {
      const draftEffort = effort, draftKey = key, draftModel = model ?? selected.model, draftBase = baseUrl ?? snapshot.providers["other-api"].baseUrl;
      key = "";
      run(async () => {
        if (provider === "other-api") await service.saveOtherService({ baseUrl: draftBase, model: draftModel, transport: "openai-chat-completions" });
        else if (draftModel !== "") await service.setModel(provider, draftModel);
        if (draftEffort !== undefined) await service.setReasoningEffort(provider, draftEffort);
        if (provider !== "chatgpt-subscription" && draftKey !== "") await service.saveApiKey(provider, draftKey);
      }, () => { const changedConnection = baseUrl !== null; clear(); status = draftModel === "" ? "Saved. Select a model to use console requests." : "Saved"; if (draftKey !== "" || changedConnection || catalog.status === "idle") refresh(); });
    }, !busy && !pending), button("refresh", "Refresh models", 8, refresh, !busy && !pending && selected.configured), ...lines.slice(0, 2).map((line, index) => button(`message:${index}`, line.trim(), 9 + index, () => undefined, false)),
    button("back", "Back", 11, () => controller.closeMenu(), true));
    return { id: root, title: "LLM options", fullScreen: false, controls: controls.map(control => control.id === "ui:llm:save" ? { ...control, rect: menuRow(8, { width: 248 }) } : control.id === "ui:llm:refresh" ? { ...control, rect: menuRow(8, { x: 328, width: 248 }) } : control),
      open: () => { clear(); status = ""; refresh(); return undefined; },
      close: () => { discovery?.abort(); generation++; clear(); busy = false; status = ""; service.cancelSignIn(); return undefined; } };
  });
  const unregisterModels = controller.register("menu:settings:llm-models", () => {
    const snapshot = service.read(), catalog = snapshot.catalogs[snapshot.provider];
    const pages = Math.max(1, Math.ceil(catalog.models.length / 8)); page = Math.min(page, pages - 1);
    const row = (id: string, label: string, index: number, action: () => void, enabled = true): UiControl => ({
      id: `ui:llm-models:${id}`, kind: "button", label, rect: menuRow(index), visible: true, enabled,
      activate: () => { action(); return undefined; },
    });
    return { id: "menu:settings:llm-models", title: `Models (${page + 1}/${pages})`, fullScreen: false, open: () => undefined, close: () => undefined, controls: [
      ...catalog.models.slice(page * 8, page * 8 + 8).map((item, index) => row(`item:${index}`, item.id, index, () => {
        model = item.id; effort = null; status = "Save settings to use this model."; controller.closeMenu();
      })),
      ...(catalog.models.length === 0 ? [row("empty", catalog.status === "loading" ? "Loading models..." : "No models loaded. Use Refresh models.", 0, () => undefined, false)] : []),
      row("previous", "Previous page", 8, () => { page--; }, page > 0),
      row("next", "Next page", 9, () => { page++; }, page + 1 < pages),
      row("back", "Back", 11, () => controller.closeMenu()),
    ] };
  });
  return { root, dispose() { unregisterModels(); unregister(); discovery?.abort(); service.cancelSignIn(); clear(); } };
}
