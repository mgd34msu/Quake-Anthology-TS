import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { ApplicationInput } from "../../../src/app/bootstrap/input.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { QvmUi } from "../../../src/compat/qvm/ui.ts";
import { QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { bindConsoleSettings } from "../../../src/ui/settings/console.ts";
import type { SettingBinding } from "../../../src/ui/settings/index.ts";

test("actual QVM candidate initialization isolates input and shared settings then publishes retained owners once", async () => {
  const root = await mkdtemp(join(tmpdir(), "qvm-candidate-input-"));
  const parsed = parseApplicationCommand(["--game", "q3-classic-lrctf", "--map", "q3ctf1", "--movement", "q3", "--character", "q3",
    "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing guest launch");
  const inputs: ApplicationInput[] = [], openInput = ApplicationInput.open;
  const menuControls: SettingBinding[] = [];
  const inputOpen = spyOn(ApplicationInput, "open").mockImplementation(async (...args) => {
    const input = await openInput(...args); inputs.push(input);
    const shared = input.sharedSettings();
    if (shared !== null) menuControls.push(...bindConsoleSettings(shared));
    return input;
  });
  let inject: "none" | "fail" | "publish" = "none";
  let guestWrites = 0;
  const publishedGuestWrites: (() => Promise<void>)[] = [];
  const createUi = QvmUi.create;
  const uiCreate = spyOn(QvmUi, "create").mockImplementation(async (seat, options, assertCurrent) => {
    if (inject === "none") return createUi(seat, options, assertCurrent);
    const mode = inject;
    let injected = false;
    return createUi(seat, { ...options, host: call => {
      if (injected) return options.host(call);
      injected = true;
      return (async () => {
        const guest = new QvmMemory(new Uint8Array(4096));
        const trap = async (code: QvmUiImport, args: readonly number[]) => {
          const words = new DataView(new ArrayBuffer(4 * (args.length + 1))); words.setInt32(0, code, true);
          args.forEach((value, index) => words.setInt32(4 * (index + 1), value, true));
          const request: QvmHostCall = { ...call, kind: "engine", role: "ui", code, words, guest, memory: guest.bytes, commandArguments: null };
          return options.host(request);
        };
        for (const text of ["set r_gamma 1.8", "set volume 0.2", "set fov 110", "set candidate_marker own-value", 'bind w "echo candidate-binding"']) {
          guest.writeString(128, text, 128);
          expect(await trap(QvmUiImport.UI_CMD_EXECUTETEXT, [0, 128])).toBe(0);
        }
        for (const [name, value] of [["r_gamma", "1.8"], ["volume", "0.2"], ["fov", "110"], ["candidate_marker", "own-value"]]) {
          if (name === undefined || value === undefined) throw new Error("Missing probe pair");
          guest.writeString(256, name, 128);
          expect(await trap(QvmUiImport.UI_CVAR_VARIABLESTRINGBUFFER, [256, 512, 128])).toBe(0);
          expect(guest.readString(512)).toBe(value);
        }
        expect(await trap(QvmUiImport.UI_KEY_GETBINDINGBUF, [119, 512, 128])).toBe(0);
        expect(guest.readString(512)).toBe("echo candidate-binding");
        guest.writeString(256, "echo trap-binding", 128);
        expect(await trap(QvmUiImport.UI_KEY_SETBINDING, [119, 256])).toBe(0);
        expect(await trap(QvmUiImport.UI_KEY_CLEARSTATES, [])).toBe(0);
        expect(await trap(QvmUiImport.UI_KEY_ISDOWN, [119])).toBe(0);
        guestWrites++;
        if (mode === "fail") throw new Error("injected candidate UI failure");
        publishedGuestWrites.push(async () => {
          guest.writeString(128, "set r_gamma 1.4", 128);
          expect(await trap(QvmUiImport.UI_CMD_EXECUTETEXT, [0, 128])).toBe(0);
          guest.writeString(256, "volume", 128); guest.writeString(512, "0.4", 128);
          expect(await trap(QvmUiImport.UI_CVAR_SET, [256, 512])).toBe(0);
        });
        return options.host(call);
      })();
    } }, assertCurrent);
  });
  let app: Application | null = null;
  try {
    app = await Application.open(parsed.options, { print: () => undefined });
    await app.step(50);
    const previous = inputs[0], local = previous?.locals[0];
    if (previous === undefined || local === undefined || previous.sharedCvars === null) throw new Error("Missing graphical input owner");
    const shared = previous.sharedCvars, commands = previous.commands, seatInput = local.input, simulation = app.simulation;
    const save = join(root, "candidate.sav");
    await app.saveGame(save);
    commands.executeNow("set r_gamma 1.25"); commands.executeNow("set volume 0.6"); commands.executeNow("set fov 100");
    seatInput.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+attack; echo original-release" } });
    seatInput.setFocus({ kind: "game" }, 1);
    seatInput.input({ kind: "key", seat: local.player.seat.id, code: 119, down: true, repeat: false, timeMilliseconds: 2 });
    commands.execute(); commands.append("echo original-tail\n");
    const pending = commands.pendingText, bindings = seatInput.bindings, values = shared.captureWorldTransferState();
    expect(seatInput.hasHeldInput).toBe(true); expect(seatInput.button("attack").active).toBe(true);
    inject = "fail";
    await expect(app.loadGame(save)).rejects.toThrow("injected candidate UI failure");
    expect(guestWrites).toBe(1); expect(app.simulation).toBe(simulation);
    expect(previous.sharedCvars).toBe(shared); expect(shared.captureWorldTransferState()).toEqual(values);
    expect(commands.pendingText).toBe(pending); expect(seatInput.bindings).toEqual(bindings);
    expect(seatInput.hasHeldInput).toBe(true); expect(seatInput.button("attack").active).toBe(true);
    expect(app.viewSettings.fieldOfView).toBe(100);
    inject = "publish";
    await app.loadGame(save);
    const current = inputs.at(-1), currentLocal = current?.locals[0];
    if (current === undefined || currentLocal === undefined) throw new Error("Missing published input");
    expect(guestWrites).toBe(2); expect(app.simulation).not.toBe(simulation);
    expect(current.commands).toBe(commands); expect(currentLocal.input).toBe(seatInput); expect(current.sharedCvars).toBe(shared);
    expect(shared.variableString("r_gamma")).toBe("1.8"); expect(shared.variableString("volume")).toBe("0.2");
    expect(app.viewSettings.fieldOfView).toBe(110);
    expect(seatInput.hasHeldInput).toBe(false); expect(seatInput.button("attack").active).toBe(false);
    expect(seatInput.binding({ kind: "key", code: 119 })).toEqual({ kind: "command", text: "echo trap-binding" });
    expect(commands.pendingText).toContain("echo original-tail");
    expect(commands.pendingText.match(/-attack/g)).toHaveLength(1);
    expect(publishedGuestWrites).toHaveLength(1);
    for (const write of publishedGuestWrites) await write();
    expect(shared.variableString("r_gamma")).toBe("1.4"); expect(shared.variableString("volume")).toBe("0.4");
    const menuControl = menuControls.at(-1);
    if (menuControl?.kind !== "choice") throw new Error("Missing real console settings binding");
    menuControl.write("3");
    expect(shared.variableString("con_scale")).toBe("3");
    shared.set("con_scale", "2"); expect(menuControl.read()).toBe("2");
    inject = "none";
    await app.step(50);
  } finally {
    inject = "none";
    try { await app?.close(); } finally { uiCreate.mockRestore(); inputOpen.mockRestore(); await rm(root, { recursive: true, force: true }); }
  }
}, 120000);
