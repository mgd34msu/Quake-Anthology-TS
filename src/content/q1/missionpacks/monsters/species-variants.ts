// SPDX-License-Identifier: GPL-2.0-or-later
/* Rogue and Hipnotic changes to id1 species (progs.dat knight, hknight, zombie, ogre, tarbaby, fish). GPL-2.0-or-later. */
import type { MonsterFrame, MonsterOperation } from "../../base/animation.ts";
import { baseSpecies } from "../../base/species.ts";
import type { MonsterSpecies } from "../../base/species.ts";
import { monsterFrames } from "../../base/frames.ts";
import { monsterAction } from "../../base/monster-actions.ts";
import { dropBackpack, launchOgreGrenade, throwGib, throwHead } from "../../base/projectiles.ts";
import { normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { launchRogueMultiGrenade } from "../rogue-weapons.ts";
import { velocityAngles } from "../types.ts";
import { dropToFloor } from "./helpers.ts";
import { MissionMonster } from "./runtime.ts";
import type { Q1MissionPackMonsters } from "./runtime.ts";
import type { PackMonsterDefinition } from "./types.ts";

const SPAWN_LYING = 2,
  SPAWN_AMBUSH = 4,
  SPAWN_SNEAKY = 8;
const LYING_BOUNDS = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -16 } };
const STATUE_GIBS = ["statgib1", "statgib2", "statgib3"];
const STATUE_SOUNDS: Readonly<Record<string, string>> = {
  "knight/idle.wav": "statue/idle.wav",
  "knight/khurt.wav": "statue/pain.wav",
  "knight/kdeath.wav": "statue/death.wav",
  "hknight/idle.wav": "statue/idle.wav",
  "hknight/pain1.wav": "statue/pain.wav",
  "hknight/death1.wav": "statue/death.wav",
};

/** The shared species behavior as a definition, so a pack can layer overrides on it. */
export function speciesDefinition(spec: MonsterSpecies, extra: Partial<PackMonsterDefinition> = {}): PackMonsterDefinition {
  return {
    spec,
    baseBehavior: true,
    frames: new Map<string, MonsterFrame>(),
    actions: {},
    pain: (monster, attacker, damage) => monster.painDefault(attacker, damage),
    die: (monster, attacker) => monster.dieDefault(attacker),
    ...extra,
  };
}
function species(classname: string): MonsterSpecies {
  const spec = baseSpecies.find(candidate => candidate.classnames.includes(classname));
  if (spec === undefined) throw new Error(`Missing base species for ${classname}`);
  return spec;
}
/** A shared frame whose action operation is retargeted at a pack action of another name. */
function withAction(frame: string, from: string, to: string): readonly [string, MonsterFrame] {
  const source = monsterFrames.get(frame);
  if (source === undefined) throw new Error(`Missing Q1 source animation ${frame}`);
  const operations: readonly MonsterOperation[] = source.operations.map(op => (op.kind === "action" && op.name === from ? { kind: "action", name: to } : op));
  return [frame, { ...source, operations }];
}
function frameCopy(name: string, frame: number, next: string, operations: readonly MonsterOperation[]): readonly [string, MonsterFrame] {
  return [name, { frame, next, operations }];
}
function state(monster: MissionMonster, key: string): number {
  return monster.entity.number(key);
}
function setState(monster: MissionMonster, key: string, value: number): undefined {
  monster.entity.fields.set(key, String(value));
  return undefined;
}

/* knight.qc and hknight.qc: statues (spawnflag 2) hold a frozen frame, take no damage and wake when triggered. */
function statue(spec: MonsterSpecies): PackMonsterDefinition {
  const frozen = spec.species === "knight" ? 44 : 73;
  return speciesDefinition(spec, {
    actions: {
      rogue_statue_pause: monster => {
        monster.entity.damageable = false;
        monster.nextFrame = "rogue_statue_pause";
        return monster.delay(0.1);
      },
    },
    redirect: (monster, name) =>
      state(monster, "rogue_statue") !== 0 && (name === spec.stand || name === spec.walk || name === spec.run) ? "rogue_statue_pause" : name,
    spawn: monster => {
      const { game, entity } = monster;
      if ((entity.spawnflags & SPAWN_LYING) === 0) return monster.spawnDefault();
      for (const model of STATUE_GIBS) game.precacheModel(`progs/${model}.mdl`);
      for (const sound of ["see", "idle", "pain", "death"]) game.precacheSound(`statue/${sound}.wav`);
      if (entity.frame === 0) entity.frame = frozen;
      entity.skin = 1;
      if (entity.targetname === "") {
        // The source returns here without starting the monster, so an untargeted statue is inert scenery.
        entity.model = `progs/${spec.model}.mdl`;
        entity.solid = "slidebox";
        entity.movement = "step";
        entity.maxHealth = spec.health;
        game.host.combat.setHealth(entity.actor, spec.health);
        return game.setBounds(entity, spec.bounds);
      }
      setState(monster, "rogue_statue", 1);
      return monster.spawnDefault();
    },
    use: (monster, activator) => {
      if (state(monster, "rogue_statue") === 0) return monster.useDefault(activator);
      const { game, entity } = monster;
      game.sound(entity, "statue/see.wav");
      entity.damageable = true;
      setState(monster, "rogue_statue", 0);
      entity.use = null;
      monster.enemy = activator;
      return game.schedule(entity, 0.1, game.named.action(entity, "rogue:monster_found"));
    },
    sfx: (monster, path) => ((monster.entity.spawnflags & SPAWN_LYING) === 0 ? path : (STATUE_SOUNDS[path] ?? path)),
    gibDeath: monster => {
      const { game, entity } = monster;
      if ((entity.spawnflags & SPAWN_LYING) === 0) return monster.gibDeathDefault();
      if (game.health(entity.actor.id) >= spec.gibHealth || spec.head === null) return false;
      game.sound(entity, "player/udeath.wav");
      throwHead(game, entity, spec.head);
      for (const model of STATUE_GIBS) throwGib(game, monster.origin, model, game.health(entity.actor.id));
      return true;
    },
  });
}

/* zombie.qc: lying (2), ambush (4) and sneaky (8) zombies. */
const ESCAPE_WAITS: readonly number[] = [0.2, 0.2, 0.2, 0.2, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.1, 0.1, 0.1, 0.15, 0.15, 0.1];
function zombieEscapeFrames(): ReadonlyArray<readonly [string, MonsterFrame]> {
  return ESCAPE_WAITS.map((_wait, index) => {
    const last = index === ESCAPE_WAITS.length - 1;
    return frameCopy(`zombie_escape${index + 1}`, 192 + index, last ? "zombie_run1" : `zombie_escape${index + 2}`, [
      { kind: "action", name: `rogue_zombie_escape${index + 1}` },
    ]);
  });
}
function zombie(spec: MonsterSpecies): PackMonsterDefinition {
  const lurkFrames = [1, 2, 3, 4, 5, 6].map(index =>
    frameCopy(
      `rogue_cruc${index}`,
      191 + index,
      `rogue_cruc${(index % 6) + 1}`,
      index === 1
        ? [
            { kind: "sound", path: "zombie/idle_w2.wav", channel: "voice", attenuation: 3, comparison: "less", chance: 0.1 },
            { kind: "action", name: "rogue_zombie_lurk" },
          ]
        : [{ kind: "action", name: "rogue_zombie_lurk" }],
    ),
  );
  const actions: Record<string, (monster: MissionMonster) => undefined> = {
    rogue_zombie_wake: monster => {
      setState(monster, "rogue_zstate", 0);
      return monster.play("zombie_paine12");
    },
    rogue_zombie_lying_rise: monster => {
      monster.game.setBounds(monster.entity, spec.bounds);
      return monsterAction(monster, "zombie_paine12");
    },
    rogue_zombie_escape: monster => {
      const { game, entity } = monster;
      if (monster.state.painFinished === 0) monster.state.painFinished = Math.fround(game.time + entity.delay);
      monster.nextFrame = "rogue_cruc1";
      return monster.delay(0.1);
    },
    rogue_zombie_lurk: monster => {
      const { game } = monster;
      if (monster.state.painFinished === 0) {
        if (monster.findTarget()) return undefined;
      } else if (monster.state.painFinished < game.time) {
        monster.nextFrame = "zombie_escape1";
        return monster.delay(0.1);
      }
      return monster.delay(0.1 + game.host.random() * 0.1);
    },
  };
  ESCAPE_WAITS.forEach((wait, index) => {
    actions[`rogue_zombie_escape${index + 1}`] = monster => {
      const { game, entity } = monster;
      if (index + 1 >= 14 && index + 1 <= 15) game.setOrigin(entity, vadd(monster.origin, vscale(game.makeVectors(game.body(entity).angles).forward, 8)));
      if (index + 1 === 16) {
        entity.solid = "slidebox";
        entity.movement = "step";
        entity.damageable = true;
        entity.aimedDamage = true;
        setState(monster, "rogue_zstate", 0);
        game.host.combat.setHealth(entity.actor, 60);
        game.sound(entity, "zombie/z_idle.wav", "voice", 2);
        dropToFloor(monster);
        return game.link(entity);
      }
      return monster.delay(wait);
    };
  });
  return speciesDefinition(spec, {
    frames: new Map<string, MonsterFrame>([
      frameCopy("zombie_sleep", 172, "zombie_sleep", [{ kind: "ai", mode: "stand", distance: 0 }]),
      withAction("zombie_paine12", "zombie_paine12", "rogue_zombie_lying_rise"),
      ...lurkFrames,
      ...zombieEscapeFrames(),
    ]),
    actions,
    redirect: (monster, name) => {
      const mode = state(monster, "rogue_zstate");
      if (mode === 1)
        return name === spec.stand ? "zombie_sleep" : name === spec.walk || name === spec.run || name === spec.missile ? "rogue_zombie_wake" : name;
      if (mode === 2)
        return name === spec.stand ? "rogue_cruc1" : name === spec.walk || name === spec.run || name === spec.missile ? "rogue_zombie_escape" : name;
      return name;
    },
    prePain: monster => {
      if (state(monster, "rogue_zstate") !== 1) return false;
      setState(monster, "rogue_zstate", 0);
      monster.play("zombie_paine12");
      return true;
    },
    spawn: monster => {
      const { game, entity } = monster,
        flags = entity.spawnflags;
      if ((flags & 1) !== 0) return monster.spawnDefault();
      if ((flags & SPAWN_LYING) !== 0) {
        if ((flags & SPAWN_AMBUSH) !== 0) entity.spawnflags = SPAWN_LYING;
        setState(monster, "rogue_zstate", 1);
        monster.spawnDefault();
        entity.solid = "none";
        return game.setBounds(entity, LYING_BOUNDS);
      }
      if ((flags & SPAWN_SNEAKY) !== 0) {
        setState(monster, "rogue_zstate", 2);
        game.totalMonsters++;
        entity.maxHealth = spec.health;
        game.host.combat.setHealth(entity.actor, spec.health);
        entity.model = "progs/zombie.mdl";
        entity.solid = "none";
        entity.movement = "none";
        if (entity.delay === 0) entity.delay = 3;
        entity.yawSpeed = entity.number("yaw_speed") || 20;
        entity.idealYaw = game.body(entity).angles.y;
        entity.movementFlags |= 32;
        game.setBounds(entity, spec.bounds);
        entity.pain = game.named.pain(entity, "rogue:monster_pain");
        entity.die = game.named.die(entity, "rogue:monster_die");
        entity.use = game.named.use(entity, "rogue:monster_use");
        monster.play(spec.stand);
        return monster.delay(0.1 + game.host.random() * 0.5);
      }
      if ((flags & SPAWN_AMBUSH) !== 0) entity.spawnflags = SPAWN_LYING;
      return monster.spawnDefault();
    },
  });
}

/* ogre.qc: boss ogres (spawnflag 2) fire multi-grenades, wear skin 1 and drop multi-rockets. */
function ogre(spec: MonsterSpecies): PackMonsterDefinition {
  return speciesDefinition(spec, {
    frames: new Map<string, MonsterFrame>([
      withAction("ogre_nail4", "ogre_nail4", "rogue_ogre_fire"),
      withAction("ogre_die3", "ogre_die3", "rogue_ogre_drop"),
      withAction("ogre_bdie3", "ogre_bdie3", "rogue_ogre_drop"),
    ]),
    actions: {
      rogue_ogre_fire: monster => {
        const { game, entity } = monster;
        if ((entity.spawnflags & 2) === 0) return launchOgreGrenade(monster);
        const target = monster.target;
        if (target === null) return undefined;
        game.effect("muzzleflash", monster.origin, entity.actor.id);
        game.sound(entity, "weapons/grenade.wav", "weapon");
        const direction = normalize(vsub(target, monster.origin)),
          velocity = { x: direction.x * 600, y: direction.y * 600, z: 200 };
        const grenade = launchRogueMultiGrenade(game, entity.actor.id, monster.origin, velocity, velocityAngles(velocity));
        return game.schedule(grenade, 2.5, game.named.action(grenade, "rogue:multi-grenade-split"));
      },
      rogue_ogre_drop: monster => {
        const { game, entity } = monster,
          boss = (entity.spawnflags & 2) !== 0;
        const contents = { weapon: null, shells: 0, nails: 0, rockets: boss ? 0 : 2, cells: 0 };
        dropBackpack(game, monster.origin, boss ? { ...contents, extra: [{ item: "rogue:ammo/multi-rockets", count: 2 }] } : contents);
        return undefined;
      },
    },
    spawn: monster => {
      const { game, entity } = monster;
      if (entity.spawnflags <= 1 && game.options.skill > 0 && game.host.random() <= 0.25) entity.spawnflags |= 2;
      if ((entity.spawnflags & 2) !== 0) entity.skin = 1;
      return monster.spawnDefault();
    },
  });
}

/* tarbaby.qc: skins, health tiers and mitosis. */
function tarbaby(spec: MonsterSpecies, runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  const tiers: readonly { readonly skin: number; readonly health: number }[] = [
    { skin: 0, health: 80 },
    { skin: 1, health: 60 },
    { skin: 2, health: 100 },
  ];
  const mitosis = (monster: MissionMonster): undefined => {
    const { game, entity } = monster;
    if (game.host.random() >= 0.35) return undefined;
    const child = game.create(entity.classname);
    child.movement = "step";
    child.owner = entity.actor.id;
    child.model = "progs/tarbaby.mdl";
    child.solid = "slidebox";
    child.skin = entity.skin;
    child.maxHealth = tiers[entity.skin]?.health ?? 80;
    game.host.combat.setHealth(child.actor, child.maxHealth);
    game.setBounds(child, spec.bounds);
    game.setOrigin(child, monster.origin);
    setState(monster, "rogue_mitosis", 0);
    const controller = new MissionMonster(game, child, monster.definition, runtime);
    runtime.monsters.set(child.actor, controller);
    child.pain = game.named.pain(child, "rogue:monster_pain");
    child.die = game.named.die(child, "rogue:monster_die");
    controller.nextFrame = "rogue_tbaby_checknew";
    controller.delay(0.5);
    game.sound(child, "blob/mytosis.wav");
    return undefined;
  };
  return speciesDefinition(spec, {
    actions: {
      rogue_tbaby_checknew: monster => {
        const { game, entity } = monster,
          parent = game.entity(entity.owner);
        if (!game.host.walkMove(entity.actor, 0, 0)) return game.remove(entity);
        game.setOrigin(entity, vadd(monster.origin, { x: 0, y: 0, z: 1 }));
        dropToFloor(monster);
        if (!game.host.walkMove(entity.actor, 0, 0)) {
          if (parent !== null) setState(runtime.require(parent), "rogue_mitosis", 1);
          return game.remove(entity);
        }
        entity.damageable = true;
        entity.aimedDamage = true;
        entity.idealYaw = game.body(entity).angles.y;
        entity.yawSpeed = entity.number("yaw_speed") || 20;
        entity.use = game.named.use(entity, "rogue:monster_use");
        entity.movementFlags |= 32;
        monster.state.pauseUntil = Math.fround(99999999);
        monster.play(spec.stand);
        monster.delay(0.1 + game.host.random() * 0.5);
        game.totalMonsters++;
        game.host.emit({ kind: "monster-total", total: game.totalMonsters });
        return undefined;
      },
    },
    prePain: monster => {
      if (state(monster, "rogue_mitosis") === 0) return false;
      mitosis(monster);
      return true;
    },
    spawn: monster => {
      const { game, entity } = monster,
        flags = entity.spawnflags;
      game.precacheSound("blob/mytosis.wav");
      let tier = 0,
        splits = true;
      if ((flags & SPAWN_SNEAKY) !== 0) tier = 2;
      else if ((flags & SPAWN_AMBUSH) !== 0) tier = 1;
      else if ((flags & SPAWN_LYING) !== 0) splits = false;
      else {
        const skill = game.options.skill,
          roll = Math.fround(Math.fround(skill * 0.2) + game.host.random());
        if (roll > 0.8 && skill > 1) tier = 2;
        else if (roll > 0.5) tier = 1;
        else splits = false;
      }
      monster.spawnDefault();
      entity.skin = tiers[tier]?.skin ?? 0;
      entity.maxHealth = tiers[tier]?.health ?? 80;
      game.host.combat.setHealth(entity.actor, entity.maxHealth);
      return setState(monster, "rogue_mitosis", splits ? 1 : 0);
    },
  });
}

export function rogueSpeciesVariants(runtime: Q1MissionPackMonsters): readonly PackMonsterDefinition[] {
  return [
    statue(species("monster_knight")),
    statue(species("monster_hell_knight")),
    zombie(species("monster_zombie")),
    ogre(species("monster_ogre")),
    tarbaby(species("monster_tarbaby"), runtime),
  ];
}

/* Hipnotic zombie.qc lying zombies (spawnflag 4) and rotfish.qc gibbing below -20 health. */
export function hipnoticSpeciesVariants(): Readonly<Record<string, Partial<PackMonsterDefinition>>> {
  const zombieStand = (monster: MissionMonster): undefined => {
    const { game } = monster;
    game.host.combat.setHealth(monster.entity.actor, 60);
    setState(monster, "hip_lay", 0);
    monster.delay(0.2);
    if (monster.findTarget()) monster.play("zombie_lay12");
    return undefined;
  };
  return {
    monster_zombie: {
      frames: new Map<string, MonsterFrame>([
        frameCopy("zombie_lay", 172, "zombie_lay", [{ kind: "action", name: "hip_zombie_lay" }]),
        frameCopy("zombie_lay12", 173, "zombie_paine13", []),
      ]),
      actions: { hip_zombie_lay: zombieStand },
      redirect: (monster, name) => (state(monster, "hip_lay") !== 0 && name === monster.spec.stand ? "zombie_lay" : name),
      prePain: monster => {
        if (monster.currentFrame !== "zombie_lay") return false;
        monster.play("zombie_lay12");
        return true;
      },
      spawn: monster => {
        if ((monster.entity.spawnflags & 5) === 4) setState(monster, "hip_lay", 1);
        return monster.spawnDefault();
      },
    },
    monster_fish: {
      gibDeath: monster => {
        const { game, entity } = monster;
        if (game.health(entity.actor.id) >= -20) return false;
        game.sound(entity, "player/udeath.wav");
        for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, game.health(entity.actor.id));
        game.schedule(entity, 0.1, game.named.action(entity, "SUB_Remove"));
        return true;
      },
    },
  };
}
