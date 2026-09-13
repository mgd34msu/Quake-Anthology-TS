import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { ApplicationInput } from "../../src/app/bootstrap/input.ts";
import { RemoteApplication } from "../../src/app/bootstrap/remote-application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { defaultMouseTuning } from "../../src/input/mouse.ts";
import { bindInputSettings } from "../../src/ui/settings/index.ts";
import { readFrontendInput } from "../../src/app/bootstrap/frontend-preferences.ts";

test("normal native application shares per-seat mouse values across console, menu and reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "mouse-local-app-"));
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1",
    "--seats", "2", "--renderer", "cpu", "--width", "160", "--height", "120", "--hidden", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing application options");
  const opened = spyOn(ApplicationInput, "open"); let app: Application | null = null;
  const controls = async (): Promise<ApplicationInput> => { const result = opened.mock.results.at(-1); if (result?.type !== "return") throw new Error("Input did not open"); return await result.value; };
  try {
    app = await Application.open(parsed.options, { print: () => undefined });
    const input = await controls(), one = input.locals[0], two = input.locals[1];
    if (one === undefined || two === undefined) throw new Error("Missing two seats");
    input.commands.append("sensitivity 8\nm_pitch -0.125\n", { session: one.player.actor.session,
      origin: { kind: "local-seat", seat: one.player.seat.id, client: one.player.seat.client.id } }); input.commands.execute();
    expect(one.builder.mouse.tuning.sensitivity).toBe(8); expect(two.builder.mouse.tuning.sensitivity).toBe(3);
    const sensitivity = bindInputSettings(one.input, one.builder).find(binding => binding.id === "ui:input:sensitivity");
    if (sensitivity?.kind !== "slider") throw new Error("Missing sensitivity menu");
    expect(sensitivity.read()).toBe(8); sensitivity.write(6);
    expect(input.inputCvars(one.player.seat.id)?.variableValue("sensitivity")).toBe(6);
    await app.close(); app = await Application.open(parsed.options, { print: () => undefined }, undefined, { pitch: 0.011 });
    const reopened = await controls();
    expect(reopened.locals[0]?.builder.mouse.tuning.sensitivity).toBe(6);
    expect(reopened.locals[0]?.builder.mouse.tuning.invertPitch).toBe(true);
    expect(reopened.locals[1]?.builder.mouse.tuning.sensitivity).toBe(3);
    const local = reopened.locals[0]; if (local === undefined) throw new Error("Missing reopened first seat");
    expect(local.builder.mouse.tuning.pitch).toBe(Math.fround(0.011));
    expect(local.builder.mouse.tuning.yaw).toBe(Math.fround(defaultMouseTuning.yaw));
    expect(readFrontendInput(local).pitch).toBe(Math.fround(0.011));
  } finally { await app?.close(); opened.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("remote startup cfg overrides its saved seat before admission and retains the same mouse owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "mouse-remote-app-"));
  const config = new ConfigStore(join(root, "q2/baseq2"));
  await config.saveSeat("input/seat-1.json", { version: 1, bindings: [], gamepad: defaultGamepadTuning,
    mouse: { ...defaultMouseTuning, sensitivity: 7.5, pitch: 0, invertPitch: true }, history: [], rumble: true, controller: { kind: "automatic" } });
  await config.dump("settings/client.cfg", "set sensitivity 3\nset m_yaw 0.5\n");
  const common = ["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--mode", "coop", "--user-content-root", root];
  const serverOptions = parseApplicationCommand([...common, "--dedicated", "--listen", "0", "--bind", "127.0.0.1"]);
  if (serverOptions.kind !== "run") throw new Error("Missing server options");
  const opened = spyOn(ApplicationInput, "open"); let server: Application | null = null, client: RemoteApplication | null = null;
  const host = { print: (): undefined => undefined };
  try {
    server = await Application.open(serverOptions.options, host);
    const address = server.networkAddress; if (address === null) throw new Error("Missing loopback address");
    const parsed = parseApplicationCommand([...common, "--connect-q2", `127.0.0.1:${address.port}`, "--renderer", "cpu", "--width", "160", "--height", "120", "--hidden"]);
    if (parsed.kind !== "run") throw new Error("Missing remote options");
    client = await RemoteApplication.open(parsed.options, host);
    const early = client.clientCommands?.inputSettings; if (early === undefined) throw new Error("Missing early mouse owner");
    expect(early.read().sensitivity).toBe(3); expect(early.read().yaw).toBe(0.5); expect(early.read().invertPitch).toBe(true);
    for (let i = 0; i < 100 && client.localPlayers.length === 0; i++) {
      await client.step(50); await Bun.sleep(1); await server.step(50); await Bun.sleep(1); await client.step(50);
    }
    expect(client.networkPhase).toBe("active");
    const result = opened.mock.results.at(-1); if (result?.type !== "return") throw new Error("Missing admitted input");
    const input = await result.value, local = input.locals[0]; if (local === undefined) throw new Error("Missing remote seat");
    expect(input.inputCvars(local.player.seat.id)).toBe(early.cvars);
    expect(local.builder.mouse.tuning.sensitivity).toBe(3);
    input.commands.append("sensitivity 4\nm_pitch -0\n", { session: local.player.actor.session,
      origin: { kind: "local-seat", seat: local.player.seat.id, client: local.player.seat.client.id } }); input.commands.execute();
    expect(local.builder.mouse.tuning.sensitivity).toBe(4); expect(local.builder.mouse.tuning.invertPitch).toBe(true);
    local.builder.mouse.tuning = { ...local.builder.mouse.tuning, pitch: 0.022 };
    expect(early.cvars.variableValue("m_pitch")).toBeLessThan(0);
    await client.close(); client = null;
    expect((await config.loadSeat("input/seat-1.json"))?.mouse.sensitivity).toBe(4);
    client = await RemoteApplication.open(parsed.options, host);
    expect(client.clientCommands?.inputSettings?.read().sensitivity).toBe(4);
  } finally { await client?.close(); await server?.close(); opened.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);
