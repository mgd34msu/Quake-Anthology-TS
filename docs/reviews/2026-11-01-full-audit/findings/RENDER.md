# RENDER — src/render/**, src/materials/**, src/text/** (renderers, scene submission, shader parser, fonts)
## Coverage
Read in full (about 12,700 of 22,224 lines): render/gl/{renderer 637, buffers 184, textures 179, programs 356, object-opacity 186, depth-atlas 185}; render/scene/{world 841, submissions 310, visibility 271, textures 310, shaders 413, material-registrations 294, resources 130, shadows 334}; render/scene/models/renderer 561; render/cpu/{rasterizer 1409, row-parallel 342, row-worker 174, textures 167, lighting 187}; render/{worker 245, worker-runtime 184, worker-transport 428, worker-protocol 338, execution 85, image-journal 64}; render/commands/{dynamic-texture 24, frame 71}; materials/{material 1559, legacy 251, lighting 221}; text/{truetype 1572, atlas 187}.
Sampled: render/scene/models/prepare (lines 70-294, 355-449 of 537); materials/deform (1-120 of 237); materials/evaluate (1-90 of 174); text/q3-font (1-140 of 436); render/cpu/triangle-kernel (123-175 plus grep of 826); render/gl/fog (1-40, 100-142 of 142); render/gl/output-gamma (grep of lifetime calls, 198); text/kfont (40-90 of 111); text/captions (15-60 of 74); render/scene/view (cameraFrustum only, 121).
Skipped (about 8,800 lines, cache/Map grep only at most): materials/{material-finish 508, q3-lighting 262, color, dlight, fog, sky, compile, source-state, material-iterator and small files}; render/scene/{patch 312, patch-lod 186, particles/** 600+, models/shadedots, light-sampler, lighting, transform}; render/cpu/{fog, lines, source}; render/gl/{fog-shader, shadow-shader}; text/{localization 431, q3-font-registry 291, layout, draw2d, and small files}.
Outside scope, opened only to trace: app/bootstrap/{assets, renderer, presentation, presentation-scene, application (selected ranges)}, main.ts, formats/q1-map/{records, queries}, formats/q12-model/animation.
GPU behavior was not run; GL conclusions are traced. Reproductions live in the scratchpad at render-audit/ and ran against the clean checkout.

## Strengths
- GL object lifetime across renderer restart is clean. Every Gen in textures, depth-atlas, object-opacity, fog and output-gamma has a matching Delete in `close()` and in constructor error paths; `GlRenderer.close` tears down in a correct order. There are no VBOs or VAOs (client arrays by design), so that class of leak cannot occur.
- Map-change lifetime is sound: `ApplicationAssets` is per-world (new instance at application.ts:2766/2780/2944), its image registry is a fork of the renderer root, and `close()` releases every image through the shared queue, which the root drains. Texture, shader and registration caches die with it, so the per-map Maps (`admitted`, `sourceRecords`, `loaded`) do not span maps.
- B2 is fixed: world.ts:545-562 defers legacy translucent groups past supplied operations, with a test (tests/render/commands/world-translucent-order.test.ts). See RENDER-006 for a separate ordering defect inside that deferred list.
- No stale-key correctness defect was found in PERF2 or PERF3. `retainedMerge` keys on every constituent vertices/indices/lighting array and re-checks `mergeable` against the retained template; PERF3 marks are invalidated by PVS identity, cluster and area contents. Their defects are growth (RENDER-003) and non-activation (RENDER-007).
- CPU rasterizer bounds are solid: bounding boxes clamp to framebuffer and viewport (rasterizer.ts:1319-1322), texel fetches wrap or clamp, indices and attributes are validated before draw.
- Texture decode is defensive (undecodable candidates are skipped, textures.ts:268). The shader parser's own structure limits (8 stages, 4 tcMods, 3 deforms, 8 animation frames) match the source. `parseFont` directory parsing is bounds-checked through `BinaryReader`, `DataView` and the `at()` helper; TrueType `hmtx` and `loca` lengths are validated.
- Worker transport handles fault delivery, reentrancy and retirement carefully and clears its timers.

## Findings
### RENDER-001 — Q1 MDL pose cache grows to gigabytes within one map (512 geometries per frame pair)
- **Verification (VERIFY-P): confirmed-with-changes. Final severity: Medium.** RETIME-007 confirmed the growth rate at about 740 MB per minute, up to about 1.7 GB, but with random backLerp that was not observed in a live client. VERIFY-B measured real play: 47 keys in 3,600 Q1 frames, with growth only for a Q1 character on a Q2-clock map at about 17 MB/s. Real-play evidence decides, so severity stays Medium, and the peak on that path is higher than VERIFY-B's 150 MB-per-pair estimate suggested.
- Severity: High
- Category: leak
- Location: src/render/scene/models/prepare.ts:362-373, prepare.ts:101, src/formats/q12-model/animation.ts:22,42-46, src/app/bootstrap/simulation/runtime.ts:7360-7365
- Confidence: reproduced
- Evidence: `byLerp = byPrevious.get(previous) ... if (byLerp.size >= 512) byLerp.clear(); byLerp.set(lerpKey(backLerp), geometry);`. The cap is per (current frame, previous frame) pair, in a module-level `persistentPoseCaches`, and the key is the raw float `backLerp`, which is a continuous fraction (`backLerp: 1 - fraction`). `aliasInterpolationCache` keeps another 256 poses per pair. The hit rate for interpolating entities is close to zero, so the caches only accumulate. Removal happens only at the per-pair cap or when the frame objects die at map change. Reproduction (render-audit/mdl-growth.ts): one synthetic 300-vertex/500-triangle MDL, 30 frames at 10 Hz, one entity, random backLerp, driven through the real `prepareSceneEntity`: RSS 63 MB at start, 622 MB after 1,500 prepares, 2,003 MB after 6,000, 3,623 MB after 15,000 (about 4 minutes at 60 fps), still rising after explicit GC. MD2, MD3 and MD4 are capped per model or surface (prepare.ts:146,413,433), so they are bounded but still hold 512 full poses each.
- Impact: Q1 play with animated monsters climbs by hundreds of MB per minute per model type, up to frame pairs x 512 x geometry size. On this machine (about 6 GB free) that ends in OOM inside a single map, and GC pressure degrades frame time before that.
- Remediation: Do not cache by raw `backLerp`; quantize it or keep a small global LRU per model. Apply the cap per model, not per frame pair, and do the same in `aliasInterpolationCache`.

### RENDER-002 — CPU row-parallel workers retain a full texture copy per dispatched batch, forever
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: High.** Reproduced in real sessions. textures.ts:162 returns a fresh object and row-parallel.ts:257-262 misses every time. e1m1 at 640x480, static camera: 18 dispatches/frame, RSS 553 to 2,041 MB in 300 frames. q3dm1 passed my 3.5 GB stop within 80 frames. Added gate: rasterizer.ts:1180 needs 4+ triangles and 50,000+ pixels, which fits the flat 320x240 soak in soak-q1-client.log. Software renderer is a menu choice (startup-selection.ts:715).
- Severity: High
- Category: leak
- Location: src/render/cpu/textures.ts:162, src/render/cpu/row-parallel.ts:253-263,265-272,190, src/render/cpu/row-worker.ts:104-106,143,147, src/render/cpu/lighting.ts:41-44, src/render/cpu/rasterizer.ts:629,693,718
- Confidence: reproduced
- Evidence: `CpuImages.bound()` returns a new object literal on every call (`return { kind: "image", internalFormat: "rgba8", ...`). `textureId` keys `#textureIds` by that object identity, so every dispatch misses, allocates a new id and pushes `serializeTexture(texture)` with the non-shared `level.pixels`. Each worker then does `textures.set(int(entry["id"]), decodeTexture(entry["texture"]))`, and there is no delete anywhere in row-worker.ts. Lighting is the same: `lightingId` keys by object identity and worker `lightings` never shrinks. `cullTriangleLights` creates a fresh `parameters` per triangle when any light is culled, and `serializeLighting` spreads `worldPositions`/`normals` into each message, so a fragment-lit Q2 batch can clone O(V) arrays per triangle. The depth-atlas target's second pool leaks one `{ kind: "vertex" }` lighting per draw (rasterizer.ts:718). Reproduction (render-audit/row-leak.ts, 640x480, QTS_CPU_WORKERS=2, one 256x256 texture, same batch): RSS 58 MB, then 177, 208, 257, 307, 358, 408 MB at 100..600 draws, about 0.5 MB per draw (texture x 2 workers), with no plateau after GC.
- Impact: The CPU renderer with its default pool (`availableParallelism() - 1`, max 4) grows by texture size x workers x qualifying batches per frame until OOM. Each dispatch also structured-clones the full mip chain to every worker, which defeats much of the parallel gain. Only pool close (resize, restart) frees it.
- Remediation: Key registrations on stable texture storage (per `TextureObject`/level identity with an update generation), and add unregister messages for released images. Send lighting as a per-batch record without geometry arrays, keyed per job and reset per job.

### RENDER-003 — PERF2 merge trie retains one merged and packed copy per distinct visible surface set
- **Verification (VERIFY-B): refuted. Final severity: Low.** Real visibility does not produce the growth. Lit surfaces emit diffuse then a per-face lightmap (legacy.ts:152, 175-180; world.ts:297), so adjacent batches fail `sameTexture` (submissions.ts:143-145) and runs rarely form. Camera tour, 60 Hz, forced `worldSpaceBatches`, real `pack`, no GL context: heap flat at e1m1 283-286 MB, base1 384-388 MB (12,000 frames each), q3dm1 418-429 MB (6,000). Unlit maps may still merge; not measured, hence Low.
- Severity: High
- Category: leak
- Location: src/render/scene/submissions.ts:233,255-264,278-279, src/render/gl/buffers.ts:83-96, src/render/scene/world.ts:525-535,638-639
- Confidence: reproduced
- Evidence: `let node = mergeRoots.get(root.vertices) ?? { next: new WeakMap() }` walks a trie by constituent `vertices`, then `node.entry = { template, signature: run.map(mergeSignature), merged }`. Every distinct run, which means every PVS plus per-surface frustum subset of a material's surfaces, adds a node holding a full merged vertex and index array. Because those merged arrays are now stable, `GeometryBuffer.pack` promotes them on the second sighting and adds 48+ bytes per vertex of Float32Array copies. The surface arrays stay alive through `legacyBatchCache`, so nothing is collectable until the world closes. There is no bound. Reproduction (render-audit/merge-growth.ts, real `mergeDrawOperations` + `GeometryBuffer.pack`, 200 surfaces of 8 vertices with one material, random visible subsets seen 3 times each): RSS 42 MB, then 110, 165, 213, 257, 299, 342 MB at 500..3000 distinct subsets, about 0.1 MB per subset, for one material of only 1,600 vertices. This regression was introduced by commit 7870041d; before it, merged arrays were per-frame garbage.
- Impact: GL Q1/Q2 world rendering (`worldSpaceBatches`) grows continuously as the player moves and looks around, because the frustum test at world.ts:529 varies subsets with view angle. Real maps have tens of materials and larger runs, so growth is proportionally larger and lasts until map change. PERF2's benefit applies only to repeated identical subsets.
- Remediation: Bound the retained merges (per-root LRU or a global byte budget), or retain only when a run repeats N consecutive frames and evict on miss.

### RENDER-004 — `r_smp 1` with GL drops world-space transforms across the worker wire
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Re-ran wire.ts: `batch.space` undefined and no viewProjection (worker-protocol.ts:170-171). presentation.ts:427 does not check for a worker. The visual result is traced only because no GL context is available. `r_smp` defaults to 0 (image-settings.ts:90), so this is opt-in.
- Severity: High
- Category: bug
- Location: src/render/worker-protocol.ts:170-171,271-280,328-333, src/app/bootstrap/presentation.ts:427, src/render/scene/models/renderer.ts:495-508, src/render/gl/renderer.ts:331
- Confidence: reproduced (wire loss); traced (visual result)
- Evidence: Encoder view: `view: { viewport, clear, clipPlane, beforeView, operations }`, with no `viewProjection`. Decoder `batch()` builds `common` without `space`. Output of render-audit/wire.ts: `batch.space after wire: undefined`, `view keys on wire: [viewport, clear, clipPlane, beforeView, operations]`, `decoded viewProjection: undefined`. Meanwhile presentation.ts:427 sets `worldSpaceBatches: this.native.window.backend === "gl" && process.env["QTS_WORLD_SPACE"] !== "0"` without checking for a worker. On the worker the batch takes `identityMatrices()` (`if (batch.space === "world") this.worldMatrices(); else this.identityMatrices();`), so world coordinates with w=1 are treated as clip coordinates and nearly all of them clip away. tests/render/worker-protocol.test.ts and worker-native.test.ts contain no reference to `space` or `viewProjection`.
- Impact: The documented cvar `r_smp 1` (`vid_restart`) on GL renders the Q1/Q2 static world and legacy models incorrectly (missing or garbled). `r_smp` defaults to 0, so this is limited to users who opt in.
- Remediation: Carry `space` and `viewProjection` through `WireEncoder`/`WireDecoder` and add a round-trip test.

### RENDER-005 — Malformed or large shader numbers throw at render time and end the process; a legitimate shader can reach it with long level time
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: High.** Throw re-run (material.ts:1447-1451). The finding's trigger was weak: frequency 100 is absent from retail, whose maximum is 10, and no corpus stretch shader reaches exact zero. Better trigger: time is Q3 server time (q3-client.ts:548; client-state.ts:51), carried across maps (application.ts:2756-2758). Retail `rgbGen wave sin .9 .1 0 10` throws at 2.43 days uptime, measured at material level; 120 of 426 baseq3 waves throw by 7 days. Client-to-server path traced, not run.
- Severity: High
- Category: robustness
- Location: src/materials/material.ts:734-736,1447-1451,1455,1520,1530, src/render/gl/buffers.ts:181-182, src/render/cpu/rasterizer.ts:600-602, src/app/bootstrap/application.ts:4437, src/main.ts:89-93
- Confidence: reproduced (material layer); traced (process exit)
- Evidence: Parsing accepts any magnitude: `sourceAtof` is `Math.fround(nativeAtof(value))`, which produces Infinity for 1e39. Only `alphaGen const` is validated at parse time (material.ts:851). At render time `shaderTableIndex` throws: `throw new RangeError("Shader table index reaches undefined source float-to-int conversion")`. Reproduced (render-audit/shader.ts): `rgbGen wave sin 1 1 0 1e30` throws. `tcMod scale 1e39 1e39` and `tcMod stretch sin 0 1 0 1` (1/0 at the waveform zero) yield `{x: NaN, y: NaN}`, which GL `pack` rejects (`throw new RangeError("OpenGL attributes must be finite float32 values")`) and CPU rejects at rasterizer.ts:601. A normal-looking `rgbGen wave sin 0.5 0.5 0 100` throws once time reaches about 5.8 hours (ok at 3,600 s, RangeError at 21,600 s); `tcMod rotate 3600` throws by 7 days. The source C code wraps or tolerates these values. `presentation.local.player.seat.present(...)` at application.ts:4437 has no local catch; main.ts:89 writes a crash log and returns 1. I did not exhaustively rule out a catch further up that loop, and I did not verify how often frame time resets.
- Impact: A single bad shader in any mounted pk3 or mod crashes the client on first sight of the surface, not at load. Long sessions on one level can hit the same throw with a legitimate high-frequency shader.
- Remediation: Replace the render-time throw with C-equivalent wrapping (wrap a clamped or double-precision phase modulo the table). Clamp or sanitize non-finite shader outputs per stage, or reject the stage at parse time so the shader falls back to default.

### RENDER-006 — Legacy translucent world surfaces draw front to back, so far glass or water overdraws near glass
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran render-audit/order.test.ts: visible order [0, 1], draw positions [32, 128], depthWrite false, src-alpha. world.ts:522 is a stable class-only sort, visibility.ts:249-250 pops front first, and prepareView's deferred list (world.ts ~550-562) keeps insertion order with no reversal.
- Severity: Medium
- Category: bug
- Location: src/render/scene/world.ts:516-522, src/render/scene/visibility.ts:249-250, src/materials/legacy.ts:127-128
- Confidence: reproduced
- Evidence: Traversal pushes back then front so it pops front first (`stackChild.push(encode(node.children[front === 0 ? 1 : 0]), encode(node.children[front]))`). `surfaces.sort((a, b) => order(a) - order(b))` is a stable sort by class only, and translucent batches have `depthWrite: !blended` = false. Q2's `R_DrawAlphaSurfaces` relies on prepending to `r_alpha_surfaces` to get back-to-front order from a front-to-back walk; this port does not reverse. Reproduction (render-audit/order.test.ts, real `WorldScene.prepareView`, panes at x=32 and x=128 viewed from x=0): visible order `[0, 1]`, merged draw positions `[32, 128]`, depthWrite false, src-alpha: the near pane draws first.
- Impact: Overlapping TRANS33/TRANS66 surfaces and alpha water blend in the wrong order (a window in front of water shows water composited on top). B2's fix defers these surfaces correctly but does not address order within them.
- Remediation: Iterate the translucent class in reverse visitation order (for example, sort key descending by visit index for phase 9).

### RENDER-007 — PERF3 ancestor marks are disabled on real Q1 maps by the shared solid leaf
- **Verification (VERIFY-P): confirmed-with-changes. Final severity: Low.** RETIME-008 and VERIFY-F confirm the trigger on real Q1 maps (e1m1 has 1,278 children on leaf 0), but the cost is at most about 0.1 ms per query.
- Severity: Medium
- Category: performance
- Location: src/render/scene/visibility.ts:106,118, src/formats/q1-map/records.ts:72, src/render/scene/visibility.ts:201
- Confidence: reproduced (fixture); traced (retail layout claim, from the original qbsp behavior of writing child -1 for every solid child)
- Evidence: `if (child.index < 0 || child.index >= map.leaves.length || seenLeaves[child.index] === 1) { unsafe = true; break; }`. Q1 children decode `-1 - value`, so all solid children are leaf 0. queries.ts:25 itself says "The shared solid leaf zero". With `unsafe` true, `marks` stays null. Reproduction (render-audit/perf3.ts, depth-14 Q1 fixture, empty PVS): 14 node reads per query with no shared leaf; 16,397 node reads when only two children share leaf 0. Test coverage for PERF3 uses Q3 fixtures only.
- Impact: The PERF3 optimization does not apply to the Q1 family, which keeps full frustum traversal cost. There is no correctness impact.
- Remediation: Do not treat sharing of a leaf as unsafe when that leaf can never be visible (Q1 leaf 0, or any leaf where `leafVisible` is false); shared visible leaves can mark all parents.

### RENDER-008 — Any Q1 dynamic light rebuilds and re-uploads every visible lightmap each frame
- **Verification (VERIFY-P): confirmed-with-changes. Final severity: Medium.** RETIME-009 measured 0.6-2.4 ms for typical real views rather than 16-25 ms, with only extreme views reaching a full frame. GL upload cost remains unmeasured, so severity stays Medium.
- Severity: High
- Category: performance
- Location: src/render/scene/world.ts:297,601-607, src/materials/lighting.ts:107-127,208-221, src/render/gl/textures.ts:24-41,163-169, src/render/image-journal.ts:47-49
- Confidence: reproduced (frontend cost); traced (GL cost)
- Evidence: `const reusable = lights.length === 0; if (!reusable || ...) { const built = buildQ1Lightmap(...); images.update(lightmap.image, 0, built.image); images.update(lightmap.direct, 0, directLightmapPixels(built));`. No light-to-face relevance test precedes this, unlike the source's `dlightframe` marking; the plane/radius rejection sits inside `addDynamicLights`, after allocation. Each face uses two separate GL textures (world.ts:297, `*-lightmap-${index}` and `*-direct-lightmap-${index}`), so each update costs `glTexSubImage2D`, about 20 `glGet`/`glPixelStorei` FFI calls in `withPixelStore`, a `glGetError`, and a journal `pixels.slice()`. In `buildQ1Lightmap` every pixel allocates a closure and an array literal (`pixels.set([brightness(0), ...])`). Measured (render-audit/dlight.ts): 1,000 visible 8x8 faces with one out-of-range dlight, build + direct + journal only: 16-25 ms/frame, before any GL work. Under `r_smp 1` each image operation adds a synchronous `image-applied` round trip (worker-runtime.ts:82).
- Impact: Muzzle flash, rockets and powerups in Q1 (and Q2 without fragment lighting) cost a full frame budget on the frontend alone, producing visible hitches on the transients where frame rate matters most.
- Remediation: Compute per-face light relevance first and rebuild only affected faces. Restore cached style results when a dlight leaves. Longer term, atlas lightmaps with one sub-image upload per page and retain packed byte buffers without per-pixel allocation.

### RENDER-009 — Hostile fonts cause exponential CPU and unbounded allocation
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran render-audit/font-bomb.ts: 6 self-referencing components 324 ms (~6^9 calls), metric bomb 16000x16000 and 256,000,000 bytes. truetype.ts:272-273 limits depth only and the cache applies only at depth 0 (:1182-1205). atlas.ts:84-86 passes the parsed font to buildFontAtlas with no cap. CFF path traced only.
- Severity: Medium
- Category: security
- Location: src/text/truetype.ts:272-273,1182-1205 (composite), 925-934 (CFF subrs), 544-549 (FDArray), 1316,1367-1375 (raster size), 1507-1529 (atlas), src/text/atlas.ts:84-86
- Confidence: reproduced (composite, raster size); traced (CFF)
- Evidence: Composite depth is limited (`if (depth < 8) { const sub = resolve(glyphIndex, depth + 1);`) but breadth is not, and `getRaw` caches only at depth 0, so a glyph whose components reference itself costs components^9. Reproduction (render-audit/font-bomb.ts): 46-byte glyph with 6 self-referencing components takes 199 ms (10^7 resolves); 5 components 62 ms; 20 components would be about 5x10^11 resolves. CFF has the same pattern (`depth > 10` limit, no call budget, and unbounded `stack.push`). FDArray with 65,535 entries each parses a local-subr INDEX (traced amplification). Raster dimensions come straight from metrics: `Math.round(font.advanceWidth(gid) * scale)` and `(font.ascent - bottom) * scale` feed `new Float32Array(width * height)`; a font with unitsPerEm 16, advance 8000, ascent 8000 at px 32 produced a 16000x16000 glyph (256,000,000 bytes). `buildFontAtlas` has no height or size cap. Also, `parseFont`'s try/catch covers parsing only: `cmapLookup` and `contours` are lazy and throw `RangeError` later, in callers.
- Impact: A font in mounted content (`fonts/*.ttf` via menu-font.ts:101-108) hangs the main thread or exhausts memory during UI load. The reach is local or mod content, not a direct network message.
- Remediation: Add a per-glyph budget for composite components and charstring operations, a max raster dimension (for example 2x px), and an atlas size cap tied to the GL limit; validate tables eagerly or wrap lazy accessors.

### RENDER-010 — Stray top-level brace silently discards an entire shader script, including valid shaders before it
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran: a script with one stray `}` between shaders gives ShaderParseError "Expected shader name" from inspectShaderScript. material.ts:1271 fail is not recovered by parse(true), and shaders.ts:107-108 `catch { return; }` discards all entries with no output. Its doc comment claims sibling retention and its catch comment covers only unlexable files.
- Severity: Medium
- Category: robustness
- Location: src/materials/material.ts:1271,1442-1444, src/render/scene/shaders.ts:107-108
- Confidence: reproduced
- Evidence: `if (nameToken.value === "{" || nameToken.value === "}") this.fail("Expected shader name");` throws through `parse(true)` despite `recover`, discarding accumulated `entries`. `addScript` then does `try { entries = inspectShaderScript(text, source).entries; } catch { return; }`, with no warning. Reproduced: `good1 {...} } good2 {...}` gives `ShaderParseError: <shader>:7:1: Expected shader name`, and neither shader registers. Source `FindShaderInShaderText`/`SkipBracedSection` tolerates a stray token.
- Impact: One extra `}` in a mod's script file makes every shader in it fall back to implicit or default materials, with no console output to explain it.
- Remediation: In recover mode, skip the stray token with a warning and return partial `entries`; log in the `addScript` catch.

### RENDER-011 — Shadow atlas content is lost on renderer replacement while light signatures still say "cached"
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** shadows.ts:269,315 keep signatures, and only close() (:333) clears them. Atlas passes are "depth-atlas" operations, not journal image operations (image-journal.ts:37-54), so replay at renderer.ts:171,255 restores the all-1 creation. video-restart.ts retains the game, and its published hook (startup.ts:483) only records the preference. Not run end to end.
- Severity: Medium
- Category: bug
- Location: src/render/scene/shadows.ts:269,315,327, src/render/image-journal.ts:43-44, src/app/bootstrap/renderer.ts:173-174,255, src/render/worker-runtime.ts:98-105, src/render/cpu/rasterizer.ts:706
- Confidence: traced
- Evidence: The atlas is created with all-1 pixels and journaled as that creation; depth-atlas passes render directly into the backend texture and never reach the journal. After `vid_restart` or a CPU resize, the journal replays the all-1 image. `Q2ShadowScene.cached` survives, so `if (sameSignature(this.cached.get(candidate.index), signature)) { cachedLights++; continue; }` emits no passes. Nothing invalidates `cached` on a backend swap.
- Impact: Shadows from static lights disappear after a renderer restart or CPU window resize until a light or caster changes.
- Remediation: Expose a renderer generation to the scene and clear `cached` when it changes, or add a journal replay hook that invalidates dependent caches.

### RENDER-012 — Row workers sample a stale snapshot of the shadow atlas
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** cpu/textures.ts:58-63 returns stable levels[0], a plain Float32Array slice (:75). row-parallel.ts:276-280 posts it once per object, which structured-clones it, and row-worker.ts:149-151 keeps that copy. rasterizer.ts:706 mutates only the coordinator's copy, while coordinator bands (row-parallel.ts:314-319) use current data. Traced, not run.
- Severity: Medium
- Category: bug
- Location: src/render/cpu/row-parallel.ts:1-6,274-282, src/render/cpu/row-worker.ts:149-151, src/render/cpu/rasterizer.ts:456,706, src/render/cpu/textures.ts:58-63
- Confidence: traced
- Evidence: `depthImage` returns the stable `levels[0]`, so `#depthIds` hits after the first registration; `#pendingDepths.push({ id, depth })` structured-clones a non-shared Float32Array once. Later atlas updates mutate the coordinator's copy in place (`image.pixels.set(target.depth.subarray(...))`). The worker keeps the first snapshot, while the coordinator also claims bands (row-parallel.ts:314-319) and uses current data. The file header's claim that output is bit-identical to the serial kernel does not hold here. tests/render/cpu/row-parallel.test.ts renders fragment-lit output in a single atlas state, so it does not observe the drift.
- Impact: CPU renderer with Q2 shadows shows outdated shadows in worker-owned bands and correct ones in coordinator bands, and band claims vary per job, so moving shadows tear and flicker.
- Remediation: Store depth atlas pixels in a SharedArrayBuffer, or re-send on change with a generation counter.

### RENDER-013 — Texture pixels are retained three to five times on the JS heap
- **Verification (VERIFY-F): confirmed-with-changes. Final severity: Medium.** Copies verified at image-journal.ts:9-20,43, gl/textures.ts:101-104,137, worker-protocol.ts:134-139, worker-runtime.ts:81 and scene/textures.ts:94; the worker journal replays only for SoftwareRenderer (:99). Category is wrong: this is bounded retention released with the image, not a leak. The "three to five times" multiplier was not measured.
- Severity: Medium
- Category: leak
- Location: src/render/gl/textures.ts:101-104,137,153-161, src/render/image-journal.ts:9-20,43, src/render/worker-protocol.ts:134-139, src/render/worker-runtime.ts:73,81,98-105, src/render/scene/textures.ts:94
- Confidence: traced
- Evidence: `SceneTexture.content` keeps frontend pixels; `RenderImageJournal.record` always `snapshotImage`s every level; `GlTextures.images.set(..., { content, ... })` keeps all levels though only `kind`, palette and translation are read afterward. With a worker: encoder `snapshot` (retained until acknowledged, then re-copied by the host journal), plus a decoded copy in the worker's `GlTextures`, plus a worker-side journal that only the CPU branch of `resize` ever replays (worker-runtime.ts:99). The 2048x2048 Float32 shadow atlas (16 MB) is duplicated the same way.
- Impact: The JS heap holds several times the texture budget in addition to driver copies, which matters on the constrained target and for GC pause times.
- Remediation: Store only the palette and format in `GlTextures`; skip the worker journal for GL; have the frontend drop `SceneTexture.content` where only the journal needs it, or share the journal's copy.

### RENDER-014 — `visibleWorld` runs twice per view
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/render/scene/world.ts:509 computes visibility before the :510-511 cache check. presentation-scene.ts:370-373 and q3-client.ts:576-577 call prepareWorldOperations, then prepareView, which traverses again at :542-543. world.ts:821 adds a third for portals. Cost not measured.
- Severity: Medium
- Category: performance
- Location: src/render/scene/world.ts:509-511,542-543,821, src/app/bootstrap/presentation-scene.ts:370-373, src/app/bootstrap/q3-client.ts:576-577
- Confidence: traced
- Evidence: `visibility ??= visibleWorld(this.map, input.camera, input); const cached = input.source?.worldOperations.get(this); if (cached !== undefined) return cached;`. The traversal runs before the cache check, and callers invoke `prepareWorldOperations(input)` (traversal + ops) then `prepareView` (traversal, discarded by the cache return, except for the `q2Fog` `surfaces`). With portals, world.ts:821 adds a third traversal.
- Impact: Duplicates the full BSP/frustum traversal and its Map/array allocation per view on the main render path.
- Remediation: Check the cache first, and have callers pass the `VisibleWorld` through.

### RENDER-015 — Per-view allocation and sorting in scene submission
- **Verification (VERIFY-F): confirmed. Final severity: Low.** Sites verified: submissions.ts:87, material-registrations.ts:205-208, world.ts:633-636, models/prepare.ts:107-112, gl/renderer.ts:280, cpu/rasterizer.ts:93-108. The finding itself says no line dominates and nothing was profiled, and submissions.ts:87 runs only for source-ordered ranges. Unmeasured GC churn does not support Medium.
- Severity: Medium
- Category: performance
- Location: src/render/scene/submissions.ts:87, src/render/scene/material-registrations.ts:205-208, src/render/scene/world.ts:591,633-636,659-660, src/render/scene/models/prepare.ts:107-112,232, src/render/gl/renderer.ts:279-280,307,313-315,322-385,342, src/render/cpu/rasterizer.ts:93-108
- Confidence: traced
- Evidence: `finishSceneOperations` builds `new Map(view.registrations.snapshot().map(...))`, and `snapshot()` flat-maps and sorts all admitted materials on each view (thousands in Q3). Each visible legacy surface builds a joined string key plus a `styles` array; every retained model surface builds a 15-number string via `transformKey`; `prepareGeometry` allocates four closures, a state copy and an array literal per draw; `beginView` spreads the matrix into an array for a finite check; the CPU backend re-maps all vertices per draw (`snapshotBatch`).
- Impact: Steady GC churn per frame, which grows with surfaces and materials; no single line dominates in this read, and it was not profiled.
- Remediation: Compute shader ranks once per registration revision; use numeric keys for surface caches; pool prepared-draw state.

### RENDER-016 — Q2 secondary-cluster and multi-view frames defeat the single-entry PVS mark cache
- **Verification (VERIFY-J): confirmed. Final severity: Low.** visibility.ts:174 creates a new buffer when a second cluster applies, and :205-206 compares by buffer identity, so it always misses. index.cache holds one entry (:218). Results stay correct.
- Severity: Low
- Category: performance
- Location: src/render/scene/visibility.ts:174,203-218
- Confidence: traced
- Evidence: `pvs = Uint8Array.from(pvs)` creates a fresh buffer whenever a second cluster applies, and the cache compares `cached.pvsBuffer === (pvs?.buffer ?? null)`, so it always misses and recomputes marks over all leaves. A single-entry cache also thrashes when portal and main views (or split-screen seats) alternate. Results stay correct.
- Impact: O(leaves) extra work per view near Q2 cluster boundaries or with portals, which partly cancels PERF3 savings.
- Remediation: Cache the merged PVS per cluster pair and hold a small per-map LRU of marks.

### RENDER-017 — Wire image maps never shrink
- **Verification (VERIFY-J): confirmed. Final severity: Low.** worker-protocol.ts:113 and :199 insert; :133 and :253 handle release-image without deleting. The only images.clear is :103 in the encoder clear.
- Severity: Low
- Category: leak
- Location: src/render/worker-protocol.ts:92,111-113,183,198-199,253
- Confidence: traced
- Evidence: `this.images.set(image.ordinal, image)` on both encoder and decoder; `release-image` handling does not delete, and only `WireEncoder.clear()` at renderer close does. Ordinals are monotonic, and legacy maps register two images per lit face (world.ts:297).
- Impact: Under `r_smp 1`, tens of thousands of small handle objects per map accumulate on both threads for the renderer's lifetime. Each is small, so this needs many map changes to matter.
- Remediation: Delete map entries when a `release-image` operation is acknowledged or decoded.

### RENDER-018 — Image refresh leaves old surfaces pinned in world batch caches
- **Verification (VERIFY-J): confirmed. Final severity: Low.** world.ts:161,164 strong maps have only get/set (:638,:653,:656,:666); releaseImages (:741) and commitImages (:776-777) do not clear them, and commitImages installs replacement surface objects. Retention ends when the world closes and becomes unreachable.
- Severity: Low
- Category: leak
- Location: src/render/scene/world.ts:161,164,741,776-777
- Confidence: traced
- Evidence: `legacyBatchCache` and `fragmentBatchCache` are strong `Map<WorldSurface, ...>`. `commitImages` replaces `this.surfaces` with new objects and `releaseImages` clears `staticLightStyles` but neither of these maps, so old surface keys and batches (with their geometry and released image handles) stay until the world closes.
- Impact: One full copy of world surface data retained per image-settings refresh on the current map.
- Remediation: Clear both maps in `releaseImages`.

### RENDER-019 — Linear scans during material registration make load quadratic
- **Verification (VERIFY-J): confirmed. Final severity: Low.** shaders.ts:78 find, :221 and :233 scans, material-registrations.ts:113 spreads and filters, :263 spreads and finds per publish. No timing taken.
- Severity: Low
- Category: performance
- Location: src/render/scene/shaders.ts:78,221,233, src/render/scene/material-registrations.ts:263,113
- Confidence: traced
- Evidence: `sourceWorldMaterial` runs `this.sourceRecords.find(...)` per Q3 surface; `registerSource` scans all records per request; `ShaderReplacementStage.publish` does `[...this.entries.values()].find(...)` per publish.
- Impact: Load and image-refresh time grows with surfaces x registered shaders on large Q3 maps. No timing was taken.
- Remediation: Index records by registration and by name.

### RENDER-020 — Row pool startup can block the renderer for 30 s and hides worker load errors
- **Verification (VERIFY-J): confirmed. Final severity: Low.** row-parallel.ts:233-238 blocks on Atomics.wait with a 30 s deadline, with no worker error listener; :248 discards the reason. rasterizer.ts:693 builds a separate SoftwareRenderer, and :1164 creates its pool lazily. tools/build.ts:71 embeds the worker, so this needs a load failure.
- Severity: Low
- Category: robustness
- Location: src/render/cpu/row-parallel.ts:233-238,248, src/render/cpu/rasterizer.ts:693,1164
- Confidence: plausible
- Evidence: The constructor spins on `Atomics.wait` with a 30-second deadline, so a worker `error` event cannot be delivered while blocked, and `tryCreate`'s `catch { return null; }` discards the reason. It happens lazily on the first qualifying draw. The depth-atlas target, itself a `SoftwareRenderer`, creates a second pool of up to 4 workers. The build does embed row-worker.ts (tools/build.ts:71), so this needs a load failure to trigger.
- Impact: A long freeze with no diagnostic if worker loading fails, and doubled worker threads under Q2 shadows on CPU.
- Remediation: Create the pool at renderer construction, report failures, and disable pooling for the atlas target or share the pool.

### RENDER-021 — Sky-side immediate draws inherit blend, alpha test and cull state from the previous batch
- **Verification (VERIFY-J): confirmed. Final severity: Low.** renderer.ts:442-461 sets only program, texture and color; rasterizer.ts:730-741 uses retainedState. world.ts:720 emits only depth-range before sky-side and q2-sky.ts:79 emits no state at all. Not observed at runtime.
- Severity: Low
- Category: bug
- Location: src/render/gl/renderer.ts:442-461, src/render/cpu/rasterizer.ts:730-741
- Confidence: plausible
- Evidence: GL `sky-side` sets only program, texture and color: `this.program.use(null, this.alphaTest)`, with no blend, depth-mask or cull setup. CPU uses `state: this.retainedState`. Q3 `RB_StageIteratorSky` sets explicit `GL_State` for the box. Sky normally draws early in a view, so the inherited state is often harmless.
- Impact: After a portal, or following state from a previous frame, a sky box could blend or alpha-discard incorrectly. Not observed at runtime.
- Remediation: Apply an explicit opaque sky state in both backends.

### RENDER-022 — Overdraw measurement API has no callers and backends disagree on row stride
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Low.** No production trigger exists, but "only in contract and backends" omits forwarding in worker.ts:200-205 and worker-runtime.ts:102,151-152 and test callers (tests/render/worker-native.test.ts:57,63, cpu/rasterizer.test.ts, gl/smoke.test.ts). Stride mismatch holds: rasterizer.ts:551 versus textures.ts:36 alignment 1.
- Severity: Low
- Category: dead-code
- Location: src/contracts/render.ts:294-295, src/render/gl/renderer.ts:542-559, src/render/cpu/rasterizer.ts:537-559, src/render/worker.ts:200-205
- Confidence: traced
- Evidence: A grep of src finds `setOverdrawMeasurement` and `readStencilOverdraw` only in the contract and backends. CPU writes with `Math.ceil(this.width / 4) * 4` stride ("PACK_ALIGNMENT=4"); GL forces pack alignment 1 through `withPixelStore`.
- Impact: Unused surface in the backend contract; a future consumer would get different layouts per backend.
- Remediation: Remove it, or define a single layout and add a caller.

### RENDER-023 — Risky growth and wire behavior have no tests
- **Verification (VERIFY-J): confirmed. Final severity: Low.** worker-protocol.test.ts and worker-native.test.ts have 0 space/viewProjection hits. visibility.test.ts:30 fixture is q3-bsp with one surface per leaf, so there is no shared-leaf case.
- Severity: Low
- Category: test-gap
- Location: tests/render/worker-protocol.test.ts, tests/render/worker-native.test.ts, tests/render/cpu/row-parallel.test.ts, tests/render/commands/merge-retention.test.ts, tests/render/visibility.test.ts
- Confidence: traced
- Evidence: Worker tests contain no `space` or `viewProjection` (grep count 0). The row-parallel test asserts pixel identity but not registry size or atlas updates between jobs. Merge retention tests hit, miss and pack promotion, but no bound on retained runs. PERF3 tests use Q3 maps with unique leaves.
- Impact: The existing tests do not exercise RENDER-001 through RENDER-004, 007 or 012.
- Remediation: Add a wire round-trip, a repeated-draw worker memory bound, a cache-size cap test and a Q1 shared-leaf fixture.

### RENDER-024 — GL and CPU feature parity notes
- **Verification (VERIFY-J): confirmed. Final severity: Info.** presentation.ts:427 restricts worldSpaceBatches to GL, rasterizer.ts:484 throws on stereo buffers. lighting.ts:27 has the stray `{}` and :39-44 has identical branches. The claim of parity for other features was not re-checked.
- Severity: Info
- Category: maintainability
- Location: src/app/bootstrap/presentation.ts:427, src/render/cpu/rasterizer.ts:93-108,484,437-440, src/render/cpu/lighting.ts:27,39-44
- Confidence: traced
- Evidence: World-space batches and their retained caches (PERF2's main beneficiary) are GL-only, so CPU keeps clip-space per-frame geometry. CPU rejects stereo buffers (`throw new Error("CPU stereo draw buffers are unavailable")`). CPU gamma runs per byte in JS on each `finish`. Fog, shadow, stencil and object-opacity features are present on both. `cullTriangleLights` has a stray `{}` at line 27 and two identical branches at lines 39-44.
- Impact: Performance characteristics and memory behavior differ substantially by backend; a fix to either path needs checking on the other. I found no missing rendering feature on CPU beyond stereo.
- Remediation: None required beyond removing the dead branch.
