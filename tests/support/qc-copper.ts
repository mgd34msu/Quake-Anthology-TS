// SPDX-License-Identifier: GPL-2.0-or-later
import { QcOpcode } from "../../src/compat/qc/program.ts";
import { QcAssembler } from "./qc-assembler.ts";
import { copperAvailable, copperProgramPath } from "./corpus.ts";

/**
 * QuakeC programs the Copper-gated suites run against. The synthetic program is hand-assembled and contains only the functions
 * and fields those suites call, with the behavior their assertions name; the installed Copper program, when present, runs the
 * same assertions against the original bytes.
 */
export interface QcProgramVariant { readonly name: "synthetic" | "copper"; readonly available: boolean; readonly bytes: () => Promise<Uint8Array>; }

export function copperVariants(): readonly QcProgramVariant[] {
  return [
    { name: "synthetic", available: true, bytes: async () => syntheticCopperProgram() },
    { name: "copper", available: copperAvailable(), bytes: async () => new Uint8Array(await Bun.file(copperProgramPath()).arrayBuffer()) },
  ];
}

let cached: Uint8Array | null = null;
export function syntheticCopperProgram(): Uint8Array {
  if (cached !== null) return cached;
  const asm = new QcAssembler(5927);
  const S = "string" as const, F = "float" as const, E = "entity" as const, V = "vector" as const;
  const bits = (value: number): number => new Uint32Array(new Float32Array([value]).buffer)[0] ?? 0;
  asm.builtin("setorigin", 2, [E, V]); asm.builtin("setmodel", 3, [E, S]); asm.builtin("setsize", 4, [E, V, V]); asm.builtin("sound", 8, [E, F, S, F, F]);
  asm.builtin("checkclient", 17); asm.builtin("lightstyle", 35, [F, S]); asm.builtin("walkmove", 32, [F, F]); asm.builtin("droptofloor", 34);
  asm.builtin("WriteByte", 52, [F, F]); asm.builtin("normalize", 9, [V]); asm.builtin("vlen", 12, [V]);
  asm.builtin("spawn", 14); asm.builtin("remove", 15, [E]); asm.builtin("find", 18, [E, "field", S]);
  asm.builtin("stuffcmd", 21, [E, S]); asm.builtin("bprint", 23, [S]); asm.builtin("sprint", 24, [E, S]); asm.builtin("ceil", 38, [F]);
  asm.builtin("localcmd", 46, [S]); asm.builtin("cvar_set", 72, [S, S]);

  for (const name of ["th_stand", "th_walk", "th_run", "th_pain", "th_die", "th_melee", "th_missile"]) asm.defineField(name, "function");
  for (const [name, type] of [["lastspawn", "entity"], ["killed_monsters", F], ["framecount", F], ["skill", F]] as const) asm.defineGlobal(name, type);
  for (const [grade, mask] of [8192, 16384, 32768].entries()) asm.defineGlobal(`IT_ARMOR${grade + 1}`, F, bits(mask));
  for (const name of ["version", "healthtime", "dmg", "wait", "lifetime_finished", "customflags", "super_damage_finished", "count", "invincible_finished", "state"]) asm.defineField(name);

  // Console functions: component cvars and deferred commands.
  asm.declare("skill_set", [S], fn => { const value = fn.params[0] ?? 0; fn.call("cvar_set", fn.string("skill"), value); });
  asm.declare("restart", [], fn => {
    fn.call("localcmd", fn.string("changelevel ")); fn.call("localcmd", fn.global("mapname")); fn.call("localcmd", fn.string("\n"));
  });

  // Healing: the amount rounds up and the result is held at max_health.
  asm.declare("T_Heal", [E, F, F], fn => {
    const [target, amount, ignore] = fn.params as [number, number, number];
    const health = fn.load(target, "health"), limit = fn.load(target, "max_health");
    fn.call("ceil", amount); const whole = fn.result();
    const sum = fn.add(health, whole);
    const skip = fn.fresh(), done = fn.fresh();
    fn.branch(ignore, skip);
    fn.branchNot(fn.gt(sum, limit), skip);
    fn.store(target, "health", limit); fn.jump(done);
    fn.label(skip); fn.store(target, "health", sum);
    fn.label(done);
  });

  // Helper actors: an impulse spawns one, and it removes itself shortly after.
  asm.declare("SUB_Remove", [], fn => { fn.call("remove", fn.global("self")); });
  asm.declare("SUB_RemoveSoon", [], fn => {
    const self = fn.global("self");
    fn.store(self, "think", fn.fnRef("SUB_Remove"), "function");
    fn.store(self, "nextthink", fn.add(fn.global("time"), fn.float(0.01)));
  });
  asm.declare("SUB_ShouldSpawn", [], fn => {
    const self = fn.global("self"), none = fn.fresh();
    fn.branchNot(fn.eq(fn.load(self, "impulse"), fn.float(20)), none);
    fn.call("spawn"); const helper = fn.result(E);
    fn.store(helper, "owner", self, "entity");
    fn.store(helper, "classname", fn.string("helper"), "string");
    fn.store(helper, "think", fn.fnRef("SUB_Remove"), "function");
    fn.store(helper, "nextthink", fn.add(fn.global("time"), fn.float(30)));
    fn.ret(fn.float(1));
    fn.label(none); fn.ret(fn.float(0));
  });
  // Client stages: autosave through the owner's console, the next intermission spot, and objective cleanup on respawn.
  asm.defineGlobal("isKex");
  asm.declare("autosave", [E, S], fn => {
    const [target, name] = fn.params as [number, number], skip = fn.fresh();
    fn.branch(fn.global("isKex"), skip);
    fn.call("stuffcmd", target, fn.string("echo Autosaving...; wait; save ")); fn.call("stuffcmd", target, name); fn.call("stuffcmd", target, fn.string("\n"));
    fn.label(skip);
  });
  asm.declare("FindNextIntermission", [E], fn => { fn.ret(fn.global("self")); });
  asm.declare("ClearItemEffects", [E], fn => {
    const [target] = fn.params as [number], items = fn.load(target, "items"), effects = fn.load(target, "effects");
    fn.store(target, "items", fn.sub(items, fn.bitAnd(items, fn.float(4194304))));
    fn.store(target, "effects", fn.sub(effects, fn.bitAnd(effects, fn.float(4))));
    const limit = fn.add(fn.global("time"), fn.float(5)), finished = fn.load(target, "super_damage_finished"), skip = fn.fresh();
    fn.branchNot(fn.gt(finished, limit), skip); fn.store(target, "super_damage_finished", limit); fn.label(skip);
  });
  // Combat: damage lowers health, then runs the target's authored pain or death callback; monster deaths count toward the level total.
  asm.declare("killed_monster", [], fn => {
    const total = asm.globalOffset("killed_monsters");
    fn.assign(total, fn.add(total, fn.float(1)));
    fn.call("WriteByte", fn.float(0), fn.float(27));
  });
  // T_Damage hands every hit to T_DamageApply, whose first block (down to the SubF join) is the regular-armor region.
  asm.declare("T_Damage", [E, E, E, F, F], fn => {
    const [target, inflictor, attacker, damage, dflags] = fn.params as [number, number, number, number, number], done = fn.fresh();
    fn.branchNot(fn.load(target, "takedamage"), done);
    fn.call("T_DamageApply", target, inflictor, attacker, damage, dflags);
    fn.label(done);
  }, ["targ", "inflictor", "attacker", "damage", "dflags"]);
  asm.declare("T_DamageApply", [E, E, E, F, F], fn => {
    const [target, , attacker, damage, dflags] = fn.params as [number, number, number, number, number];
    for (let spare = 0; spare < 4; spare++) fn.local();
    const save = fn.named("T_DamageApply.save", "float", fn.local()), zeroed = fn.fresh(), capped = fn.fresh(), joined = fn.fresh();
    const armortype = fn.load(target, "armortype");
    fn.call("ceil", fn.mul(armortype, damage)); fn.assign(save, 1);
    const have = fn.load(target, "armorvalue");
    fn.branch(fn.bitAnd(dflags, fn.float(4)), zeroed);
    fn.branchNot(fn.gt(save, have), capped);
    fn.assign(save, have);
    fn.label(capped);
    fn.store(target, "armorvalue", fn.sub(have, save));
    fn.jump(joined);
    fn.label(zeroed); fn.assign(save, fn.float(0));
    fn.label(joined);
    const take = fn.sub(damage, save);
    const health = fn.sub(fn.load(target, "health"), take);
    fn.store(target, "health", health);
    const self = fn.global("self"), previous = fn.local(E), painful = fn.fresh(), done = fn.fresh();
    fn.assign(previous, self, E); fn.assign(self, target, E);
    fn.branch(fn.gt(health, fn.float(0)), painful);
    const skipCount = fn.fresh();
    fn.branchNot(fn.bitAnd(fn.load(target, "flags"), fn.float(32)), skipCount);
    fn.call("killed_monster");
    fn.label(skipCount);
    fn.callPointer(fn.load(target, "th_die", "function"));
    fn.assign(self, previous, E); fn.jump(done);
    fn.label(painful);
    fn.callPointer(fn.load(target, "th_pain", "function"), attacker, take);
    fn.assign(self, previous, E);
    fn.label(done);
  }, ["targ", "inflictor", "attacker", "damage", "dflags"]);
  // Armor pickup: refuse unless it protects more than the current armor, then store points, tier and absorption in that order.
  asm.declare("armor_give", [E, F, F, F], fn => {
    const [who, value, type] = fn.params as [number, number, number, number], refuse = fn.fresh(), yellow = fn.fresh(), red = fn.fresh(), set = fn.fresh();
    const current = fn.mul(fn.load(who, "armortype"), fn.load(who, "armorvalue"));
    fn.branch(fn.ge(current, fn.mul(type, value)), refuse);
    const items = fn.load(who, "items"), mask = fn.float(8192 + 16384 + 32768), bit = fn.local();
    fn.store(who, "armorvalue", value);
    fn.store(who, "items", fn.sub(items, fn.bitAnd(items, mask)));
    fn.branchNot(fn.lt(type, fn.float(0.5)), yellow); fn.assign(bit, fn.float(8192)); fn.jump(set);
    fn.label(yellow); fn.branchNot(fn.lt(type, fn.float(0.65)), red); fn.assign(bit, fn.float(16384)); fn.jump(set);
    fn.label(red); fn.assign(bit, fn.float(32768));
    fn.label(set);
    fn.store(who, "items", fn.bitOr(fn.load(who, "items"), bit)); fn.store(who, "armortype", type);
    fn.ret(fn.float(1));
    fn.label(refuse); fn.ret(fn.float(0));
  });
  asm.declare("knight_pain", [E, F], fn => { fn.call("sound", fn.global("self"), fn.float(2), fn.string("knight/khurt.wav"), fn.float(1), fn.float(1)); });
  asm.declare("knight_die", [], fn => { fn.call("sound", fn.global("self"), fn.float(2), fn.string("knight/kdeath.wav"), fn.float(1), fn.float(1)); });
  asm.declare("counter_use", [], fn => { const self = fn.global("self"); fn.store(self, "state", fn.add(fn.load(self, "state"), fn.float(1))); });
  asm.declare("bubble_spawn", [V], fn => {
    const origin = fn.params[0] ?? 0;
    fn.call("spawn"); const node = fn.result(E);
    fn.assign(asm.globalOffset("lastspawn"), node, E);
    fn.call("setorigin", node, [origin, "vector"]);
    fn.call("setsize", node, [fn.vec(-16, -16, -24), "vector"], [fn.vec(16, 16, 40), "vector"]);
    fn.store(node, "movetype", fn.float(4)); fn.store(node, "solid", fn.float(3));
  });
  asm.declare("ai_forward", [F], fn => { fn.call("walkmove", fn.load(fn.global("self"), "angles_y"), fn.params[0] ?? 0); });

  // A monster: stands until a client is in view, then announces itself and runs.
  asm.declare("InitLightStyles", [], fn => { fn.call("lightstyle", fn.float(0), fn.string("m")); fn.call("lightstyle", fn.float(1), fn.string("mmnmmommommnonmmonqnmmo")); });
  asm.declare("StartFrame", [], fn => { const frames = asm.globalOffset("framecount"); fn.assign(frames, fn.add(frames, fn.float(1))); });
  asm.declare("FindTarget", [], fn => {
    const self = fn.global("self"), none = fn.fresh();
    fn.call("checkclient"); const found = fn.result(E);
    fn.branch(fn.isNull(found), none);
    fn.branch(fn.binary(QcOpcode.NeS, fn.load(found, "classname", "string"), fn.string("player")), none);
    fn.branch(fn.bitAnd(fn.load(found, "flags"), fn.float(128)), none);
    fn.store(self, "enemy", found, "entity");
    fn.call("sound", self, fn.float(2), fn.string("knight/ksight.wav"), fn.float(1), fn.float(1));
    fn.ret(fn.float(1));
    fn.label(none); fn.ret(fn.float(0));
  });
  for (const [name, next] of [["knight_stand1", "knight_run1"], ["knight_run1", "knight_run1"]] as const) asm.declare(name, [], fn => {
    const self = fn.global("self");
    fn.store(self, "nextthink", fn.add(fn.global("time"), fn.float(0.1)));
    if (name === "knight_stand1") {
      const stay = fn.fresh();
      fn.call("FindTarget"); fn.branchNot(fn.result(), stay);
      fn.store(self, "think", fn.fnRef(next), "function"); fn.label(stay);
    }
  });
  asm.declare("monster_knight_spawn", [], fn => {
    const self = fn.global("self");
    fn.store(self, "classname", fn.string("monster_knight"), "string");
    fn.call("setmodel", self, fn.string("progs/knight.mdl"));
    fn.call("setsize", self, [fn.vec(-16, -16, -24), "vector"], [fn.vec(16, 16, 40), "vector"]);
    fn.store(self, "health", fn.float(72)); fn.store(self, "movetype", fn.float(4)); fn.store(self, "solid", fn.float(3)); fn.store(self, "takedamage", fn.float(2));
    fn.store(self, "th_pain", fn.fnRef("knight_pain"), "function"); fn.store(self, "th_die", fn.fnRef("knight_die"), "function");
    fn.store(self, "think", fn.fnRef("knight_stand1"), "function"); fn.store(self, "nextthink", fn.add(fn.global("time"), fn.float(0.1)));
  });
  // Client input callbacks: overheal decays once a second, and a corpse on the ground loses 20 units of speed per think.
  asm.declare("PlayerHealthTick", [], fn => {
    const self = fn.global("self"), time = fn.global("time"), done = fn.fresh();
    const health = fn.load(self, "health");
    fn.branchNot(fn.gt(health, fn.load(self, "max_health")), done);
    fn.branchNot(fn.ge(time, fn.load(self, "healthtime")), done);
    fn.store(self, "health", fn.sub(health, fn.float(1)));
    fn.store(self, "healthtime", fn.add(time, fn.float(1)));
    fn.label(done);
  });
  asm.declare("PlayerDeathThink", [], fn => {
    const self = fn.global("self"), airborne = fn.fresh(), stopped = fn.fresh(), stored = fn.fresh();
    fn.store(self, "wait", fn.float(1));
    fn.branchNot(fn.bitAnd(fn.load(self, "flags"), fn.float(512)), airborne);
    const velocity = fn.load(self, "velocity", "vector");
    fn.call("vlen", [velocity, "vector"]); const speed = fn.sub(fn.result(), fn.float(20));
    fn.branch(fn.le(speed, fn.float(0)), stopped);
    fn.call("normalize", [velocity, "vector"]); const direction = fn.result("vector");
    const scaled = fn.local("vector"); fn.op(QcOpcode.MulFV, speed, direction, scaled);
    fn.store(self, "velocity", scaled, "vector"); fn.jump(stored);
    fn.label(stopped); fn.store(self, "velocity", fn.vec(0, 0, 0), "vector");
    fn.label(stored); fn.label(airborne);
  });
  // Client lifecycle: a connection count kept in a global and announced to everyone.
  asm.defineGlobal("clients");
  asm.declare("SUB_Null", [], () => undefined);
  asm.declare("ClientConnect", [], fn => {
    const count = asm.globalOffset("clients");
    fn.assign(count, fn.add(count, fn.float(1)));
    fn.call("bprint", fn.load(fn.global("self"), "netname", "string")); fn.call("bprint", fn.string(" entered the game\n"));
  });
  asm.declare("ClientDisconnect", [], fn => {
    const count = asm.globalOffset("clients");
    fn.assign(count, fn.sub(count, fn.float(1)));
    fn.call("bprint", fn.load(fn.global("self"), "netname", "string")); fn.call("bprint", fn.string(" left the game\n"));
  });
  asm.declare("W_WeaponFrame", [], () => undefined);
  asm.declare("player_axe1", [], () => undefined);
  cached = asm.build();
  return cached;
}
