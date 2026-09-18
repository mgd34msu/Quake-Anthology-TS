import type { UiControl, UiControlId, UiMenuId } from "../../contracts/ui.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";
import { rankingAccountView, type RankingAccountActions } from "./rankings.ts";

export function registerRankingAccountMenu(controller: NativeUiController,
  current: () => RankingAccountActions | null): { readonly root: UiMenuId; dispose(): void } {
  const root: UiMenuId = "menu:rankings:account";
  let username = "", password = "", email = "", create = false, busy = false, message = "", generation = 0;
  const clear = (): void => { username = ""; password = ""; email = ""; };
  const close = (): void => { generation++; clear(); busy = false; message = ""; };
  const run = (operation: () => Promise<void>): void => {
    if (busy) return;
    const request = generation; busy = true; message = "";
    void (async () => {
      try { await operation(); }
      catch (error: unknown) { if (request === generation) message = error instanceof Error ? error.message : "Ranking account operation failed."; }
      finally { if (request === generation) busy = false; }
    })();
  };
  const unregister = controller.register(root, () => {
    const actions = current(), view = actions === null ? null : rankingAccountView(actions);
    const player = view?.kind === "account" ? view.player : null;
    const editable = !busy && player !== null && player.kind !== "active" && player.kind !== "pending";
    const button = (id: UiControlId, label: string, row: number, action: () => void, enabled = true): UiControl => ({
      id, kind: "button", label, rect: menuRow(row), visible: true, enabled,
      activate: () => { action(); return undefined; },
    });
    const field = (id: UiControlId, label: string, row: number, text: string, change: (text: string) => void, masked = false): UiControl => ({
      id, kind: "text-entry", label, rect: menuRow(row), visible: true, enabled: editable,
      text, masked, maximumLength: 128, change: (_seat, value) => { change(value); return undefined; }, submit: () => undefined,
    });
    const status = message || (busy ? "Working..." : view === null ? "No ranking account service for this player."
      : view.kind === "unavailable" ? view.message : view.kind === "disabled" ? "Rankings are disabled for this match."
      : view.kind === "busy" || player?.kind === "pending" ? "Contacting ranking provider..."
      : player?.kind === "active" ? `Signed in. Rank: ${player.account.rank}`
      : player?.kind === "denied" ? player.reason : player?.kind === "spectator" ? "Spectating. Sign in to play ranked." : "Sign in or create an account.");
    const controls: UiControl[] = [
      field("ui:rankings:username", "Username", 0, username, value => { username = value; }),
      field("ui:rankings:password", "Password", 1, password, value => { password = value; }, true),
      field("ui:rankings:email", "Email (new account)", 2, email, value => { email = value; }),
      { id: "ui:rankings:create", kind: "toggle", label: "Create a new account", rect: menuRow(3), visible: true, enabled: editable,
        checked: create, change: (_seat, value) => { create = value; return undefined; } },
      button("ui:rankings:submit", create ? "Create account" : "Sign in", 4, () => {
        if (actions === null || !editable || username.trim() === "" || password === "") return;
        const request = create ? { kind: "create", username, password, email } satisfies Parameters<RankingAccountActions["submit"]>[0]
          : { kind: "login", username, password } satisfies Parameters<RankingAccountActions["submit"]>[0];
        password = ""; run(() => actions.submit(request));
      }, editable && username.trim() !== "" && password !== "" && (!create || email.trim() !== "")),
      button("ui:rankings:reset", "Reset account status", 5, () => { if (actions !== null) run(() => actions.reset()); }, !busy && (player?.kind === "denied" || player?.kind === "spectator")),
      button("ui:rankings:spectate", "Spectate / sign out", 6, () => { clear(); if (actions !== null) run(() => actions.spectate()); }, !busy && player !== null && player.kind !== "pending"),
      button("ui:rankings:back", "Back", 11, () => controller.closeMenu()),
    ];
    const lines = status.match(/.{1,64}(?:\s|$)|.{1,64}/g) ?? [];
    lines.slice(0, 3).forEach((line, index) => controls.push(button(`ui:rankings:status-${index}`, line, 8 + index, () => undefined, false)));
    return { id: root, title: "Ranking account", fullScreen: false, controls, open: () => undefined, close: () => { close(); return undefined; } };
  });
  return { root, dispose: () => { close(); unregister(); } };
}
