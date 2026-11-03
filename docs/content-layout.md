# Organize game data, mods, maps, and music

## How game data is found

The catalog looks for game data in this order and stops at the first root that
holds a game (`src/content/roots.ts`):

1. `--content-root PATH`, when given. Nothing else is searched.
2. Otherwise the folder of the executable (the working directory when run from
   source), then the folder above it.
3. Otherwise the default Steam libraries: `~/.local/share/Steam`, `~/.steam/steam`
   and the Flatpak Steam folder, plus every library listed in each
   `steamapps/libraryfolders.vdf`, each searched under `steamapps/common`.
   `--steam` skips steps 1 and 2 and searches only these.

A game is recognized by its base directory (`id1`, `baseq2`, `baseq3`, matched
case-insensitively). The directory holding it is that game's root, whatever it is
called, so `Quake/Id1`, `Quake 2/baseq2` and `Quake 3 Arena/baseq3` work as
installed, and the curated `q1/`, `q2/`, `q3a/` layout below works too. Expansions,
rerelease trees and mods are siblings of the base directory.

### Products, mods and add-ons

- **Products** are the rows in `src/content/catalog/products.ts` (classic,
  rerelease, QuakeWorld and demo editions of each game, and the official
  expansions). A product is installed when its required archives and programs are
  found; otherwise it stays listed as unavailable.
- **Mods** are discovered, unless disabled, in every child directory of a game's
  root (and of the writable content tree) that is not a known product or
  `rerelease`. A folder counts when it holds a PAK/PK3/PKZ archive, a `maps`,
  `models` or `vm` folder, `progs.dat`/`qwprogs.dat`, or a native game library.
  Folder names must be simple (letters, digits, `._+-`).
- **Nightdive add-ons** are the game folders the rereleases download. They live
  in `Saved Games/Nightdive Studios/Quake` or `Quake II`, under Proton in
  `steamapps/compatdata/2310` (Quake) and `2320` (Quake II), or in the profile's
  `Saved Games` for a native install. They are read-only, rank below the install
  and the writable tree, and their titles come from `addons.json`. A game
  folder installed in the classic tree also satisfies the same rerelease product,
  and the reverse.

## Installed content

An unmodified Steam installation needs no layout work at all. If you keep
your own collection folder instead, the shape below works. The `q1/`,
`q2/`, and `q3a/` family names are the engine's preferred names, but they
are not required: any folder that contains `id1`, `baseq2`, or `baseq3`
is recognized as that game, whatever it is called, and links to existing
install folders work the same as real folders.

```text
games/
  quake-typescript                 # optional compiled executable
  q1/
    id1/                          # classic Quake: pak0.pak, pak1.pak
    hipnotic/                     # Scourge of Armagon
    rogue/                        # Dissolution of Eternity
    ctf/                          # Threewave server and client packages
    qw/                           # QuakeWorld, including qwprogs.dat
    mymod/                        # one classic Q1 mod
    rerelease/
      id1/                        # Quake rerelease base data
      hipnotic/
      rogue/
      dopa/                       # Dimension of the Past
      mg1/                        # Dimension of the Machine
      mg3/                        # Dawn of the Machine
      ctf/
      q64/                        # Quake 64 add-on
      mymod/                      # one Q1 rerelease mod
  q2/
    baseq2/                       # classic Q2, including loose players/
    xatrix/                       # The Reckoning
    rogue/                        # Ground Zero
    ctf/
    lmctf/
    mymod/                        # one classic Q2 mod
    rerelease/
      baseq2/                     # rerelease, including bundled campaigns
      mymod/                      # one Q2 rerelease mod
  q3a/
    baseq3/                       # retain all installed PK3s
    missionpack/                  # Team Arena
    mymod/                        # complete Q3 mod package, including vm/ if loose
```

Q2 rerelease expansions use the rerelease `baseq2` content. They do not use the
classic `xatrix` and `rogue` directories. Keep classic and rerelease files separate
even when their filenames match.

## Where files are read and written

Stock games write where the original game does; nothing is redirected into a
separate area. Only combinations the originals could never run, and data with no
original equivalent, use the engine's own folders.

**Stock games.** A stock game takes every selected component from one product or
mod (the product the rules come from and the products it extends). It reads and
writes its own configuration with the original name, format and location:

| Game | Native configuration |
| --- | --- |
| Quake (WinQuake/GLQuake), mods | `<gamedir>/config.cfg` (`Id1`, `hipnotic`, ...) |
| QuakeWorld | `qw/config.cfg`: the QuakeWorld client writes `config.cfg` into `com_gamedir`, which is the `qw` folder (`q1-quakeworld` has content directory `q1/qw`; `tests/settings/native-files.test.ts` checks the path). id's source is not in this repository, so this follows that behavior rather than a quoted line. |
| Quake II, mods | `<gamedir>/config.cfg` (`baseq2`, `xatrix`, ...) |
| Quake III, Team Arena, mods | `<gamedir>/q3config.cfg` (`baseq3`, `missionpack`, ...) |
| Quake rerelease | `Saved Games/Nightdive Studios/Quake/kexengine.cfg` |
| Quake II rerelease | `Saved Games/.../Quake II/kexengine.cfg` and `system.cfg`, and `<gamedir>/settings.cfg` and `keybinds.cfg` |

At startup these files are executed where the original executes them
(`config.cfg` after `default.cfg`; `q3config.cfg` before `autoexec.cfg`), and
they win over the engine's JSON copies of the same bindings and variables. At
quit the file is rewritten the way the original does: bindings, then archived
variables, with the original's header and quoting. The rerelease files hold many
engine variables this port does not own, so they are updated in place: existing
lines change, other lines (including the engine's own menu bindings) stay, and
variables the files do not name remain in the user store. A file that holds only
the id header or comments does not override anything. Saved Games folders under
Proton or a native profile are located as described above. These game folders
are therefore written; install them where your account can write.

A stock game also writes everything else the original writes, in the same folder
and with the original name:

| File | Quake | QuakeWorld | Quake II | Quake III |
| --- | --- | --- | --- | --- |
| Demos | `<gamedir>/NAME.dem` | `<gamedir>/NAME.qwd` | `<gamedir>/demos/NAME.dm2` | `<gamedir>/demos/NAME.dm_68` |
| Screenshots | `<gamedir>/quakeNN.tga` | `<gamedir>/quakeNN.tga` | `<gamedir>/scrnshot/quakeNN.tga` | `<gamedir>/screenshots/shotNNNN.tga` or `.jpg` |
| Level shots | | | | `<gamedir>/levelshots/MAP.tga` |
| Logs | `<gamedir>/qconsole.log` with `-condebug` | `<gamedir>/qconsole.log` with `-condebug` | `<gamedir>/qconsole.log` with `logfile` 1 (2 flushes each write) | `<gamedir>/qconsole.log` with `logfile` 1 (2 flushes each write); `<gamedir>/games.log` from `g_log` |
| Server `writeip` | `<gamedir>/listip.cfg` | `<gamedir>/listip.cfg` | `<gamedir>/listip.cfg` | |
| Saves | `<gamedir>/NAME.sav` | none | `<gamedir>/save/NAME/` (`server.ssv`, `game.ssv`, `MAP.sav`, `MAP.sv2`; the engine's own `qts.sav` where only that fits) | `<gamedir>/save/NAME.sav` |

Quake and Quake II numbering starts at 00 and keeps counting past 99; Quake III
stops at `shot9999`. The `screenshot`, `screenshotJPEG` and `screenshotPNG`
commands choose the extension; the engine does not write PCX. One console log writer serves a local game, a dedicated
server, a client connected to a remote server and the front end; each game supplies only its trigger (`logfile` for
Quake II and III, the `-condebug` launch flag for Quake and QuakeWorld). In the
rerelease the same files go beneath the Saved Games folder: Quake saves go to
`NAME.sav` in the Quake folder (the rerelease's own `s1.sav` sits there), Quake II
saves to `<gamedir>/save/NAME.pak.gz`, the rerelease's own `saveN.pak.gz` naming.
Quake II classic games whose guest module writes files (its `save/` folders and
`game` state) write into the same folder.

**Quake II saves.** A stock Quake II game runs either the original game module
(`gamex86.dll`, or `game_x64.dll` in the rerelease, selected with `--q2-game`) or the
engine's own game logic. With the original module `save NAME` writes what id's
engine writes, and `load NAME` reads what the original wrote:

- Classic: the folder `<gamedir>/save/NAME/` holds `server.ssv` (a 32 byte comment, the
  128 byte map command and the latched cvars, `skill`, `coop`, `deathmatch`,
  `maxclients` and the rest, as 128 byte name and value pairs), `game.ssv` (the
  module's `WriteGame`), and for every level of the unit `MAP.sav` (the module's
  `WriteLevel`) and `MAP.sv2` (the 2080 configstrings of 64 bytes and the 1024 area
  portal ints). The files go through `<gamedir>/save/current/`: the level and server
  files are written there, then the folder is copied to `NAME` (`SV_CopySaveGame`),
  and `load` copies `NAME` back to `current/`. The comment is `HH:MM MM/DD  level name`,
  or `ENTERING level name` for an autosave. `save current` is refused, as is any name
  with `..`, `/` or `\`.
- Rerelease: `<gamedir>/save/NAME.pak.gz`, a gzip PACK of `game.ssv` (the module's
  `WriteGameJson`), `server.ssv` (`EVAS` binary: kind, comment, timestamp, map command,
  latched cvars), and for every level `MAP.sav` (`WriteLevelJson`) and `MAP.sv2` (the
  non-empty configstrings of 96 byte slots, then the map's area portal bytes).
- Autosaves follow the original: entering a level (`map`, `gamemap`, a level change)
  writes `save0`. Like the original, it holds the levels already left but no file for
  the level just entered; loading it spawns that level fresh with the saved game
  state. The rerelease autosave has kind 1 in `server.ssv`.
- `load` accepts these folders and archives however they were written, including the
  original game's. The files start the original module on the recorded map with the
  recorded cvars and read `game.ssv` before the map and its level file after, the order
  `SV_Loadgame` uses; a level the unit left earlier is read back from its own file when
  the unit returns to it. Deathmatch saves do not exist and are refused.
- The menus and the front end list both kinds: one row per folder (not one per level
  file) or pak, labelled with the comment.

State the original files cannot carry stays in the engine's format beside them:
`qts.qtsave` in the classic folder and `NAME.qtsave` beside the pak, holding the
engine's save image and the SHA-256 of the original files it was written beside.
The sidecar covers every local seat, the engine state shared with mixed content
(foreign characters, weapons, inventories, random streams, clocks) and, in the
rerelease, deferred damage and entity projections. The original game never reads the
sidecar. Loading follows one rule: the original files are authoritative. While the
sidecar's recorded hash still matches the files, the engine restores everything
from it; if the original game rewrote the slot, or a file was changed, added or
removed, the sidecar is ignored and the files alone start the module. The engine
names the sidecar so that the original's wipe and copy (`*.sav`, `*.sv2`) never touch
it.

When the engine's own game logic runs the game, the original's files cannot be
written, and the engine does not fake them. `game.ssv` and `MAP.sav` are the original
module's memory: its `game_locals_t` and `gclient_t` structs and one raw `edict_t` per
entity, with the module's own function pointers and field tables resolved to names.
The engine's logic keeps the same game in other structures (item, mover, monster, weapon
and player systems, and no `edict_t`), so there is nothing to dump that the original
module would read back, and a file built from guesses would load into a changed game.
That path writes `save/NAME/qts.sav` (classic) or `save/NAME.sav` (rerelease) and
replaces any original-format files in the slot, so one slot never holds two games'
state. Loading a folder or pak in the original format always runs the original module,
even in a game that was launched on the engine's logic; the module must be installed.
Custom and mixed games keep the engine format in the user store, not in these folders.

Menus and the front end list demos and saves from these folders as well as the
user store. Earlier versions kept a stock game's demos and saves in the user store;
on the first launch after the update they are moved into the native folders. The
move copies each file beside its destination, renames it into place and only then
removes the original, never overwrites a different file already there, and can be
interrupted and rerun. Whatever stays behind (autosaves, original-format saves,
screenshots, which the old layout shared between games) is still read from the
user store.

**Downloads.** Content a client downloads (maps, sounds, models, pictures, textures,
PAK and PK3 files a server sends) goes into the game folder that owns it, as the
original clients do: `id1` or `qw` for Quake and QuakeWorld (skins in `qw`'s base),
`baseq2`, `baseq3`, or the mod's own folder, created when missing. This holds for
stock and mixed combinations alike, because a download belongs to the component
that requested it, not to the engine's settings. The catalog mounts that folder
like any installed one, so a downloaded file is found after the next content
refresh. If the game folder cannot be written (a read-only install), downloads go
to the user store's product folder as before. Downloads that earlier versions
left in the user store are still read, but they are not moved: that folder also
holds add-ons and maps you placed yourself, which cannot be told apart from
downloads.

The stock-versus-mixed decision is made in one place, `stockGameFolders` in
`src/app/bootstrap/native-settings.ts`; every writer of demos, screenshots, logs,
`listip.cfg`, game-module files and saves asks it. It answers with the game's own
folder when every component comes from one product or mod, and with nothing for
a mixed combination, which then writes under the user store's product folder.
One part of the owner's split is not done yet: mixed combinations share the
engine-behavior product's user folder instead of a folder keyed per combination.

**Mixed combinations** (components from different products, such as a Quake II
map with Quake movement) keep to the user store, keyed by the component that owns
each setting: movement and input settings and bindings by the movement provider's
product, map and rules variables by the map product, character and client
variables by the engine-behavior product. A mixed game that uses Quake movement
therefore reads and writes the same movement, input and binding files that Quake
played stock keeps in its user folder. Stock games also save those JSON copies
beside their native file, so a mixed game starts from the latest stock values; the
reverse does not hold, because a stock game reads its native file first. Files
saved earlier under the engine-behavior product's folder are still read when the
movement product's folder has none.

**Settings layers.** Players generally want the same bindings and settings in every
game, so the engine keeps two levels. The high level is the engine's own
configuration (`console/layers/high.json`): every binding and the shared settings
sensitivity, invert pitch, effects and music volume, gamma, fullscreen, resolution
and field of view. The low level is each game's native file above. Precedence, highest
first:

1. the game's local overrides (`console/layers/games/<game>.json`);
2. the high level;
3. the game's own `default.cfg` and cvar defaults, which sit beneath both.

The high level stores the engine's canonical cvar names (`sensitivity`, `m_pitch`,
`volume`, `bgmvolume`, `r_gamma`, `fov`, `r_fullscreen`, `r_customwidth`,
`r_customheight`). `src/settings/setting-spellings.ts` is the one declaration of every
other spelling a game uses; the same data registers each spelling as a cvar alias of
the canonical cvar in every dialect (so `vid_gamma`, `s_volume`, `cg_fov`,
`cl_sensitivity`, `gl_mode` and the rest work in whichever game runs, where the game
does not define the name itself), and says which native files write that spelling.
A game without a spelling lacks the setting:

| Game | Sensitivity | m_pitch | Volume / music | Gamma | Fullscreen | Resolution | FOV |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Quake | `sensitivity` | `m_pitch` | `volume` / `bgmvolume` | `gamma` (1 / brightness) | none | `vid_config_x`/`_y` | `fov` |
| Quake II | `sensitivity` | `m_pitch` | `s_volume` / none | `vid_gamma` (1 / brightness) | `vid_fullscreen` | `gl_mode` index (-1 for widths outside its table) | `fov` |
| Quake III | `sensitivity` | `m_pitch` | `s_volume` / `s_musicvolume` | `r_gamma` | `r_fullscreen` | `r_customwidth`/`height` with `r_mode` -1 | `cg_fov` |
| Quake rerelease | `cl_sensitivity` | `m_pitch` | `snd_volume` / `snd_musicvolume` | `gamma` (1 / brightness) | none | `v_width`/`v_height` | `r_fov` |
| Quake II rerelease | game-local (its own scale) | game-local | `snd_volume` / `s_bgvolume` | none | none | `v_width`/`v_height` | `fov_0` |

Layer files written under the first, separate vocabulary (version 1) are migrated to
the canonical names when read.

Cvars outside these declarations (Quake II `cl_blend`, Quake III `cg_drawGun`) are the game's
own and never leave its file.

At startup the native file is read, compared with the record of what the engine
last wrote to it, and the script the game runs is the effective set: the high level
mapped into the game's names, plus the game's overrides. A key unbound at a level
becomes an `unbind` line that cancels a `default.cfg` binding. The first native file
the engine ever meets seeds an empty high level; a native file that has no record
yet and differs from the high level becomes overrides. At quit the whole effective
set is written back, so the original game sees a complete config, and the record is
refreshed.

Changes made in a running game update the high level and so every game that does not
override that entry: console `bind`, `unbind`, `set`, `seta` and `cvar` on a mapped cvar,
menus and sliders, and commands from exec'd scripts such as `autoexec.cfg`. A change
to an entry this game overrides also ends that override, so the value the player just
set is the one that stays. The comparison is made at quit against the set the game
started from and the bindings `default.cfg` left, so unchanged defaults are never
copied into the high level.

A game-local override comes only from:

- the player hand-editing that game's native file (any binding or mapped variable that
  differs from the recorded write, unless it equals the high level);
- `bind -local`, `unbind -local` and `set -local` (also `seta`, `setu`, `sets`), where
  the flag is removed and the command runs as usual;
- the "Keep bindings to this game" toggle in the front end and in-game binding menus.

A change in the high level flows to every game without an override of that entry and
leaves overridden games alone. Mixed combinations start from the high level (mapped
variables and bindings in the engine-behavior product's dialect) and the component-keyed
store then wins over it. They have no native file, but their changes at quit go back to
the high level through the same `absorbSession` code as a stock game's.

**Writable content and engine-wide data** live under
`~/.local/share/quake-typescript/` (or `--user-content-root X`, which must not be a
game install):

```text
~/.local/share/quake-typescript/
  content/                        # add-ons and overrides; engine family names
    q1/id1/maps/example.bsp
    q1/mymod/
    q1/rerelease/mymod/
    q2/baseq2/
    q2/rerelease/mymod/
    q3a/baseq3/
    q3a/mymod/
  saves/                          # saved games (this engine's shared format)
  settings/                       # engine-wide settings, per-product JSON
```

`saves/`, `settings/` and `content/` sit side by side; with
`--user-content-root X` they are `X/saves`, `X/settings` and `X`. Per-product
JSON (`input/seat-N.json`, `cvars/...`, audio) lives in the product's folder
under the content tree. Engine-wide data with no original equivalent (crash log,
renderer choice, server profiles, server-browser cache, gamepad and gyro profiles,
global input tuning, image settings, LLM credentials) stays under the default
`settings` folder; see
[credential and preference files](console-and-llm.md#credential-and-preference-files).

Engine-format saved games are kept apart from id's `.sav` and `.ssv` files rather
than written under the original names where the formats differ.

QVM components write to `.mods/PRODUCT/COMPONENT_ID/` under the user-content root.
Each name is URL-encoded. Their reads, scripts, and file lists see that component's
output before its installed files; other components remain separate.

## Install a mod

Place the author's package contents directly in its own mod directory. Avoid an
accidental `mymod/mymod/` level when unpacking. Keep PAK and PK3 files intact and
preserve dependencies, loose assets, and the author's README.

For a large archive collection, extract the distribution packages you want, then
install each complete package according to its instructions. Selecting only one
DLL, QVM, `progs.dat`, or BSP can omit required companion assets. Retain the
original distribution and README so the version and dependencies remain identifiable.

For Quake 1 Threewave 4.0, the `ctf` folder beside `id1` needs the 3.01 client `pak0.pak`, the 4.0 client
`pak1.pak`, and the 4.0 server programs. These packages include the original
Morning Star model and chain links. Keep rerelease packages in their own tree.

A discovered package still needs a supported source interface. See
[mod compatibility](mod-compatibility.md) for declarations, component installation,
and current limits.

## Install maps

For a map using base-game rules, place its loose BSP in the game's `maps/`
directory and its companion assets in their authored locations — for
example `id1/maps/example.bsp` inside your Quake folder, or
`baseq2/maps/example.bsp` inside your Quake II folder. To keep an install
pristine, put loose maps in the writable content tree instead (below).

Keep a Q3 map's complete PK3 in the `baseq3` folder; it can include required textures,
shaders, arena definitions, and bot navigation. Maps that require a mod belong
with that mod. A BSP filename alone does not describe gameplay dependencies.

Use [independent game and map selection](playing.md#choose-rules-and-maps) to play
supported combinations without moving map assets between game directories.

## Install music

For Q1/Q2 CD tracks backed by files, use the selected game's or mod's `music/`
directory — for example `id1/music/track02.ogg` or
`baseq2/music/track02.ogg` inside the respective game folder (or the same
relative path in the writable content tree).

`02.ogg`, `track02.wav`, and `02.wav` are also recognized. Q3 uses paths authored
by its maps or music commands; retain those supplied paths and files. Installed
music plays when the map or game requests it.
