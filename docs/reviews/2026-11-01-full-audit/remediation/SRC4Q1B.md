# SRC4Q1B remediation
| ID | status | note |
|---|---|---|
| SRC4Q1B-001 | fixed | New addons/coop-spawns.ts for mg1/mg3: info_player_coop is active only when ungated or flag 1, trigger_activate_coop_spawns activates exactly the points whose targetname equals its target (and deactivates the rest, trigger stays reusable) and records the team's weapons; respawnAt in composition/q1/runtime.ts restores them with the 30/4/12 ammo floors (restoreCoopWeapons). Test: tests/gameplay/q1-addons/coop-spawns.test.ts covers activation and selection and, in its second test, the weapon and ammo-floor restore (restoreCoopWeapons). |
| SRC4Q1B-002 | fixed | MG pickups follow COOP_RESPAWN_ITEMS_FOR_PLAYERS: the same player is refused a re-touch, respawn after 1 s until every player has collected it, then 6 minutes; `wait` respawns are honored. Test: start-flags.test.ts covers the single-player 6 minute branch only. |
| SRC4Q1B-007 | fixed | MG3 item_cells give 10 and 20. Test: start-flags.test.ts. |
| SRC4Q1B-008 | fixed | MG weapons that stay (leave) fire their targets once and then clear target. Test: start-flags.test.ts. |
| SRC4Q1B-003 | fixed | MG3 item_sigil with flag 128 is bound to the SUB_regen use and starts hidden after placement (campaign.ts). Test: start-flags.test.ts only asserts the use binding; the harness trace cannot place the item, so the hidden state is untested. |
| SRC4Q1B-004 | fixed | CTF tossWeapon refuses the throw when the consume fails, selects the best weapon after a throw, and a picked-up thrown weapon is selected by the Deathmatch_Weapon rank rule (q1WeaponPickupSelection). No test. |
| SRC4Q1B-005 | fixed | ctf:backpack_touch refuses the owner while more than 118 s remain and prints the source $qc_backpack_got / per-ammo messages. No test. |
| SRC4Q1B-006 | fixed | scoreDeath credits the owner of a teledeath attacker with one frag and does not penalize the victim. No test. |
| SRC4Q1B-009 | fixed | scoreDeath clears lastHurtCarrier on all opposing players when the victim carries a flag. No test. |
| SRC4Q1B-010 | fixed | CTF spawnPlayer resets lastHurtCarrier, lastReturned, lastFraggedCarrier and flagSince to -10. No test. |
| SRC4Q1B-016 | fixed | hammerStrike now drops the strike when the wielder is dead (same site as SRC3Q1A-012). No test. |
| SRC4Q1B-011 | fixed | CTF capture and pickup center prints now require a real opposite or same team; observers get none (flags.ts). No test. |
| SRC4Q1B-012 | fixed | $qc_exited prints only in coop or deathmatch; the voted-map and trigger-map divergence from GotoNextMap is kept and recorded in a comment in maps.ts. No test. |
| SRC4Q1B-013 | fixed | CTF spawnPoint falls back to a rotation through info_player_deathmatch (own cursor) before info_player_start. No test. |
| SRC4Q1B-014 | fixed | MG1/MG3 GrenadeThink (0.05 s ticks, explode at 50, reflect off a floor the grenade stopped on at 0.6) replaces the single 2.5 s explode, and bounce sounds are limited to one per 0.1 s (weapons.ts, game.sourceGrenadeFix). The floor probe constants were checked against the MG3 progs.dat immediates: the trace runs from origin + (0,0,4) to origin - (0,0,8) (the earlier version used 1 unit each way) and was corrected. No test. |
| SRC4Q1B-015 | fixed | MG3 rocket direct damage halves for monster_super_shambler too (weapons.ts). No test. |
| SRC4Q1B-017 | fixed | MG1/MG3 deathmatch limits follow mgdm1 to mgdm2 to mgdm3 to mgdm4 to mgdm1 ahead of the trigger_changelevel lookup (base/rules.ts). No test. |
| SRC4Q1B-018 | fixed | The CTF observer search walks entities from the highest and skips non-solid ones. No test. |
