# SRC3Q1B — Q1 add-ons, equipment, QuakeC adapters and QC builtins compared against original source

Paths: `RR`, `MG1`, `MG3`, `CTF` = `<scratchpad>/upstream/quake-rerelease-qc/{quakec,quakec_mg1,quakec_mg3,quakec_ctf}`; `WQ` = `<scratchpad>/upstream/Quake/WinQuake`; `q1/` = `src/content/q1/`. Port paths are at HEAD fcdc8af5.

Nothing from `upstream/` was executed. One component reproduction ran from `clean` against retail rerelease `progs.dat`, read-only (`<scratchpad>/src3q1b/builtins.test.ts`). Map counts come from a read-only query of the existing entity dump `<scratchpad>/src2q1/ents-rr.json` (`<scratchpad>/src3q1b/q*.py`).

## Coverage

**This coverage is partial. Roughly half of the assigned port lines (about 7.5K of 14.7K) were not compared. The exact list is below; treat that code as unaudited, not clean.**

**Compared, both sides read:**
| Port | Original |
|---|---|
| src/compat/qc/{builtins,machine,memory,program,executor,source-call,compatibility,profile}.ts | WQ pr_cmds.c (all PF_ functions and the builtin table, except the QUAKE2-only block at 980-1030), and pr_exec.c from what I knew of the file (PR_EnterFunction, PR_LeaveFunction, PR_ExecuteProgram and opcodes); pr_exec.c was not reopened |
| src/compat/qc/{world-host,spatial-host,movement-host,client-host,entity-host,pusher-host,actor-state,presentation-host}.ts | WQ pr_cmds.c; MG1 defs.qc builtin declarations; the builtin number tables of all six QC trees were diffed |
| src/app/bootstrap/simulation/quakec-source.ts 255-420 (builtin wiring only) | WQ pr_cmds.c |
| q1/addons/{index,context,commands,travel,corpses,lights,rope,field-triggers,base-triggers,effects,triggers}.ts | MG3 triggers.qc 1-1292, misc_fx.qc, fog.qc, lights.qc (to light_flame_small_yellow), misc_rope.qc, subs.qc InitTrigger/RemovedRuneCheck/SUB_UseTargets; MG1 triggers.qc and misc_fx.qc through normalized diffs against MG3 |
| q1/addons/brushes.ts lines 1-100 (bob, toss, shatter) | MG3 func_bob.qc, func_toss.qc |
| q1/addons/horde/{types,squads,loot,index}.ts | MG1 horde.qc in full; the horde hooks in combat.qc, items.qc, client.qc, player.qc, weapons.qc |
| q1/addons/items/{common,lavasuit,pickups,upgrades}.ts | MG3 mg3_items.qc, mg3_upgrades.qc; MG3 items.qc through a diff against RR |
| q1/equipment/threewave-grapple.ts | CTF hook.qc |

**Partly compared:**
- q1/addons/ctf/{state,index,flags,scoring,teams,runes}.ts: read in full. Compared against CTF teamplay.qc lines 90-720 after stripping (settings, team damage, team lock, drops, flag touch to the capture start). The remainder of TeamCaptureFlagTouch, the bonus code, and CTF client.qc, items.qc, observ.qc, ctfgame.qc, status.qc were not compared.
- q1/addons/items/weapons.ts: read in full. Compared only to the MG3-minus-MG1 weapons.qc diff, not to mg3_weapons.qc.
- q1/addons/items/commands.ts: read; compared only to the same diff.
- q1/equipment/threewave-weapon.ts: read; the weapons.qc animation source was not opened.
- q1/addons/campaign.ts: read lines 1-115 only.
- q1/addons/brushes.ts lines 100-190 (debris, explode, hurt, misc_model, rotate, breakable): read, not compared.
- MG3 client.qc, player.qc, items.qc: read only as normalized diffs against RR, and the printed diffs were cut off. MG3 client.qc beyond about the changelevel section, player.qc beyond the death frames, and items.qc beyond the weapon_touch start were not seen.
- MG3 weapons.qc: read only as the first 170 added lines of a diff against MG1.
- MG1 client.qc, player.qc, items.qc, weapons.qc: read only at the horde hook lines.

**NOT compared. The exact remaining list:**
- q1/addons/monsters/** (about 4,100 lines: ai, bosses, heavy, infected, ordinary, demodog, startup, and tables). Opened only for grep hits, not read.
- q1/quakec/** (about 1,680 lines: id1-program, id1-damage, id1-pickups, id1-attacks, id1-projectiles, id1-environment, armor-stage, pickup-stage, weapon-stage, damage-scale, damage-call, pickup-callers, armor-points, weapon-stage-declaration). Not read.
- q1/addons/ctf/{drops,arsenal,grapple,maps,observer,travel,types}.ts: `types` read; drops, arsenal, grapple, maps, observer and travel were never opened (they fell outside the read window).
- q1/addons/campaign.ts lines 116-225.
- src/compat/qc/mod-provider.ts lines 1-254 and 500-967; mod-{actors,clients,combat,environment (read 20-60),input,items,messages,objectives,pickups,protection}.ts, save.ts, borrowed-actors.ts, weapon-behavior-profile.ts, quakeworld-presentation.ts, message-effects.ts, message-routing.ts. Not compared to pr_edict.c save/load either.
- WQ pr_edict.c as a whole; upstream/Quake/QW pr_cmds.c (QW-only builtins were checked only by reading the port); MG1/MG3 monsters.

Reason: read-budget limit on this pass, spent first on builtins, horde, triggers and items. This does not meet ROUND3's "read every file" rule, so the list above needs a further pass.

## Strengths
- machine.ts matches pr_exec.c opcode semantics as far as compared, including raw word truth tests for IF and IFNOT, `strcmp`-valued NE_S, argument staging, depth and locals limits, and the per-entry runaway count.
- Pure builtins (ftos, vtos, rint, vectoyaw, vectoangles, normalize, nextent, random) match pr_cmds.c, including float formats and truncation order.
- findradius, droptofloor, traceline, the precache gate and the sound range checks match the source. `makestatic` handles `*N` inline models deliberately.
- Horde squads, spawn point selection (including the repeated-Y block test), wave budget arithmetic, key selection and countdown all match horde.qc line for line. The `SpawnItem` fall-through quirk is preserved and commented.
- MG-specific items (shards, rings, hellknight head, bloody weapons, upgrades, lava suit) track mg3_items.qc and mg3_upgrades.qc closely, including source quirks such as the `0.28` bloody shotgun delay and the commented-out upgrade bonus.
- Threewave grapple and chain follow hook.qc closely, including the 5-second flight timeout, the 10 and 1 damage values, the 10 and 20 blood counts, and the style toggling.
- Candidates dropped after checking: `hunger_time` and `axe_hit_chain` have no reader or writer in the source either, so the port's inert handling is correct. `InitTrigger` overriding an authored `movedir` (0 map entities have both keys). `REQUIRE_ONGROUND` on `trigger_multitouch` (0 entities). `trigger_freeze` setting damageable false in MG3, where the source has no `is_frozen` test (0 entities on any shipped map). `eprint` and `coredump` are not used by any shipped QC, which is why SRC3Q1B-006 is Low.

## Findings

### SRC3Q1B-001 — Base pickups ignore MG start-item flags: 43 hidden items are visible, 40 rune-gated items always spawn, 75 no-drop items fall
- **Verification (VERIFY-T): confirmed. Final severity: High.** MG3 items.qc:66-75,:101-106,:121,:135-138 and defs.qc:707 are as cited. spawnPickup and placeItem (pickups.ts:315,:420-426) have no gates; startMg3Item (ad/items/common.ts:9-15) covers MG3-authored classes only. Recount matches: 43 spawned, 40 rune-gated, 73+2 no-drop, 2 coop-only; hub supershotgun flags 3932160.
- Severity: High
- Category: bug
- Location: src/content/q1/foundation/pickups.ts:315-357, :420-426; src/content/q1/addons/items/common.ts:9-15 (MG3-only items only)
- Confidence: traced
- Evidence: Original (MG3):
  - items.qc:101-106 and :135-138: `else if(self.spawnflags & SPAWNED) { self.model = string_null; self.solid = SOLID_NOT; }` and `self.use = SUB_regen`.
  - items.qc:121: `if (RemovedRuneCheck()) return;`, preceded by `INHIBIT_COOP` and `RemovedOutsideCoop`.
  - items.qc:70-73 (MG1 items.qc:61-64 too): `if(self.spawnflags & DROPTOFLOOR_DISABLE) self.movetype = MOVETYPE_NONE`, and defs.qc:707 makes `droptofloor` return TRUE without moving.

  Port: `startMg3Item` implements the coop, rune and spawned gates, but only the MG3-authored classes call it (lava suit, rings, shard, hammer, laser, upgrades). Ordinary `item_*` and `weapon_*` go through `spawnPickup`, then `placeItem`: `entity.solid = "trigger"; entity.movement = "toss"; ...`. There is no flag 4, 65536 or rune test, and a grep for `removedForRunes`, `removedOutsideCoop` and `65536` in `q1/foundation`, `q1/base` and `composition` finds nothing.

  Map counts (MG3, excluding classes handled by startMg3Item):
  - SPAWNED: spikes 18, shells 10, health 6, rockets 5, cells 2, armor2 1, quad 1 = 43.
  - Rune flags: rockets 12, cells 6, health 3, spikes 3, shells 2, quad 4, pent 1, and 9 weapons including `weapon_supershotgun` on hub.bsp with flags 3932160 (removed at 0, 1, 2 and 3 runes) = 40.
  - DROPTOFLOOR_DISABLE: 73 in MG3 (startMg3Item's place step also calls the same `PlaceItem`, so shards and rings are included) and 2 in MG1.
  - COOP_ONLY: 2 `item_shells` on mge1m1.
- Impact: MG3's hub offers weapons that should appear only after four runes. Items meant to be revealed by triggers are present from the start and their triggers do nothing, because `use` is never bound. Items placed on ledges or in mid-air drop to the floor below, or are removed if nothing is within 256 units. Coop-only ammo appears in single player. MG3's ammo economy and pacing change on many maps.
- Remediation: Apply the source flag gates in the shared pickup spawn and `placeItem` for add-on programs, reusing `startMg3Item`'s checks.

### SRC3Q1B-002 — MG `trigger_teleport` flags are ignored: IGNORE_TARGETNAME and start-dormant teleporters work only for 0.2 s after being fired
- **Verification (VERIFY-T): confirmed. Final severity: High.** MG3 triggers.qc:552,:652-656 and MG1 triggers.qc:530 are as cited; spawns.ts:205 has no flag test, and base-triggers.ts:40-43 delegates to it. Map entities match exactly: mge5m2 voidtele (7), boss tele_a (6), tele_b and tele_c (14), tele_b2 and tele_c2 (15).
- Severity: High
- Category: bug
- Location: src/content/q1/foundation/spawns.ts:205, :53-61; src/content/q1/addons/base-triggers.ts:40-43
- Confidence: traced
- Evidence: MG3 triggers.qc:552: `if (self.targetname && (self.spawnflags & IGNORE_TARGETNAME) == 0) { if (self.nextthink < time) return; }` (MG1 triggers.qc:530 is the same). MG3 triggers.qc:652-656: `if ((self.spawnflags & 8) && (self.targetname)) { self.use = teleport_activate; self.touch = SUB_Null; }`, and :666 re-arms touch on first use. Port: `if (entity.targetname !== "" && entity.nextThink < game.time) return undefined;` with no flag test. The add-on registers `trigger_teleport` through `spawnMapActor`, so the base code runs unchanged. Map data:
  - mge5m2.bsp `voidtele` (flags 7), target `voidsave`.
  - boss.bsp `tele_a` (6), `tele_b` and `tele_c` (14), `tele_b2` and `tele_c2` (15).
- Impact: On mge5m2 the void rescue teleporter never fires unless something triggers it within the 0.2 s window, so a player falling into the void is not returned. In the MG3 final boss map the arena teleporters stop working as permanent teleporters once armed, breaking the boss flow.
- Remediation: Honor flag 4 in teleport_touch and add the flag 8 dormant state for these programs.

### SRC3Q1B-003 — Rerelease `ex_bprint`, `ex_sprint` and `ex_centerprint` concatenate format arguments, so localized prints show raw keys
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** RR defs.qc:683-684,:749 declare varargs ex_ prints; presentation-host.ts:127-131,:157 join them through machine.ts:183-187, and q1-localization.ts:44 returns the raw value. Reach is `--progs` or custom mods only (content.ts:168-173), which the finding states.
- Severity: Medium
- Category: bug
- Location: src/compat/qc/presentation-host.ts:127-131, :157; src/compat/qc/machine.ts:183-187 (`varString`); src/app/bootstrap/q1-localization.ts:44
- Confidence: reproduced
- Evidence: RR client.qc:1472: `bprint("$qc_entered", self.netname);` and :1592: `bprint("$qc_death_ax", targ.netname, attacker.netname);`. RR declares these as `#0:ex_bprint` with varargs, where the extra arguments fill the key's slots. Port: `const text = vm.varString(0);`, which joins all arguments. Reproduction against retail rerelease progs with `$qc_entered` and `Ranger`: `ex_bprint printed: ["$qc_enteredRanger"]`. Q1MessageLocalization then runs `if (value.startsWith('$') && table.find(value.slice(1)) === undefined) return value;`, so the raw string is shown. tests/compat/qc/rerelease-builtins.test.ts tests only a one-argument print. Native TS rules avoid this by passing `args`; this path is only for rerelease `progs.dat` run in the QC machine (tests/composition/q1/source.test.ts:24 runs this configuration).
- Impact: When a rerelease program runs as the QC source, every print with arguments shows garbage: entered, left, suicides, all obituaries, `$qc_got_item` pickups, backpack contents.
- Remediation: For the `ex_*` family, carry the first string as the key and the rest as arguments through print events and the wire, as the native rules do.

### SRC3Q1B-004 — `sprint` and `centerprint` to a non-client are fatal; the original prints a warning and continues
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** WQ pr_cmds.c:299-303,:330-334 warn and return; presentation-host.ts:164 calls vm.fail for a non-client, while the QW branch prints. No shipped call was shown to hit this, which limits it to mods.
- Severity: Medium
- Category: bug
- Location: src/compat/qc/presentation-host.ts:164; src/app/bootstrap/simulation/quakec-source.ts:310
- Confidence: reproduced
- Evidence: WQ pr_cmds.c:299-303 and :330-334: `if (entnum < 1 || entnum > svs.maxclients) { Con_Printf ("tried to sprint to a non-client\n"); return; }`. Only PF_stuffcmd raises PR_RunError. Port NQ branch: `if (!services.nq.client(actor.id)) return vm.fail("Client message addressed a non-client");`. The QW branch at :159 gets this right. Reproduction: `ex_sprint to non-client: QuakeC 0:0: Client message addressed a non-client`. Separately, `world.actor(slot)` at :157 throws for a freed edict, where the original still returns harmlessly. No shipped call was confirmed to hit this; community mods often `sprint(self.owner, ...)` where the owner is a monster or world.
- Impact: Under APP-001 a harmless mod print to a non-client ends the process, and on a dedicated server ends the session for all clients.
- Remediation: Print the warning and return for `sprint` and `centerprint`, and keep the fatal error for `stuffcmd`.

### SRC3Q1B-005 — `find` skips entities whose string field is empty, so `find(world, field, "")` returns world rather than the first edict
- **Verification (VERIFY-T): confirmed. Final severity: Low.** WQ pr_cmds.c:1036-1049 with progs.h:112 means "" matches; builtins.ts:152 skips offset 0 and entity-services.ts:388 returns []. RR ai.qc:145-152 consequence holds; counts MG3 29, MG1 8, Hipnotic 3, Rogue 2 match. It affects only unalerted monsters reaching a route end, and the rerelease engine cannot be checked, so Low.
- Severity: Medium
- Category: bug
- Location: src/compat/qc/builtins.ts:152; src/content/q1/foundation/entity-services.ts:388
- Confidence: reproduced
- Evidence: WQ pr_cmds.c:1041-1045: `t = E_STRING(ed,f); if (!t) continue; if (!strcmp(t,s)) { RETURN_EDICT(ed); ...`. `E_STRING` is `pr_strings + offset`, so it is never NULL, and offset 0 is `""`. Port: `if (text !== 0 && machine.strings.get(text) === match)`. Reproduction with a live slot 1 and an empty match: `find empty returned slot: 0`; the original returns edict 1. The consequence is in RR ai.qc:145-152, `t_movetarget`: `self.goalentity = self.movetarget = find (world, targetname, other.target); ... if (!self.movetarget) { self.pausetime = time + 999999; self.th_stand (); return; }`. With a terminal `path_corner` (no target), the WinQuake engine gives edict 1, the first client, as the goal, so the stand branch does not run. The port always takes the stand branch. Native TS `find` makes the same choice: `targetname === "" ? [] : ...`. Map data: terminal targeted `path_corner` count is MG3 29, MG1 8, Hipnotic 3, id1 2, Rogue 2. This compares to WinQuake; the rerelease engine's `find` is not available to check.
- Impact: Monsters finishing a patrol route stand for 999999 s until woken, where the original has them keep walking toward the first player. Any mod relying on empty-string matches also differs.
- Remediation: Remove the `text !== 0` guard in the builtin, and match this in the native path where the QC source is the reference.

### SRC3Q1B-006 — `objerror`, `eprint`, `coredump` and `break` are never bound, so they fail as "unbound builtin"
- **Verification (VERIFY-T): confirmed. Final severity: Low.** The four names occur only in builtins.ts:10-12,:36-38; machine.ts:189 missingBuiltins has no caller, and machine.ts:198-200 fails with `unbound builtin`. WQ pr_cmds.c:81-94 prints the diagnostic the port loses.
- Severity: Low
- Category: bug
- Location: src/compat/qc/builtins.ts:36-43, :167-172; src/compat/qc/machine.ts:198-200; no binding in src/app/bootstrap/simulation/quakec-source.ts:316-360, src/compat/qc/mod-environment.ts:33-35
- Confidence: traced
- Evidence: A grep for `"objerror"`, `"eprint"`, `"coredump"` and `"break"` across `src` finds them only in builtins.ts. `missingBuiltins()` has no caller, so nothing reports this at load. WQ pr_cmds.c: PF_objerror prints `======OBJECT ERROR in %s` with the function name and dumps self before Host_Error. PF_eprint and PF_coredump only print. RR has 16 `objerror` calls. VERIFY-C noted the runtime message (`unbound builtin objerror (11)`) without a finding.
- Impact: A map error loses its diagnostic text (`couldn't find target`, for example) and reports a misleading host fault. A mod using `eprint` or `coredump` for debugging, harmless in the original, becomes a fatal error.
- Remediation: Bind `objerror` with its message and bind `eprint` and `coredump` as prints. Call `missingBuiltins` at load and report by name.

### SRC3Q1B-007 — `setmodel(e, "")` fails in component QuakeC mods; only the primary host handles it
- **Verification (VERIFY-T): confirmed. Final severity: Low.** WQ sv_main.c:1146 and pr_cmds.c:245-250 accept ""; mod-provider.ts:269-274 returns null for it and spatial-host.ts:42-43 fails, while quakec-source.ts:276 special-cases it.
- Severity: Low
- Category: bug
- Location: src/compat/qc/mod-provider.ts:269-274; src/compat/qc/spatial-host.ts:42-43; contrast src/app/bootstrap/simulation/quakec-source.ts:276
- Confidence: traced
- Evidence: WQ sv_main.c:1146: `sv.model_precache[0] = pr_strings;` makes `""` match index 0 at pr_cmds.c PF_setmodel, then `SetMinMaxSize(e, vec3_origin, vec3_origin, true)`. The primary host has `name === "" ? { index: 0, bounds: ... }`. The mod provider uses `media.resources.get(name)` and `this.lookup("model", name)`, which return null for `""`, then `vm.fail("no precache: ")`.
- Impact: A mod clearing a model through setmodel ends the process.
- Remediation: Share the empty-name case between both hosts.

### SRC3Q1B-008 — Fog is not pushed on teleport, on client spawn or at intermission
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 triggers.qc:603-606, client.qc:417,:850-852 push fog; `fog_info` occurs only in ad/effects.ts:155. Counts 16 teleport destinations and 67 spawn points (45+22) match.
- Severity: Medium
- Category: bug
- Location: src/content/q1/foundation/spawns.ts:204-221; src/content/composition/q1/runtime.ts:226-230; src/content/q1/addons/effects.ts:153-200 (the only `fog_info_entity` reader)
- Confidence: traced
- Evidence: MG3 triggers.qc:605 (MG1 :583): `if(!coop && !deathmatch) FogPushSettingsFrom(other, t, 0);` on teleport. MG3 client.qc:850-852 (MG1 :898-900): `if(!FogPushSettingsFrom(self, spot, 0)) FogPushSettingsFrom(self, world, 0);` in PutClientInServer. MG3 client.qc:417 (MG1 :404) at intermission. A grep for `fog_info` in `q1/` finds only effects.ts:155, which runs from `trigger_fog` touch and use. Map data: 16 `info_teleport_destination` with `fog_info_entity` (for example mge5m2 `voidsave` -> `fog_abyss`, map3 `other_world_01` -> `church_fog`), and 67 spawn points (MG1 45, MG3 22).
- Impact: Fog does not change when teleporting between MG areas, so authored "other world" sections keep the wrong atmosphere, and fog set for a spawn point is not applied on start or respawn.
- Remediation: Call the existing fog activation from teleport, spawn and intermission under the same mode gates.

### SRC3Q1B-009 — Horde powerups last 30 seconds; the source gives 5
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG1 items.qc:1148-1151,:1164-1167 use 5 seconds in Horde; ad/horde/loot.ts:128 spawns the base item, whose take calls givePowerup with default 30 (pickups.ts:91, entity-services.ts:668). q1/base and q1/foundation contain no horde handling.
- Severity: Medium
- Category: bug
- Location: src/content/q1/addons/horde/loot.ts:122-131; src/content/q1/foundation/pickups.ts:91; src/content/q1/foundation/entity-services.ts:668
- Confidence: traced
- Evidence: MG1 items.qc:1148-1151: `if (horde_ent) other.invincible_finished = time + 5; else ... + 30`, and :1164-1167 the same for quad. Port: `game.spawnEntity(powerup)` uses the base definition, `runtime.givePowerup(player, powerup.kind)`, with `duration = 30`. A grep for `horde` in `q1/foundation` and `q1/base` finds nothing, and no pickup rule changes it.
- Impact: Every Horde quad and pentagram lasts six times longer, on a 2.5% rising drop chance, which materially eases the mode.
- Remediation: Give the powerups a 5-second duration when a horde manager exists.

### SRC3Q1B-010 — `kill` in Horde does not kill: in coop it does nothing while another player lives, and solo it restarts at once
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG1 client.qc:622-626 runs PlayerDie; composition/q1/runtime.ts:273-276 notices then calls requestRespawn, and ad/horde/index.ts:239-243 returns true with no effect while anyone lives, or restarts when solo.
- Severity: Medium
- Category: bug
- Location: src/content/composition/q1/runtime.ts:220-221, :273-276; src/content/q1/addons/horde/index.ts:239-243
- Confidence: traced
- Evidence: MG1 client.qc:622-626: `if (cvar("horde")) { PlayerDie(); self.health = 0; }`. Port: `this.notice(actor, "suicide"); return this.requestRespawn(actor);`, and `requestRespawn` returns true after `if (!this.game.options.coop || this.livingPlayers().length === 0) this.restartAfterDefeat();`. With a living player, including the suicider, coop does nothing. The source's horde-only `PlayerDie` path never runs.
- Impact: In coop Horde `kill` prints the suicide message and leaves the player alive and unharmed. A stuck player cannot die to wait for the next wave's team respawn. Solo, `kill` restarts the map with no death sequence.
- Remediation: In Horde, run the normal player death for `kill` and keep restart logic in the post-death respawn request.

### SRC3Q1B-011 — Horde still drops backpacks, from players and monsters
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG1 items.qc:1362-1364 returns in Horde; composition/q1/runtime.ts:246-250 gates on single player only, and base/monster-actions.ts:114,:128 call dropBackpack directly.
- Severity: Low
- Category: bug
- Location: src/content/composition/q1/runtime.ts:246-250; src/content/q1/base/monster-actions.ts:114, :128
- Confidence: traced
- Evidence: MG1 items.qc:1362-1364: `// don't drop backpacks in horde mode` then `if (horde_ent) return;`. Port `dropInventory` gates only on single-player, and monster deaths call `dropBackpack` directly. Neither tests the horde manager.
- Impact: Enforcers, ogres and coop players add ammo the mode's shared loot economy excludes, and items accumulate over long sessions.
- Remediation: Return early from both drop paths when a horde manager exists.

### SRC3Q1B-012 — Horde's monster reaggro limit and coop spawn selection are not ported
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Low.** Reaggro half refuted: MG1 combat.qc:308 is `aggro_time + AGGRO_MIN + (random()*AGGRO_ADD < time)`, nonzero whenever aggro_time is set, so the ignore branch is unreachable and monsters retarget on every hit in the source too. Spawn half stands: MG1 client.qc:699-723 has no port equivalent (composition/q1/runtime.ts:231-235).
- Severity: Low
- Category: bug
- Location: src/content/composition/q1/runtime.ts:226-233; src/content/q1/base/rules.ts:47-51
- Confidence: traced
- Evidence: MG1 combat.qc:299-315 limits a monster's switch between two player enemies using `aggro_time`, `AGGRO_MIN` and `AGGRO_ADD`. A grep for `aggro_time` in `src/content/q1` and `composition` finds nothing. MG1 client.qc:699-716 picks the first `info_player_coop` with no living player within 72 units, and in coop returns world when none is free. MG1 client.qc:670 defines the radius. The port uses the ordinary coop rotation.
- Impact: Monsters flip targets on every hit in coop Horde, and a respawn can land on an occupied spot, which the source avoids.
- Remediation: Add both rules to the horde add-on.

### SRC3Q1B-013 — `MESSAGE_ALL_PLAYERS` is ignored by SUB_UseTargets and trigger_counter
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 subs.qc:329,:341-348, triggers.qc:285,:308 are as cited; entity-services.ts:395-401 and ad/triggers.ts:20-21 ignore the bit. 3 counters on map6 and 10 monsters match.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/entity-services.ts:395-401; src/content/q1/addons/triggers.ts:20-21
- Confidence: traced
- Evidence: MG3 subs.qc:20, :329, :341-348: `if (((activator.classname == "player") || (self.spawnflags & MESSAGE_ALL_PLAYERS)) && (self.message != "")) { if(self.spawnflags & MESSAGE_ALL_PLAYERS) centerprint_all (self.message); ...`, with the flag also copied to DelayedUse. MG3 triggers.qc:285 and :308 apply it to counters. Port: `this.message(activator, entity.message)`, and `counterMessage` opens with `if (!game.isPlayer(activator) || ...) return undefined`. The value 8388608 appears in the port only as a hell knight flag. Map data: 3 `trigger_counter` on map6 (`$mg3_map6_temple_cleansed`), and 10 monsters with the flag.
- Impact: In coop only the activator sees map6's message, and if a non-player fires the counter nobody sees it.
- Remediation: Honor the bit for MG3 in both places and carry it through the delayed use.

### SRC3Q1B-014 — Direct grenade hits on MG3 final bosses use plain splash, not the source's direct damage
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Low.** Upgraded from plausible after reading the path: MG3 weapons.qc:623-630,:682 deal direct self.dmg, while foundation/weapons.ts grenade touch only explodes with no direct hit. Change: monster_boss occurs on no MG3 map, so the practical target is the single monster_oldone_new.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/weapons.ts (grenade touch, not overridden by src/content/q1/addons/items/weapons.ts)
- Confidence: plausible
- Evidence: MG3 weapons.qc:623-633: `if (other.classname && ((other.classname == "monster_boss") || (other.classname == "monster_oldone_new"))) { T_Damage(other, self, self.owner, self.dmg); GrenadeExplode_IgnoreOther(); }`. A grep for `monster_boss` and `monster_oldone` finds only the boss files, and no grenade reference to them in addons/items. I did not read foundation/weapons.ts grenade code for this pass, and the bosses' `boss_immune` handling was not compared.
- Impact: Grenades that contact a boss deal distance-reduced splash rather than full direct damage.
- Remediation: Add the branch in the MG3 weapon rules, after confirming the base path.

### SRC3Q1B-015 — Smaller MG3 pickup drifts: mega health cap and ring particles on regen
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 items.qc:169,:244 use cap 500 against pickups.ts:33-34's 250. MG3 items.qc:38-39 run draught_fx on regen; ad/items/common.ts:41 calls plain SUB_regen and ad/items/pickups.ts ring spawn skips the effect for flag 4. 2 flagged rings.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/pickups.ts:33-34, :430
- Confidence: traced
- Evidence: MG3 items.qc:169 and :244: `if (e.health > 500)` and `if (other.health >= 500) return;` raise the cap. The port uses `health >= (mega ? 250 : player.maxHealth)` and `Math.min(mega ? 250 : ...)`. MG3 items.qc's SUB_regen calls `draught_fx(0)` for `item_draught_stupor` and `item_draught_insight`. The port's `SUB_regen` only restores model and solid, and its ring spawn skips the effect for flag 4, so a revealed ring never gets its particle effect (2 `item_draught_insight` with the flag).
- Impact: Mega health is refused above 250 in MG3, and revealed rings have no particles.
- Remediation: Make the cap a program rule and call the ring effect from regen.

### SRC3Q1B-016 — The comment "PF_setsize never validated ordering" contradicts pr_cmds.c
- **Verification (VERIFY-T): confirmed. Final severity: Info.** spatial-host.ts:91 comment contradicts WQ pr_cmds.c:142-144. ## SRC4Q1A
- Severity: Info
- Category: docs
- Location: src/compat/qc/spatial-host.ts:91
- Confidence: traced
- Evidence: Port comment: `// PF_setsize never validated ordering; retail data (mg3) relies on it.` WQ pr_cmds.c:142-144: `if (min[i] > max[i]) PR_RunError ("backwards mins/maxs");`. The lax behavior may be right for the rerelease engine, but the attribution is wrong, and classic programs lose the source's error.
- Impact: Misleads future maintainers about what the original does.
- Remediation: Reword the comment to attribute the behavior to the rerelease engine.
