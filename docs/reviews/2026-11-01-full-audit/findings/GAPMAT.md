# GAPMAT — Round 2 gap read: contracts, materials, render leftovers, text, image encoders
## Coverage
Read in full, line by line:
- src/contracts/** except identity (41 files, 4330 lines). These are mostly type declarations, so I read them for shape and for the runtime functions in content, mods, presentation, source-items, source-match and weapon-behavior.
- materials: material-finish 508, q3-lighting 262, compile 87, source-state 172, color 131, dlight 120, fog 124, sky 159, material-iterator 104, legacy-fog 95, turbulence 42, q2-lighting 58, q2-lightgrid 73, geometry 29, cinematic 5, index 19. evaluate 174 was also read in full, to trace callers.
- render/scene: patch-lod 186, patch lines 225-312, particles/legacy 140, particles/primitives 144, models/shadedots 215.
- render/cpu: fog 102, lines 139, source 84. render/gl: fog-shader 110, shadow-shader 93.
- text: localization 431, q3-font-registry 291, layout 136, draw2d 108, captions 74, media-captions 57, localization-resources 24, mounted 36, ui 25, world 47, kfont 111.
- formats/images: jpeg-encoder 342, png-encoder 45.

Sampled, opened only to trace callers: render/scene/world.ts (222-240, 352-360, 660-740), render/scene/models/{renderer 440-476, light-sampler 100-130}, render/scene/shadows.ts 29-37, render/gl/buffers.ts 150-182, app/bootstrap/q3-client/scene.ts 40-125, app/bootstrap/effects/particles.ts 1-60, app/bootstrap/{sound-captions, ui 128-140, startup 855-880}, network/q3/state-delta.ts 178-192, compat/qvm/{render-record 31-50, client-render-syscalls 112-135}, content/mounts/paths.ts.

Skipped: materials/{material 1559, deform 237, legacy 251, lighting 221} and text/{atlas, q3-font, truetype} are outside this assignment. The shadedots values were read, and the table length was checked (4096), but they were not compared with anorm_dots.h because no copy is on this machine. All comparisons with id, q2repro and Quakespasm source are from memory. No source tree is on this machine, so a parity claim here is weaker than a reproduced behavior.

Experiments are in gapmat/ (repro.ts, bench.ts, bench2.ts, corpus.py, tags.py), run against the clean HEAD checkout. The corpus scan covered 227 shader files and the rerelease localization files under qfiles. Benchmarks used synthetic inputs, not a running game.

## Strengths
- FinishShader, CollapseMultitexture, VertexLightingCollapse, implicit stage layouts, sky projection tables, fog coordinates, R_FogFactor, entity lighting, patch stitching, MakeMeshNormals, rail geometry, sprite stamps and the Q1 and Q2 particle ramps all matched the id code as I remember it, branch by branch, including quirks such as the detail-stage shift.
- The shadow shader's cube basis matches `render/scene/shadows.ts:31-37` face for face, and its depth inversion is algebraically correct for the perspective matrix.
- Q2 height fog is guarded on `falloff > 0` in both live backends (render/cpu/fog.ts:47, render/gl/fog.ts:53,95), and the CPU and GL formulas agree.
- The JPEG encoder is careful. Tables are correct, category calculation is right for 1..4096, and 2000 random binary 16x16 images at quality 100 caused no throw. Theoretical AC amplitude stays under the category 11 limit.
- The dlight mask is safe: every Q3 light list is sliced to 32 before use. Localization argument expansion cannot recurse.
- Hot paths were cheaper than they look under Bun's JIT (see "Candidates checked and dropped").

## Findings
### GAPMAT-001 — A hostile Q3 server can exit the client with one NaN or very large entity coordinate
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `RE_AddRefEntityToScene` checks only reType and count (`renderer/tr_scene.c:207-223`), and a search of `renderer/*.c` for `isnan` or `IS_NAN` found none. Rail length converts to int with no exit (`renderer/tr_surface.c:469-473`). "The original had no such exit" holds. The ioquake3 NaN drop is unverifiable here. Source review: SRCQ3
- Severity: High
- Category: robustness
- Location: src/network/q3/state-delta.ts:185-186; src/compat/qvm/render-record.ts:31-44; src/compat/qvm/client-render-syscalls.ts:116-126; src/render/scene/models/light-sampler.ts:112; src/materials/q3-lighting.ts:177; src/render/scene/particles/primitives.ts:27,53,59; src/app/bootstrap/q3-client/scene.ts:107; src/materials/fog.ts:28,74; src/render/gl/buffers.ts:181-182
- Confidence: reproduced (each renderer throw); traced (wire decode to refEntity admission, through port code); plausible (the stock cgame passing the value along, which is from memory of cg_ents.c and cg_weapons.c; not driven end to end)
- Evidence: The delta decoder stores any 32-bit pattern: `const bits = reader.readBits(32); value = bitsToFloat32(bits);`. Neither `readQvmRefEntity` nor the add-entity trap checks it. Then:
  - `setupEntityLighting` calls `lightForPoint`, which has `if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError("Light sample origin must be finite");`. A NaN or Infinity origin reproduced that throw.
  - `railGeometry`: `if (!Number.isInteger(length) || length < -0x80000000 || length > 0x7fffffff) throw new RangeError("rail length exceeds source int32 conversion")`. Reproduced with a finite endpoint at x=3e9 and with NaN. RT_LIGHTNING at 1e10 throws the same way.
  - `if (segments > 1_000_000) throw new RangeError("rail ring geometry exceeds safe allocation")`. Reproduced at a length of 3.3e7 with default settings.
  - `fogFactor(NaN, 0.5)` throws `fog index NaN outside 256`, and non-finite attributes throw at gl/buffers.ts:182.
  q3-client.ts:495 rethrows frame errors, and APP-001 establishes that this ends the process. A 1e30 origin does not throw in the lighting path, so that specific path needs a non-finite value; the rail paths accept finite ones.
- Impact: A malicious server sets an entity's `pos.trBase` or an EV_RAILTRAIL `origin2` to NaN or 3e9. Any client with that entity in its snapshot exits on the next rendered frame. The original had no such exit. ioquake3, as I remember it, drops NaN refEntities with a warning. GAPNET-004 and GAPNET-007 cover the unified protocol; this is the native Q3 path.
- Remediation: At refEntity and poly admission, drop any record with a non-finite vector and print once. Replace the rail throws with clamping or a skipped draw.

### GAPMAT-002 — One malformed subtitle sidecar can end the client when a sound plays
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran: parseSubtitleText throws on all three cited inputs. sound-captions.ts:37-39 awaits prepare with no catch; ui.ts:135 and presentation.ts:359 await it; application.ts:4431 has no inner catch. The outer step catch near :4685 rethrows unless fatalWorldFailure, and run() does not catch. This closes the trace the finding left open, except main.ts:82 handling, which APP-001 covers.
- Severity: Medium
- Category: robustness
- Location: src/text/captions.ts:46,50,52,65; src/text/media-captions.ts:36; src/app/bootstrap/sound-captions.ts:37-39; src/app/bootstrap/ui.ts:135; src/app/bootstrap/presentation.ts:359
- Confidence: reproduced (parser throws); traced (await chain to the frame prepare)
- Evidence: `parseSubtitleText` throws for the whole file on one bad cue. Reproduced: a cue with end before start gives `RangeError: Invalid caption cue interval`; `00:00:01,00 --> 00:00:02,00` gives `Invalid subtitle timestamp`; a WebVTT `NOTE a --> b` block gives `Invalid subtitle cue timing`. `SeatSoundCaptions.prepare` runs `await captions.prepare(reference.requestedPath, language)` with no catch, and `ui.prepare` and `presentation.ts:359` await it. `subtitlePaths` looks for `sound/x.srt` and `.vtt` beside every played sound. The live-language path does catch (media-captions.ts:47), and startup.ts handles the frontend movie path, so the sound path is the fatal one found. application.ts:3648 was not traced to its outer handler.
- Impact: A sidecar in a mod or other mounted package, or a small authoring slip such as two-digit milliseconds, ends the client the first time that sound plays. It is an optional accessibility file.
- Remediation: Skip invalid cues with a printed warning, and catch at `SeatSoundCaptions.prepare` so a failed sidecar means no captions.

### GAPMAT-003 — A negative `skyparms` cloud height produces NaN coordinates that crash the GL path
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran cloudTexCoord over 5 faces x 81 points: 0 NaN at +64, 52 at -64, 196 at -512. material.ts skyDirective accepts negative heights (only 0 is replaced, by 512). sky.ts:153 copies the coordinates, world.ts:728 draws them, gl/buffers.ts:181-182 throws on the poisoned maximum. The GL throw itself was traced, not run.
- Severity: Medium
- Category: robustness
- Location: src/materials/sky.ts:99-102; src/materials/sky.ts:153; src/render/scene/world.ts (skyOperations, `evaluateMaterialPasses(shader, built.clouds, ...)`); src/render/gl/buffers.ts:181-182
- Confidence: reproduced (NaN coordinates); traced (reaching the GL throw)
- Evidence: The code acknowledges the condition: `// Q_acos does not clamp its input; negative cloud heights can leave NaN coordinates.`. `cloudTexCoord` over the 405 grid points of the 5 drawn faces gave 52 NaN coordinates at height -64, 196 at -512, 404 at -4096, and none at +64. The NaN stays in the cloud vertices, `worst = Math.max(worst, Math.abs(texCoord.x), ...)` becomes NaN, and `if (!(worst < 3.4028235677973366e38)) throw new RangeError("OpenGL attributes must be finite float32 values")` fires. In the C renderer a NaN texture coordinate is only a visual glitch.
- Impact: One shader with a negative cloud height in any mounted package ends the client when that part of the sky is visible. No shader in the scanned corpus does this, so the reach is mods and hostile content. This is a new trigger for the class in RENDER-005, not listed there.
- Remediation: Reject a negative height at parse, or sanitize non-finite cloud coordinates to 0 in `initializeCloudCoordinates`.

### GAPMAT-004 — Renderer profile options and cvars are never wired, so their code cannot run in production
- **Verification (VERIFY-I): confirmed. Final severity: Low.** A case-insensitive grep finds none of the four cvars. All production compiles use DEFAULT_SHADER_PROFILE (assets.ts:137, q3-client/cinematics.ts:114), scene.ts:107 uses DEFAULT_RAIL_SETTINGS, and nothing sets curveError (world.ts:102, :679).
- Severity: Low
- Category: dead-code
- Location: src/materials/compile.ts:9-12; src/app/bootstrap/assets.ts:137; src/app/bootstrap/q3-client/cinematics.ts:114; src/render/scene/shaders.ts:68; src/materials/material-finish.ts:208-260,312-319,334-338; src/materials/material-iterator.ts:81; src/render/scene/particles/primitives.ts:14-19; src/app/bootstrap/q3-client/scene.ts:107; src/render/scene/world.ts:679
- Confidence: traced
- Evidence: Every production compile uses the constant `DEFAULT_SHADER_PROFILE` (`detailTextures: true, vertexLight: false, ... hardware: "generic"`). A grep of src finds no `r_vertexLight`, `r_detailTextures`, `r_railWidth` or `r_lodCurveError`. So `vertexLightingCollapse` (53 lines), the detail-stage shift and the `voodoo` and `permedia2` branches never execute outside tests. Rail settings are always `DEFAULT_RAIL_SETTINGS`, and no production `WorldViewInput` was found setting `curveError` (`input.curveError ?? 250`).
- Impact: Users who set these standard Q3 cvars get no effect and no message. The configurable paths look live, but the game never exercises them.
- Remediation: Wire the cvars into the profile, or delete the branches and document the fixed behavior.

### GAPMAT-005 — Duplicate fog and sort logic and other helpers have no production caller
- **Verification (VERIFY-I): confirmed. Final severity: Low.** fog.ts fogAdjustment, shaderSort and shaderFogPass have no importer; the same-named material-finish.ts:177 is a separate local. finishImplicitShader, finishFailedShader, seatTextScale and spriteFog are unreferenced outside their files. legacy-fog.ts:80 lacks the falloff test that render/cpu/fog.ts:47 has.
- Severity: Low
- Category: dead-code
- Location: src/materials/fog.ts:88-95,106-119; src/materials/material-finish.ts:177-184,299-332,496-508; src/materials/legacy-fog.ts:78-90; src/render/scene/particles/primitives.ts:110-114; src/content/q3/presentation/scene.ts:45-48; src/formats/images/jpeg-encoder.ts:9-11,122,126,303-305; src/text/layout.ts:116-127
- Confidence: traced (token scan of src and tests, confirmed by import grep)
- Evidence:
  - `fog.ts` `fogAdjustment`, `shaderSort` and `shaderFogPass` have no importer in src or tests. They re-implement what `finishShader` computes from state bits, in a second form that can drift.
  - `q2FogColor` is used by tests only, and unlike the live backends it checks only `fog.height.density > 0`. With falloff 0, `heightFogExtinction` divides 0 by 0, so the tested helper does not describe live behavior.
  - `spriteFog` duplicates `q3ProceduralFog` and has no caller.
  - `finishImplicitShader`, `finishFailedShader` and `seatTextScale` have no importer.
  - The JPEG `source-destination` profile has no production caller; `capture/index.ts:23` always uses the default.
- Impact: About 100 lines of maintenance cost, plus tests that cover functions the game does not call.
- Remediation: Delete them, or make the live path call the single remaining implementation.

### GAPMAT-006 — Localization parser rejects `{{` and mishandles unquoted escapes, and production never logs the failure
- **Verification (VERIFY-I): confirmed. Final severity: Low.** Reproduced with LocalizationTable.merge: the three `{{` strings fail with "EOF before end of argument found", and `plain\nword` unquoted decodes as `plain\word`. localization-resources.ts:12 and :14 pass no options, so the warning never fires in production.
- Severity: Low
- Category: bug
- Location: src/text/localization.ts:57-62,91-98,112-124,203-208,264-266; src/text/localization-resources.ts:12,14
- Confidence: reproduced; plausible on whether the `{{` behavior is inherited from the donor
- Evidence: `if (at(argRover) && at(argRover) === "{") { continue; }` does not advance, so the second brace starts an argument. Reproduced: `"x {{y}} z"`, `"lit {{ open"` and `"{0} and {{1}}"` each fail with `EOF before end of argument found` and the entry is dropped, while `Loc_HasArguments` treats `{{` as an escape. Nothing unescapes `{{` on output. For unquoted values, `parseEscapeSequence` reads the backslash itself because the index has not moved: `plain\nword` becomes `plain\word`. `loadResources` calls `catalog.merge(base)` with no options, so `opts.log?.warn` never fires. Any key or `=` error also stops the rest of the file silently (lines 242-261).
- Impact: Stock files are unaffected: all rerelease localization files scanned contain no `{{` and no unquoted values. A mod string with an escaped brace shows its raw key, with no diagnostic.
- Remediation: Advance past the second brace, unescape on output, fix the unquoted index, and pass a logger from `loadResources`.

### GAPMAT-007 — PNG CRC uses a bit-at-a-time loop that takes most of the encode
- **Verification (VERIFY-I): confirmed. Final severity: Low.** png-encoder.ts:4-11 is bitwise CRC and zlib.crc32 is available in this Bun. Measured encodePng at 599 ms for a random 1080p frame (8.3 MB output) and 44 ms for a poorly mixed one (447 KB), so the hitch scales with compressed size and the finding's 0.4 s is a high-entropy figure.
- Severity: Low
- Category: performance
- Location: src/formats/images/png-encoder.ts:4-11,19; src/capture/index.ts:22
- Confidence: reproduced
- Evidence: `for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ...` runs per byte. For a synthetic 1920x1080 frame with a 6.2 MB IDAT, `encodePng` took 420 ms, of which the CRC took 242 ms. `zlib.crc32` on the same bytes took 0.2 ms under this Bun. `encodeScreenshot` is synchronous, so the cost lands on whichever thread calls it.
- Impact: A hitch of about 0.4 s per 1080p PNG screenshot, and worse for avidemo capture in PNG. JPEG at quality 90 took 151 ms on the same frame.
- Remediation: Use `zlib.crc32` or `Bun.hash.crc32`.

### GAPMAT-008 — CPU Q1 depth fog allocates several objects per pixel on one thread
- **Verification (VERIFY-I): confirmed. Final severity: Low.** render/cpu/fog.ts:26-37 allocates color, result and the mix object (legacy-fog.ts:11-13, :93-95) per pixel, reached from rasterizer.ts:463. The 57 ms figure was not re-measured.
- Severity: Low
- Category: performance
- Location: src/render/cpu/fog.ts:26-37; src/materials/legacy-fog.ts:11-13,93-95; src/render/cpu/rasterizer.ts:463
- Confidence: reproduced (cost on a synthetic frame)
- Evidence: Each pixel builds `const color = { x: red / 255, ... }`, a `result` from `q1FogColor`, and a `mix` object. A full 1920x1080 pass took 57 ms per frame. The same arithmetic without allocation took 34 ms in my comparison. The remaining cost is the per-pixel exp and depth inversion, on the main thread. `applyQ2DepthFog` in the same file already avoids per-pixel objects.
- Impact: On the software renderer, a fogged Q1 map spends about 57 ms at 1080p in this pass alone, which caps it under 18 fps. The GL backend is unaffected.
- Remediation: Inline the blend, cache the fog amount for repeated depth values, and run it per worker row if the row-parallel path can own it.

## Supplements
- Supplements RENDER-005: the same render-time throw also exists at materials/color.ts:27-28 (`byte`) and color.ts:106-107 (`animatedPictureIndex`). Reproduced: `animatedPictureIndex(2.5e5, 10, 4)` throws, so an `animMap` at 10 Hz throws after about 58 hours of shader time on one level, and sooner at higher frequency. `alphaGen portal` with range 0 at zero distance gives NaN, which throws in `byte` (traced).
- Supplements CORE-018: beyond its 11 names, a token scan finds 64 contract exports in total with no importer outside their own file. Examples are `Q1Snapshot`, `QwSnapshot`, `Q2Snapshot`, `Q2RereleaseSnapshot`, `GuestCallbackBinding`, `NativeGuestCheckpoint`, `MovementInputContinuation`, `Q3BspFog` and `SeatActorBinding`. Some are used inside their own file as parts of other types, so this is an upper bound on dead surface. contracts/index.ts re-exports 14 of 41 modules, and 7 contract files contain runtime functions (content, identity, mods, presentation, source-items, source-match, weapon-behavior).
- Supplements GAPCORE-005: `ParseKfont` discards its failure reason (text/kfont.ts:21-24, `void reason; return null;`), and the kfont exports it listed remain without a production importer.

## Candidates checked and dropped
- Case-sensitive `includes("fog")`, `"nodraw"` and `"nodlight"`: material.ts:1350 lowercases surfaceparms before storing them.
- Fog color missing `tr.identityLight` in `prepareFogVolume`: `input.identityLight ?? 1` is never set to anything else in the callers I found, so the factor is 1.
- Platform-tagged localization entries dropped because no platform is passed: all tags are console platforms, and every tagged key also has an untagged entry (Q1 14, Q2 18, tag-only 0).
- Inactive stage in the middle of a shader: the port draws later stages, where GeneratePermanentShader stops at the first inactive stage as I remember it. The corpus has 0 stages without a map, so it has no observed effect and I did not report it.
- Per-vertex context spread in `evaluateStageColor`: 0.091 us versus 0.063 us with a shared context. Full `prepareMaterialBatches` on a collapsed lightmap material costs 0.224 us per vertex. That is noticeable at high vertex counts but not a clear defect, and I did not measure real visible vertex counts.
- `selectPatchLod` per-frame allocation: under 5 us per patch in the synthetic grid.
- `SourceParticles.sample` with `q2.unshift`: 1.86 ms for 4096 + 4096 particles. `prepareParticleGeometry` for 4096: 1.49 ms. `splitDlightMask` with 8 lights: 115 ns per call.
- Q2 lightgrid node cycle hang: not pursued. `lookupQ2Lightgrid` relies on the decoder's validation stated in its comment, and I did not open formats/q2-map/bspx.ts, so this remains unverified rather than cleared.
- `registerFont` with an empty path throwing from `normalizeResourcePath`: FS_ReadFile on an empty name is also fatal in the original, as I remember it.
- `WorldTextStore` frame-lifetime entries growing with no reader: submitters are per-player debug draws, so I found no realistic trigger without clients.
- CPU `heightFogFraction` returning 0 for equal start and end where GLSL divides by zero: a backend difference in a degenerate case, with no visible case found.
