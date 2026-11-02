# SRC3Q2 — Quake 2 ports compared against id source: monsters, weapons, chase, network send and receive, g_misc remainder, rerelease weapons

HEAD fcdc8af5. Original paths are relative to `<scratchpad>/upstream/`. Nothing was executed from upstream, and no finding was run: every finding is `traced` by reading. Port paths are relative to the project root unless they start with `upstream`. Helper scripts are in `<scratchpad>/src3q2/` (strip.py and show.sh only print source). The project directory was not changed.

## Coverage
**Compared function by function against the opened original:**
- Every logic file in src/content/q2/base/monsters: actor, berserk, boss2, boss3-stand, boss-common, brain, chick, common, flipper, floater, flyer, gladiator, gunner, hover, index, insane, jorg, makron, medic, mutant, parasite, supertank, tank. Originals: game/m_actor, berserk, boss2, boss3, boss31, boss32, brain, chick, flipper, float, flyer, gladiator, gunner, hover, insane, medic, mutant, parasite, supertank, tank .c, with `mframe_t` tables, comments and blank lines filtered out and `mmove_t` lines kept.
- src/content/q2/foundation/monsters/soldier.ts and infantry.ts, classic paths, against m_soldier.c and m_infantry.c. Rerelease branches of these two were read but not compared.
- foundation/monsters/gibs.ts against g_misc.c 90-280. foundation/monsters/ai.ts read in full, with flies and corpse logic compared to g_monster.c 107-135.
- foundation/monsters/index.ts 1-480, `think`, `die`, `dodge`, `touchPathCorner`, `touchCombatPoint` against g_monster.c 60-90, 230-290, 365-560 and g_misc.c 342-470.
- foundation/weapons/player.ts (768, full), generic-frame.ts, hand-grenade.ts, presentation.ts against game/p_weapon.c 40-1434 (lines 1-39 not read). This replaces SRC2Q2's recollection-based comparison.
- Rerelease branches of the same files against rerelease/p_weapon.cpp 383-430, 656-1212, 1234-1898.
- foundation/weapons/ballistics.ts 90-495 against rerelease/g_weapon.cpp 1-1119.
- base/player/index.ts `chase` and `updateChase` against game/g_chase.c (all).
- src/app/bootstrap/network/q2.ts 274-460, 505-560 and src/network/q2/client-messages.ts 55-120, 173-199 against server/sv_user.c 30-664.
- q2.ts frame send and src/app/bootstrap/simulation/network.ts 225-280, 372-440 against server/sv_send.c 70-567.
- src/network/q2/server-messages.ts 140-345 against client/cl_parse.c 193-320, 380-806.
- foundation/scenery.ts, base/entities/scenery.ts (both full) against game/g_misc.c 335-1876.

**Truncation disclosure:** listings were cut at 88-125 columns for originals and 230-300 for dense port lines, so a few long line tails were not seen. Known cases: the end of the rail pierce expression at ballistics.ts:236, the rocket effect origin in rocketTouch, and tail arguments of T_Damage calls in g_weapon.cpp.

**Not compared (no claim either way):**
- foundation/monsters/perception.ts against g_ai.c, and ai.ts movement against m_move.c line by line. CONTENT2-011 and CONTENT2-012 touch this area, but it remains the largest open gap.
- foundation/monsters/index.ts 480-780 and 842-882, moves.ts, frames.ts, muzzle.ts, base/monsters/tables/* (TABLES compared tables to DLLs). Frame `thinkfunc` assignments were not checked against m_*.c.
- rerelease/p_weapon.cpp 1-382, 431-655 (P_ProjectSource, PlayerNoise, Pickup_Weapon, ChangeWeapon, Think_Weapon, Use_Weapon, Drop_Weapon); rerelease/g_weapon.cpp 1120-1216 (rest of bfg_think, fire_bfg, fire_disintegrator); ballistics.ts 1-89, 496-552.
- foundation/weapons/hand-action.ts, projection.ts, turn.ts, damage.ts, definitions.ts.
- cl_parse.c 1-192 and 321-379 (downloads list, rest of serverdata, baseline). Client consumers of server-messages.ts were only spot-checked (remote.ts:177 cinematic, audio.ts:464 talk sound).
- server-write.ts against sv_ents.c, and handshake against sv_main.c. Rerelease m_*.cpp monsters were out of scope. base/entities/movers.ts `func_object` callbacks were not compared to g_misc.c 665-689 beyond SRC2Q2-018.

**Deliberate-choice check:** docs/comparison-q2.md was grepped for multicast, PHS, rate, messagelevel, msg, modelindex2, power screen, flies. No hits.

## Strengths
- Boss logic matches, including quirks that are easy to lose: makron_pain's dangling else, MakronHyperblaster's fixed flash number, fire_bfg's ignored kick argument, and the differing check-attack chances between Boss2 and Jorg or Makron.
- Monster damage, speed, spread and flash numbers checked in all base monsters agree with m_*.c and q_shared.h, as do gib counts and model sets outside the catalogued soldier entry.
- p_weapon.c classic flow matches: Weapon_Generic state order, the grenade hold and blow-up sequence, machinegun and chaingun RNG order, all damage, kick and offset values, and NoAmmoWeaponChange order.
- Rerelease weapon values match p_weapon.cpp and g_weapon.cpp, including railgun 125/225, blaster speed 1500, BFG idle-last 54, the duplicate-frame skip on grenades, DAMAGE_TIME in the BFG kick, and non-advancing pierce starts.
- target_actor_touch, path_corner_touch, point_combat_touch and func_clock match g_misc.c and m_actor.c.
- SV_ExecuteClientMessage drop replay in Q2CommandReplay matches sv_user.c:625-645.

## Findings

### SRC3Q2-001 — The TS Q2 server sends every sound, temp entity and muzzle flash to every client, with no PHS, PVS or area test
- **Verification (VERIFY-U): confirmed-with-changes. Final severity: Medium.** simulation/network.ts:382-425 applies no PHS, PVS or area test and q2.ts:528-535 queues everything, unlike sv_send.c:161-242. The MVD path at network.ts:268-276 does scope sounds and flashes. One correction: footsteps are entity events in frames (index.ts:469-472) and are not in this list, so they are not part of the leak.
- Severity: Medium
- Category: security
- Location: src/app/bootstrap/simulation/network.ts:382-425; src/app/bootstrap/network/q2.ts:528-535
- Confidence: traced; not run
- Evidence: Per-peer `events` filters only by `targets(actor)`, and only for directed kinds: `messages.push({ kind: 'temporary-entity', value })` (:416), `messages.push({ kind: 'sound', ... position: event.origin ...})` (:419), `messages.push({ kind: 'muzzle-flash', ...})` (:421, :424). q2.ts:528 queues all of them for each peer. Original: server/sv_send.c:161-242 SV_Multicast applies CM_ClusterPHS or CM_ClusterPVS plus `CM_AreasConnected`, and :360-375 SV_StartSound uses `MULTICAST_PHS` unless attenuation is ATTN_NONE or the channel has the no-PHS bit. m_*.c and p_weapon.c call `gi.multicast(..., MULTICAST_PVS)` for flashes. Only the MVD path computes recipients (network.ts:268-276), and its comment says effects retain no native multicast scope. Guest-hosted mods have their own routing in classic-guest-services.ts:264.
- Impact: Any client receives the world position of every gunshot, explosion and footstep sound on the map, which a modified client can use as a radar. Unrelated events add to each datagram, growing with player count. Stock clients also run flash effects for entities outside their frame, using stale origins.
- Remediation: Carry a scope on effect, sound and flash events and test each peer's cluster and area, as the MVD recipients already do for sounds and flashes.

### SRC3Q2-002 — The server ignores the client's `rate`; SV_RateDrop has no counterpart
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** q2.ts:505-560 has no budget test before channel.send, and no `rate` key is read in network/q2, network/q2*.ts bootstrap, simulation/network.ts or base/player. sv_main.c:913-924 parses and clamps it; SV_RateDrop in sv_send.c applies it.
- Severity: Medium
- Category: robustness
- Location: src/app/bootstrap/network/q2.ts:505-560
- Confidence: traced by grep; no `rate` key read exists in network/q2.ts, app/bootstrap/network/q2*.ts, simulation/network.ts or base/player
- Evidence: q2.ts sends a frame to each active peer whenever a new server frame exists, with no budget check. Original: server/sv_send.c:459-483 SV_RateDrop totals `message_size` and skips the frame over `c->rate`; :554 applies it. server/sv_main.c:913-924 parses `rate`, clamps it to 100..15000 and defaults to 5000. The QW and Q3 servers in this repo do read it (qw-server.ts:83, network-q3.ts:129), and remote-application.ts:2440 registers the client cvar.
- Impact: A low-bandwidth client cannot reduce its download, so packets queue and it lags or times out. A client's `rate` setting does nothing against this server, and SRC3Q2-001 raises the volume.
- Remediation: Track per-peer message sizes in a RATE_MESSAGES ring and skip frames over the clamped rate, exempting loopback as the original does.

### SRC3Q2-003 — An Iron Maiden corpse gets the default corpse box, which lies under the floor
- **Verification (VERIFY-U): confirmed. Final severity: Low.** chick.ts:36 maps chick_dead to finishCorpse, dispatch calls handler(context) (monsters/index.ts:378), so common.ts:60's default z -24..-8 applies; m_chick.c:299-300 uses 0..16. The effect is limited to an ungibbable corpse with no gameplay consequence, hence below the reported Medium.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/monsters/chick.ts:36; src/content/q2/base/monsters/common.ts:60
- Confidence: traced; dispatch passes only `context` (foundation/monsters/index.ts:378), so the default parameter applies. Not observed in play
- Evidence: `chick_dead: finishCorpse`, whose default is `{ min: {-16,-16,-24}, max: {16,16,-8} }`. Original upstream/Quake-2/game/m_chick.c:297-305: `VectorSet (self->mins, -16, -16, 0); VectorSet (self->maxs, 16, 16, 16);`. The chick's live box starts at z 0 (m_chick.c:653), so its origin is at floor level and the default box spans 24 to 8 units below the floor. Every other base monster's corpse box was checked and matches; tank, supertank, boss2 and makron pass explicit bounds.
- Impact: The body renders on the floor while its collision box is inside it. Hitscan and player contact miss, so bullets cannot gib the corpse as in the original; splash damage was not traced. Toss physics starting from a solid box was not traced further.
- Remediation: `chick_dead(context) { return finishCorpse(context, { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 16 } }); }`.

### SRC3Q2-004 — Jorg's walker model stays attached after its final explosion, because ThrowHead does not clear model2
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** jorg.ts:16 sets model2, boss-common.ts:61 calls throwGib with head:true on the same entity, gibs.ts:70-97 never clears model2, and entity-services.ts:347 still sends it. g_misc.c:193 sets modelindex2 = 0. The gib lives 10-20 s (gibs.ts schedule).
- Severity: Medium
- Category: bug
- Location: src/content/q2/foundation/monsters/gibs.ts:54, :70-75; src/content/q2/base/monsters/jorg.ts:16; src/content/q2/base/monsters/boss-common.ts:61
- Confidence: traced; `model2` has no write in gibs.ts and entity-services.ts:347 sends it as an attached model. Not observed in play
- Evidence: upstream/Quake-2/game/g_misc.c:183-195 ThrowHead: `self->s.modelindex2 = 0;`. Port head path reuses `self` and sets only `gib.model = model`. Jorg sets `context.entity.model2 = "models/monsters/boss3/jorg/tris.md2"`, and boss31.ts:192 runs BossExplode at the end of the death move, which calls throwGib with `head: true`. missionpacks/monsters/gekk.ts:43 clears model2 in its own head gib, which shows the requirement was known there.
- Impact: At the climax of the final boss fight the whole Jorg walker, reset to frame 0, flies off attached to the gear gib for 10 to 20 seconds.
- Remediation: Clear model2, model3 and model4 in the head branch of throwGib.

### SRC3Q2-005 — A head gib keeps its entity's looping sound
- **Verification (VERIFY-U): confirmed. Final severity: Low.** g_misc.c:183-200 sets s.sound = 0. standardGib (common.ts:33-41) and the throwGib head branch emit no stop. hover.ts:16 starts a loop, and audio.ts:609 stops it only when the actor leaves the snapshot. Boss code calls stopLoop explicitly (boss-common.ts:57), so this is specific to the standard path.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/gibs.ts:70-97; src/app/bootstrap/audio.ts:608-610
- Confidence: traced
- Evidence: g_misc.c:183-200 ThrowHead sets `self->s.sound = 0`. Port monster loops are event-driven (common.ts:50-51, ai.ts:416) and stop only on a stop event or when the actor leaves the snapshot (audio.ts:609). throwGib emits no stop. It clears the flies effect bit but not the flies sound.
- Impact: A gibbed Icarus (hover) leaves a head chunk playing hovidle1 for 10 to 20 seconds, and a corpse with flies keeps buzzing after being gibbed.
- Remediation: Emit the loop stop in the head branch, using the same empty-path event as stopLoop.

### SRC3Q2-006 — Monsters never show the power screen effect
- **Verification (VERIFY-U): confirmed. Final severity: Low.** monsters/index.ts:574 clears and sets only resurrection bits, and 0x200 and powerArmorTime exist only in player code. brain.ts:13-33 does have powered screens, so g_monster.c:346-350 applies. The "no cue" impact holds: no src/content/q2 or src/world code emits screen or shield sparks either.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:574
- Confidence: traced by grep; `0x200` and `powerArmorTime` occur only in player code (base/player/view.ts:149-150, index.ts:492, character.ts:110)
- Evidence: Port: `entity.effects &= ~256; ...; if (state.resurrecting) {...}`. Original upstream/Quake-2/game/g_monster.c:346-350 M_SetEffects: `if (ent->powerarmor_time > level.time) { if (... == POWER_ARMOR_SCREEN) ent->s.effects |= EF_POWERSCREEN; ...}`, with the SHIELD case adding a green shell. g_combat.c:244 sets `powerarmor_time = level.time + 0.2` on any entity.
- Impact: A Brain's green screen never appears when shot from the front, so the player gets no cue that damage is being absorbed.
- Remediation: Record the armor feedback time for monsters and apply the M_SetEffects branch, clearing bit 512 each think.

### SRC3Q2-007 — Print levels ignore the client's `msg` setting
- **Verification (VERIFY-U): confirmed. Final severity: Low.** network.ts:389 and :407 push every print, and no `msg` key is read in the Q2 network or player paths; sv_send.c:70 and sv_main.c:927-930 filter by it.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/network.ts:389, :407
- Confidence: traced by grep; no `msg` key read in the Q2 network or player code
- Evidence: server/sv_send.c:70 `if (level < cl->messagelevel) return;` and :115 in SV_BroadcastPrintf; server/sv_main.c:927-930 parses `msg`. Port pushes every print. qw-server.ts:108 does filter.
- Impact: A client using `msg 1` or higher to suppress pickup and low-priority messages still receives them.
- Remediation: Parse `msg` in the Q2 userinfo path and test it per peer before pushing a print.

### SRC3Q2-008 — Infantry and mutant corpses get flies half the time; the original gives them flies nearly always, and defers medics
- **Verification (VERIFY-U): confirmed. Final severity: Low.** infantry_dead and mutant_dead (m_infantry.c:304-313, m_mutant.c:534-543) leave nextthink set, and g_monster.c:380-388 re-enters the endfunc each frame, so M_FlyCheck re-rolls. ai.ts:402-407 and mutant.ts:85 cancel the think and roll once. m_medic.c:63 skips corpses with a nextthink; the port has no such delay.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/ai.ts:407, :445-448; src/content/q2/base/monsters/mutant.ts:85
- Confidence: traced for the difference; effect not measured
- Evidence: m_infantry.c:304-312 and m_mutant.c:534-543 do not set `nextthink = 0`, unlike other `*_dead` functions. g_monster.c:365-388 M_MoveFrame sets `nextthink` before the endfunc and returns on SVF_DEADMONSTER, so while M_FlyCheck (g_monster.c:123-131) fails its `random() > 0.5` the corpse thinks again next frame and re-rolls. The port cancels the think in `corpse` and `finishCorpse`, then rolls once.
- Impact: About half of these corpses never get flies. In the original, the pending think also makes the corpse fail `medic_FindDeadMonster`'s `ent->nextthink` test (m_medic.c:63) until the flies finish, so port medics revive such bodies sooner.
- Remediation: Re-roll each frame until the check succeeds, leaving the think pending, for these two species only.

### SRC3Q2-009 — Entity loop sounds attenuate at 1 where the original always uses the static rate
- **Verification (VERIFY-U): refuted. Final severity: Info.** attenuation 1 is the correct value: audio/mixer.ts:543 multiplies Q2 loop attenuation by 0.003, exactly SOUND_LOOPATTENUATE (snd_dma.c:38, :863), via audio.ts:530 and engine.ts:311-313. The remediation would break it. New evidence of the inverse: loops emitted with 3 (scenery.ts:205, foundation/movers.ts:167, :179 and :191, base/entities/movers.ts:29) mix at 0.009, three times too steep.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/monsters/common.ts:51; base/monsters/makron.ts:87; foundation/monsters/ai.ts:416; foundation/weapons/ballistics.ts:310; foundation/weapons/player.ts:435-437; src/app/bootstrap/audio.ts:530
- Confidence: traced; audible radius not measured
- Evidence: client/snd_dma.c:38 `SOUND_LOOPATTENUATE 0.003` and :863, :874 apply it to every `s.sound`, equal to ATTN_STATIC (3). Port emits `attenuation: 1`, passed through at audio.ts:530. The port's teleporter uses 3 (base/entities/scenery.ts:205), so the value is honored.
- Impact: Rockets in flight, blaster bolts, Flyer and Hover engines, Boss2 engines, flies and weapon loops carry about three times the original distance in the local TS client.
- Remediation: Use 3 for all `loop: "start"` events.

### SRC3Q2-010 — Three monster sound calls differ from the source
- **Verification (VERIFY-U): confirmed. Final severity: Low.** common.ts:13 is sound(path, channel, attenuation). gladiator.ts:22 passes attenuation 2 against m_gladiator.c:54-56 ATTN_NORM. boss2.ts:14 is unconditional at attenuation 1 against m_boss2.c:41-44's 50 percent ATTN_NONE. supertank.ts:34 passes channel 4 against m_supertank.c:44-46 CHAN_VOICE.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/monsters/gladiator.ts:22; base/monsters/boss2.ts:14; base/monsters/supertank.ts:34
- Confidence: traced
- Evidence: (a) Gladiator: `search: sound("gladiator/gldsrch1.wav", 2, 2)`, but m_gladiator.c:54-56 uses ATTN_NORM. (b) Boss2: `search: sound("bosshovr/bhvunqv1.wav")` always plays at ATTN_NORM, but m_boss2.c:41-44 is `if (random() < 0.5) gi.sound (..., ATTN_NONE, 0)`, so half the time silent and otherwise map-wide. (c) Supertank: `TreadSound: sound("bosstank/btkengn1.wav", 4)` is CHAN_BODY, but m_supertank.c:44-46 uses CHAN_VOICE.
- Impact: The Boss2 search cue is local and unconditional instead of global and intermittent. Supertank treads no longer cut off its voice sounds.
- Remediation: Copy the source arguments; Boss2 needs a random gate and attenuation 0.

### SRC3Q2-011 — BFG charge noise is placed at the world origin, under a comment the source does not support
- **Verification (VERIFY-U): refuted. Final severity: Info.** The player.ts:627 comment is accurate for retail: ORIG/p_weapon.c:1389 passes the uninitialized `start`, and gamex86.dll 0x2002f678 passes a stack address (`lea ecx,[esp+0x24]`) with no earlier write in that path. Only Q2/game/p_weapon.c:1389 uses ent->s.origin. An explicit zero is a deterministic stand-in for that undefined value; moving to the origin is a design choice, not a port defect.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/player.ts:627-628
- Confidence: traced against this tree only; retail DLL behavior was not checked
- Evidence: `// Classic C reads an uninitialized stack vector here; keep the donor's explicit zero vector.` and `rerelease ? game.body(self).origin : zero`. upstream/Quake-2/game/p_weapon.c:1389 is `PlayerNoise(ent, ent->s.origin, PNOISE_WEAPON);`, with no stack vector involved. Other distributions may differ.
- Impact: On BFG charge in classic, monsters that hear noises get a target at (0,0,0) rather than at the player. Monsters near the player are not alerted by the charge frame, and any near the map origin can be.
- Remediation: Use the body origin in both editions and remove the comment.

### SRC3Q2-012 — Barrel debris speed and floor drop differ
- **Verification (VERIFY-U): confirmed. Final severity: Low.** scenery.ts:178 uses real division where g_misc.c:925 is integer arithmetic (2*150/200 = 1 against 1.5). barrelDropToFloor (scenery.ts:198-203) uses 0x2010003 and leaves origin unchanged on failure; g_monster.c:315-322 uses MASK_MONSTERSOLID and keeps the +1.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/scenery.ts:178, :200
- Confidence: traced
- Evidence: (a) Port: `2 * self.damage / 200`. g_misc.c:925 `spd = 2 * self->dmg / 200;` assigns integer arithmetic, so default dmg 150 gives 1, not 1.5. (b) M_droptofloor uses MASK_MONSTERSOLID and adds 1 to origin even on failure; the port traces with 0x2010003 (playersolid) and leaves origin unchanged on failure. SRC2Q2-021 covers barrel_touch, not these.
- Impact: Small debris from a default barrel flies 50 percent faster. A barrel can come to rest on playerclip and ignore monsterclip.
- Remediation: Use `Math.trunc(2 * self.damage / 200)` and mask 0x2020003.

### SRC3Q2-013 — Signon commands are accepted after spawn
- **Verification (VERIFY-U): confirmed. Final severity: Low.** q2.ts:339-342 and :352-363 have no state guard, and newClient (:289-295) sets active false and clears frames; sv_user.c:66-69, :130-133 and :187-190 reject these commands after spawn. Self-inflicted only, aside from the reliable reply traffic.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/network/q2.ts:339-342, :352-363
- Confidence: traced; not run, per the no-flood rule
- Evidence: server/sv_user.c:66-69, :130-133, :187-190 reject `new`, `configstrings` and `baselines` unless `state == cs_connected`. Port runs `newClient` and `signonPage` for any peer. `new` sets `peer.active = false`, clearing frames and halting moves while the player stays in the world. `begin` is unguarded in both.
- Impact: A spawned client can freeze its own body in the world, and a short string command returns about a page of reliable data. Reliable overflow still drops only that peer (the crash path is NET-001).
- Remediation: Ignore these three commands while `peer.active` is true.

### SRC3Q2-014 — Chase behavior differs when the target leaves or nobody is available
- **Verification (VERIFY-U): confirmed. Final severity: Low.** index.ts:565 clears the target before chase, so findIndex gives -1 and :552 picks the first candidate; g_chase.c:111-133 advances from the old slot. g_chase.c:173 prints "No other players to chase."; the port has no such text. g_chase.c:89 uses PM_DEAD; index.ts:582 always freezes.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/index.ts:546-558, :565, :582
- Confidence: traced; `No other players` has no hit under src/content or src/app
- Evidence: g_chase.c ChaseNext advances from the old target's slot. The port clears `chaseTarget` first, so `findIndex` returns -1 and it selects the first candidate. GetChaseTarget prints `gi.centerprintf(ent, "No other players to chase.")`; the port is silent. UpdateChaseCam sets `pm_type = PM_DEAD` for a dead target; the port always uses freeze, so the source's dead-view handling is not used.
- Impact: Spectators jump to the lowest slot instead of the next player, and get no message when nobody can be chased.
- Remediation: Keep the old slot for the search, and add the center print.

### SRC3Q2-015 — Rerelease Dualfire has no firing sound
- **Verification (VERIFY-U): confirmed. Final severity: Low.** q2PowerupSound (presentation.ts:28-33) has no quadfire input or branch; RR/p_weapon.cpp:666-671 plays ctf/tech3.wav with a 1 s limiter. Port tech3 use is limited to multiplayer/ctf/techs.ts:121. ## SRC4Q2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/presentation.ts:28-33
- Confidence: traced by grep; `tech3` occurs only under multiplayer/ctf, where it serves the CTF tech
- Evidence: rerelease/p_weapon.cpp:666-671: `else if (ent->client->quadfire_time > level.time && ent->client->ctf_techsndtime < level.time) { ctf_techsndtime = level.time + 1_sec; gi.sound(ent, CHAN_ITEM, gi.soundindex("ctf/tech3.wav"), ...); }`. q2PowerupSound ends at the double-damage case and returns null.
- Impact: Firing under Dualfire in the rerelease edition lacks its audio cue.
- Remediation: Add the branch with a one-second limiter stored per player.

## Summary of IDs
Medium 4 (001-004). Low 11 (005-015). Critical 0, High 0. No finding refutes a catalog entry. SRC3Q2-013 relates to NET-001 only by sharing the reliable queue.
