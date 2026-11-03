# Skipped tests

144 tests skipped in the full run. Every gate was resolved on this machine without a display: `SDL_VIDEODRIVER=offscreen` gives a working GL context (Mesa software) with `DISPLAY` and `WAYLAND_DISPLAY` unset, so no X server was needed and the owner's desktop was never used. Runs used the localized scratch runner (throwaway HOME, corpus bind-mounted read-only).

Outcome: 104 now run and pass; 40 still skip, each for the environment reason below (the SDL2-compat controller case now skips through the shared gate instead of failing).

Nothing is installed here that provides a private X server (`which Xvfb Xvnc xvfb-run` finds none), so the x11-only tests stay skipped.

Fixes made while running the opt-in gates (each was a stale test or a real defect found by running them):

- `src/render/worker-protocol.ts`: the worker image-journal acknowledgment kept the caller's update buffer instead of the private copy, so a later rewrite of that buffer corrupted what a renderer restart replays. Real defect; fixed. Covered by `tests/render/worker-native.test.ts` (cpu and gl).
- `tests/render/worker-native.test.ts`, `tests/first-playable/application/renderer-restart.test.ts`: stopped mutating creation buffers after registration (the journal now shares immutable creation content by design); closing a worker backend reports `Render worker is not open`.
- `tests/render/commands/world.test.ts`: the Q2 fixture root lacked `gamex86.dll`, now copied through `corpusFile`.
- `tests/first-playable/application/q2-native-original.test.ts`: copies the add-on files instead of symlinking (content links that leave the root are rejected by design).
- `tests/first-playable/world-text.test.ts`: asserts `images.cfg` does not hold `gl_debug_distfrac` rather than that the file is absent (display settings legitimately write it).
- `tests/first-playable/rerelease-flare-render.test.ts`: monsters now move, so seat comparisons use a magnitude bound; seats are thawed from the freeze (counts as an intermission, which blocks saving) before saving; save path inside the save directory.
- `tests/first-playable/debug-shapes.test.ts`: seats are put back in server before level travel (a frozen seat is an intermission with damage disabled).
- `tests/first-playable/q2-barrel-shadow.test.ts`: authored shadow lights are cone lights lit per fragment since the flashlight work; assertions updated accordingly.
- `tests/first-playable/held-weapon.test.ts`: the first-person gun sways between captures; comparisons exclude the gun's box.
- `tests/render/gl/fragment-clamping.test.ts`: the test line sat on a pixel-row boundary and software GL rasterised it on the other row; moved to a row centre (cpu and gl agree).

| file | test | gate | status |
|---|---|---|---|
| `tests/capture/application.test.ts` | local cpu console saves actual frames and snapshots settings before later commands | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | local gl console saves actual frames and snapshots settings before later commands | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | committed publication failure closes application during travel | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | committed publication failure closes application during load | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | committed publication failure closes application during queued-load | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | remote cpu console saves a real native Q2 server frame | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | remote gl console saves a real native Q2 server frame | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/capture/application.test.ts` | cancelled native readbacks do not wait for a future frame or survive renderer close | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/audio/round-reset.test.ts` | round reset clears the real dummy device queue without reopening output | `QUAKE_ROUND_AUDIO_DEVICE=1` | now runs and passes |
| `tests/app/startup-world.test.ts` | prepared skill controls first retail Q2 entity spawn | `QUAKE_STARTUP_RETAIL_TEST=1` | now runs and passes |
| `tests/compat/qc/weapon-stage.test.ts` | declared client calls execute copper Copper parameters, globals and entity results with nested staging restored | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-provider.test.ts` | QC source items share capacity fields while count and capacity aliases remain invalid (copper) | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-provider.test.ts` | copper Copper healing executes through declared actor callbacks in isolated mod instances | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-provider.test.ts` | copper Copper helper spawn and scheduled removal retain shared actor ownership across save | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-monster.test.ts` | copper Copper monster spawns, acquires a canonical Q2 client and runs source AI | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-input.test.ts` | copper Copper applied callbacks use effective input and retain private continuation in a Q2 world | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-commands.test.ts` | copper Copper console functions and localcmd retain component cvars and source ownership | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-combat.test.ts` | copper Copper combat owns health and authored pain/death callbacks inside shared Q2 authority | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/mod-clients.test.ts` | copper Copper client callbacks reserve edicts and retain private state and targeted stuffcmd through save | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/armor-stage.test.ts` | declared copper Copper helper debits only regular savings and preserves no-armor flags | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/armor-stage.test.ts` | declared copper Copper region supplies regular armor after power to original Hipnotic | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/armor-stage.test.ts` | copper Copper pickups decide refusal and publish each tier store during nested source damage | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/armor-stage.test.ts` | QC armor admission validates declared copper Copper statement control flow | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/qc/armor-stage.test.ts` | primary copper Copper declaration preserves five-argument damage, borrowed armor and saved identity | `variant.available`: Copper add-on `q1/rerelease/copper/progs.dat` (copperAvailable) | environment limit: Copper is an optional user-installed mod, absent from qfiles and Steam |
| `tests/compat/q2/rerelease/debug-shapes.test.ts` | initialized native guest debug imports reach the shared line owner through Microsoft x64 ABI | `QUAKE_DEBUG_SHAPES_NATIVE=1` | now runs and passes |
| `tests/compat/q2/rerelease/debug-shapes.test.ts` | initialized headless native guest accepts ten drawing imports while missing graphical bindings remain errors | `QUAKE_DEBUG_SHAPES_NATIVE=1` | now runs and passes |
| `tests/first-playable/q2-shadow-light.test.ts` | shared spotlight illuminates and restores actual q1-classic-id1 surfaces through cpu | `QUAKE_FLASHLIGHT_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-shadow-light.test.ts` | shared spotlight illuminates and restores actual q1-classic-id1 surfaces through gl | `QUAKE_FLASHLIGHT_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-shadow-light.test.ts` | shared spotlight illuminates and restores actual q2-rerelease-baseq2 surfaces through cpu | `QUAKE_FLASHLIGHT_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-shadow-light.test.ts` | shared spotlight illuminates and restores actual q2-rerelease-baseq2 surfaces through gl | `QUAKE_FLASHLIGHT_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-shadow-light.test.ts` | shared spotlight illuminates and restores actual q3-baseq3 surfaces through cpu | `QUAKE_FLASHLIGHT_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-shadow-light.test.ts` | shared spotlight illuminates and restores actual q3-baseq3 surfaces through gl | `QUAKE_FLASHLIGHT_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-md5.test.ts` | application-loaded Q2 MD5 renders real male, soldier, blaster and joint scales through cpu | `QUAKE_MD5_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-md5.test.ts` | application-loaded Q2 MD5 renders real male, soldier, blaster and joint scales through gl | `QUAKE_MD5_RENDER=1` | now runs and passes |
| `tests/first-playable/q2-barrel-shadow.test.ts` | base1 barrel cpu shadows preserve lighting and count effect lights once | `QUAKE_BARREL_SHADOW=1` | now runs and passes |
| `tests/first-playable/q2-barrel-shadow.test.ts` | base1 barrel gl shadows preserve lighting and count effect lights once | `QUAKE_BARREL_SHADOW=1` | now runs and passes |
| `tests/first-playable/held-weapon.test.ts` | Q2 blaster reaches Sarge and Visor through shared cpu attachments without changing first-person pixels | `QUAKE_HELD_WEAPON_APP=1` | now runs and passes |
| `tests/first-playable/held-weapon.test.ts` | Q2 blaster reaches Sarge and Visor through shared gl attachments without changing first-person pixels | `QUAKE_HELD_WEAPON_APP=1` | now runs and passes |
| `tests/first-playable/debug-shapes.test.ts` | typed rerelease debug calls reach both cpu seats, expire by presentation frame, and retire with the world | `QUAKE_DEBUG_SHAPES_APP=1` | now runs and passes |
| `tests/first-playable/debug-shapes.test.ts` | typed rerelease debug calls reach both gl seats, expire by presentation frame, and retire with the world | `QUAKE_DEBUG_SHAPES_APP=1` | now runs and passes |
| `tests/first-playable/network/q2-enhanced-remote.test.ts` | normal remote application joins the reference R1Q2 server over localhost UDP | `QUAKE_Q2_DONOR_ROOT` (reference R1Q2 server build) | environment limit: no reference R1Q2 server on this machine |
| `tests/first-playable/network/q2-demo.test.ts` | installed protocol34 recording prepares bare precache and advances through its actual EOF | `existsSync(corpusFile(q2/ctf/demos/2014-01-07-2001-lfctf1.dm2))` | environment limit: that recording is absent; q2/ctf has no demos directory and the lmctf demos are different recordings the test's frame assertions do not describe |
| `tests/first-playable/network/download-workflow.test.ts` | public download controls survive native cancellation and HTTP package remount with fallback on travel | `QUAKE_DOWNLOAD_WORKFLOW_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-native.test.ts` | actual first world consumes wait-completed difficulty and capacity | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-native.test.ts` | actual map replacement resumes mounted exec and later ordinary exec on current content | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-native.test.ts` | closing before pending startup completes preserves source client mouse and image archives | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-native.test.ts` | q1-classic-id1 actual QC source retains bare skill across map replacement | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-native.test.ts` | q1-quakeworld actual QC source retains bare skill across map replacement | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-cli-native.test.ts` | q1-classic-id1 actual CLI map wait tail follows donor stuffcmds order | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-cli-native.test.ts` | q1-quakeworld actual CLI map wait tail follows donor stuffcmds order | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-cli-native.test.ts` | Q2 actual CLI early set survives config and resolves first-world skill | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/startup-cli-native.test.ts` | Q3 actual safe startup skips saved config and exposes forced variables to autoexec | `QUAKE_STARTUP_NATIVE_TEST=1` | now runs and passes |
| `tests/first-playable/application/renderer-restart.test.ts` | retained cpu renderer stages, discards and publishes resource replacement | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/first-playable/application/renderer-restart.test.ts` | retained gl renderer stages, discards and publishes resource replacement | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/first-playable/application/renderer-restart.test.ts` | failed GL resource replay restores the old context and renderer | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/first-playable/application/renderer-restart.test.ts` | restart preserves latest mip pixels and texture-mode ordering around later creations | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/first-playable/application/q3-selected-clock.test.ts` | q2-rerelease-baseq2 menu Play samples fractional elapsed into the selected Q3 presentation clock | `QUAKE_GL_SMOKE=1` (glTest) | now runs and passes |
| `tests/first-playable/application/q3-selected-clock.test.ts` | q2-classic-baseq2 menu Play samples fractional elapsed into the selected Q3 presentation clock | `QUAKE_GL_SMOKE=1` (glTest) | now runs and passes |
| `tests/first-playable/application/q2-native-original.test.ts` | discovered Q2 add-on launches its mounted DLL and full authored map through Application | `QUAKE_Q2_NATIVE_APP=1` | now runs and passes |
| `tests/first-playable/application/player-death.test.ts` | actual application death stays animated, pauses load browser and recovers through queued world replacement | `QUAKE_DEATH_APPLICATION_TEST=1` | now runs and passes |
| `tests/first-playable/application/mixed-weapon-wheel.test.ts` | Q1 world with Q3 arsenal and Q2 rerelease monsters renders the weapon wheel | `QUAKE_PRIVATE_NATIVE=1` | now runs and passes |
| `tests/first-playable/application/frame-time-native-remote.test.ts` | actual Q3 UDP peer retains wall transport and scaled client command clocks | `QUAKE_GL_SMOKE=1` (glTest) | now runs and passes |
| `tests/first-playable/application/frame-time-native-local.test.ts` | actual local Q3 doubled time, camera freeze and resume | `QUAKE_GL_SMOKE=1` (glTest) | now runs and passes |
| `tests/first-playable/application/base-arena-public.test.ts` | public Q3 training selection launches skill four Crash and accepts live controls | `QUAKE_ARENA_PUBLIC_TEST=1` | now runs and passes |
| `tests/first-playable/application/addon-library-menu.test.ts` | public add-on library installs cached authored package, launches GL world, returns Main and shows Q3 tiers | `QUAKE_ADDON_ASSETS` and `QUAKE_ADDON_OUTPUT` (cached public add-on package zip, digest 4108605842...) | environment limit: the cached package zip is not on this machine |
| `tests/first-playable/world-text.test.ts` | native info_world_text reaches cpu seats and clears with the world | `QUAKE_WORLD_TEXT_APP=1` | now runs and passes |
| `tests/first-playable/world-text.test.ts` | native info_world_text reaches gl seats and clears with the world | `QUAKE_WORLD_TEXT_APP=1` | now runs and passes |
| `tests/first-playable/startup-video-layout.test.ts` | startup Display keeps renderer and Apply visible on one normal-sized page | `QUAKE_GL_SMOKE=1` (glTest) | now runs and passes |
| `tests/first-playable/startup-selection.test.ts` | Mods menu exposes installed components across provider families and retains independent selections | `QTS_TEST_INSTALLED_WEAPON_BEHAVIORS=1` and installed weapon-behavior components in the user content root | environment limit: the QC, QVM and rerelease-native components are owner-installed mods in ~/.local/share/quake-typescript (off limits); with the gate set and the corpus only, no component is found |
| `tests/first-playable/selected-movement-input.test.ts` | startup-selected QuakeWorld movement drives the normal mixed-game application | `QUAKE_GL_SMOKE=1` (glTest) | now runs and passes |
| `tests/first-playable/rerelease-flare-render.test.ts` | unchanged q64/rtest cpu draws authored flares for two seats | `QUAKE_FLARE_RENDER=1` | now runs and passes |
| `tests/first-playable/rerelease-flare-render.test.ts` | unchanged q64/rtest gl draws authored flares for two seats | `QUAKE_FLARE_RENDER=1` | now runs and passes |
| `tests/first-playable/rerelease-flare-render.test.ts` | CPU and GL apply flare luminance after bilinear sampling and reset the ordinary draw | `QUAKE_FLARE_RENDER=1` | now runs and passes |
| `tests/guest/elf/quakelive.test.ts` | supplied Quake Live qagamei386.so maps and relocates in guest memory | `existsSync(corpusFile(quakelive/baseq3/bin.pk3))` | environment limit: Quake Live is not installed (no bin.pk3 anywhere under qfiles or Steam) |
| `tests/guest/elf/quakelive.test.ts` | supplied Quake Live qagamex64.so maps and relocates in guest memory | `existsSync(corpusFile(quakelive/baseq3/bin.pk3))` | environment limit: Quake Live is not installed (no bin.pk3 anywhere under qfiles or Steam) |
| `tests/gameplay/q1-base/base.test.ts` | id1 monster precaches match native spawn declaration order and inhibition | `QTS_Q1_QC_SOURCE` (id1 QC source directory) | environment limit: id's QC source is not on this machine |
| `tests/formats/q3-model/retail.test.ts` | real MD4 fixture remains unavailable in the supplied corpus; synthetic layout is tested separately | unconditional `test.skip`: real MD4 fixture | environment limit: no MD4 model exists in the supplied corpus (documented in the test) |
| `tests/formats/q3-map/retail.test.ts` | installed Q3 test BSP44 shares render and collision model ownership | `existsSync(q2/baseq2/pak6.pak)` | environment limit: baseq2/pak6.pak (maps/q3test1.bsp) is in neither qfiles nor the Steam install; q2/lmctf/pak6.pak is an unrelated env-texture pack |
| `tests/first-playable/simulation/q2-viewweapon.test.ts` | actual Q1 weapon on a rerelease Q2 character shares the final source camera anchor | `QUAKE_VIEWWEAPON_RENDER=1` | now runs and passes |
| `tests/guest/runtime/system-v/runtime.test.ts` | real qagamei386.so completes all ELF initializers and finalizers | `existsSync(corpusFile(quakelive/baseq3/bin.pk3))` | environment limit: Quake Live is not installed (no bin.pk3 anywhere under qfiles or Steam) |
| `tests/guest/runtime/system-v/runtime.test.ts` | real qagamex64.so completes all ELF initializers and finalizers | `existsSync(corpusFile(quakelive/baseq3/bin.pk3))` | environment limit: Quake Live is not installed (no bin.pk3 anywhere under qfiles or Steam) |
| `tests/text/world.test.ts` | world text triangles render with alpha and optional depth on offscreen GL | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/worker-native.test.ts` | native cpu serial and worker preserve pixels, callbacks and restart lifetime | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/worker-native.test.ts` | native gl serial and worker preserve pixels, callbacks and restart lifetime | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/worker-native.test.ts` | native worker failure rejects an armed capture without another frame or barrier | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/platform/window-runner.test.ts` | private Xvfb exercises real CPU presentation, OpenGL and pushed events | `Bun.which("Xvfb")` | environment limit: no Xvfb, Xvnc or xvfb-run installed (Xwayland exists but needs a compositor, i.e. the owner's desktop) |
| `tests/platform/window-native.test.ts` | test process uses its explicitly owned display | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | CPU presentation preserves exact pixels and copies typed-array subviews | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | real pushed events retain key, mouse, window and quit fields | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | events stay with their window and closing one preserves the other | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | invalid startup and closed handles fail at the boundary | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | repeated window startup releases all window resources | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | window polling preserves controller events and independent audio lifetime | `sdlVirtualCallbackMismatch` (tests/support/sdl-compat.ts, shared with controller.test.ts) | environment limit: the installed SDL2-compat (2.32.72) drops virtual-controller input; skips with that reason instead of failing |
| `tests/platform/window-native.test.ts` | partial GL startup failure leaves a CPU window usable | `QUAKE_PLATFORM_NATIVE_TEST=1` (dummy driver) | now runs and passes (dummy video driver, no display) |
| `tests/platform/window-native.test.ts` | real GL procedures clear, read back, swap and retain context lifetime | `QUAKE_PLATFORM_NATIVE_TEST=1`, `SDL_VIDEODRIVER=x11` | environment limit: needs a private X11 display; none available |
| `tests/platform/window-native.test.ts` | GLSL 120 compiles, links and draws through native client arrays | `QUAKE_PLATFORM_NATIVE_TEST=1`, `SDL_VIDEODRIVER=x11` | environment limit: needs a private X11 display; none available |
| `tests/platform/window-headless.test.ts` | loading the application entry maps no graphics or media native libraries | `QUAKE_PLATFORM_HEADLESS_TEST=1` | now runs and passes (run alone: other native tests map SDL in the same process) |
| `tests/platform/window-context.test.ts` | real render worker adopts one context, draws, rejects duplicates and releases before cleanup | `QUAKE_PLATFORM_NATIVE_TEST=1` and `SDL_VIDEODRIVER=x11` | environment limit: needs a private X11 display; none available |
| `tests/platform/controller.test.ts` | native virtual rumble is accepted and stops on reassignment and close; blocked on SDL2-compat 2.32.70 | `virtualCallbackMismatch` (SDL2-compat >= 2.32.70) | environment limit: installed SDL2-compat has the virtual-callback incompatibility the test names |
| `tests/platform/controller.test.ts` | physical motor output and gyro/touchpad sampling require a connected physical controller and observation | unconditional `test.skip` | environment limit: requires a connected physical controller and observation |
| `tests/persistence/source-saves.test.ts` | reads and rewrites the actual WinQuake reference save without losing edict fields | `QTS_TEST_Q1_REFERENCE_SAVE` / `QTS_TEST_Q2_REFERENCE_SAVE_DIR` | environment limit: no WinQuake or q2repro rerelease-format reference save available |
| `tests/persistence/source-saves.test.ts` | roundtrips actual q2repro rerelease engine and game saves | `QTS_TEST_Q1_REFERENCE_SAVE` / `QTS_TEST_Q2_REFERENCE_SAVE_DIR` | environment limit: no WinQuake or q2repro rerelease-format reference save available |
| `tests/persistence/saved-game.test.ts` | actual installed Quake source saves identify format and preserve extensions | `corpusHasFile(q1/id1/autosave/start.sav)` | environment limit: written only by playing in the rerelease install; absent |
| `tests/persistence/provider-ownership.test.ts` | actual public save campaign envelope passes source validation without weakening foreign-provider checks | `QTS_SAVE_PROVIDER_FIXTURE` | environment limit: no public save-campaign fixture available |
| `tests/persistence/kex-saves.test.ts` | the installed steam q1 save decodes and roundtrips its world records | Nightdive Steam Saved Games found through `homedir()` (s1.sav, baseq2/save/save0.pak.gz) | environment limit: both files exist under Steam compatdata, but the hermetic test preload points homedir() at a throwaway directory so the owner's profile cannot be read; by design |
| `tests/persistence/kex-saves.test.ts` | the installed steam q2 save identifies its map and game | Nightdive Steam Saved Games found through `homedir()` (s1.sav, baseq2/save/save0.pak.gz) | environment limit: both files exist under Steam compatdata, but the hermetic test preload points homedir() at a throwaway directory so the owner's profile cannot be read; by design |
| `tests/media/cinematic.test.ts` | shipped Team Arena videoMap executes through shared cpu world materials | `QUAKE_MEDIA_NATIVE=1` and `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/media/cinematic.test.ts` | shipped Team Arena videoMap executes through shared gl world materials | `QUAKE_MEDIA_NATIVE=1` and `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/media/cinematic.test.ts` | installed rerelease OGV decodes Theora frames and synchronized Vorbis through the shared media owner | `QUAKE_MEDIA_NATIVE=1` | now runs and passes |
| `tests/media/cinematic.test.ts` | original rerelease OGV checkpoint reconstructs its exact packet prefix with identical future pixels and PCM | `QUAKE_MEDIA_NATIVE=1` | now runs and passes |
| `tests/materials/image-resolution.test.ts` | actual weapon HUD keeps authored icon aspect across replacement refresh | `QUAKE_IMAGE_HUD=1` | now runs and passes |
| `tests/materials/image-resolution.test.ts` | actual MD2 custom skins use every shared image format through cpu | `QUAKE_IMAGE_HUD=1` | now runs and passes |
| `tests/materials/image-resolution.test.ts` | actual MD2 custom skins use every shared image format through gl | `QUAKE_IMAGE_HUD=1` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed media/lrctf_logo-small_animated.gif shared q1 material cpu | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed media/lrctf_logo-small_animated.gif shared q1 material gl | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed media/lrctf_logo-small_animated.gif shared q2 material cpu | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed media/lrctf_logo-small_animated.gif shared q2 material gl | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed media/lrctf_logo-small_animated.gif shared q3 material cpu | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed media/lrctf_logo-small_animated.gif shared q3 material gl | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed help/images/flaming_logo.gif shared q1 material cpu | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed help/images/flaming_logo.gif shared q1 material gl | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed help/images/flaming_logo.gif shared q2 material cpu | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed help/images/flaming_logo.gif shared q2 material gl | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed help/images/flaming_logo.gif shared q3 material cpu | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/materials/animated-images.test.ts` | installed help/images/flaming_logo.gif shared q3 material gl | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/ui/hud/splitscreen-readability.test.ts` | actual cpu status capture 320x240 | `QUAKE_HUD_READABILITY_APP=1` | now runs and passes |
| `tests/ui/hud/splitscreen-readability.test.ts` | actual cpu status capture 1280x720 | `QUAKE_HUD_READABILITY_APP=1` | now runs and passes |
| `tests/ui/common/native-ui.test.ts` | SDL menu clicks use their own coordinates and native motion drags sliders | `QUAKE_UI_NATIVE_SMOKE=1` | now runs and passes |
| `tests/render/gl/smoke.test.ts` | indexed depth atlas retains client state, ordered runs and oversized triangles | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/gl/smoke.test.ts` | GLSL stages, shadow atlases, ordered fog and renderer restart | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/gl/smoke.test.ts` | GL output gamma follows blending and preserves raw buffers across capture, resize and disable | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/gl/smoke.test.ts` | stage uniform values preserve native state across changes, rejected inputs and restart | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/gl/fragment-clamping.test.ts` | gl triangles clamps lit source color before fixed framebuffer blending | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/gl/fragment-clamping.test.ts` | gl lines clamps lit source color before fixed framebuffer blending | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/gl/buffer-reuse.test.ts` | GL retained prepared buffers, failure cleanup and close preserve fresh color and depth | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/commands/world.test.ts` | prepares and draws q2/baseq2/pak6.pak:maps/q3test1.bsp | `existsSync(q2/baseq2/pak6.pak)` | environment limit: baseq2/pak6.pak (maps/q3test1.bsp) is in neither qfiles nor the Steam install; q2/lmctf/pak6.pak is an unrelated env-texture pack |
| `tests/render/commands/world.test.ts` | authored movie override on unchanged q1 surfaces uses shared cpu materials | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/render/commands/world.test.ts` | authored movie override on unchanged q1 surfaces uses shared gl materials | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/render/commands/world.test.ts` | authored movie override on unchanged q2 surfaces uses shared cpu materials | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/render/commands/world.test.ts` | authored movie override on unchanged q2 surfaces uses shared gl materials | `SDL_VIDEODRIVER=offscreen` | now runs and passes |
| `tests/render/commands/shadows.test.ts` | GL draws the shared cone and cube caster operations | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/commands/shadows.test.ts` | GL retains growing cone-axis casters and rejects a sphere outside the cone | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/render/commands/shadows.test.ts` | GL model spotlight preserves point shadows, skin modulation and alpha | `QUAKE_GL_SMOKE=1` | now runs and passes |
| `tests/network/q2/demo-header.test.ts` | installed CTF34 header selects recorded directory independent of current game | `existsSync(corpusFile(q2/ctf/demos/2014-01-07-2001-lfctf1.dm2))` | environment limit: that recording is absent; q2/ctf has no demos directory and the lmctf demos are different recordings the test's frame assertions do not describe |

**Owner decision (2026-11-03):** the 40 remaining environment-limited skips listed here are accepted as skips for now.
