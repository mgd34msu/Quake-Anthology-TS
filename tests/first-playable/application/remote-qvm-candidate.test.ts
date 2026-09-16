import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { RemoteApplication } from "../../../src/app/bootstrap/remote-application.ts";
import { ApplicationInput } from "../../../src/app/bootstrap/input.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { QvmUi } from "../../../src/compat/qvm/ui.ts";
import { QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { bindConsoleSettings } from "../../../src/ui/settings/console.ts";

test("remote QVM signon and retained-control travel isolate preparation and publish real owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "remote-qvm-candidate-"));
  const common = ["--map", "q3ctf1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch"];
  const selected = parseApplicationCommand([...common, "--game", "q3-baseq3", "--dedicated", "--listen", "0", "--bind", "127.0.0.1", "--user-content-root", join(root, "server")]);
  if (selected.kind !== "run") throw new Error("Missing hosted guest options");
  let server: Application | null = null, remote: RemoteApplication | null = null, retained: ApplicationInput | null = null;
  let reject = true, probes = 0;
  const candidates: ApplicationInput[] = [], laterWrites: (() => Promise<void>)[] = [];
  const prepare = ApplicationInput.prepare;
  const inputPrepare = spyOn(ApplicationInput, "prepare").mockImplementation(async (...args) => {
    const candidate = await prepare(...args); candidates.push(candidate); return candidate;
  });
  const createUi = QvmUi.create;
  const uiCreate = spyOn(QvmUi, "create").mockImplementation(async (seat, options, assertCurrent) => {
    let injected = false;
    return createUi(seat, { ...options, host: call => {
      if (injected) return options.host(call);
      injected = true;
      return (async () => {
        const owner = remote?.clientCommands, candidate = candidates.at(-1), old = retained?.locals[0];
        if (owner === undefined || owner === null || candidate === undefined) throw new Error("Remote candidate probe lost its owner");
        const shared = owner.routing.owner("r_gamma", owner.commands.context);
        const before = { engine: owner.cvars.captureWorldTransferState(), shared: shared.captureWorldTransferState(), pending: owner.commands.pendingText,
          mouse: owner.inputSettings?.cvars.captureWorldTransferState(),
          input: old === undefined ? null : { bindings: old.input.bindings, focus: old.input.focus,
            angles: { ...old.builder.viewAngles }, actor: old.player.actor, held: old.input.hasHeldInput } };
        const guest = new QvmMemory(new Uint8Array(4096));
        const trap = async (code: QvmUiImport, args: readonly number[]) => {
          const words = new DataView(new ArrayBuffer(4 * (args.length + 1))); words.setInt32(0, code, true);
          args.forEach((value, index) => words.setInt32(4 * (index + 1), value, true));
          const request: QvmHostCall = { ...call, kind: "engine", role: "ui", code, words, guest, memory: guest.bytes, commandArguments: null };
          return options.host(request);
        };
        for (const command of ["set r_gamma 1.7", "set volume 0.3", "set fov 115", "set sensitivity 6", "set remote_candidate_marker own-value", 'bind w "echo staged-binding"']) {
          guest.writeString(128, command, 128); expect(await trap(QvmUiImport.UI_CMD_EXECUTETEXT, [0, 128])).toBe(0);
        }
        for (const [name, value] of [["r_gamma", "1.7"], ["volume", "0.3"], ["fov", "115"], ["sensitivity", "6"], ["remote_candidate_marker", "own-value"]]) {
          if (name === undefined || value === undefined) throw new Error("Missing remote cvar probe");
          guest.writeString(256, name, 128); expect(await trap(QvmUiImport.UI_CVAR_VARIABLESTRINGBUFFER, [256, 512, 128])).toBe(0);
          expect(guest.readString(512)).toBe(value);
        }
        expect(await trap(QvmUiImport.UI_KEY_GETBINDINGBUF, [119, 512, 128])).toBe(0); expect(guest.readString(512)).toBe("echo staged-binding");
        expect(await trap(QvmUiImport.UI_KEY_CLEARSTATES, [])).toBe(0); expect(await trap(QvmUiImport.UI_KEY_ISDOWN, [119])).toBe(0);
        expect(owner.cvars.captureWorldTransferState()).toEqual(before.engine); expect(shared.captureWorldTransferState()).toEqual(before.shared);
        expect(owner.inputSettings?.cvars.captureWorldTransferState()).toEqual(before.mouse); expect(owner.commands.pendingText).toBe(before.pending);
        if (old !== undefined) {
          if (before.input === null) throw new Error("Retained input snapshot missing");
          expect(old.input.bindings).toEqual(before.input.bindings); expect(old.input.focus).toEqual(before.input.focus);
          expect(old.builder.viewAngles).toEqual(before.input.angles); expect(old.player.actor).toBe(before.input.actor);
          expect(old.input.hasHeldInput).toBe(before.input.held); expect(old.input.hasHeldInput).toBe(true);
        }
        probes++;
        if (reject) throw new Error("injected remote candidate failure");
        const sharedSettings = candidate.sharedSettings();
        if (sharedSettings === null) throw new Error("Remote candidate has no shared settings");
        const menuControl = bindConsoleSettings(sharedSettings)[0];
        if (menuControl?.kind !== "choice") throw new Error("Remote console menu binding missing");
        laterWrites.push(async () => {
          guest.writeString(256, "r_gamma", 128); guest.writeString(512, "1.4", 128); expect(await trap(QvmUiImport.UI_CVAR_SET, [256, 512])).toBe(0);
          guest.writeString(128, "set sensitivity 4", 128); expect(await trap(QvmUiImport.UI_CMD_EXECUTETEXT, [0, 128])).toBe(0);
          menuControl.write("3"); expect(shared.variableString("con_scale")).toBe("3"); shared.set("con_scale", "2"); expect(menuControl.read()).toBe("2");
        });
        return options.host(call);
      })();
    } }, assertCurrent);
  });
  try {
    server = await Application.open(selected.options, { print: () => undefined });
    expect(server.simulation.q3Source()).not.toBeNull();
    expect(server.simulation.q3Guest()).toBeNull();
    const address = server.networkAddress; if (address === null) throw new Error("Guest server has no listener");
    const parsed = parseApplicationCommand([...common, "--game", "q3-baseq3", "--connect-q3", `127.0.0.1:${address.port}`, "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", join(root, "client")]);
    if (parsed.kind !== "run") throw new Error("Missing remote guest options");
    const reach = async (count: number): Promise<void> => {
      for (let frame = 0; frame < 160; frame++) {
        if (remote === null || server === null) throw new Error("Missing network owner");
        await remote.step(50); await Bun.sleep(1); await server.step(50); await Bun.sleep(1);
        if (probes >= count && remote.networkPhase === "active") return;
      }
      throw new Error(`Remote guest did not reach publication ${count}`);
    };
    remote = await RemoteApplication.open(parsed.options, { print: () => undefined });
    const failedOwner = remote.clientCommands;
    await expect(reach(1)).rejects.toThrow("injected remote candidate failure");
    expect(remote.clientCommands).toBe(failedOwner); expect(remote.localPlayers).toHaveLength(0);
    await remote.close(); remote = null;
    reject = false; remote = await RemoteApplication.open(parsed.options, { print: () => undefined });
    const owner = remote.clientCommands; if (owner === null) throw new Error("Missing persistent remote command owner");
    const commands = owner.commands, engine = owner.cvars, mouse = owner.inputSettings;
    await reach(2); retained = candidates.at(-1) ?? null;
    const first = retained?.locals[0]; if (first === undefined || retained === null || retained.sharedCvars === null) throw new Error("Missing initial remote controls");
    const shared = retained.sharedCvars, seatInput = first.input;
    expect(retained.commands).toBe(commands); expect(retained.cvars).toBe(engine);
    expect(engine.variableString("remote_candidate_marker")).toBe("own-value"); expect(shared.variableString("r_gamma")).toBe("1.7"); expect(remote.viewSettings.fieldOfView).toBe(115);
    const initialWrite = laterWrites[0]; if (initialWrite === undefined) throw new Error("Missing initial guest delegate"); await initialWrite();
    expect(shared.variableString("r_gamma")).toBe("1.4"); expect(mouse?.cvars.variableString("sensitivity")).toBe("4");
    const hold = (): void => {
      const local = retained?.locals[0]; if (local === undefined) throw new Error("No retained remote seat");
      local.builder.setViewAngles({ x: 17, y: 43, z: 0 });
      local.input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+attack; echo retained-release" } });
      local.input.setFocus({ kind: "game" }, 1); local.input.input({ kind: "key", seat: local.player.seat.id, code: 119, down: true, repeat: false, timeMilliseconds: 2 });
      commands.execute(); expect(local.input.hasHeldInput).toBe(true);
    };
    hold(); server.queueCommand("map", ["q3ctf1"], null); await server.step(50); await reach(3);
    retained = candidates.at(-1) ?? null; const current = retained?.locals[0]; if (current === undefined || retained === null) throw new Error("No remote travel controls");
    expect(remote.clientCommands).toBe(owner); expect(owner.commands).toBe(commands); expect(owner.cvars).toBe(engine); expect(owner.inputSettings).toBe(mouse);
    expect(current.input).toBe(seatInput); expect(retained.cvars).toBe(engine); expect(retained.sharedCvars).toBe(shared);
    expect(seatInput.hasHeldInput).toBe(false); expect(seatInput.binding({ kind: "key", code: 119 })).toEqual({ kind: "command", text: "echo staged-binding" });
    const travelWrite = laterWrites[1]; if (travelWrite === undefined) throw new Error("Missing travel guest delegate"); await travelWrite(); expect(shared.variableString("r_gamma")).toBe("1.4");
    hold(); reject = true; const beforeInput = retained, beforeBindings = seatInput.bindings;
    server.queueCommand("map", ["q3ctf1"], null); await server.step(50);
    await expect(reach(4)).rejects.toThrow("injected remote candidate failure");
    expect(remote.clientCommands).toBe(owner); expect(beforeInput.commands).toBe(commands); expect(beforeInput.cvars).toBe(engine);
    expect(seatInput.hasHeldInput).toBe(true); expect(seatInput.bindings).toEqual(beforeBindings); expect(probes).toBe(4); expect(laterWrites).toHaveLength(2);
  } finally {
    try { await remote?.close(); } finally { try { await server?.close(); } finally { uiCreate.mockRestore(); inputPrepare.mockRestore(); await rm(root, { recursive: true, force: true }); } }
  }
}, 180000);
