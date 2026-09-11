# Source assessment

This assessment grounds the unified-engine plan in the adjacent TypeScript ports and the installed reference corpus. It records the state inspected on 2026-09-10. Implementation has not started. Source inspection establishes available mechanisms and concrete gaps; inherited release labels and historical test reports do not establish a passing baseline for the combined engine.

The user identified Q1/Q2 implementation quality as suspect and Q3 as the stronger port. This changes how the sources are used. Their product intent remains valuable, but no imported implementation receives blanket authority because it is called a direct port. All requested game content and functionality remain completion requirements. Inherited omissions are work to finish, not accepted exclusions.

Three kinds of evidence remain separate throughout the plan:

- **Intent and contract:** what the user required and what source interfaces or design records describe.
- **Implementation observation:** what the inspected TypeScript actually does, including omissions and accidental behavior.
- **Validated source behavior:** behavior established by a current comparison with the applicable original source, then by execution where needed.

Current original-source comparisons outrank stale documentation and inherited bugs. A failing port behavior is a defect to repair, not a fidelity requirement. Original undefined behavior also needs an explicit compatibility decision rather than an accidental JavaScript translation.

## Workspace and source revisions

The destination began as clean `main` at `e7ec45b`, with no remote and only an empty tracked `.gitignore`. No on-disk `AGENTS.md` existed in the destination or its ancestors. The following source checkouts were clean when inspected. Remote refs were not fetched.

| Source checkout under `/home/buzzkill/Projects` | Inspected HEAD | Local tracking state |
| --- | --- | --- |
| `quake-1-re-ts` | `6bc6a8bf29b66981e3b6ce7251ebbc6413120270` | Matches local `origin/main` |
| `quake-2-re-ts` | `0d73750cbe5683c7411934d0a5d4eb5acd4da676` | Ahead 9 of local `origin/main` |
| `quake-3-ts` | `8453c49824eb7a5ed5aee452f74e19336965d1f8` | Matches local `origin/main` |

Their origins are `mgd34msu/Quake-1-Rerelease-TS`, `mgd34msu/Quake-2-Rerelease-TS`, and `mgd34msu/Quake-3-TS` on GitHub. Integration inputs must identify these local commits, including the unpublished Q2 work.

Reference trees under `/home/buzzkill/Projects/qsrc` provide the original behavior:

| Reference | Inspected HEAD |
| --- | --- |
| `quake` | `bf4ac424ce754894ac8f1dae6a3981954bc9852d` |
| `quake-rerelease-qc` | `634eefab09a77eb7b5f5ca7078ba3d8784a91142` |
| `quake-2` | `372afde46e7defc9dd2d719a1732b8ace1fa096e` |
| `quake2-rerelease-dll` | `8dc1fc9794c01ece06881e703851b768fb3994de` |
| `q2repro` | `dafa004c6f0a3218f426dc661412ffdc1ed2a523` |
| `quake-iii-arena` | `dbe4ddb10315479fc00086f08e25d968b4b43c49` |

The Quake reference has untracked `Mission Packs/` and `progs106/`; q2repro has an untracked `.wraplock`. Git revisions alone do not identify that additional material. Source provenance needs content hashes for reference inputs outside tracked history. Reference trees, supplied archives, and commercial data remain untouched.

## The existing core already defines the intended separation

The strongest precedent is Q2's [unified-engine design](/home/buzzkill/Projects/quake-2-re-ts/ARCHITECTURE.md:177). It describes one engine for Q1, Q2, and Q3, with independent asset loading, selectable gameplay, and cross-game entity behavior. Its discussion of universal formats is a design precedent, not proof that the present Q2 implementation supports the entire matrix. In particular, classname translation alone cannot supply Q1 campaign monsters under Q3 rules or preserve arbitrary collision hulls.

Q2's implemented [DataMountPlanFor](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:886) separates gameplay, campaign, and installation. Rerelease gameplay with original maps mounts rerelease assets first, the classic installation beneath, and gives classic `maps/` lookups precedence. This preserves the selected ruleset's HUD, fonts, sounds, and textures while retaining the selected map geometry. Classic gameplay mounts the selected installation alone. These are explicit resolution rules, not a global filename merge.

Q1 makes an additional distinction. Its [ResolveLaunch](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:399) retains each campaign's `progs.dat`, while [SV_Ruleset](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/ruleset.ts:103) selects an independent classic or rerelease engine behavior profile. Choosing classic behavior for hipnotic therefore does not select id1's game code. [ClassicProgsPlan](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:425) models that separate choice for eligible campaigns, but the file explicitly states that the corresponding menu entry is not wired.

The unified session model consequently needs separate identities for gameplay implementation, behavior profile, content, map source, asset precedence, and wire protocol. These identities also belong in saves and launch records. A single `game` string cannot preserve their meaning through switching, networking, or restoration.

Component selection is per subsystem. Q3's strict tooling, platform ownership, resource lifetime, CPU/GL interfaces, and verification infrastructure are preferred reuse candidates. Its actual [SoftwareRenderer](/home/buzzkill/Projects/quake-3-ts/src/render/cpu/rasterizer.ts:364) and [GlRenderer](/home/buzzkill/Projects/quake-3-ts/src/render/gl/renderer.ts:136) implement one backend contract. Equivalent or better Q1/Q2 implementations remain candidates: Q1 content/VM work and Q2 MD5 replacement scale, BSPX lighting, campaign lifecycle, audio, and multiplayer features supply capabilities the union needs. Shared source lineage can reduce duplicate implementation after semantic comparison. Each candidate still needs review against the unified contract. Q3's state limits, material assumptions, and resource identities cannot become universal merely by renaming their types. [feature-coverage.md](feature-coverage.md) records the full feature-family union.

## Existing execution and compatibility limits

Q1 already interprets QuakeC in TypeScript. Its [program loader](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:1095) and extension bindings provide a useful execution base. That does not make the current compatibility table behavior-preserving. [compat_spawn.ts](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:140) substitutes permanent walls for destructible or moving objects, inhibits some mechanics, and changes rune relays into unconditional relays. The rune conversion drops the sigil condition used by real hub logic. A map that spawns without unknown classnames can still lose progression rules. Crossover acceptance must exercise doors, counters, objectives, inter-map state, and campaign completion.

This is a current original-source comparison: [rune_relay_use](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg3/mg3_triggers.qc:37) returns when a required sigil is absent, then schedules target execution. The TypeScript rename loses that condition. Likewise, [mg1's hub exit](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg1/map_specific/hub.qc:21) requires all sigils, while [the fallback](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:121) becomes an ordinary level exit. No game execution was performed for these comparisons.

The isolated Q1 investigation also found that its classname test accepts the union of classic programs rather than checking each selected program. Its map sweep pairs content with its own program instead of testing the cross product. These checks cannot establish arbitrary crossover. Built-in Q1 gameplay still needs first-party TypeScript implementation; retaining QuakeC execution for external mods and comparison does not fulfill that separate requirement.

Q2 offers peer bindings over a shared core, including classic gameplay on wider rerelease state. Its [legacy module selection](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:914) statically selects baseq2, CTF, LMCTF, xatrix, or rogue. Unknown names reach the baseq2 fallback. This is not arbitrary native-mod execution.

The widened classic session uses [protocol 4038](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/protocol/q2repro.ts:1742), derived from 1038 with classic movement and light-level semantics restored. The code identifies 4038 as private to this engine. Local agreement on this format is not interoperability with existing 1038 peers. Protocol identity and negotiation must survive consolidation explicitly.

The planning team's bounded Q2 probe exercised the actual classic serializers in memory. It found four losses: POI stage changes from 9 to 0, entity fog density from 0.35 to 0, brush animation enabled from true to false, and persistent flechette capacity from 200 to 0. The relevant ownership is [game/g_save.ts](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_save.ts:919). This finding requires a preservation audit across all classic module serializers. Cross-unit flags and landmark state already have serialization and are not part of this omission. The probe did not write a save file or boot a restored game.

Other inspected Q2 gaps include the empty [classic flashlight action](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_items.ts:830) and Q64 movement configuration disagreement: the [server's ClientThink](/home/buzzkill/Projects/quake-2-re-ts/src/kexgame/p_client.ts:3531) passes default movement configuration while the [cgame](/home/buzzkill/Projects/quake-2-re-ts/src/kexgame/cgame/cg_main.ts:78) applies the published N64-physics setting. The latter is a source-level discrepancy, without a live movement reproduction. These are functionality requirements to repair and validate.

Q3 has both a TypeScript CPU rasterizer and system OpenGL rendering. Its [module acquisition](/home/buzzkill/Projects/quake-3-ts/src/engine/client-modules.ts:111) selects known retail artifacts by identity for TypeScript replacements and parses other QVM images for bytecode execution. The [QvmInterpreter](/home/buzzkill/Projects/quake-3-ts/src/vm/interpreter.ts:102) is a real starting point for Q3 mod support. Neither that interpreter nor Q2's static selection is a generic PE or ELF interpreter. Native binary mods require a separate execution design if arbitrary mod compatibility is to be fulfilled with TypeScript implementation. Known-module substitution cannot count as that deliverable.

The isolated mod inspection found PE32 i386 classic Q2 modules and a PE32+ x86-64 rerelease module, with OS and C/C++ runtime imports. Required work includes guest memory, instructions, calling conventions, relocations, imports, callbacks, and family-specific layouts. Even correct binary execution cannot override movement or damage hidden inside a mod automatically. Semantic crossover needs its own ownership rules and adapters.

## Linux platform and implementation policy

Linux is the first release target. This host has Bun 1.3.14, SDL2 2.32.70, system GL and EGL, Vorbis, FreeType, libc, and Xvfb. Library discovery establishes availability, not successful rendering or audio behavior.

The existing convention permits system libraries for platform services. Q1's [library resolver](/home/buzzkill/Projects/quake-1-re-ts/src/platform/libs.ts:1) covers SDL2, GL, Vorbis, and sockets. Q2 uses corresponding SDL, Vorbis, and GL bindings, with `Bun.udpSocket` for UDP. Q3's [native-library resolver](/home/buzzkill/Projects/quake-3-ts/src/platform/native-libraries.ts:15) covers SDL2 and FreeType, with separate platform adapters for other native services. These are compatible with TypeScript-owned gameplay and CPU rendering. A compiled Bun executable still needs its system platform libraries.

Q1 and Q2's current checks do not meet the requested no-casts standard. Their porting rules permit `as const`, their FFI tables use it, and their [check script](/home/buzzkill/Projects/quake-2-re-ts/scripts/check.sh:1) combines TypeScript with a regex ban on selected `any` spellings. Their tsconfigs omit unchecked-index enforcement and exclude tooling from compilation.

Q3 supplies the stronger reusable foundation: [strict compiler settings](/home/buzzkill/Projects/quake-3-ts/tsconfig.json:1) and a [compiler-API policy checker](/home/buzzkill/Projects/quake-3-ts/tools/type-policy.ts:389). The checker rejects explicit and unsafe inferred `any`, type and const assertions, non-null assertions, suppressed diagnostics, hidden native implementation, runtime subprocesses, and inappropriate FFI access. Applying that policy to imported code is actual migration work. Its approved library names and hardcoded module paths need deliberate adaptation for the unified platform boundary. First-party runtime and tooling remain TypeScript, with only the few shell entrypoints the user allowed.

## Data coverage and provenance

The planning inventory of `/home/buzzkill/Projects/qfiles` contains 1,882 files, approximately 11 GB, including 45 PAKs, 12 PK3s, two KPFs, and one ZIP. Archive-entry counts include repeated or overridden paths and are not counts of unique playable maps.

The observed Q1 material covers id1, hipnotic, rogue, dopa, mg1, mg3, CTF, and QuakeWorld. Here mg3 is Dawn of the Machine. Q2 includes classic baseq2, xatrix, rogue, CTF, and LMCTF, plus the rerelease's base campaign, Call of the Machine, The Reckoning, Ground Zero, and Quake II 64. The rerelease inventory contains 222 BSP entries. Q3 includes baseq3 and Team Arena. Q1 Nintendo 64 content has not been verified. Extra Quake Live data exists in the corpus but does not expand the requested product scope.

The format assessment includes Q1 BSP29 and BSP2, Q2 IBSP38 and QBSP, Q3 IBSP46, MDL, SPR, MD2, SP2, MD3, and MD5 models, CIN, OGV, and RoQ cinematics, and audio. These inventory categories do not imply that every variant has a verified fixture. MD4 has Q3 source support but no confirmed retail-corpus example in this assessment. Presence of a parser is weaker evidence than complete rendering, animation, collision, or playback. Uncertain coverage belongs in the executable inventory and acceptance work, without reopening already-settled scope questions.

Commercial assets remain external runtime inputs. The destination's initially empty ignore file provides no protection. Q1 and Q3 have useful data, output, and credential rules; Q2's rules omit commercial assets. Imported source needs preserved attribution, particularly Q3's [NOTICE.md](/home/buzzkill/Projects/quake-3-ts/NOTICE.md:1) and accompanying licenses. Generated menu artwork needs separate provenance and a deliberately tracked asset location.

## Evidence needed before integration acceptance

No fresh full baseline suite or build ran during this assessment. Historical Q3 evidence and Q1/Q2 release descriptions remain historical. The bounded Q2 save observation is narrower than engine acceptance.

Q3's [check runner](/home/buzzkill/Projects/quake-3-ts/tools/check.ts:15) provides a useful verification design: immutable input snapshots, explicit retail requirements, separate GL execution, and detection of changing inputs. Its [build tool](/home/buzzkill/Projects/quake-3-ts/tools/build.ts:38) includes renderer workers and records artifact provenance. Q1's CI intentionally skips retail-dependent coverage without installed data. Existing Q1/Q2 sandbox scripts force-reset supplied worktrees and should not become the unified verification interface unchanged.

The dependency graph must therefore include source capture and policy migration, isolated state ownership, asset resolution, format and collision integration, executable gameplay bindings, semantic crossover, save preservation, and real CPU/GL verification. Release acceptance needs both source and compiled execution, real gameplay transitions, independent network peers where compatibility is claimed, and repeated changes of content and gameplay within one process. Graphics checks use an owned private display and dummy audio, following [Q3's device-isolation instructions](/home/buzzkill/Projects/quake-3-ts/AGENTS.md:15). Neither synthetic fixtures nor successful map loading can replace these checks.
