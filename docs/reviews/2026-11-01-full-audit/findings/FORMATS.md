# FORMATS — File formats, media, persistence, settings, content mounts and paths

Audited at HEAD fcdc8af5. Paths are relative to the project root. Reproduction scripts: `scripts/formats/` (run against the clean checkout).

## Coverage
Read in full:
- Images: `src/formats/images/jpeg.ts` (1129), `png.ts` (227), `gif.ts`, `bmp.ts`, `tga.ts`, `q3-tga.ts`, `q3-pcx.ts`, `q3-bmp.ts`, `indexed.ts`, `wad.ts`, `mip.ts`, `palette.ts`
- Zip/PK3/PAK reader (outside the file list, read because the brief requires it): `src/content/archive/zip.ts` (123), `pak.ts`, `index.ts`, `source.ts`, `types.ts`, `loose.ts`; `src/core/binary/index.ts`
- Maps: `src/formats/bsp-kind.ts`, all of `q1-map/*` except `types.ts` (67), all of `q2-map/*`, `q3-map/decode.ts`, `ibsp44.ts`, `world.ts`, `entities.ts`
- Models: `q12-model/common.ts`, `md2.ts`, `mdl.ts`, `sprite.ts`, `animation.ts`; `q3-model/md3.ts` (481), `md4.ts`, `md5.ts`, `text.ts`, `lod.ts`
- Mounts/paths: `src/content/mounts/index.ts` (623), `mounts/paths.ts`, `roots.ts`, `user-data.ts`
- Persistence: `save-image.ts`, `save-policy.ts`, `saved-game.ts`, `value.ts`, `protection.ts`, `world-state.ts`, `kex-q2-save.ts`, `source-json.ts`, `source-bytes.ts`, `source-items.ts`, `recipe.ts`, `execution.ts`, `q1.ts`, `q1-source.ts`, `q1-selection.ts`, `q1-quakec.ts`, `q1-foundation.ts`, `mods.ts`, `q2-classic.ts`, `q2-classic-guest.ts`, `q2-rerelease.ts`
- Settings: `config.ts`, `restart.ts`, `server/profile.ts`, `q2-owner.ts`, `q2.ts`, `cvars.ts`, `selection.ts`, `rotation.ts`, `library.ts`, `common.ts`
- Media: `source.ts`, `ogg.ts`, `cin.ts`, `cin-playback.ts`, `roq.ts`, `roq-stream.ts`, `roq-codebook.ts`, `roq-audio.ts`, `ogv-playback.ts`

Sampled:
- `src/media/playback.ts` (first 136 of 196)
- `src/persistence/q2-rerelease-state.ts` (first 28 of 46)
- `src/formats/q3-model/animation.ts` (first 36 of 93)
- Callers, only the ranges traced: `render/scene/textures.ts`, `render/scene/visibility.ts`, `render/scene/models/prepare.ts`, `app/bootstrap/content.ts`, `startup-saves.ts`, `original-save.ts`, `world/collision/q1/*`, `world/collision/q3/map-resource.ts`, `materials/q2-lightgrid.ts`, `platform/theora.ts`, `platform/files/contained.ts`

Skipped (not read):
- Formats: `images/jpeg-encoder.ts` (342), `png-encoder.ts` (45), `index.ts`, `IJG-LICENSE.md`; `q12-model/normals.ts` (174), `index.ts`; `q3-model/quaternion.ts`, `replacements.ts`, `scene.ts`, `index.ts`; `q3-map/index.ts`; `q1-map/types.ts`
- Media: `roq-playback.ts` (244), `presentation.ts` (167), `roq-presentation.ts`, `material.ts`, `transitions.ts`, `types.ts`, `audio.ts`, `still.ts`, `index.ts`
- Persistence: `q3.ts`, `shared.ts`, `native-weapon.ts`, `provider-ownership.ts`, `q2-foundation.ts`, `q2-base-entities.ts`, `q2-containers.ts`, `q2-hand-grenades.ts`, `q2-items.ts`, `q2-missionpacks.ts`, `q2-monsters.ts`, `q2-movers.ts`, `q2-players.ts`, `q2-typescript.ts`, `q2-weapons.ts`, `qvm-grapple.ts`, `index.ts` (schema readers of the same shape as those read)
- Settings: `server/lmctf.ts`, `lmctf-cvars.ts`, `q1.ts`, `q3.ts`, `types.ts`, `index.ts`; `settings/index.ts`

Not audited: `src/compat/qc/save.ts`, which applies Q1 save pairs, and the guest emulator's sandbox strength. Both are outside this scope.

## Strengths
- `BinaryReader` (`src/core/binary/index.ts:33`) checks every read and section with safe-integer range tests. Binary parsers fail with typed errors, not out-of-bounds reads. No out-of-bounds read was found in any decoder.
- The ZIP reader cross-checks central and local headers, names, sizes and CRC. It rejects encryption, ZIP64 and multi-disk archives, and honours an output cap (`zip.ts:64-68, 91-105, 115-121`). Bun was verified to enforce `maxOutputLength`.
- Zip-slip is handled: `normalizeEntryPath` (`archive/types.ts:58`) refuses leading `..`, drive colons and NUL. `normalizeResourcePath` (`mounts/paths.ts:4`) refuses any `..`. Map-supplied texture names therefore cannot leave a root.
- Symlink containment on reads: `findContentPath` and `openLooseEntry` compare realpaths against the canonical root (`paths.ts:47-49`, `loose.ts:18-21`).
- `FileSource` holds one descriptor, uses positional reads, detects file changes, and defers close until reads finish (`archive/source.ts:51-90`).
- `writeContainedSave` is the correct pattern: `O_EXCL|O_NOFOLLOW`, full write loop, `fsync` of the file, rename through a held directory descriptor, `fsync` of the directory (`save-policy.ts:48-68`).
- `SaveReader` schemas construct every field explicitly. `unpack` uses `defineProperty`, so `__proto__` keys cannot pollute (`value.ts:69-73`).
- Q2 and Q3 maps validate BSP node cycles at load (`q2-map/reader.ts:238-256`, `q3-map/decode.ts:199-216`). MD3 enforces the source limits (`md3.ts:25-30`).
- Media limits are good: the CIN Huffman walk strictly decreases and frame size is capped (`cin.ts:79, 108, 147`); Ogg has page CRC, 16 MiB packet and 512 MiB file caps (`ogg.ts:32, 51, 64`); Theora dimensions and rate are capped (`platform/theora.ts:59-62`); RoQ motion and scratch ranges are checked (`roq.ts:281`, `roq-stream.ts:148, 224`).

## Findings

### FORMATS-001 — 140-byte JPEG decodes up to 65500x65500 with no input cost (decompression bomb)
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Code as quoted (jpeg.ts:122-127, 270; no cap in textures.ts:232). Re-measured 4000x4000 from 140 bytes: 482 ms, 192 MB. No legitimate file triggers it, and delivery needs an installed hostile file or opt-in `cl_allowDownload`. The 65500x65500 figure is extrapolated, not run.
- Severity: High
- Category: security
- Location: src/formats/images/jpeg.ts:270, 287-290, 122-127, 734, 893, 1020, 1116; src/render/scene/textures.ts:232, 261
- Confidence: reproduced
- Evidence:
  - The only dimension cap is the IJG limit: `if (width > 65500 || height > 65500) input.sourceFail(...)`.
  - Allocation follows the header directly: `outputSamples: buffered ? null : new Uint8Array(width * height)` per component (up to 10), or `new Int16Array(stride * rows * descriptor.v * 8)` when buffered, then `new Uint8Array(frame.width * frame.height * 4)` in `render`.
  - Once a marker is seen, `Entropy.fill` synthesizes zero bits forever without consuming input (lines 122-127). The MCU loop therefore walks the whole image from nothing.
  - The caller's `try/catch` (textures.ts:182) cannot stop a stall or the OOM killer, and no caller caps dimensions.
  - Measured with `jpeg.ts`, 140-byte input:

    | Size | Time | RSS | Output |
    |---|---|---|---|
    | 1000x1000 | 68 ms | 74 MB | 4 MB |
    | 4000x4000 | 542 ms | 188 MB | 64 MB |
    | 16000x16000 | 7.1 s | 1.87 GB | 1.02 GB |

  - Extrapolating to 65500x65500 gives about 2 minutes and 17 GB of output for one component (not run because of the memory limit).
  - Progressive files multiply CPU: each extra scan costs 12 bytes and re-walks every block. `jpegperf.ts` measured 202 ms for 1 scan and 481 ms for 50 scans at 4 MP, about 5.7 ms per scan per 4 MP. libjpeg's scan-limit mitigation has no equivalent here.
- Impact: Any `.jpg` in a mounted or downloaded PK3 referenced as a texture freezes the main thread for minutes or OOM-kills the client.
- Remediation: Enforce a product-level maximum (Q3 used 2048-4096 textures) before allocating, and cap scan count. Fail once fabricated zero bits exceed a small budget.

### FORMATS-002 — GIF retains a full canvas copy per 15-byte frame
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Re-measured 1,520 bytes to 419 MB retained, 465 MB RSS in 195 ms (gif.ts:113, no frame cap). q2-downloads.ts:246 rejects .gif, so the path is local content or an opt-in Q3 pk3. The 290 GB figure is arithmetic only.
- Severity: High
- Category: security
- Location: src/formats/images/gif.ts:69, 102, 113; src/render/scene/textures.ts:187-194; src/app/bootstrap/character-turntable.ts:126
- Confidence: reproduced
- Evidence:
  - `frames.push({ image: { width, height, pixels: canvas.slice() }, ...` runs for every frame, regardless of the frame's rect. The only limit is `width * height * 4 > 0x7fffffff` per canvas, with no frame-count cap.
  - `textures.ts:194` then runs `convert` (rgba plus mip) for every frame.
  - `gif.ts` measured 1,520 bytes (100 frames of 1x1 on a 1024x1024 canvas) producing 419 MB retained and 465 MB RSS in 222 ms. At the same 15 bytes per frame, a 1 MB file holds about 69,000 frames, or about 290 GB.
- Impact: A small `.gif` in user or addon content (the path exists for Q2 rerelease textures and the character turntable) kills the process. Normal GIFs also pay canvas-times-frames memory.
- Remediation: Cap frame count and total decoded bytes. Decode lazily, or store rects and composite on demand.

### FORMATS-003 — IBSP44 polygon expansion trusts `vertexCount` before any range check
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** ibsp44.ts:66-74 is as quoted and the loop runs before any vertex range check. Under `ulimit -v 4000000`, both 1e7 and 2147483647 threw a catchable `Out of memory` at about 650 MB; unlimited behavior was not rerun. Needs a crafted local map or opt-in Q3 download.
- Severity: High
- Category: security
- Location: src/formats/q3-map/ibsp44.ts:66-74, reached from src/formats/q3-map/decode.ts:117 (`data = normalizeQ3Bsp(data, source)`) and src/formats/bsp-kind.ts:10
- Confidence: reproduced
- Evidence:
  - `const ... vertexCount = int(surface, 76);` is used in `for (let i = 1; i < vertexCount - 1; i++) indices.push(0, i, i + 1);`. Line 68 validates only `firstIndex/indexCount`, and `vertexCount` is never checked against the vertex lump.
  - `ibsp44.ts` used a 292-byte file. With `vertexCount=10000000`, RSS reached 1.25 GB before a later validation rejected the map.
  - With `2147483647` under `ulimit -v 6000000`, it threw `Out of memory` after 1.2 s. Without a limit it continues until the kernel kills the process.
- Impact: A 292-byte `.bsp` exhausts memory during load. Later validation never runs.
- Remediation: Range-check `firstVertex + vertexCount` against the vertex lump (section 11, stride 44) before expanding, and bound total synthesized indices.

### FORMATS-004 — Q1 BSP loader accepts node cycles; render traversal then hangs forever
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Re-ran q1cycle: `readQ1Bsp` accepted a self-referencing node and `worldPointLeaf` (visibility.ts:30-38) never returned. The guard in q1-map/queries.ts:52 is not on this path. A permanent hang, but Q1 has no map download path (remote-q1.ts:124 requires a local map; qw-client.ts:63), so only a locally installed map reaches it.
- Severity: High
- Category: robustness
- Location: src/formats/q1-map/index.ts:136, 157-161; src/render/scene/visibility.ts:30-38, 155, 231-250
- Confidence: reproduced
- Evidence:
  - `validateReferences` only range-checks: `for (const child of node.children) index(child.index, child.kind === "node" ? map.nodes.length : map.leaves.length, ...)`. Q2 and Q3 reject cycles at load, Q1 does not.
  - `worldPointLeaf` has no guard: `while (child.kind === "node") { ... child = node.children[...]; }`.
  - The `visibleWorld` stack (line 231) also pushes two children per pop with no visited check. `ancestorIndex` marks such trees `unsafe` (line 113) but that only disables marks, so the stack can grow without bound.
  - `q1cycle.ts`: `readQ1Bsp` accepted a node whose children both point to node 0. `worldPointLeaf` never returned; the process was killed by `timeout` (exit 124).
  - The Q1 collision paths (`world/collision/q1/index.ts:241`, `hull.ts:66, 86`, `q1-solid/index.ts:32`) do guard, but throw `RangeError` at runtime only on the branch traversed. A cycle placed off the spawn path passes load and fires when the camera arrives there.
- Impact: A crafted map hangs the client permanently with no error once the camera enters the region. The event loop stops and only a process kill recovers it.
- Remediation: Run the same iterative cycle check for Q1 nodes and clipnodes in `validateReferences`, from every model head node.

### FORMATS-005 — Alias interpolation cache keyed on a continuous float retains 256 full poses per frame pair
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Retention is real but "Q1 client memory climbs" is false for Q1 play. Sole caller is prepare.ts:365, and it receives backLerp 0 on Q1 clocks (see RENDER-001): 0 nonzero keys in 3,600 and 600 measured frames. It grows only on the RENDER-001 cross-game path, capped at 256 per pair (animation.ts:45). Duplicate root cause of RENDER-001.
- Severity: High
- Category: leak
- Location: src/formats/q12-model/animation.ts:22, 29, 42-47; src/render/scene/models/prepare.ts:101, 362-372; src/app/bootstrap/simulation/runtime.ts:7365
- Confidence: reproduced (retention); traced (live path)
- Evidence:
  - `const cacheKey = \`${backLerp}|${previousOriginDelta.x}|...\`` keys a module-global `WeakMap<ModelFrame, WeakMap<ModelFrame, Map<string, ...>>>`. The only bound is `if (byKey.size >= 256) byKey.clear();`, per frame pair.
  - `backLerp` is `1 - fraction` of wall-clock presentation (runtime.ts:7365), so it is effectively never repeated. The cache rarely hits and fills instead.
  - Keys are `ModelFrame` objects that live as long as the model. Retention scales as vertices times frame pairs visited times up to 256.
  - `alias.ts` with 300 vertices, 100 frame pairs and 30,000 calls measured +842 MB RSS after `Bun.gc(true)`. That call count is about 3.5 minutes at 144 fps.
  - `prepare.ts:101` adds a second persistent layer, `byLerp`, capped at 512 per pair, holding built geometry (render scope, noted for cross-reference).
- Impact: Q1 client memory climbs by gigabytes over a session with animated MDLs on screen, and every render frame also pays a cache-miss allocation.
- Remediation: Remove the per-`backLerp` caching, or quantize the lerp to a small set. Bound the cache by total entries with LRU rather than per pair.

### FORMATS-006 — Q3 `leaf.area` has no upper bound, driving an area-squared allocation
- **Verification (VERIFY-B): confirmed. Final severity: Medium.** Upgraded from traced to measured by patching leaf 0 of real q3dm1.bsp. `parseQ3Bsp` accepted area 20000 and 2147483646 (decode.ts:220). `decodedCollisionMap` (map-resource.ts:535-537) threw catchable OOM at 20000 and hit an uncatchable JSC MemoryExhaustion abort at 2147483646, under the 4 GB limit. Crafted map only.
- Severity: High
- Category: security
- Location: src/formats/q3-map/decode.ts:220; src/world/collision/q3/map-resource.ts:534-537, 255-258; src/world/collision/q3/topology.ts:70
- Confidence: traced
- Evidence:
  - `decode.ts:220` checks only the lower bound: `if (leaf.area < -1) fail(offset + 4, "invalid leaf area");`.
  - `map-resource.ts:535-537`: `areaCount = Math.max(areaCount, leaf.area + 1)`, then `Array.from({ length: areaCount }, () => ({ flood: 0, floodValid: 0 }))` and `new Int32Array(areaCount * areaCount)`.
  - One 48-byte leaf record with `area = 0x7ffffffe` creates 2^31 objects before the typed-array allocation fails. `area = 30000` allocates 3.6 GB.
  - `topology.ts:70` also boxes `areaCount^2` values into a JS array on checkpoint.
- Impact: A very small crafted map OOMs on load. Moderate values pass and cost gigabytes and very slow saves.
- Remediation: Cap area count at decode (original engine `MAX_MAP_AREAS` scale, 256-1024) and validate cluster count the same way.

### FORMATS-007 — Loading a save trusts its embedded recipe: filesystem mount paths and executable modules
- **Verification (VERIFY-B): confirmed-with-changes. Final severity: Medium.** Traced as quoted: recipe.ts:24-25, startup.ts:1199, content.ts:451, 484; digest is self-supplied (mounts/index.ts:544). Impact is narrower than High: content.ts:456-480 restricts module/product pairing, native modules run emulated rather than on the host, and the payload file must already be on disk. No malicious save was built. The path leak and install-move breakage stand.
- Severity: High
- Category: security
- Location: src/persistence/recipe.ts:24-25, 89, 113, 126-142; src/persistence/saved-game.ts:12; src/app/bootstrap/original-save.ts:18; src/app/bootstrap/startup.ts:1199; src/app/bootstrap/application.ts:2642; src/app/bootstrap/content.ts:451, 484; src/content/mounts/index.ts:544
- Confidence: traced (no malicious save was built and loaded end to end)
- Evidence:
  - The save schema stores host paths: `{ ...common, kind: "loose", rootPath: reader.field("rootPath").string() }` and `archivePath: reader.field("archivePath").string(), archiveDigest: readDigest(...)`. No containment check applies.
  - The save also picks execution: `kind ... choice("typescript", "quakec", "qvm", "native")`, with `artifact` and native `profile`.
  - `prepareApplicationSave` returns `saved.image` as is. `startup.ts:1199` passes `recipe: image.recipe`, and `application.ts:2642` does `if (save !== undefined) recipe = save.recipe;`.
  - `content.ts:451` does `let recipe = restoredRecipe ?? await resolveRecipe();`, then line 484 `openMountPlan(recipe.mounts, mountOptions)`.
  - The only digest check compares the file to the digest the save itself supplies (`mounts/index.ts:544`). Lines 456-482 check module/product pairing, not catalog membership.
  - Refutation attempt: `runtime.ts:630` compares `saved.recipe` to `options.recipe`, but both come from the same save. The network path does remap through the catalog (`network/unified-content.ts:113-124`). The save path has no equivalent.
- Impact:
  - A shared `.sav` can mount any readable path and select a QVM, QuakeC or native guest module from an archive already on disk, such as one downloaded earlier or delivered beside the save. How far that goes depends on guest sandbox strength.
  - Separately, absolute paths break saves when the install moves and leak the user's home path when a save is shared.
- Remediation: Store content-relative identities only. On load, re-resolve the recipe through the installed catalog and reject any mount or module the catalog does not offer.

### FORMATS-008 — PK3 inflation cap is the attacker's own declared size, run synchronously per asset
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/content/archive/zip.ts:115 `inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.byteLength) })`, and :58 takes byteLength from the central directory with only the 0xffffffff ZIP64 rejection at :65. No per-entry or archive budget exists. readEntry (archive/index.ts:60) then digestBytes (mounts/index.ts:321) run on the result.
- Severity: Medium
- Category: security
- Location: src/content/archive/zip.ts:58, 115; src/content/archive/index.ts:60; src/content/mounts/index.ts:311, 321
- Confidence: reproduced (ratio and cap behaviour); traced (reach)
- Evidence:
  - `inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.byteLength) })`, where `byteLength` is up to 0xfffffffe from the central directory. There is no per-entry or per-archive budget.
  - `inflate.ts` measured deflate at 1029:1 (200 MB to 203,842 bytes). A roughly 4 MB entry therefore expands to about 4 GB on the main thread, then `digestBytes` hashes it (`mounts/index.ts:321`).
  - The cap is enforced, so a lying header cannot exceed its declaration, but the declaration is unconstrained.
  - The call blocks the event loop, so on a dedicated server it also stalls ticks.
- Impact: A hostile or downloaded PK3 causes multi-GB transient allocations and long frame stalls per referenced asset. Combined with object-heavy decoders (MD3, MD5) this can reach OOM.
- Remediation: Add a configurable maximum entry size (for example 256 MiB) and a compression-ratio sanity check in `readZipDirectory`, and run large inflates asynchronously.

### FORMATS-009 — MD5 animation expands about 3,800:1 into JS objects
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/formats/q3-model/md5.ts:187-190 permits 65535 frames, 256 joints and 0 components; the frames.map below builds localJoints and joints objects for every joint of every frame. Reached from app/bootstrap/model-loader.ts:43,73. The memory figures were not re-measured.
- Severity: Medium
- Category: security
- Location: src/formats/q3-model/md5.ts:187-190, 209-214, 216-236
- Confidence: reproduced
- Evidence:
  - `numFrames` is allowed up to 65535, `numJoints` up to 256 and `numAnimatedComponents` may be 0, so a frame is just `frame N {}`. Each still builds `localJoints` and `joints` for all joints.
  - `md5.ts` measured 62 KB of text with 2000 frames producing +234 MB RSS retained in 247 ms. Linear scaling to the 65535-frame limit gives about 2 MB of text and about 7.6 GB. The text also compresses heavily in a PK3.
- Impact: A small rerelease-style `.md5anim` exhausts memory.
- Remediation: Derive posed joints lazily or into typed arrays, and cap `frames * joints` against input length or an absolute budget.

### FORMATS-010 — PNG/TGA/BMP/PCX have only a 2 GiB cap and no game-scale dimension limit
- **Verification (VERIFY-F): confirmed-with-changes. Final severity: Medium.** PNG (png.ts:69), TGA (tga.ts:18) and PCX (indexed.ts:16-20) have only the 2 GiB rule. The QW skin claim is wrong: src/app/bootstrap/network/qw-skins.ts:41 (the cited path is also wrong) returns null when xmax >= 320 or ymax >= 200 before decodePcx, so the "server-influenced QW skin" impact does not hold. The Q2 skin and other decodePcx callers remain unguarded.
- Severity: Medium
- Category: security
- Location: src/formats/images/png.ts:69, 76-84, 87; src/formats/images/tga.ts:18, 44; src/formats/images/indexed.ts:16-20, 68; src/formats/images/q3-tga.ts:96-99
- Confidence: traced
- Evidence:
  - `png.ts:69`: `width * height * 4 > 0x7fffffff` is the only size rule. With 16-bit RGBA, `rawLength` reaches about 4.3 GB, inflated in one synchronous call at the measured 1029:1 from about 4.2 MB of IDAT, plus up to 2 GB of pixels.
  - PCX allows 46340x46340 (`dimensions`) at a 31:1 RLE ratio. `tga.ts` runs up to 129:1 with `pixels.set` per pixel.
  - The Q3 PCX path has an original 1024 limit (`q3-pcx.ts:35`), but the shared `indexed.ts` decoder used by Q2 and QW skins (`network/qw-skins.ts:42`) does not.
- Impact: Single textures can force gigabytes of allocation. QW skins come from a server-influenced path.
- Remediation: One shared `maxDecodedImagePixels` guard in every decoder, tighter for skins. FORMATS-001 and FORMATS-002 need the same guard.

### FORMATS-011 — KEX save `gunzipSync` is unbounded and runs on save-menu refresh
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/persistence/kex-q2-save.ts:65 `gunzipSync(await Bun.file(path).bytes())` has no maxOutputLength. Only externalDirectories reach it: startup-saves.ts scan of this.directory skips `.pak.gz`, and the external loop collects them, then :103 decodes each uncached row with no user selection.
- Severity: Medium
- Category: security
- Location: src/persistence/kex-q2-save.ts:65; src/app/bootstrap/startup-saves.ts:83-86, 103
- Confidence: reproduced (no cap); traced (trigger)
- Evidence:
  - `pak = gunzipSync(await Bun.file(path).bytes());` passes no `maxOutputLength`. `inflate.ts` measured 203,873 bytes producing 209,715,200 bytes in 307 ms.
  - `startup-saves.ts:103` decodes each `.pak.gz` found in `externalDirectories` when listing saves. No user selection is needed.
- Impact: A hostile file in a save directory blocks or kills the client when the save menu opens. That recurs until the file is removed, since the row cache is in memory.
- Remediation: Pass `maxOutputLength` (retail saves are small) and reject on overflow.

### FORMATS-012 — One unusual member name rejects an entire PAK/PK3, and any archive in a plan aborts the plan
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/content/archive/types.ts:61-63 throws RangeError for empty or "." segments, while `a/../b` normalizes. pak.ts:25 and zip.ts:74 call it per entry with no skip. mounts/index.ts:555-558 closes sources and rethrows.
- Severity: Medium
- Category: robustness
- Location: src/content/archive/types.ts:61-63; src/content/archive/pak.ts:25; src/content/archive/zip.ts:74; src/content/mounts/index.ts:555-558
- Confidence: reproduced
- Evidence:
  - `candidate.split("/").some(part => part === "" || part === ".")` throws `RangeError`, not `ArchiveError`.
  - `pak.ts` reproduction: `["maps/a.bsp","./maps/b.bsp"]`, `["maps/a.bsp","maps//b.bsp"]` and `["maps/a.bsp",""]` all gave `REJECT WHOLE ARCHIVE: RangeError`.
  - The rules are inconsistent: `a/../b` is accepted and normalized, `./a` is fatal. Original engines mount such archives and simply never resolve the odd entry.
  - `openMountPlan` rethrows on any failure.
- Impact: Community mods packed with `./` prefixes or doubled slashes cannot load. A single bad addon archive breaks the product plan containing it.
- Remediation: Skip the unsafe entry with a diagnostic, keeping its ordinal, instead of failing the archive. Treat `.` and empty segments as normalizable.

### FORMATS-013 — Settings schema errors abort startup; there is no migration and truncated files silently reset
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/settings/config.ts:136 returns null on non-JSON, and :169-174 loadSeat then yields null. parseSeatSettings (:97-102) throws on a missing required field such as rumble. configuration.ts:100 and input.ts:305 await loadSeat in Promise.all with no guard. The only version logic is `input["version"] !== 1`.
- Severity: Medium
- Category: robustness
- Location: src/settings/config.ts:97-102, 136, 169-174; src/app/bootstrap/configuration.ts:99-103; src/app/bootstrap/input.ts:305
- Confidence: traced
- Evidence:
  - `loadSeat` swallows non-JSON via `ConfigStore.parsed` (`catch { return null; }`) and the next save overwrites the file with defaults, keeping no backup.
  - Valid JSON with any missing or invalid field throws from `parseSeatSettings`. For example `boolean(input["rumble"])` is required, and `validateGamepadTuning` throws.
  - `configuration.ts:100` awaits `settings.loadSeat(...)` in a `Promise.all` with no guard, unlike `frontend-preferences.ts:136`, which wraps `loadGlobalTuning`.
  - The only version logic is `input["version"] !== 1`, so a future required field has no upgrade route.
- Impact: One bad value in `input/seat-N.json` blocks launch until the user finds and deletes the file. A truncated file silently loses all bindings.
- Remediation: Quarantine the file (rename to `.bad`) and load defaults, consistently for both failure types, and add per-field defaults or a migration step.

### FORMATS-014 — Settings `writeAtomic` is not crash-durable
- **Verification (VERIFY-F): confirmed-with-changes. Final severity: Low.** src/settings/config.ts:123-131 has no file.sync or directory fsync, contrasting persistence/save-policy.ts:62,64. A truncated or empty file is never valid JSON, so the outcome is only the silent reset branch of config.ts:136, not the "blocks startup" branch the finding adds. Power loss only, settings only, hence Low.
- Severity: Medium
- Category: robustness
- Location: src/settings/config.ts:123-131 (contrast src/persistence/save-policy.ts:62, 64)
- Confidence: traced
- Evidence: `try { await file.writeFile(contents); } finally { await file.close(); } await rename(temporary, path);`. There is no `file.sync()` and no directory fsync. `writeContainedSave` and `weapon-behavior-tool.ts:73` both do sync. The path also has no symlink containment, because `settingsPath` is lexical only.
- Impact: Power loss after rename can leave an empty or truncated `seat`, `config` or server profile. FORMATS-013 then discards it silently or blocks startup.
- Remediation: `await file.sync()` before rename and fsync the parent directory. Reuse one durable-write helper across settings, LLM settings and player progress.

### FORMATS-015 — JPEG decode throughput is 5.8 MP/s using Map-based Huffman and per-MCU allocation
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/formats/images/jpeg.ts:160-176 uses Map lookups per code length, :743 allocates `pending` per MCU, :977-991 sample() runs per pixel per channel, and scene/textures.ts:232 decodes synchronously. Throughput figure not re-measured.
- Severity: Medium
- Category: performance
- Location: src/formats/images/jpeg.ts:160-176, 498-504, 743, 977-991; src/render/scene/textures.ts:232
- Confidence: reproduced
- Evidence:
  - `table.get((1 << length) + (look >>> (8 - length)))` runs up to eight Map lookups per symbol. `const pending: {...}[] = [];` allocates one array per MCU, and `sample()` is called per pixel per channel.
  - `jpegperf.ts` measured 4.19 MP, 1.91 MB, in 718 ms: 5.8 MP/s, 2.66 MB/s. Decoding is synchronous on the main thread.
- Impact: High-resolution JPEG texture packs add seconds of map-load stall. The same code makes the FORMATS-001 stall worse.
- Remediation: Use array lookahead tables as jdhuff does, reuse the pending buffer, and write planes without per-sample calls.

### FORMATS-016 — Save listing fully decodes every save
- **Verification (VERIFY-H): confirmed. Final severity: Low.** startup-saves.ts:120 runs full readSavedGame for uncached files; save-image.ts:83-88 decodes the whole file; the cache at :90-92 is keyed by mtime and size.
- Severity: Low
- Category: performance
- Location: src/app/bootstrap/startup-saves.ts:88-92, 120; src/persistence/save-image.ts:83-88; src/persistence/value.ts:33, 79
- Confidence: traced
- Evidence: Each new or changed file goes through the full `readSavedGame`, which runs JSON parse, base64 decode and the complete schema, including guest memory regions. There is no header section, and only map, game and label are displayed. Results are cached per file by mtime and size for the session.
- Impact: Large native-guest saves make the first menu open slow.
- Remediation: Add a small metadata header to the v3 envelope, read separately.

### FORMATS-017 — Loose lookups rescan directories per probe; case collisions throw out of texture fallback
- **Verification (VERIFY-H): confirmed. Final severity: Low.** paths.ts:35 readdirs per component and :39 throws on ambiguity; mounts/index.ts:314 bypasses #listing; textures.ts:177 reads outside the try at :182.
- Severity: Low
- Category: performance
- Location: src/content/mounts/paths.ts:35-44; src/content/mounts/index.ts:314, 379-390; src/render/scene/textures.ts:177, 182
- Confidence: traced
- Evidence:
  - `findContentPath` calls `readdir(current)` per path component per read, and only `exists()` uses the `#listings` cache.
  - `throw new Error("Ambiguous content path...")` fires when two names differ only by case and neither is an exact match. `textures.ts:177` awaits the read outside the `try` that starts at line 182, so this aborts the load instead of skipping the candidate.
- Impact: Loads are slower with large loose mod directories and several texture extension candidates. A Linux-unpacked mod with case-colliding files can fail its map load.
- Remediation: Route `#readSource` through the listing cache and pick deterministically, or log, on case collisions.

### FORMATS-018 — Decoded maps and models retain duplicate raw bytes
- **Verification (VERIFY-H): confirmed. Final severity: Low.** BinaryReader.bytes copies (core/binary/index.ts:69-71), so q1-map/index.ts:92 and :114, :127 duplicate data. No src consumer of Q1Map.lumps outside formats (other .lumps hits are WAD). md3.ts:290 and md4.ts:182 slice.
- Severity: Low
- Category: performance
- Location: src/formats/q1-map/index.ts:92, 114, 127, 119; src/formats/q2-map/reader.ts:127; src/formats/q3-model/md3.ts:290; src/formats/q3-model/md4.ts:182
- Confidence: traced
- Evidence:
  - `lumps.push({ name, offset, length, data: reader.section(offset, length).bytes(length) })` copies every lump, then `bytes()` copies lighting and visibility again and `extensions` keeps BSPX. A grep found no `.lumps` consumer on `Q1Map` in `src` outside formats.
  - MD3 and MD4 also keep `bytes: data.slice(0, end)` next to the parsed objects.
- Impact: About twice the file size retained per loaded map, on top of object-heavy records.
- Remediation: Keep views only during parsing and drop `lumps.data` from the retained record.

### FORMATS-019 — OGV reads the whole file before its size limit, then duplicates packets
- **Verification (VERIFY-H): confirmed. Final severity: Low.** playback.ts:92 calls readMedia, which allocates at source.ts:53, before ogg.ts:32 checks the limit. ogg.ts:66 and :90 join copies.
- Severity: Low
- Category: performance
- Location: src/media/playback.ts:92; src/media/ogg.ts:32, 66, 90
- Confidence: traced
- Evidence: `new OgvPlayback(readMedia(input, 0, input.byteLength), ...)` allocates before `if (bytes.length > 512 * 1024 * 1024) throw`, and `join(...)` then copies each packet. CRC runs per byte synchronously. RoQ and CIN do stream.
- Impact: A large file allocates fully before rejection, peak memory is about twice the file size, and movie start stalls.
- Remediation: Check `input.byteLength` first, and index packets as `subarray` views.

### FORMATS-020 — Classic native save overlay grows by copying on every write
- **Verification (VERIFY-H): confirmed. Final severity: Low.** q2-classic-guest.ts:123 reallocates to the exact end on each extending write. No cap beyond the range validation. Not measured with a retail save.
- Severity: Low
- Category: performance
- Location: src/persistence/q2-classic-guest.ts:123
- Confidence: plausible
- Evidence: `if (end > owned.bytes.length) { const grown = new Uint8Array(end); grown.set(owned.bytes); owned.bytes = grown; }` is quadratic in sequential `fwrite` calls. `g_save.c` writes per struct and per string. The cost was not measured with a retail DLL. Guest-chosen offsets also allocate directly, with `range` checking only safe-integer validity.
- Impact: Hitch on native-DLL saves and level transitions.
- Remediation: Use geometric growth with a tracked length, and a maximum save size.

### FORMATS-021 — Q1 PVS corruption is detected at runtime, not at load
- **Verification (VERIFY-H): confirmed. Final severity: Low.** q1-map/index.ts:155 validates only the start offset. queries.ts:14-18 throws on truncation or bad zero runs at first query, from visibility.ts:149 and collision q1/index.ts:281. No catch at those sites.
- Severity: Low
- Category: robustness
- Location: src/formats/q1-map/queries.ts:7-22 (file-relative), called from src/render/scene/visibility.ts:149 and src/world/collision/q1/index.ts:281
- Confidence: plausible
- Evidence: `validateReferences` checks only each leaf's start offset. A truncated row or oversized zero run throws `BinaryError` from `decompressQ1Pvs` on the first query of that leaf, in-frame or mid-trace. The outer frame guard for this path was not verified.
- Impact: A malformed map loads, then throws when the player reaches a particular leaf.
- Remediation: Decode all rows once at load, or treat a bad row as all-visible with a diagnostic, as tolerant source ports do.

### FORMATS-022 — Validators have overlap amplification from attacker-chosen ranges
- **Verification (VERIFY-H): confirmed. Final severity: Low.** decode.ts:262-265 and :271-275 walk each surface's full range with no overlap or total budget. ibsp44.ts:84-100 walks nodes per model with fresh visited sets.
- Severity: Low
- Category: performance
- Location: src/formats/q3-map/decode.ts:262-265, 271-275; src/formats/q3-map/ibsp44.ts:84-100
- Confidence: traced
- Evidence: Each surface loops over its full `firstVertex..+vertexCount` and index range, and ranges may overlap freely. The cost is surfaces times vertices, so a file of tens of MB can cost billions of operations. IBSP44 repeats a full node walk per model.
- Impact: Load-time CPU DoS from mid-sized crafted maps.
- Remediation: Use a summed-count budget, or a difference array for the lightmap-use check.

### FORMATS-023 — Rerelease save JSON parser is about 9x slower than `JSON.parse`
- **Verification (VERIFY-H): confirmed. Final severity: Low.** source-json.ts:18 regex per character; :54 array literal per value; :57 slice per number. The timing ratio was not re-measured.
- Severity: Low
- Category: performance
- Location: src/persistence/source-json.ts:18, 54, 57
- Confidence: reproduced
- Evidence: A regex runs per whitespace character, an array literal is built per value, and `text.slice(offset)` runs per number. `sjson.ts` measured a 23 MB document at 1591 ms against 167 ms for `JSON.parse`, and 6 MB at 420 ms against 48 ms. The custom parser exists for lossless numbers, so `JSON.parse` is not a drop-in replacement.
- Impact: Slower rerelease save loads and level transitions.
- Remediation: Use char-code scanning, a sticky regex with `lastIndex`, and hoisted literals.

### FORMATS-024 — Exported `lookupQ2Lightgrid` duplicate lacks the runtime's guard
- **Verification (VERIFY-H): confirmed. Final severity: Low.** bspx.ts:184 skips validation with zero leaves, and lookup at :200-211 loops on a self-referencing root. The live materials path guards at q2-lightgrid.ts:46. Only retail.test.ts:7 uses the bspx copy.
- Severity: Low
- Category: dead-code
- Location: src/formats/q2-map/bspx.ts:184, 200-211; src/materials/q2-lightgrid.ts:8-9, 46
- Confidence: traced
- Evidence:
  - The octree check is skipped when there are no leaves: `while (pending.length > 0 && leaves.length > 0)`. A self-referencing root then loops forever in `bspx.ts` lookup.
  - The live path was checked and is not vulnerable: `q2LightGridPoint` returns early with `if (grid.leaves.length === 0) return null;`.
  - The `bspx.ts` copy has only a test caller (`tests/formats/q2-map/retail.test.ts:7`). The `materials` comment "The map decoder validates the octree" is true only conditionally.
- Impact: Two implementations with differing semantics, and one latent hang.
- Remediation: Delete one copy, and validate cycles regardless of leaf count.

### FORMATS-025 — Unused `writeSaveImage` has weaker guarantees than its production counterpart
- **Verification (VERIFY-H): confirmed. Final severity: Low.** save-image.ts:91-95 has no fsync or containment. It has no src callers; only tests call it. writeContainedSave (save-policy.ts:48) is the production path.
- Severity: Low
- Category: dead-code
- Location: src/persistence/save-image.ts:89-95
- Confidence: traced
- Evidence: `await Bun.write(temporary, ...); await rename(temporary, path);` has no fsync and no containment. A grep found no callers in `src` outside persistence, only tests. Tests exercising it therefore validate a different code path than the shipped `writeContainedSave`.
- Impact: Misleading comment, and a tempting wrong helper.
- Remediation: Remove it, or route it through `writeContainedSave`.

### FORMATS-026 — Digest cache uses a fixed temp filename and never prunes
- **Verification (VERIFY-H): confirmed. Final severity: Low.** mounts/index.ts:72-73 uses a fixed temp name, and the map only gains entries (:69). loadDiskDigests resets to empty on parse failure. Interleaving was not reproduced.
- Severity: Low
- Category: robustness
- Location: src/content/mounts/index.ts:69, 72-73
- Confidence: traced
- Evidence: `await writeFile(\`${file}.tmp\`, ...)` is not unique per process, so a client plus a dedicated server can interleave writes. A torn result then fails `JSON.parse`, the cache resets, and the next launch rehashes gigabytes. Entries for deleted archives are kept forever because the disk map is only ever added to.
- Impact: Occasional slow startup and slow cache growth.
- Remediation: Use a unique temp name and drop entries not seen this run.

### FORMATS-027 — Path containment checks hardcode `../`
- **Verification (VERIFY-J): confirmed. Final severity: Info.** settings/config.ts:120 and archive/loose.ts:21 hardcode "../", while mounts/paths.ts:16 uses sep. roots.ts:137 has B:/~BUN/, and contained.ts:12 throws off Linux.
- Severity: Info
- Category: maintainability
- Location: src/settings/config.ts:120; src/content/archive/loose.ts:21 (contrast src/content/mounts/paths.ts:16)
- Confidence: traced
- Evidence: `child.startsWith("../")` while `pathWithinRoot` uses `` `..${sep}` ``. This is correct on Linux and would miss `..\` on Windows. `roots.ts:137` carries a `B:/~BUN/` Windows path, while `contained.ts:12` is Linux-only, so platform intent is mixed.
- Impact: None on the current Linux target. A traversal gap if Windows builds ship.
- Remediation: One shared containment helper using `sep`.

### FORMATS-028 — Malformed-input limits have no test coverage
- **Verification (VERIFY-H): confirmed-with-changes. Final severity: Low.** tests/formats has only the five cited directories, and no bomb or cycle tests exist there. Correction: tests/content/catalog/archive.test.ts is a dedicated archive suite, so "only as helpers" is wrong, but its three tests cover ordering, containment and changed bytes, not hostile limits.
- Severity: Low
- Category: test-gap
- Location: tests/formats/ (q12-model, q1-map, q2-map, q3-map, q3-model), tests/materials/images.test.ts
- Confidence: traced
- Evidence: A grep for `bomb`, `maxOutputLength` and `cycle` tied to jpeg, gif, png, zip, pk3, pak, kex or bsp found no such tests. `tests/formats/q*-map` contains no cycle test at all. There is no `tests/formats/images` or dedicated archive directory; archive APIs appear only as helpers inside other suites. Parsers have happy-path and some truncation coverage (for example `tests/formats/q1-map/read.test.ts:35-36`).
- Impact: The findings above would not be caught, and fixes have no regression protection.
- Remediation: Add table-driven hostile-input tests with memory and time budgets for each decoder. The scripts in `scripts/formats/` can seed them.
