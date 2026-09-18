import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ApplicationImageSettings } from "../../src/app/bootstrap/image-settings.ts";
import { bindConsoleSettings } from "../../src/ui/settings/console.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { bindGameplaySettings, resetGameplaySettings } from "../../src/ui/settings/gameplay.ts";
import { settingControl } from "../../src/ui/settings/index.ts";

test("identity settings edit only the invoking Quake seat and preserve the other color nibble", () => {
  const owner = createIdentityOwner("identity-settings");
  const server = new CvarRegistry({ dialect: "q1-netquake", context: { session: owner.session, origin: { kind: "server-console" } } });
  const seats = [0, 1].map(index => {
    const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(index), client: owner.client(index, 0) } } });
    cvars.register("_cl_name", `Player ${index + 1}`, CvarFlag.Archive); cvars.register("_cl_color", "35", CvarFlag.Archive); return cvars;
  });
  const first = seats[0], second = seats[1]; if (first === undefined || second === undefined) throw new Error("Missing seats");
  const source = { cvars: server, client: first }, settings = bindGameplaySettings(source);
  const name = settings.find(setting => setting.label === "Player name"), shirt = settings.find(setting => setting.label === "Shirt color"), pants = settings.find(setting => setting.label === "Pants color");
  if (name?.kind !== "text-entry" || shirt?.kind !== "choice" || pants?.kind !== "choice") throw new Error("Missing identity controls");
  const nameControl = settingControl(name, { x: 0, y: 0, width: 200, height: 30 }, owner.seat(0));
  if (nameControl.kind !== "text-entry") throw new Error("Missing name entry");
  nameControl.change(owner.seat(0), "Ranger"); expect(first.variableString("_cl_name")).toBe("Player 1");
  nameControl.submit(owner.seat(0), "Ranger"); shirt.write("13"); pants.write("4");
  expect(first.variableString("_cl_name")).toBe("Ranger"); expect(first.variableValue("_cl_color")).toBe(212);
  expect(shirt.read()).toBe("13"); expect(pants.read()).toBe("4");
  expect(second.variableString("_cl_name")).toBe("Player 2"); expect(second.variableValue("_cl_color")).toBe(35);
  expect(server.find("_cl_name")).toBeUndefined();
  expect(first.archiveEntries()).toContainEqual({ name: "_cl_name", value: "Ranger" });
  resetGameplaySettings(source); expect(first.variableString("_cl_name")).toBe("Player 1"); expect(first.variableValue("_cl_color")).toBe(35);
});

test("Quake II settings use client skin hand and FOV while automatic saves keep server ownership", () => {
  const owner = createIdentityOwner("q2-identity-settings"), context = { session: owner.session, origin: { kind: "server-console" } } satisfies ConstructorParameters<typeof CvarRegistry>[0]["context"];
  const server = new CvarRegistry({ dialect: "q2-rerelease", context }), client = new CvarRegistry({ dialect: "q2-rerelease", context });
  server.register("sv_autosave", "1");
  for (const [name, value] of [["name", "Player"], ["skin", "female/athena"], ["hand", "0"], ["fov", "90"]])
    if (name !== undefined && value !== undefined) client.register(name, value, CvarFlag.UserInfo | CvarFlag.Archive);
  const settings = bindGameplaySettings({ cvars: server, client });
  const skin = settings.find(setting => setting.label === "Player skin (model/skin)"), hand = settings.find(setting => setting.label === "Weapon hand"), fov = settings.find(setting => setting.label === "Field of view"), autosave = settings.find(setting => setting.label === "Automatic saves");
  if (skin?.kind !== "text-entry" || hand?.kind !== "choice" || fov?.kind !== "slider" || autosave?.kind !== "toggle") throw new Error("Missing Q2 controls");
  const skinControl = settingControl(skin, { x: 0, y: 0, width: 200, height: 30 }, owner.seat(0));
  if (skinControl.kind !== "text-entry") throw new Error("Missing skin entry");
  skinControl.submit(owner.seat(0), "female/brianna"); hand.write("1"); fov.write(110); autosave.write(false);
  expect(client.variableString("skin")).toBe("female/brianna"); expect(client.variableValue("hand")).toBe(1); expect(client.variableValue("fov")).toBe(110);
  expect(client.infoString(CvarFlag.UserInfo)).toContain("\\fov\\110"); expect(server.variableValue("sv_autosave")).toBe(0); expect(server.find("skin")).toBeUndefined();
});

test("console size choices persist in the shared local archive", async () => {
  const userContentRoot = await mkdtemp(join(tmpdir(), "console-scale-"));
  const identity = createIdentityOwner("console-settings");
  const options = { userContentRoot, dialect: "q3", context: { session: identity.session, origin: { kind: "local-console" } },
    print: () => undefined } satisfies Parameters<typeof ApplicationImageSettings.open>[0];
  try {
    const settings = await ApplicationImageSettings.open(options);
    const binding = bindConsoleSettings(settings.cvars)[0];
    if (binding?.kind !== "choice") throw new Error("Missing console size choice");
    expect(binding.read()).toBe("0");
    binding.write("3");
    await settings.close();
    const restored = await ApplicationImageSettings.open(options);
    expect(restored.cvars.variableValue("con_scale")).toBe(3);
    await restored.close();
  } finally { await rm(userContentRoot, { recursive: true, force: true }); }
});


test("pickup switching menus share each seat's archived userinfo and reset the same value", async () => {
  const { registerPlayerUserinfo, playerUserinfo } = await import("../../src/app/bootstrap/player-userinfo.ts");
  const owner = createIdentityOwner("pickup-settings"), context = { session: owner.session, origin: { kind: "local-console" } } satisfies ConstructorParameters<typeof CvarRegistry>[0]["context"];
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-rerelease"] satisfies readonly ConstructorParameters<typeof CvarRegistry>[0]["dialect"][]) {
    const first = new CvarRegistry({ dialect, context }), second = new CvarRegistry({ dialect, context });
    registerPlayerUserinfo(first, 0); registerPlayerUserinfo(second, 1);
    const source = { cvars: first, weaponPickupPolicy: "shared" } satisfies import("../../src/ui/settings/gameplay.ts").GameplaySettingsSource;
    const setting = bindGameplaySettings(source).find(value => value.label === "Switch to picked-up weapons");
    if (setting?.kind !== "choice") throw new Error("Missing actual pickup preference");
    const name = dialect === "q2-rerelease" ? "autoswitch" : "qts_weapon_autoswitch", selected = dialect === "q2-rerelease" ? "3" : "never", initial = dialect === "q2-rerelease" ? "0" : "always";
    setting.write(selected); expect(first.variableString(name)).toBe(selected); expect(second.variableString(name)).toBe(initial);
    expect(playerUserinfo(first)).toContain(`\\${name}\\${selected}`); expect(first.archiveEntries()).toContainEqual({ name, value: selected });
    resetGameplaySettings(source); expect(setting.read()).toBe(initial);
    if (dialect !== "q2-rerelease") {
      const opaque = bindGameplaySettings({ cvars: first, weaponPickupPolicy: "source-owned" });
      expect(opaque.some(value => value.label === "Switch to picked-up weapons")).toBe(false);
      expect(opaque.find(value => value.id === "ui:gameplay:source-weapon-switching")?.enabled()).toBe(false);
    }
  }
  const q3 = new CvarRegistry({ dialect: "q3", context }); q3.register("cg_autoswitch", "1", CvarFlag.Archive);
  const setting = bindGameplaySettings({ cvars: q3 }).find(value => value.label === "Switch to picked-up weapons");
  if (setting?.kind !== "toggle") throw new Error("Missing Q3 pickup preference");
  setting.write(false); expect(q3.variableValue("cg_autoswitch")).toBe(0); resetGameplaySettings({ cvars: q3 }); expect(setting.read()).toBe(true);
});
