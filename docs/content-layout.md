# Organize game data, mods, maps, and music

Point `--content-root` at one directory containing your game installations, or
omit it: the executable searches its own folder, then the folder above it, then
the default Steam library locations (`--steam` searches only Steam), stopping at
the first folder holding a game. Each game is located by its base directory —
`id1`, `baseq2`, or `baseq3` — so an unmodified Steam layout (`Quake/Id1`,
`Quake 2/baseq2`, `Quake 3 Arena/baseq3`) works, and expansions, rerelease
trees, and mods resolve as siblings of the base directory. The curated layout
below also works. Install only products you own; missing products
remain unavailable. Preserve the original archive names and loose companion files.

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

## Writable content

Add-ons and overrides can live separately from the installed base data.
Unlike installed games, this writable tree is addressed with the engine's
canonical family names (`q1`, `q2`, `q3a`):

```text
~/.local/share/quake-typescript/
  content/
    q1/id1/maps/example.bsp
    q1/mymod/
    q1/rerelease/mymod/
    q2/baseq2/
    q2/rerelease/mymod/
    q3a/baseq3/
    q3a/mymod/
  saves/                          # application-managed saved games
  settings/                       # application-managed settings
```

The `content/` tree mirrors the installed layout. Use
`--user-content-root /path/to/writable-content` to change the writable content root.
This option does not relocate the sibling saves and settings directories.

Startup scripts such as `config.cfg` and `autoexec.cfg` load from selected
content. Existing personal configs can therefore affect a launch. LLM credentials
and preferences use [separate executable-directory rules](console-and-llm.md#credential-and-preference-files).

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
