import type { UiControl, UiControlId, UiMenuId } from "../../contracts/ui.ts";
import type { ApplicationLocalLobby, LocalLobbySelection } from "../../app/bootstrap/local-lobby.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";

export function registerLocalLobbyMenu(controller: NativeUiController, current: () => ApplicationLocalLobby | null,
  hostSelection: () => Promise<LocalLobbySelection>, readSeats: () => number): { readonly root: UiMenuId; dispose(): void } {
  const root: UiMenuId = "menu:local:lobby";
  let name = "Local lobby", capacity = 4, busy = false, status = "", page = 0, generation = 0;
  const run = (operation: () => Promise<void>): void => {
    if (busy) return;
    const request = generation; busy = true; status = "";
    void (async () => {
      try { await operation(); }
      catch (error: unknown) { if (request === generation) status = error instanceof Error ? error.message : "Local lobby operation failed."; }
      finally { if (request === generation) busy = false; }
    })();
  };
  const unregister = controller.register(root, () => {
    const owner = current(), lobby = owner?.current() ?? null;
    const button = (id: UiControlId, label: string, row: number, action: () => void, enabled = !busy): UiControl => ({
      id, kind: "button", label, rect: menuRow(row), visible: true, enabled,
      activate: () => { action(); return undefined; },
    });
    const controls: UiControl[] = [];
    if (owner === null) controls.push(button("ui:lobby:unavailable", "No local lobby service is configured.", 0, () => undefined, false));
    else if (lobby === null) {
      const available = owner.list().filter(candidate => candidate.phase === "open");
      page = Math.min(page, Math.max(0, Math.ceil(available.length / 4) - 1));
      controls.push({ id: "ui:lobby:name", kind: "text-entry", label: "Lobby name", rect: menuRow(0), visible: true, enabled: !busy,
        text: name, maximumLength: 64, change: (_seat, value) => { name = value; return undefined; }, submit: () => undefined },
        { id: "ui:lobby:capacity", kind: "slider", label: "Player capacity", rect: menuRow(1), visible: true, enabled: !busy,
          value: capacity, minimum: 1, maximum: 64, step: 1, change: (_seat, value) => { capacity = value; return undefined; } },
        button("ui:lobby:host", "Host selected game", 2, () => run(async () => { const selection = await hostSelection(); await owner.host(name, capacity, selection, readSeats()); }), !busy && name.trim() !== ""));
      available.slice(page * 4, page * 4 + 4).forEach((candidate, index) => controls.push(button(`ui:lobby:join-${index}`,
        `Join ${candidate.name} (${candidate.members.reduce((sum, member) => sum + member.seats, 0)}/${candidate.capacity})`, 3 + index,
        () => run(() => owner.join(candidate.id, readSeats())))));
      controls.push(button("ui:lobby:previous", "Previous lobbies", 7, () => { page--; }, !busy && page > 0),
        button("ui:lobby:next", "Next lobbies", 8, () => { page++; }, !busy && (page + 1) * 4 < available.length));
    } else {
      const member = lobby.members.find(candidate => candidate.account.id === owner.account.id), host = lobby.owner === owner.account.id;
      controls.push(button("ui:lobby:phase", `${lobby.name}: ${lobby.phase === "playing" ? "Playing" : lobby.phase === "starting" ? "Starting host" : "Waiting for readiness"}`, 0, () => undefined, false));
      const pages = Math.max(1, Math.ceil(lobby.members.length / 4)); page = Math.min(page, pages - 1);
      lobby.members.slice(page * 4, page * 4 + 4).forEach((entry, index) => controls.push(button(`ui:lobby:member-${index}`,
        `${entry.account.name}: ${entry.ready ? "Ready" : "Not ready"} (${entry.seats} seat${entry.seats === 1 ? "" : "s"})`, 1 + index, () => undefined, false)));
      controls.push(button("ui:lobby:ready", member?.ready ? "Not ready" : "Ready", 5, () => run(() => owner.ready(!member?.ready)), !busy && lobby.phase === "open"),
        button("ui:lobby:start", lobby.matchGeneration === 0 ? "Start match" : "Start next match", 6, () => run(() => owner.start()),
          !busy && host && lobby.phase === "open" && lobby.members.every(entry => entry.ready)),
        button("ui:lobby:leave", host ? "Close lobby" : "Leave lobby", 7, () => run(() => owner.leave())),
        button("ui:lobby:members", "More members", 8, () => { page = (page + 1) % pages; }, !busy && pages > 1));
    }
    controls.push(button("ui:lobby:status", status || (busy ? "Working..." : "Local shared service; not a retail platform lobby."), 9, () => undefined, false),
      button("ui:lobby:back", "Back", 11, () => controller.closeMenu()));
    return { id: root, title: "Local lobbies", fullScreen: false, controls, open: () => undefined, close: () => undefined };
  });
  return { root, dispose: () => { generation++; unregister(); } };
}
