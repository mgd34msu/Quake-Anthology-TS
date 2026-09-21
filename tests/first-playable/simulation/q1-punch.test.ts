import { expect, test } from "bun:test";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { discoverInstalledContent, resolveLaunch, presetChoice } from "../../../src/content/catalog/index.ts";
import { decodeSaveImage, encodeSaveImage } from "../../../src/persistence/index.ts";
import { createNumericOperations, Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { dropQ1Punch } from "../../../src/content/q1/foundation/entity-services.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";

const cases = [...["q1", "qw", "q2", "q2-rerelease-baseq2", "q3"].map(movement => ({ movement, foreignWeapons: false })), { movement: "q2", foreignWeapons: true }];
for (const { movement, foreignWeapons } of cases) test(`Q1 addon punch with ${movement} movement and ${foreignWeapons ? "Q3" : "Q1"} weapons survives save`, async () => {
  const parsed = parseApplicationCommand(["--game", "q1-rerelease-mg1", "--map", "start", "--movement", movement, "--character", "q3", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: foreignWeapons ? "q3:official" : "q1:official", content: catalog.require(foreignWeapons ? "q3-baseq3" : "q1-classic-id1").id }] } } });
  const content = await loadApplicationContent(parsed.options, recipe), identity = createIdentityOwner(`punch-${movement}`);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 } satisfies Parameters<typeof createSimulation>[0];
  let simulation = createSimulation(options);
  try {
    let client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
    const source = simulation.q1Source(), weapons = simulation.q1WeaponSource();
    if (source === null || !foreignWeapons && weapons === null) throw new Error("Missing Q1 owners");
    const shaker = source.game.create("trigger_screenshake", { properties: [{ key: "classname", value: "trigger_screenshake" }, { key: "spawnflags", value: "1" }, { key: "dmg", value: "12" }] });
    source.game.spawnEntity(shaker); simulation.callbacks.use(shaker.actor, actor, actor);
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const shake = simulation.playerView(actor).kickAngles;
    if (shake === undefined) throw new Error("Missing source shake");
    expect(Math.hypot(shake.x, shake.y, shake.z)).toBeGreaterThan(0);
    source.game.cancel(shaker);
    if (weapons !== null) {
      const gunPlayer = weapons.game.player(actor); if (gunPlayer === null) throw new Error("Missing weapon player");
      weapons.game.weaponPunch(gunPlayer, -2);
    }
    const punched = weapons === null ? shake : { ...shake, x: -2 }, aim = simulation.playerView(actor).angles;
    expect(simulation.playerView(actor).kickAngles).toEqual(punched);
    expect(source.game.player(actor)?.punchAngles).toEqual(punched);
    const saved = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
    let legacy: typeof saved | null = null;
    if (movement === "q1" && weapons !== null && weapons.game !== source.game) {
      const primary = source.game.player(actor), previous = weapons.game.player(actor);
      if (primary === null || previous === null) throw new Error("Missing legacy recoil owners");
      const primaryValue = primary.punchAngles, previousValue = previous.punchAngles;
      primary.punchAngles = { x: 0, y: 0, z: 0 }; previous.punchAngles = punched;
      const image = simulation.checkpoint();
      legacy = { ...image, providers: image.providers.map(provider => {
        if (provider.schema !== "world:simulation") return provider;
        const value = decodeCheckpointValue(provider.bytes);
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing simulation save object");
        const previousState = { ...value }; Reflect.deleteProperty(previousState, "q1Punch");
        return { ...provider, bytes: encodeCheckpointValue(previousState) };
      }) };
      primary.punchAngles = primaryValue; previous.punchAngles = previousValue;
    }
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const expected = simulation.playerView(actor).kickAngles;
    expect(expected).toEqual(dropQ1Punch(punched, 0.1, createNumericOperations(Q1_DONOR_PROFILE)));
    expect(simulation.playerView(actor).angles).toEqual(aim);
    simulation.close();
    const restored = createIdentityOwner(`punch-restored-${movement}`); client = restored.client(0, 1);
    simulation = createSimulation({ ...options, identity: restored, restore: saved, restoredClients: [client] });
    const restoredActor = simulation.players()[0]; if (restoredActor === undefined) throw new Error("Missing restored player"); actor = restoredActor;
    expect(simulation.playerView(actor).kickAngles).toEqual(punched);
    simulation.step({ elapsedMilliseconds: 100, commands: [] }); expect(simulation.playerView(actor).kickAngles).toEqual(expected);
    if (legacy !== null) {
      simulation.close(); const oldIdentity = createIdentityOwner("legacy-punch"), oldClient = oldIdentity.client(0, 2);
      simulation = createSimulation({ ...options, identity: oldIdentity, restore: legacy, restoredClients: [oldClient] });
      const oldActor = simulation.players()[0]; if (oldActor === undefined) throw new Error("Missing legacy player");
      expect(simulation.playerView(oldActor).kickAngles).toEqual(punched);
      simulation.step({ elapsedMilliseconds: 100, commands: [] }); expect(simulation.playerView(oldActor).kickAngles).toEqual(expected);
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);

for (const movement of ["q1", "q2"]) test(`original QC punch remains source-owned and decays once with ${movement} movement`, async () => {
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--progs", "progs.dat", "--movement", movement, "--character", "q1", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`qc-punch-${movement}`);
  if (content.preparedQuakeC === null) throw new Error("Missing actual QC artifact");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, mode: "singleplayer", skill: 1, seed: 17, maxClients: 1 });
  try {
    const source = simulation.quakecSource(), actor = simulation.admitPlayer(identity.client(0, 0)).actor;
    if (source === null) throw new Error("Missing source");
    const punch = { x: 3, y: 4, z: 0 }, aim = simulation.playerView(actor).angles;
    source.setClientPunchAngles(actor, punch); simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const expected = dropQ1Punch(punch, 0.1, createNumericOperations(Q1_DONOR_PROFILE));
    expect(source.clientPunchAngles(actor)).toEqual(expected); expect(simulation.playerView(actor).kickAngles).toEqual(expected);
    expect(simulation.playerView(actor).angles).toEqual(aim);
  } finally { simulation.close(); await content.close(); }
}, 30000);
