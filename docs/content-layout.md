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
| QuakeWorld | `qw/config.cfg` (assumed from the client's `com_gamedir`; not confirmed) |
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

Saved games, demos, screenshots, downloads and logs are still written to the
engine's own folders, not to each game's folders: the shared save format differs
from id's `.sav` and `.ssv` files, so it is kept apart rather than written under
the original names.

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
