# Architecture overview

A map of `src/` for someone new to the code. It names where things live; it does not
promise behavior. The boundaries between layers are the declarations in
[contracts.md](contracts.md) and `src/contracts`. For what works today see [status.md](status.md).

## The shape of the program

One executable hosts Quake, Quake II, Quake III Arena and their expansions through one set of
shared services. A game is a selection of components, not a code path:

- a **world program** that owns spawning, rules and callbacks (a built-in TypeScript
  implementation, a QuakeC `progs.dat`, a Quake III QVM, or a Quake II game DLL),
- a **map set**, **movement** provider, **character**, **weapons/arsenal**, **monsters** and
  **equipment**, each chosen independently,
- the shared **simulation**, **renderer**, **audio**, **input**, **console**, **UI**,
  **saves** and **network** services.

The user's selection becomes an `ExecutableRecipe` (`src/contracts/content.ts`) before any
simulation is built. Everything downstream consumes the recipe, so saves and network peers
can reconstruct the same composition.

## Startup path

1. `src/main.ts` installs the crash log and fault handlers, parses the command line with
   `src/app/bootstrap/options.ts` (`parseApplicationCommand`), migrates legacy LLM settings,
   and opens the LLM settings service.
2. The command is one of `version`, `help`, `list-content`, `weapon-behavior`, or a launch
   (`menu` or `run`). `--menu` or a launch with no selection opens `StartupApplication`
   (`app/bootstrap/startup.ts`), which owns the menu and replaces the running world.
3. A launch builds an `Application` (`app/bootstrap/application.ts`) for a local or
   dedicated world, or a `RemoteApplication` (`remote-application.ts`) for a client joining a
   server. `src/app/bootstrap/README.md` describes its runtime behavior.
4. Content is found by `src/content/roots.ts` and catalogued by `src/content/catalog`.

## Directory map

| Directory | Contents |
| --- | --- |
| `contracts/` | Type-only boundaries: identity, time, recipe, world, gameplay, scene, render, movement, protocol, execution (guest), UI, mod callbacks. |
| `foundation/`, `core/` | Primitives (arenas, pools, event rings, bounded queues, generational handles), binary readers/writers, the command buffer and cvar registry, deterministic random state. |
| `formats/` | Parsers and decoders: BSP for Q1/Q2/Q3, MD2/MDL/MD3/MD4 models, images, archives. |
| `content/` | Everything about game content. `roots.ts` and `user-data.ts` locate data; `catalog/` lists installed products; `mounts/` layers archives and directories read-only; `composition/` merges arsenals and supplies across games; `q1/`, `q2/`, `q3/` hold each game's built-in rules, items, monsters and multiplayer modes; `mods/` and `monsters/` hold component declarations. |
| `world/` | The authority layer: actor registry with generational ids, shared body table, collision and spatial queries, gameplay authority (damage, inventory, transitions), the scheduler, and `session/` (`EngineSession`, clocks). |
| `movement/` | Player movement for Q1, Q2 and Q3 (and QuakeWorld) as swappable providers. |
| `compat/` | Executors for original mod code. `qc/` (QuakeC), `qvm/` (Quake III bytecode and syscalls), `q2/` (classic and rerelease game-DLL hosts, native primary and mod adapters). |
| `guest/` | The software CPU that runs Quake II DLLs: PE loader, x86 and x64 interpreters, floating point, the call ABI and the Windows runtime shims. See [SECURITY.md](../SECURITY.md). |
| `bots/` | Bot behavior and navigation (AAS reading and construction, Q1/Q2 navigation). |
| `network/` | Per-protocol codecs and servers (`q1/`, `q2/`, `q3/`), shared pieces (`common/`: flood gates, rcon guard, movement budget), `services/` (discovery, downloads, rankings) and `unified/` (the mixed-game transport). See [protocol.md](protocol.md). |
| `persistence/` | The shared save image (`QTSAVE3`) and per-provider checkpoint codecs, plus original Q1/Q2 save import and export. See [save-format.md](save-format.md). |
| `render/` | Scene and command layers, a CPU software rasterizer (with optional worker threads) and a GL backend; both consume the same ordered draw commands. |
| `materials/`, `media/`, `text/`, `audio/`, `camera/`, `capture/` | Material scripts, video and cinematics, fonts and localization, the mixer and music, spline cameras, screenshots. |
| `input/`, `platform/` | Seats, bindings and controllers; SDL, OpenGL, FreeType, Vorbis and Theora bindings through `bun:ffi` and library discovery (`platform/native-libraries.ts`). |
| `console/`, `settings/`, `ui/`, `llm/` | Console sessions and dedicated stdin, server and shared settings, menus and HUD, the optional LLM assistant. |
| `app/bootstrap/` | The application: composition of everything above, startup menu, simulation runtime (`simulation/`), per-protocol network glue (`network/`), save and demo commands. This is where features are joined. |

## Frame cycle

An `Application` owns one `EngineSession` and one authoritative shared simulation. Per
step: input is turned into source commands; the simulation runs movement and the world
program's callbacks in the source's order, then bots, mirrored guest state and network
publication; each local seat's presentation then reads the resulting snapshot
independently and submits draw commands to the renderer. Guest code (DLL, QVM) is stepped
asynchronously inside the step but its results are applied in a fixed order. The
older tick-execution.md describes the cycle at 1.0.0 and omits the
foreign-provider branch and the native-character and guest-monster steps added later.

## Layering rule

`tools/layer-edges.json` lists which top-level `src/` layers may import which others, and
`bun run policy` rejects an edge that is not listed. `app` imports nearly everything;
`contracts`, `foundation` and `core` import almost nothing. When you need a new cross-layer
import, edit that file in the same change and explain why.

## Execution kinds and fallbacks

Each world program has an execution kind: TypeScript, QuakeC, QVM or native DLL. When a
foreign component (another game's weapons, movement, character or enemies) is selected on a
guest world, the engine uses a *qualified* integration if the guest artifact has a known
interface profile, and otherwise runs the guest as a **black box**: its own game continues
unchanged while the shared engine owns the foreign component, and the guest's own firing is
silenced while a foreign weapon is active. See [mod-compatibility.md](mod-compatibility.md).

## Dated documents

Plans, ledgers and comparison pages in `docs/` describe how the code was planned and checked
at a point in time; paths in them often name donor-project files. Use this page and
[status.md](status.md) for orientation.
