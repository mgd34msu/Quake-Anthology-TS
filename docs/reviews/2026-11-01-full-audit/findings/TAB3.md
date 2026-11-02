# TAB3 — Hand review of data tables, part 3
## Coverage
Read in full, by hand, no line truncation (36 of 36 files, 14,855 lines):
src/content/q2/rerelease/monsters/tables/{guncmdr,insane,medic,flyer,mutant,parasite,flashes,gladiator}.ts; src/content/q1/base/frames.ts; src/content/q2/base/monsters/tables/{boss32,actor,tank,hover,boss31,boss2}.ts; src/content/q3/base/game/save-values.ts; src/content/q2/foundation/monsters/muzzle.ts; src/content/q2/missionpacks/monsters/tables/{rogue-chick,xatrix-brain,rogue-infantry,rogue-berserk,rogue-mutant,rogue-carrier,xatrix-gladb}.ts; src/content/monsters/{q2,mg3-resources}.ts; src/content/q1/missionpacks/monsters/tables/{hipgrem,morph,invis_sw}.ts; src/network/q2/anorms.ts; src/content/q1/addons/monsters/heavy/tables/mg3_lavaman.ts; src/content/q2/foundation/weapon-attachments.ts; src/content/q1/addons/monsters/bosses/{frames/final,sphere-points}.ts; src/compat/q2/native-primary-weapon-profile.ts; src/content/composition/expansion-supply.ts.
Skipped: none.
Checks beyond reading, scripts in <scratchpad>/tab3/: every attachment digest hashed against qfiles and pak models, triangle geometry per row, get_org dispatch decoded from mg3 progs, supply profiles expanded with every expansion, retail native profile bytes spot-checked.
Limits: the Xatrix half of native-primary-weapon-profile.ts could not be asset-checked (TAB3-002). The save-values field-coverage script parsed only part of GameEntity and GameClient, so it is not evidence of full save coverage; GAPQ3B-010 already covers that gap.

## Strengths
- Outliers that looked wrong and are source-true: sphere-points.ts index 0 (z -0.99) and index 19 (z -0.97) sit out of spiral order, and the decoded get_org dispatch in mg3 progs maps all 100 indexes to exactly these values (0 differences; the chain ends 99, 19, 0). TABLES only checked set membership, so this closes the order question.
- Provenance headers hold: get_org is in monsters/mg3_oldone_new.qc, boss_final_rise1 in monsters/boss_final.qc, lavaman_rise1 in monsters/mg3_lavaman.qc per progs s_file. Both named generators exist (tools/content/generate-mg3-monster-resources.ts, src/content/q2/rerelease/monsters/generate-tables.ts).
- flashes.ts is sequential 0-289 and agrees with every muzzleIds entry in muzzle.ts by hand comparison.
- weapon-attachments.ts: all 119 digests resolve to a real model. Every mesh triple is in bounds. Rerelease w_glauncher sharing w_plauncher's triple (:45/:51, :104/:110) looks like copy-paste but is not: triangle sides and centroid match the asset exactly (1.59, 3.56, 3.66).
- q2.ts lists that look short (brain has no brnidle1/2 or brnatck2, flipper has no flpidle1 or flpsrch1) match the port: no code plays those sounds.
- expansion-supply.ts: all item ids resolve. Across 8 exported composition profiles (including hipnotic) and every applicable expansion, no item has duplicate owners and every ammo owner resolves to a supply row after expansionSourceSupply.
- native-primary retail profile: digest equals game_x64.dll; 11 of 11 decision ranges contain the button offset (both button fields where declared), and 5 of 5 entries start after CC padding.
- Dangling next pointers (gremlin_flip7 to gremlin_gib, boss_final_missile23 to boss_final_decide) are not defects: boss_final_decide is handled by the override at q1/addons/monsters/bosses/final.ts:56, and an earlier findings file records both as registered.

## Findings
### TAB3-001 — Native held-weapon table omits the 19 crakhor carriers, and a miss throws with no fallback
- **Verification (VERIFY-O2): confirmed-with-changes. Final severity: Medium.** Crakhor does not reach the throw at native-held-weapon.ts:33 on the corpus with a stock guest. No loose dir or pak under qfiles/q2 has players/crakhor/tris.md2, runtime.ts:7413 pushes the body before the attachment (:7414), and presentation-scene.ts:196 hits assets.ts:325 "Model is absent" first (GAPQ12-001 family). With a foreign character, runtime.ts:7403 skips both. startup-selection.ts:270-271 never offers crakhor because it requires tris.md2. The defect is real for its other trigger: reproduced throw and 19/19 crakhor digests unlisted (component level, fake provider). Any third-party Q2 model with tris.md2 and a weapon file but no `.attachment.json` passes the body and throws at :33, ending the process under APP-001; end-to-end not run. Medium: a process exit limited to a native guest with a foreign arsenal. Remaining routes to :33 with crakhor, not run: a guest that sets modelindex2=255 with modelindex!=255 (classic-guest-services.ts:346-348), or a crafted unified-server frame carrying nativeHeldWeapon (unified-frame-values.ts:49, APP-002 family). The stock DLL's modelindex state was not disassembled.
- Severity: Low
- Category: robustness
- Location: src/content/q2/foundation/weapon-attachments.ts:15-135; src/app/bootstrap/native-held-weapon.ts:32-33; src/app/bootstrap/presentation-scene.ts:241; src/app/bootstrap/simulation/rerelease-guest-services.ts:271
- Confidence: traced for the table gap and the throw; the trigger was not run
- Evidence: hashing players/*/w_*.md2, weapon.md2 and a_*.md2 across qfiles/q2/baseq2/players and rerelease pak0, plus md5mesh, leaves exactly 19 unlisted files, all in baseq2/players/crakhor (a_grenades and 18 w_*). Male, female and cyborg are complete. native-held-weapon.ts:33: `if (definition === null) throw new Error(`Native held model ... requires ${path}`)`. presentation-scene.ts:241 awaits this with no catch. The attached path comes from client state: `players/${model}/${weapon}` (rerelease-guest-services.ts:271). The non-native path at held-weapon.ts:64-65 falls back to `held.grip`.
- Impact: With a foreign selected arsenal on a native Q2 guest, a player whose model resolves to crakhor reaches the throw, which ends the process under APP-001. The same applies to any third-party player model that has weapon files but no `.attachment.json`. Limit: the crakhor folder has no tris.md2 and I did not establish that the guest resolves that model name, so reach is unproven.
- Remediation: Add the crakhor digests if they qualify, and skip the held weapon on a miss rather than throwing from presentation.

### TAB3-002 — Xatrix native primary profile binds to a DLL build absent from the corpus; the corpus build has no primary profile
- **Verification (VERIFY-O2): confirmed. Final severity: Info.** combat-profile.ts:24 digest is sha256:8187df..., and qfiles/q2/xatrix/gamex86.dll is 0b0d119e..., matching combat-profile.ts:84. No gamex86*.dll under qfiles hashes to 8187df. native-primary-weapon-profile.ts:80-82 returns null for 0b0d, so native-primary.ts:29-31 returns null. The 0-of-7 range count was not re-run.
- Severity: Info
- Category: test-gap
- Location: src/compat/q2/native-primary-weapon-profile.ts:10-42, :80-82; src/compat/q2/classic/combat-profile.ts:22-26, :84; src/compat/q2/native-primary.ts:29-31
- Confidence: reproduced for the digests and bytes; not traced for what callers do with null
- Evidence: line 12 `digest: xatrixCombatProfile.digest` is sha256:8187df3f... qfiles/q2/xatrix/gamex86.dll is sha256:0b0d119e..., matching `xatrix1998CombatProfile` at combat-profile.ts:84. nativePrimaryWeaponProfile returns null for that digest, so builtinNativePrimary returns null. Applying the profile's RVAs to the 0b0d build fails as expected: 0 of 7 decision ranges contain 0xdcc or 0xdd4. No other in-scope source verifies the 8187df values, and the comment "verified against this PE" at combat-profile.ts:22 cannot be repeated with the available data.
- Impact: The 7 decision ranges, entry points and field offsets for this build remain unverified. The 1998 build has a combat profile but no built-in native primary support. Rejection by digest prevents misapplied offsets, so this is a verification gap rather than a demonstrated defect.
- Remediation: Add the 8187df DLL to the verification corpus, or record it as externally verified. State explicitly whether the 1998 build is meant to be unsupported.

### TAB3-003 — Attachment rows are unlabeled and two grips are named by list position
- **Verification (VERIFY-O2): confirmed. Final severity: Info.** Reproduced by hashing rerelease pak0: :56 (male40Joint) is table index 40 and is male and cyborg md5/a_grenades.md5mesh; :115 (female99Joint) is index 99 and is female md5/a_grenades.md5mesh. :134 is index 118, classic players/cyborg/weapon.md2, after the female block. No row names its model.
- Severity: Info
- Category: maintainability
- Location: src/content/q2/foundation/weapon-attachments.ts:11-12, :15-135 (:56, :115, :134)
- Confidence: reproduced
- Evidence: `male40Joint` and `female99Joint` match no asset name; they sit at 0-based map positions 40 and 99 and belong to a_grenades.md5mesh. Their values differ from `maleJoint`/`femaleJoint` by about 1e-6 in origin and 1e-7 in axis. No row names its model. :134 is classic players/cyborg/weapon.md2 but sits after the female block.
- Impact: Any row insertion makes the names wrong, and a row can only be identified by hashing the corpus. No runtime effect.
- Remediation: Name the grips after the a_grenades carrier and add a model path to each row, or generate the table from a path list.
