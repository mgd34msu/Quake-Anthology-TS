# Quake Anthology TypeScript: full project audit

**Completed:** 2026-11-01. **Revision:** `fcdc8af5` on `main`, package version 1.2.6, 11 commits after the v1.2.6 tag.
**Scope:** all of `src`, `tests`, `tools`, `docs`, `assets` and the repository configuration.
**No code was changed.** This directory is the only addition to the working tree, and it is uncommitted.

| Document | Contents |
| --- | --- |
| This page | Conclusions, themes, test results, coverage, and recommended order of work |
| [CATALOG.md](CATALOG.md) | All 948 entries by severity, linked to their full entries |
| [findings/](findings/) | Full entries by area: evidence, impact and remediation for each |
| [verification/](verification/) | Results of the independent reviews that tried to disprove every finding |
| [evidence/](evidence/) | Soak logs, heap retention paths, architecture metrics, promise scan, and harness source |

## Conclusions

The engine is careful work with a strong classic core, one structural flaw, one serious leak, and more fidelity gaps outside the classic games than its docs suggest.

- **Memory safety and the classic ports are strong.** No path from a guest DLL or QVM to host memory was found, and the type discipline is unusually strict. Classic frame and move tables match id's source almost exactly, with 4,670 classic Q2 frames showing no mismatch.
- **Fidelity is weaker beyond the classic core, and some stock content doesn't work.** Six stock Q3 maps refuse to load (SRC3Q3-001). Rerelease monsters run classic AI movement and view rules (SRC5-001, SRC5-002, SRC6-001), and MG1 and MG3 are missing many features, including a whole monster and many map flags (SRC4Q1A-001, SRC2Q1-001, SRC3Q1B-001).
- **The structural flaw is that any exception ends the process.** The code turns bad input and original-source undefined behavior into thrown errors, which is good, but no layer catches them. As a result, ordinary peers, servers, files and console typos can all shut the program down. All 10 Critical findings are of this kind or depend on it, and it accounts for well over 75 findings overall.
- **The leak is that every map change keeps the entire previous world in memory.** It affects all three games, on clients and servers, at 18–41 MB per map. A cause was isolated and a throwaway patch confirmed it.
- **The project lacks the machinery to catch this class of problem.** There is no CI, the test suite cannot pass without one specific local setup and writes into the developer's real profile, the policy gate takes 18 minutes and 13 GB, many tests still pass with the behavior they name removed, and the status documents contradict each other.

**Running a public server on this revision isn't safe.** Three of the Critical findings need nothing more than a default configuration and an open port: GAPSIM-001 (with a classic Q2 DLL), NET-002 (QuakeWorld) and NET-003 (unified). Fixing the containment boundaries below is the single most valuable change available.

## Findings at a glance

There are 929 unique findings, plus 19 cross-references kept for traceability, 11 of which are re-measurement notes.

| Severity | Count | Meaning |
| --- | ---: | --- |
| Critical | 10 | A remote peer can end a server, or run commands on it, in a realistic configuration |
| High | 85 | Reachable crash, session-scale leak, major performance loss, or wrong core behavior |
| Medium | 278 | Real defect with limited reach |
| Low | 479 | Minor defect or cleanup |
| Info | 77 | Observation, or a finding refuted by verification |

| Category | Count | | Evidence | Count |
| --- | ---: | --- | --- | ---: |
| Bug | 392 | | Reproduced by running code | 305 |
| Robustness | 130 | | Traced through the code path | 585 |
| Performance | 90 | | Plausible, or established by search only | 39 |
| Test gap | 84 | | | |
| Security | 64 | | | |
| Documentation | 60 | | | |
| Maintainability | 44 | | | |
| Leak or unbounded growth | 39 | | | |
| Dead code | 26 | | | |

An independent reviewer tried to disprove every unique finding. That process changed a lot: **18 findings were refuted, 94 were lowered in severity, 12 were raised, and many more had their triggers or measurements corrected.** The refuted findings stay in the catalog, marked as such, and are at Low or Info: CONTENT1-010, GAPBOTS-001, GAPBOTS-003, GAPQ12-014, GAPQ12B-006, GAPQ12B-007, GAPQ12B-008, GAPQ3-010, GAPQ3B-006, GAPSIM-012, LEFT-006, RENDER-003, SRC2Q2-010, SRC3Q1A-010, SRC3Q2-009, SRC3Q2-011, SRCQ3-002, TABLES-009.

## Critical findings

| ID | What happens | Requires | Evidence |
| --- | --- | --- | --- |
| [GAPSIM-001](findings/GAPSIM.md) | One unauthenticated `connect` with a 600-character userinfo ends the server | Q2 server hosting a classic native DLL | Throw reproduced with retail `gamex86.dll`; network route traced |
| [NET-002](findings/NET.md) | One QuakeWorld datagram with sequence `0x7fffffff` ends the server | QW listener; unauthenticated admission | Component reproduced; full route traced |
| [NET-003](findings/NET.md) | Replaying the unified `connect` handshake ends the server | Unified listener; no admission needed | **Crashed a real dedicated server** |
| [SIM-001](findings/SIM.md) | One input with a bad arsenal intent ends the host | Admitted unified peer | **Crashed a real dedicated server** |
| [GAPQ3-001](findings/GAPQ3.md) | `gc 0 7`, `follownext`, or a trailing ESC in `follow` ends the server | Connected client, native Q3 game | Throws reproduced; route traced |
| [GAPQ3-002](findings/GAPQ3.md) | A passed `callvote` containing a newline runs arbitrary server console commands | Winning a vote, easy on empty or bot-filled servers; `g_allowVote` defaults to 1 | Vote string reproduced; execution traced |
| [BOTS-001](findings/BOTS.md) | One long chat line ends the server | Native Q3 bots in a team game | Retail template shape confirmed; throw reproduced synthetically |
| [BOTS-002](findings/BOTS.md) | About 128 checkpoint chats exhaust a heap and end the server | Native Q3 bots in a team game | Retail template confirmed; driven with a stubbed bot context |
| [SRC2Q3-001](findings/SRC2Q3.md) | `gc` naming a slot at or above `sv_maxclients` ends the server | Connected client, native Q3 team game | Throw reproduced; route traced |
| [LEFT-001](findings/LEFT.md) | `checkpoint a is at 5`, sent as team chat or `tell` to a bot, or a short map vector, ends the server | Native Q3 bots in a team game | Reproduced on the real bot console path with the retail template |

## Major themes

### 1. Exceptions have no containment boundary

[APP-001](findings/APP.md) is the root: `run()` has no recovery path, and `main.ts` exits on anything that reaches it. Original Quake engines separate `ERR_DROP` from `ERR_FATAL`; this engine has no equivalent ([VM-004](findings/VM.md), [GUEST-008](findings/GUEST.md), [NET-023](findings/NET.md), [SIM-012](findings/SIM.md)).

| Source of the throw | Examples |
| --- | --- |
| Peers against a server | NET-001, NET-003, SIM-001, GAPSIM-001, GAPQ3-001, BOTS-001, BOTS-002, LEFT-001, GAPQ12-002, GAPQ12-003, GAPQ12B-001, GAPQ12B-002, GAPQ12C-001 |
| Servers against a client | NET-005, APP-002, UI-002, GAPAPP-001, GAPAPP-008, GAPAPP2-004, GAPQ3-005, GAPAPP2-001, GAPAPP2-002, GAPCOMPAT-003, GAPCORE-001, GAPMAT-001, GAPNET-001, GAPQ12-001, GAPQ3-003 |
| Content and mods | DOCS3-007, LEFT-002, RENDER-005, GAPNET-003, GAPCOMPAT-001, GAPCOMPAT-002, GAPAPP-005, GAPQ3B-004, GAPQ3B-005, PLATFORM-002, PLATFORM-003 |
| The local user or environment | APP-003, APP-004, APP-010, T2B-001, PLATFORM-004, PLATFORM-012, PLATFORM-019, GAPAPP-003, UI-003 |

One recurring contract deserves its own fix: `MountedContent.open` throws on invalid paths instead of reporting a miss, which underlies GAPAPP-001, GAPAPP2-001 and GAPAPP2-002.

The crash path also hides its own evidence: the log loses `AggregateError` and `cause` details (APP-005), a close failure replaces the original error (APP-006), and EPIPE and CLI typos are recorded as crashes (APP-004, APP-007). The log is world-readable and stores unredacted arguments, including any `+set rcon_password` (APP-012).

### 2. Memory leaks and unbounded growth

[AUDIT-001](findings/AUDIT.md) dominates. Heap retained after forced full GC, measured with real game data:

| Scenario | Heap before | Heap after | Per map | RSS |
| --- | ---: | ---: | ---: | --- |
| Q1 dedicated, 20 map changes | 58.9 MB | 424.8 MB | 18.3 MB | 407 → 865 MB |
| Q2 dedicated, 10 map changes | 64.1 MB | 257.1 MB | 19.3 MB | 429 → 620 MB |
| Q3 dedicated with 4 bots, 10 map changes | 108.9 MB | 522.6 MB | 41.4 MB | 678 → 1,988 MB |
| Q1 hidden client (CPU renderer), 8 map changes | 279.7 MB | 467.9 MB | 23.5 MB | 1,507 → 2,002 MB |
| Q1 hidden client (real OpenGL), 8 map changes | 233.8 MB | 425.2 MB | 24 MB | 1,388 → 1,891 MB |
| **Q1 dedicated with the bindings cleared (throwaway patch), 12 map changes** | **59.1 MB** | **73.9 MB** | **flat, 74–81 MB** | **402 → 450 MB** |

The heap snapshot shows the chain: `Application.worldSimulation → options → playerIdentity → scope → previousSimulation → options → …`. Closures stored in each new world share a JavaScript scope with the `previousSimulation` variable in `prepareAndReplaceWorld` (`application.ts:2653`). The existing test suite doesn't see it, because a create-and-close cycle never takes this path.

Other growth, by what it scales with:

| Scales with | Findings |
| --- | --- |
| Session or play time | [RENDER-002](findings/RENDER.md) (a texture copy per dispatched CPU batch, about 0.5 MB per draw with 2 workers), [PLATFORM-001](findings/PLATFORM.md) (audio actor table, crash at about 97 minutes at the measured rate), GUEST-003, SIM-008, VM-010, GAPAPP2-006, GAPNET-005 |
| Map lifetime | LEFT-003 (about 70 MB per 500-vertex surface, for rotating or moving models), BOTS-005 (93 MB per runtime at 4,900 nodes, per client), RENDER-001 (up to about 150 MB per frame pair, but only with a Q1 character on a Q2-clock map), GAPSIM-005, GAPSIM-006, GAPQ12C-002, CORE-003, GAPQ12-013 |
| Disk | AUDIT-005 (4.3 GB of build output), APP-019, GAPAPP2-013, FORMATS-026 |

### 3. Performance

No single renderer or simulation hotspot stands out in the main TypeScript path, where dedicated Q1 and Q2 cost about 1.4 ms per step. The expensive areas are specific:

- **Guest execution.** This is the largest real limit. The classic i386 interpreter allocates per instruction with no decode cache. On a retail `gamex86.dll` it runs at 0.72 MIPS and about 83K instructions per frame, which is about 110 ms for a 100 ms server frame on base2, so a classic DLL can't reliably hold 10 Hz ([GUEST-004](findings/GUEST.md)). BigInt soft-float is 7.9x slower than integer code in synthetic loops, but a real measurement puts it at 18% of the classic step and 8% of the rerelease step, so it's a contributor rather than the main cause ([GUEST-005](findings/GUEST.md)).
- **Q3 with bots.** 12–15 ms per step with 4 bots, and 7–9.5 s per map change, which blocks the server frame loop (AUDIT-014, BOTS-012, BOTS-004).
- **Collision.** Q1 sizes that aren't exact hull dimensions skip clip hulls, at 30–60x the cost per trace ([CORE-002](findings/CORE.md)).
- **Scans repeated per frame or per call.** APP-013, GAPAPP-004, GAPCOMPAT-005, GAPCOMPAT-006, VM-011, GUEST-012, GAPQ12B-003, GAPSIM-004, RENDER-014, SIM-013, SIM-014, PLATFORM-024.
- **Earlier optimizations.** PERF2 and PERF3 have no stale-key bugs. PERF3's ancestor marks are disabled on real Q1 maps because a leaf is shared, but that costs at most about 0.1 ms per query (RENDER-007). PERF2's suspected memory growth was refuted on real maps (RENDER-003).
- **Figures re-measured.** An independent pass re-measured the 50 performance and leak findings rated Medium or above: 35 were measured (6 partly) and 15 had no figure or needed conditions the audit couldn't create. Most original timings ran 1.2–1.7x slow because of contention during the audit, and ratios held. Notable corrections: typical Q1 dynamic light views cost 0.6–2.4 ms rather than 16–25 ms (RENDER-008), and the UI pool burn doesn't occur with retail strings (UI-005). The full table is in [findings/RETIME.md](findings/RETIME.md).

### 4. Network and trust boundaries

Beyond crashes, the servers lack standard hardening: no per-client movement time budget (NET-006), no NetQuake challenge (NET-007), no connectionless rate limiting (NET-008), weak slot and handshake limits (NET-009), and a hostile server can drive a client past 2.5 GB of memory with 261 KB on the wire (NET-004). On the client, a Q3 server can force-write any client cvar every frame (GAPAPP-002), and archived values are written unescaped into a script run at next launch (GAPCORE-002).

Some of this matches the original engines' behavior, so it's a decision rather than an accident. It should still be written down, because no document states the trust model (DOCS-015). A hostile mod DLL can't reach native code, but it does receive server console authority and can read `rcon_password` (GUEST-002), and QVMs can write any file under the user root (VM-005). The LLM command validator is a short deny list (PLATFORM-006), and cancelling a request during refresh signs the user out (PLATFORM-005).

Files are a smaller risk than expected. Bombs and hangs exist in JPEG, GIF, IBSP, Q1 BSP and fonts (FORMATS-001 to 006, RENDER-009), but verification rated these Medium because they need a crafted local file and have no default remote path. Downloads do widen that path, so see NET-013.

### 5. Gameplay fidelity

Comparing with id's real source changed this section the most. The classic cores match closely, but the audit's earlier impression of near-total fidelity was too generous: most of the gameplay defects below were invisible until the original code was opened.

- **Stock content that fails.** `q3dm3`, `q3dm4`, `q3dm5`, `q3dm7`, `q3dm10` and `q3dm18` refuse to load, because an entity with no spawn function is fatal where id prints a warning and frees it (SRC3Q3-001, also run directly by the audit lead). The first local client throws on maps such as `q3tourney3` whose spawn point targets a `target_give` (SRC3Q3-002). The Q2 client ends on a model list containing a sprite, which covers retail maps with a BFG (SRC4Q2-001). A touch-fired `func_button` works only once, affecting 123 buttons in baseq2 (SRC2Q2-001).
- **Q3 bots can't use teleporters, jump pads or lifts.** The native navigation profile omits those travel modes, a 128-unit drop limit removes legal ledge routes, and a simulated-traversal gate rejects mover and jump-pad edges. On live bots, 0 of 63 teleport and 0 of 32 jump-pad edges passed on `q3dm17`, and 0 movers were chosen in 3,189 selections on `q3dm19` (SRC8B-001, SRC8B-002, SRC8C-001). No control run took a teleporter after lifting these, so blocking is proven but a fix isn't.
- **QVM games with bots crash.** Any QVM game with bots ends the process when a bot's item goal has been taken and its spot is in view; a dedicated server exited at about 2 simulated seconds with 4 bots (SRC9-001). Built-in `q3-baseq3` and `q3-missionpack` aren't affected. This is rated High rather than Critical only because it needs an opt-in mod and no peer can trigger it.
- **QVM bots can hang.** `BotGetLevelItemGoal` returns 0 instead of -1, so `BotDontAvoid` never exits and any QVM mod with bots can hang at a powerup respawn. The loop was reproduced on retail bytecode through the real trap decoder, not in a full match (SRC7-001).
- **Rerelease AI is classic AI.** The view cone, `M_MoveToGoal`, `SV_StepDirection` and `SV_movestep` are the classic versions, so monsters don't see beside them, stair-step, can't slide along walls and refuse water (SRC5-001, SRC5-002, SRC6-001).
- **MG1 and MG3 gaps.** `monster_slime` isn't implemented, so some maps fail to spawn (SRC4Q1A-001); Chthon isn't the killable version (SRC4Q1A-004); doors, buttons, pickups and teleporters ignore map keys and flags, including 694 entities that move the wrong way (SRC2Q1-001, SRC3Q1B-001, SRC3Q1B-002); and coop checkpoints activate every spawn (SRC4Q1B-001).
- **Blocking defects.** Inline think closures make every checkpoint throw on 15 coop maps, which blocks saves and level exits; reproduced on `jail2` ([CONTENT2-001](findings/CONTENT2.md)). Classic monster proxies survive travel and free unrelated edicts in the next level ([GAPSIM-002](findings/GAPSIM.md)).
- **Visible behavior.** Monsters don't chain-wake in id1 and Rogue (CONTENT1-001), zero-size missiles interact wrongly with players (CORE-001), Q3 spectators keep their own state when following (GAPQ3B-001), closed doors can cull from one side for remote clients (GAPSIM-003), and laser beams stay drawn until the level ends (GAPQ12C-002).
- **Weapons that never fire.** In local QuakeWorld, `PlayerPostThink` never runs, so weapons don't fire (shells stay at 25), yet `qw-local-play` passes ([T1-001](findings/T1.md)). The Q2 arsenal in qdoom with QW or Q2 movement behaves the same way ([T1-002](findings/T1.md)).
- **Split-screen.** A remote client can throw "Application content is closed" on a same-map reload after a seat drop and rejoin; this reproduced in 4 of 13 runs of the unmodified test (T1-003).
- **Data tables.** The tables are very accurate against the real assets: 3,877 of 3,877 Q1 frame rows and 15,557 of 15,724 Q2 move rows match. The mismatches are specific, such as the Prox Launcher's models and the rerelease item values (TABLES-001 to TABLES-004).
- **Found by comparing with id's real source.** A Q1 entity that starts inside a solid never fires touch, so point-blank rockets pass through targets (SRCQ1-001). Toggling a `func_areaportal` missing from the BSP's portal list throws on retail `train` and `xsewer2` (SRCQ2-001). Native DLLs get a null `trace.surface` on box actors, which the retail DLL can read through a shot at an explobox during its death delay (SRCQ2-017). MG1 and MG3 `func_bob` passes degrees to a radian sine (GAPQ12C-004).
- **Inherited from id, not port regressions.** GAPQ3-002, BOTS-002, GAPMAT-001, NET-008, NET-015 and VM-005 exist in id's 1.32 source too. They still need fixing here, but they aren't mistakes in the port.
- **Cross-game mixing is the least settled area.** Selected foreign components account for many defects, including GAPCOMPAT-001, SIM-002, SIM-003, SIM-004 and SIM-005.

Fidelity judgments rest on the reviewers' memory of id's source, because no original source is on this machine. Treat those entries as well-informed rather than proven.

### 6. Maintainability

| Metric | Value |
| --- | --- |
| `SharedSimulation` | 8,260 lines, 498 members; `step` is 463 lines with cyclomatic complexity 326 |
| `Application` | 4,554 lines, 250 members; `prepareAndReplaceWorld` is 617 lines; `commands` has complexity 300 and nesting depth 17 |
| Functions over 100, 200, 500 lines | 210, 59, 9 |
| Lines over 160 characters | 13,686, up to 1,635 characters |
| Comment density | 1–5% across most of the tree |
| Mutually dependent directory pairs | 13, such as `compat ↔ content` and `content ↔ persistence` |
| Import cycles | 12 groups, up to 10 files |
| Modules unreachable from production | 64, totaling 4,119 lines, including the ELF loader and System V guest runtime |
| Exports never imported; imported only by tests | 1,816 (many are types); 235 |

See AUDIT-007 to AUDIT-010, SIM-018, APP-020, GAPSIM-018 and VM-013. The two application classes have drifted apart in ways that cause real bugs (APP-020), and the event codec is 1,056 hand-synchronized lines with no generator (GAPNET-012).

### 7. Tests

The suite is large and has strong assertion density, about 8 `expect()` per test. Its problems are operational rather than a lack of tests:

- It writes to the real profile: 93 of 188 launching test files never set a user root, and `Application.close()` saves settings into `HOME` (TESTS-001). The crash-log test adds a false entry to the real log on every run (APP-008), which explains some of the entries in your local `crash.log`. Earlier test runs may also have changed your real settings files.
- It can't pass without a particular layout: tests fail rather than skip with no game data (TESTS-003), and about half ignore `QTS_TEST_CORPUS` (TESTS-004).
- Coverage disappears silently: about 19% of assertions are gated, including 81% in `tests/movement` (TESTS-005), broken guard paths skip tests even with valid data (TESTS-006), and GL tests sit behind 80+ opt-in variables (TESTS-007).
- Tests can pass with their behavior removed, shown by mutation: the HTTP redirect origin check (T2-001), restore tests that restore into the same live objects (T3-002), the worker wire test that only compares `.kind` (T3-003), and tests titled for music replacement and collision (T4B-001, T4B-002). Foreign-matrix smoke tests mostly assert `health > 0`, which is how T1-001 stayed green (T1-004).
- Fixtures are out of reach: byte-exact save tests are gated on paths that exist nowhere (T4-001), and 8 QC test files need a Copper add-on outside the corpus (T2D-002).
- The riskiest paths are untested: the fatal network paths, peer chat limits, malformed AAS files, and run-loop failure behavior (NET-030, BOTS-023, APP-026, TESTS-012).

### 8. Documentation

User guides are mostly accurate, and the links in them work. The status material is the weak part.

- **Wrong for users:** the README's dedicated server example never opens a listening socket (DOCS-001), the LLM credential location is wrong in two guides (DOCS-002), and `playing.md` says modes need authored content that the code now synthesizes (DOCS-005).
- **Stale or contradictory:** "current" status pages stopped at 1.0.0, 18 releases ago (DOCS-003), and completion is quoted as 21/23, 22/23, 61.4% or 0/477 depending on the page (DOCS-004). All 232 evidence links are dead, and at least 675 of 1,689 unpinned line links land on blank, import or closing-token lines (DOCS-009).
- **Missing:** CONTRIBUTING, CHANGELOG, SECURITY, an architecture overview, troubleshooting, the save format, the protocol, the release process, and the server guide (DOCS-015). JSDoc covers 12.3% of exported declarations (DOCS-016), which only matters for the contract files that docs present as schemas.
- **Ledger rows are often false:** 140 of the 184 open-row reasons contain a false clause at HEAD, and 119 are wholly false (DOCS2-004, DOCS4-006, DOCS5-001), so the open count isn't a work list. T20 is also recorded as complete while no Q1 VCR or Q3 journal was found (DOCS2-001).
- **Broken commands:** 4 of 14 npm scripts fail (DOCS-007). `NATIVE_INTERPOSITION_REPORT.md` describes a tree 78 commits old and should not be committed as it stands (DOCS-012), though some of its open items are still real (DOCS3-001).

### 9. Build, release and tooling

- **The policy gate costs 17m51s and about 13 GB**, against 33 s for `tsc` (AUDIT-002). It's the likely cause of the earlier review's exit 137.
- **No CI** exists for a public repository (AUDIT-003), and builds run no tests, can't be traced to a commit, and have no scripted release (AUDIT-004).
- **`src/version.ts` was wrong at two release tags** (DOCS-010), and a build from HEAD still reports 1.2.6 despite 11 later commits.
- **Build snapshots copy local credentials** if they're present in the project root (AUDIT-006).
- **The release archive holds only the executable,** with no license text, notices or README (AUDIT-018). The executable has no embedded home paths.
- **The title art reproduces the Quake logo and id-style characters,** and only one image records its origin (AUDIT-015). This needs a legal opinion, which this audit can't give.

## Strengths

These are worth preserving through any refactor.

- **Type discipline.** `as any`, `as unknown as`, `@ts-ignore` and non-null assertions all count zero in `src`, and the policy tool enforces it. All 20 empty catches are commented, and only 2 promises are truly floating.
- **Guest isolation.** Native DLLs run in a pure TypeScript interpreter with no FFI access, and guest memory is checked on every path. QVM memory safety holds by construction.
- **Parsers.** Bounds-checked readers, zip-slip protection, and strict PE validation. No out-of-bounds read was found.
- **Download containment.** `O_NOFOLLOW` directory walks, `O_EXCL` staging and `linkSync` publication. Stufftext is not executed.
- **World replacement design.** A staged prepare and publish protocol with rollback, whose leak is a closure accident rather than a design flaw.
- **GL lifetime.** Every object has a matching delete, including constructor error paths. Module-level mutable state is effectively absent.
- **Minimal supply chain.** 2 dev dependencies, no runtime npm dependencies, pinned versions. A history scan found no leaked keys.
- **Earlier review.** B1–B4 from the [2026-10-27 review](../2026-10-27-code-review.md) are fixed, and those fixes and PERF2–3 were checked here. PERF1 landed in `d54179d9`, but this audit did not separately re-test it.

## Test results

Everything ran on a clean export of HEAD with an isolated home directory and real game data, so your profile was untouched. The definitive run also had a copy of the Copper add-on and real OpenGL on a private X display.

| Check | Result |
| --- | --- |
| `bun run typecheck` | **Passed** in 33 s |
| `bun run policy` | **Passed** in 17m51s, about 13 GB peak |
| `bun test`, definitive run | 3,563 passed, 139 skipped, **6 failed**, 3,708 tests in 688 files; 59 minutes |
| `bun test`, first run: dummy SDL drivers, data found only through `QTS_TEST_CORPUS` | 3,207 passed, 145 skipped, 356 failed; 30 minutes, 7.3 GB peak |

The difference between the two runs shows how much depends on setup: about 350 failures came from tests that ignore `QTS_TEST_CORPUS` (TESTS-004), need a display, or read an add-on from the real profile (T2D-002).

All 6 remaining failures have been explained ([AUDIT-016](findings/AUDIT.md)):

| Tests | Cause | Type |
| --- | --- | --- |
| `q3-selected-clock` (2) | `connect`, `disconnect` and `quit` register twice under selected Q3 presentation | **Real product regression**, minor |
| `video-settings` (2) | Assumes a display at least 800 wide; the private display reported 686x890 and the product correctly clamped to it | Test defect |
| `window-runner` (1) | Expects test names that Bun 1.3.14 doesn't print when piped | Test defect |
| `monster-roster` (1) | Uses two different corpus roots | Test defect |

Also, `display-preferences` fails only under the dummy driver, and `remote-application` failed intermittently (T1-003) but passed in the definitive run. **The suite is not green on any configuration tested, and only `q3-selected-clock` points at a product defect.**

## Coverage and limits

The work ran in stages: 15 area reviews, follow-up reviews until no source or test file remained unread, 24 reviews that tried to disprove findings, an independent re-measurement of performance figures, a comparison with id's public source, and direct measurement by the audit lead. Each [findings file](findings/) begins with an exact list of what was read.

| Area | Lines | Reviewed |
| --- | ---: | --- |
| `src`, logic | about 330K | **All read.** LEFT collected every file that any review had skipped, sampled or truncated, and read those 346 files in full |
| `src`, data tables | 44.7K in 110 files | **All read,** though repeated rows in most Q1 and Q2 tables were read through a compact view that collapses them. Also, 38,341 of 42,739 entries (89.7%) were compared against real game assets, plus all 4,096 `shadedots` entries against the lighting formula. No wrong frame or move row was found by hand |
| `tests` | 97K | **All read** |
| `docs`, top-level reports | 15K | **All read,** including every ledger row, path cell and JSON row |
| `tools`, configuration | 1.5K | Read in full |
| `assets` | 5 PNGs, 3 text files | All viewed or read |

**What this audit did not or could not establish:**

- **Actual play.** A person has to play the game to judge feel and to catch what headless runs don't. Soak runs and bots ran with scripted or no input.
- **Live attacks for most Criticals.** Only NET-003 and SIM-001 crashed a real running server. A later attempt to run the others live was halted by an automated safety stop in the review tooling. It wasn't retried, because that stop isn't something this audit should work around, so the other 7 rest on reproduced throws and end-to-end traces. Running them yourself on an isolated machine would settle it.
- **Other platforms and hardware.** Everything ran on Linux x64 on localhost. Windows and macOS paths weren't run, and neither were physical controllers or real audio devices.
- **Internet-facing behavior.** No real master servers, ranking services, download hosts or remote players were used.
- **GPU costs.** GL ran on a private display, but upload costs and renderer-worker memory (RENDER-013) weren't measured.
- **Complete original source comparison.** id's public Quake, Quake 2, Quake III Arena, rerelease DLL and rerelease QuakeC source settled entries and compared the port area by area, including monsters, movers, weapons, collision and most game logic. Q3 shadow pixel output can't be established without rendering, and the small items reviewers couldn't reach are named at the end of each [findings file](findings/), mainly [SRC9](findings/SRC9.md). QuakeWorld logic runs from the original `qwprogs.dat`, so it has no port to compare. Some sources aren't public at all: the rerelease engine and its bot brain, LMCTF, r1q2, q2pro, q2repro, KEX and MVD codecs, and the Microsoft CRT, so those judgments rest on binaries or memory.
- **15 performance findings have no re-measured figure.** They either state no figure or need conditions not available here, such as a hostile server stream or a live worker renderer. [findings/RETIME.md](findings/RETIME.md) gives the reason for each. Findings in other categories were checked by reading and reproduction, not timed.
- **A green test suite.** That needs code changes, which were out of scope.
- **The origin of one crash log entry.** "application composition is not yet wired" matches no reachable revision and is most likely from an uncommitted build (APP-009).

Licensing notes in AUDIT-012, AUDIT-015 and AUDIT-018 are not legal advice.

## Recommended order of work

**1. Stop remote crashes (first).**
- Add containment boundaries: a peer's fault drops that peer, a server's fault disconnects the client and returns to the menu, a guest or VM fault acts as `ERR_DROP`, and a dedicated server survives by restarting the map (APP-001, VM-004, GUEST-008).
- Fix the 9 Criticals directly as well. Containment shouldn't be the only defense for GAPQ3-002, which is command injection.
- Make `MountedContent.open` report a miss instead of throwing.
- Guard `publish` and handshake flushes (NET-001, NET-002, NET-003).

**2. Fix the map-change leak.**
- Fix AUDIT-001 and add a soak test that asserts a bounded `SharedSimulation` count. The harness in `evidence/` can be adapted.
- Then address RENDER-002 and PLATFORM-001.

**3. Make failures visible and tests trustworthy.**
- Fix crash logging: causes, EPIPE, CLI errors, redaction, 0600 permissions, a build ID (APP-004 to APP-007, APP-012).
- Fix the tests: one corpus helper, a mandatory user root, and separate unit, corpus and GL tiers (TESTS-001, TESTS-003, TESTS-004).
- Fix the 6 failing tests, starting with the duplicate command registration, and repair the tests shown to pass with their behavior removed.
- Make the policy gate affordable, then add corpus-free CI (AUDIT-002, AUDIT-003).

**4. Harden servers and clients.**
- Add the time budget, challenges, rate limits and inflate caps (NET-004, NET-006 to NET-009).
- Restrict forced cvar writes and escape archived values (GAPAPP-002, GAPCORE-002).
- Write a SECURITY document with the mod trust model.

**5. Fix gameplay blockers.** Start with SRC3Q3-001 (a small change that restores six stock maps), SRC8B-001 with SRC8B-002 and SRC8C-001 (Q3 bot routing), SRC9-001, SRC4Q2-001, SRC2Q2-001, T1-001, T1-002, CONTENT2-001, GAPSIM-002, CONTENT1-001 and CORE-001, then decide whether rerelease AI should match the rerelease (SRC5-001, SRC5-002, SRC6-001), then the rest of the High entries in the [catalog](CATALOG.md).

**6. Address performance and structure.**
- Profile first, because guest figures are synthetic. Likely targets are the i386 decode cache and floating point, Q3 map travel, and CORE-002.
- Split world replacement into named stages, which also reduces the risk of another AUDIT-001. Add a formatter and a layer rule.

**7. Clean up documentation and release packaging.** Fix DOCS-001, DOCS-002 and DOCS-005, the broken scripts, and the release archive contents immediately, since they're cheap. Then archive superseded status pages behind one maintained page, and write the missing guides.
