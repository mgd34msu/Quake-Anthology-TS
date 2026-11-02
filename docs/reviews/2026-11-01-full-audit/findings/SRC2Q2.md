# SRC2Q2 — Quake 2 ports compared against id source: player, entities, weapons, items, network

HEAD fcdc8af5. Original paths are relative to `<scratchpad>/upstream/`: `Quake-2/...` and `quake2-rerelease-dll/rerelease/...`. Nothing was executed from upstream. Port paths are relative to the project root. Experiments ran from `<scratchpad>/clean`; scripts are in `<scratchpad>/src2q2/` (button.test.ts, scan-btn.py, scan-item.py, c.py). The project directory was not changed.

## Coverage
**Compared function by function, port against original (full port file, relevant original read):**
- src/content/q2/base/player/commands.ts (338) against game/g_cmds.c (all 992), p_hud.c Cmd_Score_f and Cmd_Help_f (headers and key lines at 276-291, 346-356), p_weapon.c Use_Weapon.
- src/content/q2/base/player/index.ts (672), spawns.ts (113), obituary.ts (35) against game/p_client.c 170-1800. index.ts 300-520 had already been compared by SRCQ2; the remainder is new here.
- src/content/q2/foundation/movers.ts (619), motion.ts (200), angular-motion.ts (77), base/entities/movers.ts (280) against game/g_func.c (all, with blank lines and block comments stripped).
- src/content/q2/foundation/items.ts lines 1-145, 368-532, 586-933 against game/g_items.c 20-1130. The foreign Q3 pickup code at 160-330 has no id counterpart and was only skimmed. Item table rows were checked by value from memory of the table and by TABLES, not line by line against g_items.c 1134-2216.
- src/content/q2/foundation/weapons/player.ts (768), generic-frame.ts classic path, hand-grenade.ts (59), ballistics.ts 90-551 against game/g_weapon.c 100-916 (read) and p_weapon.c. p_weapon.c was NOT reread in full: the fire functions were compared against my recollection of that file, and only Use_Weapon's and Drop_Weapon's locations were opened. Treat "no mismatch" for p_weapon.c as weaker than the rest. ballistics.ts 1-89 not read. presentation.ts, projection.ts, turn.ts, damage.ts, types.ts, checkpoint.ts not read. Rerelease branches were not compared to rerelease/p_weapon.cpp or g_weapon.cpp.
- src/content/q2/base/entities/turrets.ts lines 20-239 against game/g_turret.c (all).
- src/content/q2/foundation/scenery.ts (228), base/entities/scenery.ts (263) against game/g_misc.c 499-518, 692-760, 1030-1180, 1285-1300, 1335-1460, 1563-1830. g_misc.c func_explosive, barrel, func_wall, misc_deadsoldier, teleporter and KillBox bodies outside those ranges were compared from recollection, with only the SVF line (g_misc.c:1260) opened.
- src/network/q2/channel.ts (248) against qcommon/net_chan.c 80-380.
- src/network/q2/temp-entities.ts (158), temp-types.ts against client/cl_tent.c case list and read order at 709-1177. The final cases after 1177 and the helper bodies (CL_ParseBeam etc.) were compared from recollection.
- src/network/q2/client-messages.ts (248) against server/sv_user.c, opened at 525-655 by grep; body from recollection.
- src/network/q2/server-messages.ts 140-446, server-write.ts 125-306 against client/cl_parse.c and server/sv_send.c from recollection, not opened. Classic opcodes only.
- src/network/q2/handshake.ts first ~200 lines of logic, classic branch only, against recollection of sv_main.c and cl_main.c.
- src/content/q2/base/monsters/*: only health, gib_health and mass were compared, scripted, against m_*.c. All values shown agreed. Output was truncated at 40 rows and cut per line, so soldier and some gib values were not all visible.

**Not compared (no claim either way):**
- src/content/q2/base/monsters/*.ts logic and all move tables against m_*.c. TABLES compared the tables to DLLs. This is the largest gap: about 1,500 port lines and about 12,000 original lines.
- src/content/q2/foundation/monsters/* outside cited lines, entity-services.ts, targets.ts beyond SRCQ2, callbacks.ts, host.ts.
- src/content/q2/base/player/character.ts was read but has no direct original (a port adapter); no verdict on its gib clamps. environment.ts and view.ts remain as SRCQ2 left them. checkpoint.ts, landmarks.ts, resources.ts, types.ts not read.
- game/g_chase.c was not opened: updateChase was compared from recollection.
- Client presentation against cl_view.c, cl_fx.c, cl_scrn.c, ref_gl.

**Unavailable (no original in id's tree, so no comparison is possible):** src/network/q2/codecs/r1q2.ts, q2pro.ts, q2pro-fields.ts, q2repro.ts, clc_batch_move.ts, zpacket.ts, kexdemo.ts, kex-write.ts, kex-usercmd.ts, mvd.ts; src/network/q2/gtv.ts, gtv-transport.ts, mvd-*.ts, kex/*; the q2pro, r1q2 and KEX branches of channel.ts, handshake.ts, server-messages.ts, client-messages.ts and server-write.ts. Also not read: adapters.ts, codec.ts, codecs/codec.ts, connectionless.ts, demo.ts, server-demo.ts, prediction.ts, fog.ts, solid.ts.

**Deliberate-choice check:** read docs/comparison-q2.md lines 1-412 (of 679) and grepped docs/ for the terms in the findings. It describes behavior-preserving goals and names none of these differences as deliberate. The comment at commands.ts:166 is the one stated rationale, and SRC2Q2-002 shows it rests on a misreading.

## Strengths
- motion.ts and angular-motion.ts match g_func.c Move_Calc, plat_CalcAcceleratedMove, plat_Accelerate and AngleMove_* term by term, including the team-master immediate-start rule.
- Door, plat, train and secret-door state machines match apart from the items below, including team speed normalization (Think_CalcMoveSpeed) and the deliberate-looking `door_secret_use` origin test.
- ballistics.ts fire_lead, grenade, rocket and BFG flows match g_weapon.c, including the water re-spread at double spread, the hand-grenade timer formula, and bfg_think's piercing loop.
- turrets.ts matches g_turret.c, including the `fabs` quirk in the yaw clamp.
- pickupQ2Armor, Pickup_Pack, Pickup_Bandolier, MegaHealth_think, DoRespawn teams and Drop_Item geometry match g_items.c.
- channel.ts classic mode matches net_chan.c: sequence, reliable bit, last_reliable timing, 1384 and 1400 limits, and dumped unreliable data.
- temp-entities.ts matches cl_tent.c's read order, including TE_STEAM's id branch.
- Monster base stats checked agree with m_*.c.

## Findings

### SRC2Q2-001 — A touch-fired func_button works only once, because the port's shared door `use` clears its touch callback
- **Verification (VERIFY-U): confirmed. Final severity: High.** movers.ts:262-263 clears `touch` for every `use` caller and buttonTouch (:517-518) calls `use`; Q2/game/g_func.c:726-752 button_fire never clears it. Re-run: `touch after first press false`, still false after the button returns. Nothing restores it; :307 is the only assignment.
- Severity: High
- Category: bug
- Location: src/content/q2/foundation/movers.ts:262-265, :307, :517-520
- Confidence: reproduced (`src2q2/button.test.ts`, component level through Q2Foundation); map counts by `src2q2/scan-btn.py`. Not played through on a retail map
- Evidence: Port: `for (const member of state.team) { member.message = ""; member.touch = null; ...}` runs for every caller of `use`, and `buttonTouch` calls `this.use(self, services, contact.other)`. The original's button path never clears touch: g_func.c:743-752 button_touch sets activator and calls button_fire; button_fire (:726-735) has no `touch = NULL`. Clearing belongs only to door_use (:961-976). Test output: `touch before true`, `touch after first press false`, and the button travels out and back with `touch` still false. Retail: of baseq2's 277 func_button entities, 232 are touch-fired and 123 of those have `wait >= 0` (repeatable), including base1 (target t4), base2, base3 and train. Others: rogue 144, xatrix 49, rerelease 462, lmctf 42, ctf 3.
- Impact: Any repeatable wall button can be pressed once per map. Elevator-call and door buttons a player must use a second time do nothing, which can strand the player or block progress in a campaign map; backtracking is the common case. Applies to the TS game in both editions; native DLLs use their own code.
- Remediation: Apply the message and touch clearing only when `state.button` is false, as door_use does.

### SRC2Q2-002 — weapnext and weapprev are reversed in effect
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** g_cmds.c:559-587 scans downward, and Use_Weapon (p_weapon.c:311-340) only sets newweapon, so the last owned weapon wins, which is the one above current. RR/g_cmds.cpp weapnext uses `selected_weapon + i`. commands.ts:171-173 with player.ts:60 (definition order blaster to bfg) stops at the first hit going down, so both editions are reversed.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/player/commands.ts:61-69, :166-173; src/content/q2/foundation/weapons/player.ts:139-152
- Confidence: traced; not run against a retail build
- Evidence: Port comment: "The original next/previous names traverse the item table in reverse/forward order respectively", and it stops at the first `"selected"`. In the original, g_cmds.c:574-587 (weapnext) scans downward and calls `it->use`, but Use_Weapon (p_weapon.c:311-340) only sets `client->newweapon`, so `cl->pers.weapon == it` does not become true until the loop reaches the current weapon itself. Every owned weapon is used in turn and the last one wins, which is the weapon just above the current one. So classic weapnext moves up the table (Shotgun to Super Shotgun) and weapprev moves down. rerelease/g_cmds.cpp makes this explicit: weapprev scans `selected_weapon + IT_TOTAL - i` and weapnext `selected_weapon + i`, each stopping at `cl->newweapon == it`. The port's weapnext takes the first hit going down, the opposite for both editions. The original also prints a "No ammo" line for each skipped empty weapon; the port does not.
- Impact: Mouse-wheel and bound weapon cycling go the wrong way in every TS Q2 game.
- Remediation: Swap the directions at :167-173 and remove the comment. Check any test that pinned the current order.

### SRC2Q2-003 — say_team uses the model for skin teams and the skin for model teams
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** commands.ts:9 returns the model part when bit 64 (DF_SKINTEAMS, q_shared.h:1022) is set; g_cmds.c:39-46 returns the model only under DF_MODELTEAMS and otherwise the skin. The mapping is inverted.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/player/commands.ts:6-10, :94
- Confidence: traced
- Evidence: `return (context.game.options.deathmatchFlags & 64) !== 0 ? skin.slice(0, slash) : skin.slice(slash + 1);`. q_shared.h:1022-1023: `DF_SKINTEAMS 0x40`, `DF_MODELTEAMS 0x80`. g_cmds.c:39-46: if DF_MODELTEAMS, return the model part, otherwise the skin part. Bit 64 is the skin-team flag, so the port returns the model under skin teams and the skin under model teams. This is separate from GAPCOMPAT-010, which concerns the combat binding's no-slash case.
- Impact: In a teamplay server, `say_team` reaches the wrong players. With skin teams, a team message goes to everyone sharing the model, including the other team.
- Remediation: Test bit 128 for the model branch, or share one ClientTeam helper with combat-binding.ts.

### SRC2Q2-004 — Bandolier and Ammo Pack capacity survives death in deathmatch
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** items.ts:766 raises entry capacity on a pack pickup; index.ts:201 keeps it (`{ ...entry, count: 0 }`) and ensure (items.ts:506-508) skips existing entries. p_client.c:622-627 and :1117-1125 reset the maxima on every deathmatch spawn.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/player/index.ts:200-204, :239-241; src/content/q2/foundation/items.ts:506-508
- Confidence: traced
- Evidence: Port respawn: `this.setInventory(entity, game, state.useQ2Inventory ? [] : state.spawnInventory)`, and setInventory runs `configure(entity.actor, { ...entry, count: 0 })`, keeping `capacity`. `configurePlayer` then calls `ensure`, which adds only absent entries. The original resets all maxima: p_client.c:1117-1125 calls InitClientPersistant every deathmatch spawn, and :622-627 sets 200/100/50/50/200/50.
- Impact: One Ammo Pack raises a player's limits for all later lives on that map, to 300 bullets, 200 shells, 100 rockets, and so on. That is a gameplay advantage the original removes on death.
- Remediation: Reset ammo capacity to the item definition's value in the deathmatch and dead-respawn branch.

### SRC2Q2-005 — Dropping the last power armor leaves its protection active, and the shield does not take priority
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** commands.ts:45-59 has no power-armor case and power armor is droppable (items.ts:373). items.ts:858-866 stores the used item's kind, and the binding reads only cells (:492-500). g_items.c:688-702 derives the type live, shield first, and :747-752 toggles off on the last drop.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/player/commands.ts:45-60; src/content/q2/foundation/items.ts:858-866
- Confidence: traced
- Evidence: g_items.c:747-752 Drop_PowerArmor: `if ((ent->flags & FL_POWER_ARMOR) && (inventory == 1)) Use_PowerArmor`. PowerArmorType (:688-702) is also derived live from inventory and prefers the shield. Port `drop` has no power-armor case: it consumes one item and never touches `setPoweredProtection`, and `use` stores the kind of the item used.
- Impact: In deathmatch a player can pick up a Power Shield, drop it for a teammate and keep shield protection, for as long as cells last. A player with an active Screen who picks up a Shield in single player stays on Screen; the original switches at once.
- Remediation: Turn powered protection off when the last unit is dropped, and derive the kind from inventory, shield first.

### SRC2Q2-006 — Power armor is switched off on every level change and at intermission
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** composition/q2/index.ts:261-267 runs attach, which restores carry (index.ts:186, :190-191), then putInServer(false), whose :252 clearPowerups (:397-399) removes flag 4096 and the protection. p_client.c:662 and :672 preserve FL_POWER_ARMOR, and MoveClientToIntermission does not touch it (port :605 does).
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/player/index.ts:252, :396-401, :605; src/content/composition/q2/index.ts:261-267
- Confidence: traced; the carry path was followed by reading, not run
- Evidence: `admit` runs `attach` (which restores `carry`, including flag 4096 and `armor.powered`, index.ts:160, :190-191) and then `putInServer(entity, game, false, landmark)`, which unconditionally calls `clearPowerups`: `entity.flags &= ~4096; ... setPoweredProtection(entity.actor, { kind: "none" })`. The original keeps it: p_client.c:662 saves `FL_POWER_ARMOR` in savedFlags, :672 restores it, and PutClientInServer (:1097-1256) clears only `FL_NO_KNOCKBACK`. Only player_die clears the flag (:548). MoveClientToIntermission (p_hud.c:32 onward) clears the four powerup timers but not the flag; port line 605 clears both. Also, a coop respawn restores `carry` and then clears it.
- Impact: A player who enabled a Power Screen enters the next map unprotected with no notice.
- Remediation: Move the flag and powered-protection clearing out of `clearPowerups` into `recordDeath`, leaving the timed powerups as they are.

### SRC2Q2-007 — misc_deadsoldier gets flag 8 where the original sets SVF_DEADMONSTER, so it blocks movement
- **Verification (VERIFY-U): confirmed-with-changes. Final severity: Low.** The flag bug is real: scenery.ts:117 sets 12 where g_misc.c:1260 means 6, and actor-execution.ts:73 with world/collision/contents.ts:60 then gives it solid monster contents. The impact is overstated: the box is 16 units tall (scenery.ts:119) and STEPSIZE is 18 (movement/q2/types.ts:55), so a floor-placed corpse is a step-over bump, not a corridor block.
- Severity: Medium
- Category: bug
- Location: src/content/q2/foundation/scenery.ts:117; src/app/bootstrap/simulation/actor-execution.ts:73
- Confidence: traced; not observed in play, and retail entity counts were not scanned
- Evidence: Port: `entity.serverFlags |= 12;` (4|8). g_misc.c:1260: `ent->svflags |= SVF_MONSTER|SVF_DEADMONSTER;`, which game.h:47-48 defines as 2 and 4, so 6. actor-execution.ts:73 reads `deadMonster: (entity.serverFlags & 2) !== 0`. sv_world.c skips SVF_DEADMONSTER for any mask without CONTENTS_DEADMONSTER (cited in SRCQ2-002), and MASK_PLAYERSOLID and MASK_MONSTERSOLID lack it. Same wrong bit family as SRCQ2-012.
- Impact: Decorative corpses are solid to players and monsters. The original lets them pass through. They bump the player and can obstruct monster movement in corridors.
- Remediation: Use 6.

### SRC2Q2-008 — Classic pickups give no screen flash and do not select the item
- **Verification (VERIFY-U): confirmed. Final severity: Low.** The only nonzero bonusAlpha write and pickup selectedItem write are in rerelease/index.ts:205-207. Foundation pickup completion (items.ts:688-697) does neither; g_items.c:777 and :785-786 do both. Listing every `selectedItem =` and `bonusAlpha` site in src/content/q2 found no classic writer.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/items.ts:688-697; src/content/q2/rerelease/index.ts:205-207; src/content/q2/base/player/view.ts:102-103
- Confidence: traced by grep over src for all `bonusAlpha` writers
- Evidence: g_items.c:777 `other->client->bonus_alpha = 0.25`, and :785-786 `if (ent->item->use) selected_item = ITEM_INDEX(ent->item)`. In the port the only write of a nonzero `bonusAlpha` is rerelease/index.ts:205, inside the rerelease pickup policy, which also sets `selectedItem`. Classic view.ts reads and decays a value that stays 0.
- Impact: Classic TS games have no pickup flash, and `invuse` does not act on what was just picked up.
- Remediation: Do both in the foundation's pickup completion for every edition.

### SRC2Q2-009 — Quad, Invulnerability and power armor activation are silent, and power armor prints a line the original lacks
- **Verification (VERIFY-U): confirmed-with-changes. Final severity: Low.** items.ts:858-885 emits no sound or message, and no port source plays items/damage.wav or items/protect.wav for these items; misc/power1 and power2 occur only in lmctf/runes.ts. The citation is incomplete: runtime.ts:1243 is the foreign-world hook, and the native Q2 source prints the same line from runtime.ts:3705.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/items.ts:858-885; src/app/bootstrap/simulation/runtime.ts:1243
- Confidence: traced by grep over src/content/q2, composition and bootstrap
- Evidence: g_items.c:361 `items/damage.wav` in Use_Quad, :406 `items/protect.wav` in Use_Invulnerability, :712 `misc/power2.wav`, :723 `misc/power1.wav`, :719 "No cells for power armor.". The port's `use` emits no sound. `items/damage.wav` has no hit under src/content/q2, and `misc/power1` appears only in lmctf/runes.ts. runtime.ts:1243 instead prints `Power armor ${kind}`.
- Impact: No audio cue for activating these items, an unexplained failure with no cells, and non-original console text.
- Remediation: Emit the source sounds and message from `use`, and remove the print hook.

### SRC2Q2-010 — Classic rail passes through non-monster SOLID_BBOX entities
- **Verification (VERIFY-U): refuted. Final severity: Info.** ballistics.ts:236 matches retail. gamex86.dll at 0x2001902f is `cmp [eax+0xf8],2` (solid == SOLID_BBOX) inside the rail ignore test, and ORIG/g_weapon.c:683-685 has the same "ZOID" clause, as does RR/g_weapon.cpp:801-806. Only the Q2/game tree omits it, so the proposed remediation would diverge from retail.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/ballistics.ts:236
- Confidence: traced
- Evidence: `const pierce = game.host.isMonster(actor) || game.host.isPlayer(actor) || entity?.solid === "box" || game.options.edition === "rerelease" && (...)`. The `solid === "box"` term is not gated. g_weapon.c:683-686: `if ((tr.ent->svflags & SVF_MONSTER) || (tr.ent->client)) ignore = tr.ent; else ignore = NULL;`.
- Impact: In classic the slug continues past exploboxes, rockets and grenades, damaging what is behind them. The original stops there.
- Remediation: Move that term inside the rerelease condition. The rerelease and CTF rules were not compared here, so confirm which editions want it.

### SRC2Q2-011 — Blaster bolts are not SVF_DEADMONSTER
- **Verification (VERIFY-U): confirmed. Final severity: Low.** g_weapon.c:353 sets SVF_DEADMONSTER on bolts. fireBlaster (ballistics.ts:313-318) and projectileForActor (:290-298) set no serverFlags, while lmctf/weapons.ts:63 sets 2 on its goop. World collision therefore treats bolts as solid monster contents for player masks. Effect not measured.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/ballistics.ts:313-318
- Confidence: traced; effect not measured
- Evidence: g_weapon.c:353-358 sets `bolt->svflags = SVF_DEADMONSTER`, with a comment that the player will not be solid-clipped against it during prediction. fireBlaster sets no serverFlags, and `projectileForActor` does not either.
- Impact: Bolts are solid to player and monster movement traces, unlike the original, and can clip movement for a frame. Hyperblaster fire makes this most likely.
- Remediation: Set bit 2 in fireBlaster, after checking how Rogue and rerelease treat their bolts.

### SRC2Q2-012 — `kill` prints "suicides" and can gib a corpse by repetition
- **Verification (VERIFY-U): confirmed. Final severity: Low.** commands.ts:185 goes through index.ts:116-118 with the world as attacker, so obituary.ts never takes the `attacker === victim` branch and table entry 23 prints "suicides"; g_cmds.c:648-656 passes ent as attacker, giving "killed himself". Repeating `kill` subtracts 2 from a corpse until the -40 branch at index.ts:319. It needs 6 s or more dead because of the respawnTime gate.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/commands.ts:181-186; src/content/q2/base/player/index.ts:116-118; obituary.ts:27
- Confidence: traced
- Evidence: g_cmds.c:652-655: `ent->health = 0; meansOfDeath = MOD_SUICIDE; player_die (ent, ent, ent, 100000, vec3_origin)`. The attacker is the player, so p_client.c:267-302 replaces the message with "killed himself/herself/itself". The port routes through `environmentDamage`, whose attacker is the world actor, so the MOD 23 table entry prints "suicides". The original sets health to exactly 0 so `kill` never gibs. The port subtracts `Math.max(1, health) + 1`, so issuing `kill` repeatedly on a corpse lowers health by 2 each time until the -40 gib branch.
- Impact: Wrong obituary text on every suicide, and a corpse can be gibbed by command.
- Remediation: Attribute the attack to the player and skip the damage when already dead.

### SRC2Q2-013 — `score` toggles in single player, and `help` cannot close the deathmatch scoreboard
- **Verification (VERIFY-U): confirmed. Final severity: Low.** commands.ts:126 toggles in every mode, and view.ts:117 turns that into layout bit 1; p_hud.c:276-291 returns first in single player. commands.ts:135 always forces the board on in deathmatch, while Cmd_Help_f calls the toggling Cmd_Score_f.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/commands.ts:124-137; src/content/q2/base/player/view.ts:117
- Confidence: traced
- Evidence: p_hud.c:276-291 Cmd_Score_f returns before touching showscores unless deathmatch or coop, and toggles otherwise. Cmd_Help_f (:346-351) calls Cmd_Score_f in deathmatch. Port `score` runs `state.showScores = !state.showScores` for every mode. Port `help` in deathmatch forces `state.showScores = true` and sends the board, so it never closes.
- Impact: In single player `score` sets STAT_LAYOUTS bit 1 and a stale layout can be drawn, compounding SRCQ2-010. In deathmatch F1 cannot dismiss the board.
- Remediation: Port the two functions' control flow.

### SRC2Q2-014 — A dead deathmatch player's scoreboard is late and never tags the killer
- **Verification (VERIFY-U): confirmed. Final severity: Low.** index.ts:371 only sets the flag, so the first board waits for :479's `& 31` tick; p_client.c:530-531 sends it at death. :543 sends entity.enemy, which has no player write under base/player or composition/q2, where p_client.c:309 and :313 set it. No `killer` read was found in q2-match-ui, seat-hud-state, events or CTF presentation.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/index.ts:371, :479, :543; obituary.ts
- Confidence: traced by grep; `.enemy =` has no write for players under base/player or composition/q2, and `killer` has no consumer found in bootstrap
- Evidence: p_client.c:530-531 calls Cmd_Help_f at death, which sends a reliable scoreboard at once. p_client.c:309 and :313 set `self->enemy` to NULL or the attacker, and DeathmatchScoreboardMessage marks that player. The port only sets `state.showScores`, so the first board waits for the `& 31` tick, up to 3.2 s. It passes `killer: entity.enemy`, which nothing sets on a player.
- Impact: The death screen shows no scores for up to 3.2 s and never shows who killed you. Native Q2 clients would not get the tag either, if this event drives their layout; that path was not traced.
- Remediation: Call `scoreboard` on first death, and set `entity.enemy` in the obituary.

### SRC2Q2-015 — No "entered the game" message or login effect, and spectator flow differs
- **Verification (VERIFY-U): confirmed. Final severity: Low.** "entered the game" occurs in src only for Q1 and Q3, and there is no MZ_LOGIN counterpart (p_client.c:1276-1281, :1339-1344). afterClientThink (index.ts:411-413) has no upmove chase cycling (p_client.c:1725-1736). :523 relies on putInServer's holdMilliseconds 0 (:259). The :1711 latch difference is narrow, because beginFrame clears latches at :428.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/index.ts:411-413, :521-523; src/content/composition/q2/index.ts:261-267
- Confidence: traced; `entered the game` has no hit under src/content/q2 or src/app, and `MZ_LOGIN` has no equivalent besides `q2:logout`
- Evidence: p_client.c:1276-1281 and :1339-1344 send MZ_LOGIN and "%s entered the game" on ClientBegin. Spectator: :1725-1736 cycles chase on a jump press, absent from `afterClientThink` (`upmove` has no use in base/player). :1711 clears all latched buttons, while the port clears bit 1. spectator_respawn (:1066-1076) sends MZ_LOGIN and a 14-unit hold when joining; port line 523 sends a teleport event with `holdMilliseconds: 0`.
- Impact: Multiplayer peers get no join notice, and spectators lose jump cycling.
- Remediation: Port the three blocks.

### SRC2Q2-016 — Inventory selection differs: grenades skipped by invnextw, catalog order, and `use` changes the selection
- **Verification (VERIFY-U): confirmed. Final severity: Low.** commands.ts:24 tests `kind === "weapon"`, which excludes ammo_grenades even though items.ts:372 and :375 mark it usable and weapon. The catalog order comes from items.ts:69-93. :42 writes the selection, which Cmd_Use_f (g_cmds.c:396-422) does not. :162 prints "No item to use." for invdrop against g_cmds.c:630. g_items.c:191 and :535 revalidate after a drop; the port does not.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/commands.ts:18-30, :42, :162; src/content/q2/foundation/items.ts:69-93
- Confidence: traced
- Evidence: `filter === "weapon" && item.kind === "weapon"` excludes ammo_grenades, which the original flags IT_AMMO|IT_WEAPON with `use = Use_Weapon`, and g_cmds.c:88 tests the flag. The port list order is ammo, keys, packs, health, armor, powers, weapons, whereas selection in the original follows itemlist (g_items.c:1134 onward). `use` sets `state.selectedItem`, which Cmd_Use_f (g_cmds.c:396-422) does not. Drop never revalidates the selection (g_items.c:191, :535). `invdrop` with nothing selected prints "No item to use." where g_cmds.c:630 says "No item to drop.".
- Impact: Inventory cycling visits items in a different order and misses grenades. Small but visible to anyone using the inventory keys.
- Remediation: Filter on `item.weapon`, order the list by the source table, and remove the selection write.

### SRC2Q2-017 — trigger_elevator arrivals use the corner's wait; the original keeps the train's previous wait
- **Verification (VERIFY-U): confirmed. Final severity: Low.** trainWait (movers.ts:420-422) reads target.wait; train_wait reads moveinfo.wait (g_func.c:1500), set only in train_next (:1568) and not by train_resume (:1586-1599). The elevator path reaches resumeTrainAt via base/entities/movers.ts:231. Retail path data was not checked.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/movers.ts:391-395, :420-428
- Confidence: traced; effect on retail lab, mine2 and xware not checked against their path data
- Evidence: train_wait reads `self->moveinfo.wait` (g_func.c:1500), set only in train_next (:1568). train_resume (:1586-1599), which trigger_elevator_use calls (:1722-1723), does not set it. The port reads `target.wait`, which is the corner just arrived at. A targeted train that never ran train_next has wait 0 in the original and proceeds; the port stops if the corner says -1.
- Impact: An elevator may stop or wait differently from the original at its called floor.
- Remediation: Store the wait on TrainState when trainNext selects a corner, and read that in trainWait.

### SRC2Q2-018 — func_object clips with the player mask instead of the monster mask
- **Verification (VERIFY-U): confirmed. Final severity: Low.** base/entities/movers.ts:274 sets 0x2010003 (MASK_PLAYERSOLID); g_misc.c:726 sets MASK_MONSTERSOLID (0x2020003). simulation/physics.ts:310 uses the motion's clipMask.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/entities/movers.ts:274
- Confidence: traced
- Evidence: `entity.clipMask = 0x2010003`, which is MASK_PLAYERSOLID. g_misc.c:726 `self->clipmask = MASK_MONSTERSOLID`, which is 0x2020003.
- Impact: A falling func_object stops on playerclip brushes and passes monsterclip brushes, the reverse of the original.
- Remediation: Use 0x2020003.

### SRC2Q2-019 — point_combat has a smaller box and survives in deathmatch
- **Verification (VERIFY-U): confirmed. Final severity: Low.** movers.ts:153 and :496-503 share the path_corner setup and z +/-8. g_misc.c:474-484 frees the entity in deathmatch and uses z +/-16. Survival in deathmatch is inert without monsters; the box size is the only behavioral part.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/movers.ts:496-503
- Confidence: traced for the values; gameplay effect not measured
- Evidence: Port uses `-8..8` on all axes for path_corner and point_combat alike. g_misc.c:474-484 frees it in deathmatch and sets `-8,-8,-16` to `8,8,16`. Retail count: baseq2 400, rerelease 1156, rogue 238, xatrix 241.
- Impact: A monster can miss a combat point the original would trigger, leaving it walking past its authored position.
- Remediation: Split the case and copy the values.

### SRC2Q2-020 — Team door sounds and message sounds differ
- **Verification (VERIFY-U): confirmed. Final severity: Low.** movers.ts:190-191 starts the middle loop on every team member, while g_func.c:902-906 and :933-937 gate s.sound on !FL_TEAMSLAVE. :527 and base/entities/movers.ts:143 play on the door, while g_func.c:1135 plays on `other`, and secret doors use door_touch as well (:2025).
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/movers.ts:190-191, :527; src/content/q2/base/entities/movers.ts:143
- Confidence: traced
- Evidence: door_go_up and door_go_down set `s.sound` only `if (!(self->flags & FL_TEAMSLAVE))` (g_func.c:902-906, :933-937). The port's `middle` loop is outside the `state.master === entity` guard, so each team member starts its own loop. door_touch plays on `other` with CHAN_AUTO (:1135); the port plays on the door, as it does for secret doors.
- Impact: Double doors are louder than the original, and a locked-door message sound comes from the door rather than the player.
- Remediation: Move the loop inside the guard, and play on `contact.other`.

### SRC2Q2-021 — A pushed barrel moves by a plain box trace instead of M_walkmove
- **Verification (VERIFY-U): confirmed. Final severity: Low.** scenery.ts:187-194 traces a box and moves only on fraction 1, returning early when `other` has no combat record. g_misc.c:873-885 calls M_walkmove.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/scenery.ts:187-194 (barrel_touch)
- Confidence: traced for the difference; g_misc.c barrel_touch and m_move.c were compared from recollection
- Evidence: Original barrel_touch calls `M_walkmove (self, vectoyaw(v), 20 * ratio * FRAMETIME)`, which steps up and refuses to walk off a ledge without FL_PARTIALGROUND. The port traces the box and moves only on fraction 1. It also returns early for an `other` with no combat record.
- Impact: Barrels can be pushed off ledges the original would refuse, and cannot be pushed up small steps.
- Remediation: Call the foundation's walkMove.

### SRC2Q2-022 — The server has no MAX_STRINGCMDS limit, and a repeated move or bad checksum drops the client
- **Verification (VERIFY-U): confirmed. Final severity: Low.** client-messages.ts:51 collects every string command and q2.ts:373-400 runs them all with no count; sv_user.c:525 and :655 cap at 7 executed. The throws at client-messages.ts:70-71 and :87-88 reach the q2.ts:441-447 catch and drop the peer, where sv_user.c:583-584 and :615-619 return silently. ## SRC3Q2
- Severity: Low
- Category: security
- Location: src/network/q2/client-messages.ts:70-71, :87-88; src/app/bootstrap/network/q2.ts:373-400, :441-447
- Confidence: traced; not run, per the no-flood rule
- Evidence: sv_user.c:525 `#define MAX_STRINGCMDS 8`, and :655 `if (++stringCmdCount < MAX_STRINGCMDS) SV_ExecuteUserCommand (s)`, with the comment about malicious users. The port's reader collects every clc_stringcmd and `process` runs them all, so a 1400-byte packet can carry hundreds of short commands. sv_user.c:583-584 and :615-619 silently return on a second move or a bad checksum. The port throws and q2.ts:444 drops the peer. That is stricter and harmless for honest clients, but it is a difference.
- Impact: One packet can run hundreds of `say`, `give` or chase commands in a tick. This adds to NET-006's budget gap, on the string channel rather than movement.
- Remediation: Stop executing after 7 string commands per packet, as the source does.

## Summary of IDs
High 1 (001). Medium 6 (002-007). Low 15 (008-022). No finding refutes a catalog entry. SRC2Q2-006 and 007 relate to SRCQ2-012's flag confusion only in cause.
