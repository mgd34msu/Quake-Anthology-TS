# Native application

Run the unified application with Bun:

```sh
bun start --preset q2-q1-q3
bun start --preset q1-q2
bun start --renderer cpu --width 640 --height 480
bun start --seats 2 --mode coop
bun start --dedicated
bun start --game q3-baseq3 --map q3dm1 --movement q3 --character q3 --mode deathmatch
bun start --game q2-classic-baseq2 --movement q2 --character q2 --mode coop --dedicated --listen-q2 27910
bun start --game q2-classic-baseq2 --movement q2 --character q2 --mode coop --connect-q2 localhost:27910
```

The first profile selects Q2 `base1`, Q1 movement, and a Q3 Sarge character. The second selects Quake rerelease `e1m1`, Q2 movement, and a Q2 male character. `--help` lists explicit content, map, renderer, difficulty, and seat options. `--list-content` reads the installed content catalog.

WASD moves, Space jumps, Mouse 1 fires, the wheel changes weapons, and holding Q opens the weapon wheel. Escape or controller Start opens that seat's menu. Backtick opens the console. Settings control the actual input builder, controller tuning, bindings, window resolution, effects and music volume, and HUD preferences.

The connected Quake III console treats ordinary text as chat. Prefix its commands with `/`, such as `/set cg_fov 100` or `/map_restart 0`.

`Application` owns one `EngineSession` and one authoritative `SharedSimulation`. Input produces source commands; simulation owns actors and source callback order. Each `WorldSeatPresentation` reads the resulting snapshot independently. Both native renderer backends consume the same ordered resource and draw commands. Content, models, palettes, and sounds retain their selected provider mounts.

Level changes use `SharedTransitionCoordinator` for authored intents and `SimulationTravel` for source campaign/player carry. Quake III retains its native session fields and cvars separately; `map_restart` also retains source time. The native window, clients, seats, input settings, and console remain live across travel. Actor generations change, invalidating references to the prior world. The console `map` command starts a fresh map; `Application.changeLevel()` retains source travel state.

One `ApplicationEffects` advances source particles, beams, explosion models, and lights once per game frame; each seat samples the result. Unsupported source events retain their original payload in `unhandledPresentationEffects`. Quake finales use the original image and mounted localization with the source character reveal rate. Quake rerelease alias models select shipped MD5 replacements and source animation timing through `model-loader.ts`.

Quake III games create a separate native cgame for each seat. Its actual snapshots, prediction, weapon selection, HUD, effects, and sound feed the shared renderer and audio engine. The source console routes game variables to the server, client variables to the invoking seat, and movement variables to the selected input provider.

Weapon selection and holdable use carry the selected arsenal identity independently of movement commands. Quake II rerelease presentation uses its mounted Kfont, localized messages and story text, per-player fog, and source sky changes. Restoring a save republishes retained story, sky, and player fog state. Source autosave requests write actual saved-game files under `~/.local/share/quake-typescript/saves/`.

Use `save quicksave` and `load quicksave` in the console. Relative names use the configured save directory and add `.sav` when no extension is supplied. Explicit save paths must stay inside that directory; `load` also accepts an absolute path to an existing save elsewhere. `Application.saveGame()` and `loadGame()` accept explicit file paths. Quake I and II saves restore the exact recipe, source state, scheduled callbacks, actors, and clocks. A saved profile can change the active movement and character selections. Connected client slots must match the saved players. Native Quake III whole-game checkpoints and providers without complete state serializers report an error.

`--listen-q2` binds the native Quake II protocol to the same authoritative simulation. `--bind` selects its local IP; port 0 requests an available port. The source wire rejects mixed recipes and unbound protocol layouts. Channels survive map travel while player actors and signon state change. Unified mixed-game networking remains separate work.

`--connect-q2` starts `RemoteApplication`, which receives native Quake II snapshots and presents the remote world. It preserves the window, seat, and input settings during server map changes. It owns no local authoritative simulation.

`captureNextFrame()` captures CPU or GL output before presentation. CPU output can also be read with `readPixels()` after a step. A dedicated application has no local input, renderer, or framebuffer.

This entry point is still receiving source provider joins. Complete content coverage, remaining campaign presentation, all multiplayer permutations, and exhaustive source fidelity remain integration work; a successful launch is not full release acceptance.
