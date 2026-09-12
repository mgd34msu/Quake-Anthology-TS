import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Q1Creatures } from "../../../src/content/q1/base/creatures.ts";
import type { Q1EntityServices } from "../../../src/content/q1/foundation/entity-services.ts";
import { q1MonsterSources } from "../../../src/content/monsters/q1.ts";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import type { DamageRequest, DamageOutcome, ItemId } from "../../../src/contracts/gameplay.ts";
import type { ProviderId } from "../../../src/contracts/identity.ts";
const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(join(corpus, "q1/rerelease/id1/pak0.pak")) || !existsSync(join(corpus, "q2/baseq2/pak0.pak")) || !existsSync(join(corpus, "q3a/baseq3/pak0.pk3")))("source shambler protection survives native and foreign projectile combat and fresh restore", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shambler-source-"));
    try {
        const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "e1m2", "--movement", "q1", "--character", "q1", "--dedicated", "--mode", "singleplayer"]);
        if (command.kind !== "run")
            throw new Error("No launch");
        const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
        const monsterSource = { provider: "q1:monsters/rerelease/id1", content: catalog.require("q1-rerelease-id1").id } satisfies ProviderReference;
        const weapons: readonly {
            family: string;
            provider: ProviderId;
            product: string;
            weapon: ItemId;
            ammo: ItemId;
        }[] = [
            { family: "native", provider: "q1:official", product: "q1-rerelease-id1", weapon: "q1:weapon/rocketlauncher", ammo: "q1:ammo/rockets" },
            { family: "q1", provider: "q1:official", product: "q1-rerelease-id1", weapon: "q1:weapon/rocketlauncher", ammo: "q1:ammo/rockets" },
            { family: "q2", provider: "q2:official", product: "q2-classic-baseq2", weapon: "q2:weapon_rocketlauncher", ammo: "q2:ammo_rockets" },
            { family: "rail", provider: "q3:official", product: "q3-baseq3", weapon: "q3:weapon/railgun", ammo: "q3:ammo/railgun" },
            { family: "q3", provider: "q3:official", product: "q3-baseq3", weapon: "q3:weapon/rocketlauncher", ammo: "q3:ammo/rocketlauncher" },
        ];
        for (const weapon of weapons) {
            const splash = weapon.family === "q1" || weapon.family === "q3";
            const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: weapon.provider, content: catalog.require(weapon.product).id }] }, enemies: { kind: "selected", value: weapon.family === "native" ? { kind: "map-defined" } : { kind: "replace", default: { source: monsterSource, classname: "monster_army" }, byClassname: Object.fromEntries(Object.keys(q1MonsterSources.find(source => source.edition === "rerelease")?.creatures ?? {}).map(classname => [classname, { source: monsterSource, classname: classname === "monster_ogre" ? "monster_shambler" : classname }])) } } } });
            const captured: {
                game: Q1EntityServices | null;
            } = { game: null }, register = Q1Creatures.prototype.registerSpecies;
            Q1Creatures.prototype.registerSpecies = function (this: Q1Creatures, species) { if (this.game.provider === monsterSource.provider)
                captured.game = this.game; return register.call(this, species); };
            const app = await (async () => { try {
                return weapon.family === "native" ? await Application.open({ ...command.options, map: "maps/e1m6.bsp" }, { print: () => undefined }) : await Application.open(command.options, { print: () => undefined }, recipe);
            }
            finally {
                Q1Creatures.prototype.registerSpecies = register;
            } })();
            try {
                let sim = app.simulation;
                const client = app.session.createClient(0), human = sim.admitPlayer(client.id);
                for (let frame = 0; frame < 15; frame++)
                    sim.step({ elapsedMilliseconds: 100, commands: [] });
                const game = captured.game ?? sim.q1Source()?.game;
                if (game === undefined)
                    throw new Error("No source controller");
                const shambler = [...game.entities.values()].find(entry => entry.classname === "monster_shambler");
                const admittedPlayer = sim.actors.resolveOwned(human.actor);
                if (shambler === undefined || admittedPlayer === null)
                    throw new Error("No shambler/player");
                let player = admittedPlayer;
                let target = shambler.actor;
                const body = sim.bodies.read(target.id), playerBody = sim.bodies.read(player.id);
                if (body === null || playerBody === null)
                    throw new Error("No bodies");
                const obstruction = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: target.id, monsters: true });
                if (obstruction.startSolid)
                    throw new Error("Selected shambler lane obstructed");
                const lane = Array.from({ length: 8 }, (_, index) => { const angle = index * Math.PI / 4; return { ...body.origin, x: body.origin.x + 150 * Math.cos(angle), y: body.origin.y + 150 * Math.sin(angle) }; }).find(origin => {
                    const fit = game.host.trace({ start: origin, end: origin, bounds: playerBody.bounds, ignore: player.id, monsters: true });
                    const shot = game.host.trace({ start: { ...origin, z: origin.z + 22 }, end: { ...body.origin, z: body.origin.z + 22 }, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, ignore: player.id, monsters: true });
                    const teleport = [...game.entities.values()].some(entity => { if (entity.classname !== "trigger_teleport")
                        return false; const trigger = game.body(entity); return origin.x + playerBody.bounds.max.x >= trigger.origin.x + trigger.bounds.min.x && origin.x + playerBody.bounds.min.x <= trigger.origin.x + trigger.bounds.max.x && origin.y + playerBody.bounds.max.y >= trigger.origin.y + trigger.bounds.min.y && origin.y + playerBody.bounds.min.y <= trigger.origin.y + trigger.bounds.max.y && origin.z + playerBody.bounds.max.z >= trigger.origin.z + trigger.bounds.min.z && origin.z + playerBody.bounds.min.z <= trigger.origin.z + trigger.bounds.max.z; });
                    const floor = game.host.trace({ start: origin, end: { ...origin, z: origin.z - 64 }, bounds: playerBody.bounds, ignore: player.id, monsters: true });
                    return !teleport && !fit.startSolid && floor.fraction < 1 && Math.abs(floor.end.z - origin.z) < 8 && shot.actor?.equals(target.id);
                });
                if (lane === undefined)
                    throw new Error("No clear player firing lane");
                const yaw = Math.atan2(body.origin.y - lane.y, body.origin.x - lane.x) * 180 / Math.PI;
                sim.bodies.write(player, { ...playerBody, origin: lane });
                sim.bodies.link(player);
                sim.combat.setHealth(player, 10000);
                sim.inventory.give(player, weapon.weapon, 1);
                sim.inventory.give(player, weapon.ammo, 10);
                if (weapon.family === "q3") {
                    const targetSaved = { slot: target.id.slot, generation: target.id.generation }, playerSaved = { slot: player.id.slot, generation: player.id.generation };
                    await app.saveGame(join(directory, "shambler.sav"));
                    await app.loadGame(join(directory, "shambler.sav"));
                    sim = app.simulation;
                    const restoredTarget = sim.actors.resolveSaved(targetSaved), restoredPlayer = sim.actors.resolveSaved(playerSaved);
                    if (restoredTarget === null || restoredPlayer === null)
                        throw new Error("Missing restored source actors");
                    expect(restoredTarget.id.equals(target.id)).toBe(false);
                    target = restoredTarget;
                    player = restoredPlayer;
                }
                const observed: {
                    incoming: DamageRequest;
                    outcome: DamageOutcome;
                }[] = [], events: DamageOutcome[] = [];
                const apply = sim.combat.apply.bind(sim.combat);
                sim.combat.apply = request => { const outcome = apply(request); if (request.target.equals(target.id) && request.attack.attacker?.equals(player.id))
                    observed.push({ incoming: request, outcome }); return outcome; };
                for (let frame = 0; frame < 35; frame++) {
                    const output = sim.step({ elapsedMilliseconds: 50, commands: [{ actor: player.id, source: { kind: "remote-client", client: client.id }, sequence: frame,
                                command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: sim.timeSeconds, viewAngles: { x: splash ? 30 : 0, y: yaw, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: frame < 5 ? 0 : 1, impulse: 0 },
                                arsenal: { provider: weapon.provider, weapon: weapon.weapon, useHoldable: false } }] });
                    for (const event of output.events)
                        if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed")
                            events.push(event.payload.outcome);
                }
                expect(sim.inventory.count(player.id, weapon.ammo)).toBeLessThan(10);
                const hits = observed.filter(entry => entry.outcome.kind === "committed" && entry.outcome.decision.appliedDamage > 0);
                expect(hits.length).toBeGreaterThan(0);
                let radius = false;
                for (const { incoming, outcome } of hits) {
                    if (outcome.kind !== "committed")
                        throw new Error("Missing committed projectile outcome");
                    const adjusted = outcome.decision.request, scale = weapon.family === "q2" || weapon.family === "q3" ? 0.5 : 1;
                    expect(events).toContain(outcome);
                    expect(adjusted.attack).toEqual(incoming.attack);
                    expect(adjusted.target).toBe(incoming.target);
                    expect(adjusted.delivery).toBe(incoming.delivery);
                    expect(adjusted.attack.weapon).toBe(weapon.weapon);
                    expect(adjusted.attack.weaponProvider).toBe(weapon.provider);
                    expect(adjusted.amount).toBe(scale === 1 ? incoming.amount : Math.fround(incoming.amount * scale));
                    expect(adjusted.knockback).toBe(scale === 1 ? incoming.knockback : Math.fround(incoming.knockback * scale));
                    expect(outcome.decision.appliedDamage).toBe(Math.ceil(adjusted.amount));
                    if (incoming.delivery === "radius")
                        radius = true;
                    if (incoming.delivery === "direct" && (weapon.family === "native" || weapon.family === "q1")) {
                        expect(incoming.amount).toBeGreaterThanOrEqual(50);
                        expect(incoming.amount).toBeLessThanOrEqual(60);
                    }
                    if (weapon.family === "rail")
                        expect(outcome.decision.appliedDamage).toBe(100);
                }
                if (splash)
                    expect(radius).toBe(true);
            }
            finally {
                await app.close();
            }
        }
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
}, 60000);
