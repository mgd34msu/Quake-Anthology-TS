# UI — src/ui/** and assets/
## Coverage
Read in full (50 of 50 files, 13,082 lines under src/ui): common/legacy/runtime.ts (2810), common/legacy/menu.ts (2019), common/legacy/script/preprocessor.ts (1956), script/lexer.ts (1223), script/memory.ts, script/token-memory.ts, script/precomp-memory.ts, script/source-memory.ts, common/legacy/team-arena/memory.ts, common/legacy/input.ts, common/legacy/borders.ts, common/controller.ts (536), common/{layout,draw,skin,assets,art-manifest,menu-theme,captions,accessibility,index}.ts, every file in settings/ (17), hud/ (7), library/ (3), saves/menu.ts, mods/menu.ts. assets/ui/inspect.ts, manifest.ts and main-menu-background.prompt.md in full.
Sampled (consumers only, to trace reach): src/app/bootstrap/{ui,startup-menu,menu-art,q2-native-hud,presentation,remote-application,application,splash}.ts, src/content/q3/presentation/mission-hud.ts, src/compat/qvm/client-script-syscalls.ts, src/bots/behavior/library/script-sources.ts, src/input/{router,seat}.ts, src/network/q2/server-messages.ts, src/main.ts, docs/ui-art-review.md, tests/ui/common/legacy/retail.test.ts.
Skipped: visual review of PNG contents (dimensions, format, size, hashes and references only). No retail corpus is configured in this environment (QTS_TEST_CORPUS, QUAKE_DATA_PATH and QFILES_ROOT are unset), so nothing ran against retail menus.
Experiments ran from the clean checkout. Scripts: scripts/ui/ (parser.ts, runtime.ts, ctrl.ts, perf.ts, harness.ts).

## Strengths
- The expression evaluator is iterative with fixed 64-value and 64-operator bounds (preprocessor.ts:321, :363), so deep #if expressions cannot overflow the stack. Self-referential defines and recursive #include are detected (preprocessor.ts:1341, :1429-1436). A 200-level linear include chain and 1,000,000 chained macro strings both completed without a stack overflow.
- Menu parsing has hard caps: 64 menus, 96 items, 16 list columns, 32 multi slots, 10 color ranges, 1023-byte scripts. UI memory is a bounds-checked typed pool with typed-pointer aliasing checks (team-arena/memory.ts). Malformed menu fields cannot escape the pool.
- loadNativeUiArt releases everything on failure and close() is idempotent (assets.ts:42, :44). Menu dimensions are verified against the manifest at load.
- NativeUiController state is seat-owned. Its keyed maps are keyed by static control IDs (only dynamic IDs are buttons, which are not stored), so fields/listTops/listRows do not grow without bound. Secrets entered through masked fields are cleared on close (llm.ts:18, ranking-account.ts:10-11). HUD center-print queue is bounded (EventRing 256, hud/index.ts:97).
- Measured native menu draw cost is about 8 microseconds per frame for a 3-control menu, so per-frame allocation in the native menu path is not a practical problem.
- All PNGs match their manifest hashes (title.png has none, see UI-024).

Checked and dropped: HUD notice array is pruned every prepared frame by presentation.ts:177, so it is not a leak. UiRuntime.itemArena growth on reload and its O(n) findIndex (runtime.ts:1133-1147) only apply to "unaccounted" memory, and production always passes qvm32 (mission-hud.ts:301). A suspected stack overflow from concatenating strings across macro expansions did not reproduce.

## Findings
### UI-001 — Preprocessor limits default to MAX_SAFE_INTEGER and no caller sets them; a two-line macro cycle hangs the process
- **Verification (VERIFY-A): confirmed. Final severity: High.** preprocessor.ts:38 `DEFAULT_DIAGNOSTIC_LIMIT = Number.MAX_SAFE_INTEGER` is the fallback for all seven limits (:639-645) and no caller (QVM trap_PC_LoadSource, Team Arena HUD, bot library) sets them (grep-confirmed). A two-line macro cycle hangs the synchronous token loop; a doubling macro exhausts memory. Mod-content DoS.
- Severity: High
- Category: robustness
- Location: src/ui/common/legacy/script/preprocessor.ts:38, :639-645, :1070-1072, :1443-1449, :1413; callers src/compat/qvm/client-script-syscalls.ts:102-105, src/bots/behavior/library/script-sources.ts:106, src/content/q3/presentation/mission-hud.ts:297-301
- Confidence: reproduced
- Evidence: `const DEFAULT_DIAGNOSTIC_LIMIT = Number.MAX_SAFE_INTEGER;` is the fallback for maxIncludeDepth, maxMacroExpansions, maxQueuedTokens, maxOutputTokens, maxSourceTokens, maxDefines and maxExpressionTokens. A grep of src and tests finds no use of any of those options outside preprocessor.ts. Only direct self-reference is removed (:1341-1342). parser.ts results:
  - `#define A B\n#define B A\nA\n`: killed by a 6 s timeout (exit 124). With maxMacroExpansions=100000 the same input fails cleanly in 528 ms, so the guard works but is off.
  - `#define A B B\n#define B A\nA`: live allocations about expansions/2 (20,009 at 40,000 expansions), each a 1068-byte token, so it grows until memory is exhausted.
  - 348-byte doubling macro: 262,144 tokens, 5.2 s, synchronous. Include diamond depth 14: 16,384 tokens, 1.2 s. Time doubles per added line.
  The token loop is synchronous between include awaits, so nothing yields.
- Impact: any .menu or bot script reached via trap_PC_LoadSource, the Team Arena HUD loader or the bot library can freeze the client or dedicated server main thread forever, or exhaust memory, from a few bytes of mod content. The id original had the same hole, but this process is long-running and hosts third-party mods.
- Remediation: set finite production defaults in PreprocessorEngine (expansions, queued tokens, output tokens, include depth, defines) instead of relying on callers, and add regression tests for the cycle and doubling cases.

### UI-002 — Server-supplied Q2 layout strings can terminate the client process
- **Verification (VERIFY-A): confirmed. Final severity: High.** q2-native.ts:58/82/90 and rerelease-layout throw RangeError on out-of-range stat/client/image indices and unmatched if/endif; layout text is MSG_ReadString from the server (server-messages.ts:279), parsed during frame prep with no catch → client process exit. Q2's equivalent was ERR_DROP, not fatal. Traced (throws reproduced).
- Severity: High
- Category: robustness
- Location: src/ui/hud/q2-native.ts:58, :82, :90, :152; src/ui/hud/q2-rerelease-layout.ts:52, :55, :62, :139, :184; src/network/q2/server-messages.ts:279; src/app/bootstrap/presentation.ts:245, :371; src/app/bootstrap/remote-application.ts:2315-2325; src/main.ts:34
- Confidence: traced (throws reproduced; the end-to-end network path was followed by reading, not run)
- Evidence: `if (index < 0 || index >= frame.stats.length) throw new RangeError(...)`. ctrl.ts results: layout `pic 999` throws "Q2 HUD stat 999 is outside playerstate"; `client 0 0 9999 0 0 0` throws "Q2 HUD client 9999 is outside clientinfo"; rerelease `if 1` with no endif throws "Q2 HUD if without matching endif"; a bare `endif` also throws. Layout text is `MSG_ReadString` from the server (server-messages.ts:279) and is parsed in prepareNativeQ2Hud during frame preparation. `run()` has no catch around `await this.step(elapsed)`, step's catch rethrows, and main.ts:34 logs the crash and calls `process.exit(1)`.
- Impact: a hostile or buggy Q2 server, or a replayed demo, can kill the client with one svc_layout message. Q2's equivalent errors are ERR_DROP (disconnect), not process exit, and an out-of-range stat index was never fatal there.
- Remediation: treat layout errors as a dropped connection or skip the bad op and report once, and catch at the prepareNativeQ2Hud boundary.

### UI-003 — Up arrow throws RangeError when no other item can take focus
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `menu->items[menu->cursorItem]` runs with cursorItem -1 before the `while` condition ends the loop (`ui/ui_shared.c:2449-2457`). `items[-1]` is the last word of `disableColor` (`ui/ui_shared.h:269-270`). `Item_SetFocus` also returns false for an already focused item (`ui/ui_shared.c:1347`), as the finding states. Source review: SRCQ3
- Severity: High
- Category: bug
- Location: src/ui/common/legacy/runtime.ts:1644-1654; src/ui/common/legacy/menu.ts:871-874; src/content/q3/presentation/mission-hud.ts:597; src/main.ts:34
- Confidence: reproduced (in UiRuntime; the full HUD key path was traced, not run)
- Evidence: the loop steps to -1 after wrapping and calls `menu.itemAt(menu.cursorItem)`, and `item()` throws "UI menu item slot exceeds the source array" for index < 0. runtime.ts results: a menu with one focusable item plus a decoration throws on the second Up; an all-decoration menu throws on the first Up. As I recall id's C, it reads `items[-1]` here without a bounds check (no local copy exists to confirm), so the translation turned a silent out-of-bounds read into a throw. setItemFocus also returns false for an item that already has focus, so a single-focusable menu always reaches this path. Forward direction has the same risk at itemCount=96.
- Impact: in Team Arena, with the cgame key catcher active, pressing Up over a menu whose items are decorations or hidden rejects keyEvent and, with no guard found on that path, ends the process through the unhandled-rejection handler. handleKey picks menus by rectangle regardless of visibility (runtime.ts:1527-1529), which makes such menus easy to hit. Reach is limited to the key-catcher states.
- Remediation: stop the loop when cursorItem leaves 0..itemCount-1 after wrapping, and restore the original cursor.

### UI-004 — Malformed script values raise non-source errors that bypass parser recovery
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** RangeErrors at lexer.ts:900, :917, :1087, token-memory.ts:185, preprocessor.ts:285, :505; lexer.ts:445 isSourceFailure requires ScriptLanguageError; menu.ts:971-975 and client-script-syscalls.ts:124 rethrow; loadHudMenu is unguarded at client.ts.
- Severity: Medium
- Category: robustness
- Location: src/ui/common/legacy/script/lexer.ts:900, :917, :1087; script/token-memory.ts:185; script/preprocessor.ts:285, :505, :513, :1561, :1576; guards at src/ui/common/legacy/menu.ts:971-975, src/compat/qvm/client-script-syscalls.ts:124; propagation src/content/q3/presentation/client.ts:355
- Confidence: reproduced
- Evidence: parser.ts results, all `RangeError` with isSourceFailure=false: `99999999999.5` ("NumberValue floating conversion exceeds..."), `"\99999999999"`, stringize over 1024 bytes, `##` merge over 1024 bytes, `#if 1 << 40`, `#if 2147483647 + 1`. Both guards only swallow source failures and rethrow everything else: `if (reader.isSourceFailure(error)) return undefined; throw error;`.
- Impact: one large float or overflowing #if in one mod menu or bot file aborts the whole load instead of producing a diagnostic for that file. For the HUD, loadHudMenu rejects out of client preparation with no local guard.
- Remediation: report these through fail() as ScriptLanguageError so existing recovery applies.

### UI-005 — String_Alloc tail replacement burns the UI pools on per-frame lookups
- **Verification (VERIFY-P): confirmed-with-changes. Final severity: Low.** RETIME-010 found no pool growth with retail Team Arena strings. The defect needs other strings.
- Severity: Medium
- Category: leak
- Location: src/ui/common/legacy/team-arena/memory.ts:334-351, :253-254; src/ui/common/legacy/runtime.ts:2801-2803, :335-339
- Confidence: reproduced (synthetic strings; not confirmed against retail HUD strings because no corpus is available)
- Evidence: the source's penultimate-node quirk is preserved: `// The source tracks the penultimate node here, replacing the previous tail.` With three strings in a bucket, the two non-head strings evict each other, so each lookup allocates again. itemPassesCvar builds a RuntimeScriptCursor and calls cursor.string() per show/hide item per frame. runtime.ts `pool`: "ui_map3", "team_game1", "g_mode2" share a bucket; 1000 repeat lookups of two interned strings grew the string pool by 19,000 bytes and UI_Alloc by 32,000 bytes. Control with two strings: 0 bytes. Pool returned null after 19,694 pairs on the 1 MB UI pool. The cgame pool is 128 KB.
- Impact: if one frame-tested HUD script hits a three-way collision, the 128 KB pool drains in roughly a minute at 60 fps (about 4,000 pairs at 32 bytes per pair) with one such pair per frame. Then allocate(8) fails, `String_Alloc dereferences a failed UI_Alloc stringDef_t` throws, or a null token throws in itemPassesCvar, on every frame. Inherited from id's code, but the translation makes exhaustion fatal.
- Remediation: append at the real tail. No observable source behavior depends on losing dedup entries, apart from pool usage.

### UI-006 — Modifier state sticks when a key-up arrives with no menu open, so a typed letter wipes a text field
- **Verification (VERIFY-G): confirmed. Final severity: Low.** controller.ts:117 closeMenu leaves shift/control set; :299 returns before :245-246 when no menu is active. Lowered: needs a modifier held across menu close, and pressing Ctrl again clears it.
- Severity: Medium
- Category: bug
- Location: src/ui/common/controller.ts:117, :195-201, :245-246, :299
- Confidence: reproduced
- Evidence: `const active = this.active(); if (active === null) return false;` precedes key handling, and closeMenu does not clear shift/control (they are cleared only on focus loss, :295). ctrl.ts: Ctrl down, Esc (menu closes), Ctrl up (returns false, state stays true), reopen, plain `u` key-down: `text = ""`.
- Impact: after leaving a menu while holding Ctrl, keys u, h, a, e, v in any text field clear it, delete a character, move the cursor or paste until Ctrl is pressed again. Player names, API keys and search text are affected.
- Remediation: clear modifiers in closeMenu when the stack empties, or track modifier keys before the active-menu check.

### UI-007 — A stick held during controller removal keeps changing settings until the menu closes
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** router.ts:232-233 calls seat.releaseDevice only; seat.ts:207-212 sends no UI event; controller.ts:367-368 clears only below threshold; draw (:380-382) repeats held keys every 80 ms. Removal path traced, not run on hardware.
- Severity: Medium
- Category: bug
- Location: src/ui/common/controller.ts:49, :367-368, :380-382; src/input/router.ts:232-233; src/input/seat.ts:207-212
- Confidence: reproduced (controller behavior; removal path traced)
- Evidence: the "disconnected" path calls `seat.releaseDevice`, which clears held bindings and gamepad state but sends no UI event. heldAxes is cleared only by a below-threshold axis event, focus loss or a menu change. ctrl.ts: axis 1.0 then no further events: focus sequence `ui:b -> ui:b -> ui:c -> ui:f -> ui:b -> ui:c`, repeating every 80 ms from draw().
- Impact: a controller dropped mid-press leaves navigation repeating. On the left-x axis it calls change() every 80 ms, so sliders, toggles and choices keep changing and writing settings, with a sound each time.
- Remediation: deliver a device-removed UI event that purges heldAxes entries for that device, and prune by device in draw.

### UI-008 — The highest "Text size" setting overflows menu rows
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** settings/index.ts:290 allows textScale 2; layout.ts:33-36 height 28; controller.ts:385 scales font, :483 fixes y+6, :394-398 fits width only. menuRow is used by production menus (startup-menu.ts and others).
- Severity: Medium
- Category: bug
- Location: src/ui/settings/index.ts:290; src/ui/common/controller.ts:385, :394-398, :483; src/ui/common/layout.ts:33-36; src/ui/common/menu-theme.ts:24
- Confidence: reproduced
- Evidence: textScale ranges to 2 and menuSkin body scale is 2.3. fitText only constrains width. Text origin is a fixed `y = control.rect.y + 6`. ctrl.ts at textScale=2: row 0 text at y=98 with glyph height 36.8, in a row 92..120 with pitch 28, so it extends to about 134.8, into the next row. Non-scrolled rows have no clip (:433).
- Impact: the setting that exists for low-vision players makes rows overlap in every native menu at its upper range. Overlap begins above about textScale 1.2 (6 + 8*2.3*scale > 28).
- Remediation: make row height and text origin derive from the scaled font, or apply a vertical fit in fitText as well as a horizontal one.

### UI-009 — Menu art: most uploaded images are never drawn, and decoded copies are retained for the process lifetime
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** assets.ts:20-25 registers four images; menu-theme.ts:25 nulls background/panel/focus and controller.ts:413-439 are the only readers. menu-art.ts:8 cache deletes only on decode failure (:18); :24 slices per load. File sizes match.
- Severity: Medium
- Category: performance
- Location: src/ui/common/assets.ts:20-25, :39-40; src/ui/common/menu-theme.ts:25; src/app/bootstrap/ui.ts:163; src/app/bootstrap/startup-menu.ts:119-120; src/ui/common/controller.ts:413, :417, :439; src/app/bootstrap/menu-art.ts:8, :16-24; src/app/bootstrap/application.ts:1965, :2950
- Confidence: traced
- Evidence: every load registers all four images. The only readers of skin.background, skin.panel and skin.focus are in controller.ts, and the only two production controllers use menuSkin, which sets all three to null. `resource:engine-menu:main-background` is read only by menuBackdrop, called only from startup-menu.ts:837. Asset status:

  | File | Size | Pixels | RGBA | Production use |
  | --- | --- | --- | --- | --- |
  | title.png | 2.34 MB | 1536x1024 | 6.3 MB | Splash child only (splash.ts:42) |
  | main-menu-background.png | 2.03 MB | 1672x941 | 6.3 MB | Startup menu only, also uploaded in game |
  | menu-background.png | 2.59 MB | 1536x1024 | 6.3 MB | Uploaded, never drawn |
  | menu-panel.png | 0.96 MB | 1254x1254 | 6.3 MB | Uploaded, never drawn (tests/docs only) |
  | menu-focus.png | 0.36 MB | 2172x724 | 6.3 MB | Uploaded, never drawn (tests/docs only) |

  `decodedImages` is a module-level Map with no eviction holding 25 MB of RGBA, and each load also makes a `.slice()` copy per image. Loads repeat at application start and on travel (application.ts:2950), and previous art is released on retirement (:3059), so the GPU side is correctly paired. The waste is the content, not a leak.
- Impact: about 19 MB of never-sampled GPU and registry data at startup and 25 MB in game, 25 MB of permanently retained heap, 25 MB of transient copies per load, and 3.9 MB of binary size for art no production path draws.
- Remediation: remove or actually wire the unused skin art, load the main background only in the startup menu, and drop the decode cache after upload.

### UI-010 — Legacy runtime allocates heavily per frame on the Team Arena HUD path
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** Allocation pattern seen at sampled sites (runtime.ts:265-272, :356, itemPassesCvar at :2801). The 0.93 ms and 326 freezes per frame were not re-run. Limited to the Team Arena HUD.
- Severity: Medium
- Category: performance
- Location: src/ui/common/legacy/runtime.ts:265-272, :356, :1105-1112, :2269, :2330, :2522-2533, :2766-2768, :2801; src/ui/common/legacy/menu.ts:565-569, :740-744, :875-883, :1058, :1074, :1146-1164
- Confidence: reproduced
- Evidence: runtime.ts `frame` with 40 text items, 10 sliders and a 20-row, 3-column list: 326 Object.freeze calls per frame and 0.93 ms per frame on this machine with stub fonts. Causes: the `behavior` getter builds two objects per read; `listData()` builds a new frozen 14-accessor object per call; `list.columns` builds a frozen slice on every access, read `2*C+1` times per row; resourceKey lowercases a path per window per frame; widgetPicture allocates a closure per slider draw; itemPassesCvar parses a script per item; each item awaits an async paint chain. paintAutoWrapped calls textWidth on the growing buffer per character, O(n^2) per wrapped item per frame.
- Impact: steady GC pressure in gameplay. 0.93 ms is minor at 60 Hz (about 6%) and larger at 240 Hz (about 22%). Limited to Team Arena HUD use.
- Remediation: cache freeze wrappers per item, hoist `list.columns` out of the row loop, and pre-tokenize cvar scripts at parse time.

### UI-011 — Script tokenizing is slow enough to stall the main thread on large files
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** memory.ts:294-297 allocates a DataView per getter; lexer.ts:859-871 builds a Map per escape. Throughput not re-run and retail file sizes not measured.
- Severity: Medium
- Category: performance
- Location: src/ui/common/legacy/script/memory.ts:294-297; script/lexer.ts:859-871, :1139-1144, :1167-1169; script/token-memory.ts:172-182, :262-263; script/preprocessor.ts:1079-1085, :1087-1098
- Confidence: reproduced
- Evidence: perf.ts on a 1.16 MB, 300,000-token file: managed text 155K tokens/s (6.4 us/token), BotMemory-backed storage 47K tokens/s (21.2 us/token, 6.4 s total). SourceScriptStorage.view allocates a new DataView on every getter (`offset` is read per character), unlike the cached views in its sibling classes. peek creates a one-character string per call, readRecord copies 1068 bytes twice per token, and readEscape builds a Map per escape.
- Impact: bot and QVM script loads use the slow path on the main thread. A 200 KB bot file would take about 1 s by these numbers. Retail file sizes were not measured here.
- Remediation: cache the DataView, read bytes directly in the lexer loop, and copy token records only when a snapshot is actually retained.

### UI-012 — Much of the legacy UI layer is unreachable from production
- **Verification (VERIFY-G): confirmed. Final severity: Low.** Every listed symbol appears only in its defining file; LegacyUiSeat and defaultUiMenuPlan are also in retail.test.ts; sole production UiRuntime.create is mission-hud.ts:325. Lowered: dead code with no runtime consequence.
- Severity: Medium
- Category: dead-code
- Location: src/ui/common/legacy/input.ts (135 lines); src/ui/common/legacy/runtime.ts:197-199, :510-521, :694-722, :856-873, :1006-1020, :1030-1044, :1816-1900; src/ui/common/legacy/menu.ts:26-31, :359-363, :387-390, :396-402, :982-1007; src/ui/common/legacy/script/preprocessor.ts:1896-1956; script/lexer.ts:551-558
- Confidence: traced
- Evidence: the only production `UiRuntime.create` is mission-hud.ts:325, with `context: { kind: "cgame" }`. Whole-word grep across src (outside the defining files) and tests finds zero references for: menuSink, UiMenuDefinitionSink, appendMenu, publishMenuAsset, acceptMenuRegistration, assertMenuMemory (internal only), cacheAll, paintNamed, runMenuScript, runItemScript, setFeederSelection, applyBindings, reloadBindings, bindingPending, defaultHudMenuPlan, openHandle, ScriptPreprocessor, printDefineHashTable, scriptSkipTo. LegacyUiSeat and defaultUiMenuPlan are referenced only by tests/ui/common/legacy/retail.test.ts. Retail UI QVMs run their own menu code through syscalls, so context "ui" code (bindings, text editing, overstrike) has no production path.
- Impact: runtime.ts at 2,810 lines is a god file carrying features nothing ships, which inflates review and audit surface and gives a false impression of a working native Team Arena UI.
- Remediation: delete the zero-reference APIs and split or remove the "ui" context branch, or wire it in if a native Team Arena frontend is planned.

### UI-013 — Riskiest parser and legacy runtime logic has almost no always-on coverage
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** retail.test.ts:23 is gated on a retail archive and is the only test naming UiRuntime; no test references any max* preprocessor limit.
- Severity: Medium
- Category: test-gap
- Location: tests/ui/common/legacy/retail.test.ts:23; tests/compat/qvm/client-script.test.ts; src/ui/common/legacy/script/preprocessor.ts:639-645
- Confidence: traced
- Evidence: the only runtime test file is `test.skipIf(!existsSync(archivePath))`, gated on a retail pak. Grep finds no test using maxIncludeDepth, maxMacroExpansions, maxQueuedTokens, maxOutputTokens, maxSourceTokens, maxDefines or maxExpressionTokens. UI-001, UI-003 and UI-004 all reproduce in a few lines without assets.
- Impact: clean machines and CI without a corpus get no execution of UiRuntime, so crashes like UI-003 are not caught.
- Remediation: add synthetic-menu tests using a harness like scripts/ui/harness.ts, and cycle, doubling and overflow tests for the preprocessor.

### UI-014 — Parser error paths leak accounted script memory until the VM closes
- **Verification (VERIFY-J): confirmed. Final severity: Low.** preprocessor.ts:1427-1436 creates the frame, then deletes it on recursion without disposing its lexer. :1701 frees the expression chain only on the success path after evaluate. menu.ts:1262,1338 dispose cursors outside finally.
- Severity: Low
- Category: leak
- Location: src/ui/common/legacy/script/preprocessor.ts:1427-1436, :1686-1701, :1500-1505, :1541; src/ui/common/legacy/menu.ts:1262, :1338
- Confidence: reproduced
- Evidence: parser.ts `leak`, BotMemory live allocations after dispose: clean file 0; one self-include 2; ten self-includes 20; failing `#if 1 + x` 2; failed macro arguments 5. On recursion: `this.frames.delete(includedFrame.id); return;` with no `lexer.dispose()`. Expression and argument chains are freed only on success. Each self-include leaks a full copy of the file plus 3.1 KB. Separately, menu.ts disposes cursors outside finally, which currently has no effect because the HUD path uses managed memory.
- Impact: bounded by the number of bad directives and loads, retained until the owner's BotMemory is disposed.
- Remediation: dispose the frame on the recursion path, and free chains in finally blocks.

### UI-015 — Menu script recursion is unguarded
- **Verification (VERIFY-J): confirmed. Final severity: Low.** runtime.ts:755-773 activate, :1172-1178 runScript, :1259 open and :1349-1352 scriptOpen recurse with no depth counter and no suspending await before the descent.
- Severity: Low
- Category: robustness
- Location: src/ui/common/legacy/runtime.ts:755-773, :1172-1178, :1259, :1349-1352
- Confidence: reproduced
- Evidence: `menuDef { name m ... onOpen { open m } }`, then activate("m"): `RangeError: Maximum call stack size exceeded`. The awaits do not yield before descending, so async does not protect the stack.
- Impact: a mod menu script can crash the HUD path. The original recursed too.
- Remediation: add a script depth counter that reports and stops.

### UI-016 — Legacy widgets cannot be operated without a mouse pointer over them
- **Verification (VERIFY-J): confirmed. Final severity: Low.** runtime.ts:1773,1781,2114,2172 require the pointer inside the rect. input.ts:104 sends MouseWheel keys, but no MouseWheel handling exists in runtime.ts. input.ts:20-28 maps pad buttons to the same keys.
- Severity: Low
- Category: bug
- Location: src/ui/common/legacy/runtime.ts:1773, :1781, :2114, :2172, :1913-1997; src/ui/common/legacy/input.ts:20-28
- Confidence: reproduced
- Evidence: yes/no, multi, slider and bind handlers all require `rectContains(item.window.rect, this.displayCursorX, this.displayCursorY)`, and focusRelative does not move the cursor. runtime.ts `keyboard`: focus on a yes/no with the pointer parked elsewhere, Enter/Left/Right change nothing; with the pointer over it, Enter toggles. Sliders have no key adjustment. handleListKey ignores MouseWheelUp/Down although input.ts sends them. This matches id's code, but input.ts maps controller buttons as if they were sufficient.
- Impact: keyboard-only and gamepad-only players cannot use these widgets. Currently limited to mission HUD menus, because of UI-012.
- Remediation: if the runtime stays, treat focused-item activation as valid for keyboard and pad keys, and add left/right slider steps.

### UI-017 — Gamepad-only gaps in native menus
- **Verification (VERIFY-J): confirmed. Final severity: Low.** controller.ts:171 only submits, and SDL_StartTextInput is the only text path. :282-289 cancels only on keyboard Escape while pad buttons are captured. :359-360 rebuilds the Map per event with no repeat, while the axis path at :367-368 has repeat.
- Severity: Low
- Category: bug
- Location: src/ui/common/controller.ts:171, :282-289, :359-360, :367-368
- Confidence: traced
- Evidence: text-entry activation only calls submit and there is no on-screen keyboard, so name, map, lobby and API key fields cannot be edited from a pad. Binding capture cancels only on keyboard Escape, because B and Start are captured as binds. D-pad has no repeat while the left stick does. `new Map(...)` is rebuilt per button event and duplicates input.ts:20-28.
- Impact: a pad-only user can be blocked from fields such as player name and cannot cancel a rebind.
- Remediation: add a simple pad text entry, a pad cancel chord, and a shared button map with repeat.

### UI-018 — UI layout throws on an empty safe area, and split-screen menus have no minimum text size
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Low.** fitUi throws (layout.ts:8-9), but a zero window drawable throws earlier at sdl.ts:803, so fitUi sees zero only through seatViewport truncation (presentation.ts:62-68). No SDL_SetWindowMinimumSize exists in src, so "minimum window 320x200" is not an enforced limit. Unreadable split-screen text stands.
- Severity: Low
- Category: robustness
- Location: src/ui/common/layout.ts:8-9; src/ui/common/controller.ts:378; src/ui/common/menu-theme.ts:39; src/ui/hud/index.ts:31-33; src/app/bootstrap/presentation.ts:178
- Confidence: reproduced for throw and sizes; plausible for a zero viewport occurring at runtime
- Evidence: `if (... area.width <= 0 || area.height <= 0) throw new RangeError(...)`. ctrl.ts: draw at 0x0 and 1x0 throws, as does menuPanel. No guard for this was found in the draw path. Body text pixel height: 160x100 is 3.8 px, 320x200 is 7.7 px, 3840x1600 is 61.3 px. statusLayout enforces a minimum readable HUD scale (hud/index.ts:33), and the controller has no equivalent.
- Impact: if any platform reports a zero drawable, the frame throws. Four-way split at the minimum window (320x200) renders menus unreadable.
- Remediation: skip drawing for empty areas, and apply a minimum text scale in menus as the HUD does.

### UI-019 — Language setting exists but native menu and HUD text is hard-coded English
- **Verification (VERIFY-J): confirmed. Final severity: Low.** Neither controller construction (ui.ts:163-170, startup-menu.ts:120-122) passes localize, and ui.ts:327 passes identity. controller.ts:468,500-501 bypass localize, and :405,:409 fit before localizing.
- Severity: Low
- Category: maintainability
- Location: src/app/bootstrap/ui.ts:163-170, :327; src/app/bootstrap/startup-menu.ts:120-122; src/ui/common/controller.ts:393, :409, :468, :485, :500-501; src/ui/hud/weapon.ts:24-25; src/ui/settings/services.ts:113
- Confidence: traced
- Evidence: neither production NativeUiController passes `localize`, and the HUD passes `localize: text => text`. Even if wired, list column cells (:468) and slider labels (:500-501) bypass localize, and fitText truncates the unlocalized string then localizes the truncated result (:405, :409), which would miss the catalog. Literal labels number in the hundreds across settings/, library/, saves/ and mods/ (settings/index.ts alone has 64 lines with capitalized literals).
- Impact: the Language option changes source-catalog text only, not the frontend. Adding localization later requires fixing the bypasses.
- Remediation: wire one localizer, route all text through it, and truncate after localizing.

### UI-020 — Repeated helpers across menus and parser fields
- **Verification (VERIFY-J): confirmed. Final severity: Low.** All ten cited button helpers exist at the cited lines. settings/server.ts:20-27 wraps at 60 with no long-word handling. Other wrappers and menu.ts ranges were sampled, not exhaustively compared.
- Severity: Low
- Category: maintainability
- Location: `button` helper in settings/{gyro:18,llm:34,local-lobby:21,ranking-account:25,server:32,rotation:15}.ts, saves/menu.ts:17, library/{menu:30,match:8}.ts, mods/menu.ts:36; word-wrap in settings/server.ts:20-27, saves/menu.ts:19-21, settings/llm.ts:72, settings/ranking-account.ts:54, mods/menu.ts:45; menu.ts:1350-1409 (eight near-identical asset cases); menu.ts:1032-1164 (hand-written mirrors of Mutable* classes); controller.ts:393, :455, :460, :496, :508 (measure closures)
- Confidence: traced
- Evidence: the word wrappers differ in width (42, 48, 54, 60, 64) and in behavior on long words. The panel rect is written out at controller.ts:415 and menu-theme.ts:37, :39.
- Impact: inconsistent message wrapping, with fixes needing to land in many places.
- Remediation: extract one control factory module and one wrap helper, and table-drive the asset keywords.

### UI-021 — Native menu layout inconsistencies
- **Verification (VERIFY-J): confirmed. Final severity: Low.** library/match.ts:9,27 gives y=436, bottom 466, against panel bottom 456 (24+432, menu-theme.ts:39). menuPanel uses fitUi without scale (:38-40), while controller.ts:378 uses menuScale.
- Severity: Low
- Category: bug
- Location: src/ui/library/match.ts:9, :27; src/ui/common/menu-theme.ts:38-40; src/app/bootstrap/ui.ts:349-351; src/app/bootstrap/startup-menu.ts:831
- Confidence: traced
- Evidence: match menu Back uses row 10: `y = 96 + 340 = 436`, height 30, ending at 466 past the panel bottom of 456. menuPanel always uses `fitUi(safeArea)` with no menuScale while the controller uses `appearance.menuScale`, so at Menu size 0.75 the backdrop does not match the content.
- Impact: cosmetic overflow and mismatch.
- Remediation: derive these from one panel rect and pass menuScale through.

### UI-022 — Q2 layout strings are re-tokenized per frame, twice for classic Q2
- **Verification (VERIFY-J): confirmed. Final severity: Low.** q2-native-hud.ts:28-30 stores ops only when environment is defined, and :49 re-parses otherwise. q2-native.ts:41 tokenizes on each call.
- Severity: Low
- Category: performance
- Location: src/ui/hud/q2-native.ts:41, :123, :125; src/app/bootstrap/q2-native-hud.ts:28-30, :49
- Confidence: traced
- Evidence: prepare parses to collect picture names and stores results only when `environment` is defined, so classic Q2 parses again in commands(). The layout text rarely changes between frames.
- Impact: avoidable allocation on every Q2 HUD frame.
- Remediation: cache parsed tokens by layout string and bind stat values at draw time.

### UI-023 — Cgame context throws on bind and edit widgets
- **Verification (VERIFY-J): confirmed. Final severity: Low.** runtime.ts:1155-1159 throws in cgame, reached from :2633 via paintBind when text is set (:2653-2655), and from :1722. mission-hud.ts:325-329 is the only UiRuntime.create in src and passes kind cgame.
- Severity: Low
- Category: robustness
- Location: src/ui/common/legacy/runtime.ts:1155-1159, :1722, :2633; src/content/q3/presentation/mission-hud.ts:325-333
- Confidence: traced
- Evidence: bindingHost throws "UI ... is unavailable in cgame context". paintBind calls it for any bind item with text, and beginEditing calls it on Enter or click in an edit field. Production uses only the cgame context.
- Impact: a mod HUD containing a type-13 item with text throws on every paint. A click or Enter on an edit field throws too.
- Remediation: degrade to the "???" text and ignore editing in cgame.

### UI-024 — Asset tooling and docs lag the shipped files
- **Verification (VERIFY-J): confirmed. Final severity: Low.** art-manifest.ts:36 omits title.png, used by splash.ts:1. assets/ui/manifest.ts:1 omits mainMenuBackground, docs/ui-art-review.md:3 says three assets, prompt:3 cites /tmp/codex-clipboard, prompt:5 asks 1920x1080, menu-theme.ts:31 hard-codes the ratio. No test imports inspect.ts or manifest.ts.
- Severity: Low
- Category: docs
- Location: src/ui/common/art-manifest.ts:36; assets/ui/manifest.ts:1; assets/ui/inspect.ts:8; docs/ui-art-review.md:3, :23; assets/ui/main-menu-background.prompt.md:3; src/ui/common/menu-theme.ts:31
- Confidence: traced
- Evidence: title.png is not in menuArtFiles, so no hash or dimension check covers it. manifest.ts re-exports three frames and omits mainMenuBackground while menuArtFiles includes it. The review doc says "Three reusable raster assets". The prompt file cites a `/tmp/codex-clipboard-*` input and asks for 1920x1080, while the file is 1672x941. menuBackdrop hard-codes `1672 / 941` instead of reading the manifest. No test imports inspect.ts or manifest.ts.
- Impact: changes to the splash art or background dimensions pass unchecked, and the docs mislead.
- Remediation: add title.png to the manifest, use manifest dimensions in menuBackdrop, and refresh the doc.

### UI-025 — `text = "FIXME"` at runtime.ts:2652 is faithful, not a leftover
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** The literal is in id's code: `(value != 0) ? "FIXME" : "FIXME"` (`ui/ui_shared.c:3448`), with the `value` read at :3424. Confidence can move from plausible to traced. Source review: SRCQ3
- Severity: Info
- Category: docs
- Location: src/ui/common/legacy/runtime.ts:2652-2657
- Confidence: plausible (no copy of ui_shared.c exists on this machine; based on recollection of id's Item_Bind_Paint)
- Evidence: id's ui_shared.c has `DC->drawText(item->textRect.x, item->textRect.y, item->textscale, newColor, (value != 0) ? "FIXME" : "FIXME", 0, maxChars, item->textStyle);` in the branch for a bind item with no `text`. The TS keeps that: "FIXME" is replaced by bindingText only when `item.definition.text !== undefined`. The file's preserved `this.cvarValue(cvar)` call at :2646 also matches the source's unused `value` read.
- Impact: a bind item without text displays the literal word FIXME, exactly as the original does. Not a port leftover. Only reachable by mod menus, and no comment records that it is deliberate.
- Remediation: add a one-line comment naming the source, so future audits do not re-flag it.
