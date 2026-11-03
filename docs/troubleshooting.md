# Troubleshooting

## First checks

```sh
./quake-typescript --version
./quake-typescript --content-root /path/to/games --list-content
```

`--list-content` prints one line per catalog product: id, availability and title. If the game you
want is missing or unavailable, fix content discovery first ([content-layout.md](content-layout.md)).
A command-line mistake prints a message and exits with status 1 without writing a crash log.

## The program does not start: a native library is not found

The executable needs SDL2 (or SDL3), OpenGL, FreeType, libvorbisfile and libtheoradec at run
time. Install the distribution packages, or point the program at a specific file with an
environment variable. An override replaces the whole search, so it must be a full path to the
library:

| Variable | Library | Default names tried (after the executable's folder) |
| --- | --- | --- |
| `QUAKE_SDL2_LIBRARY` | SDL 2 | `libSDL2-2.0.so.0`, `libSDL2.so` |
| `QUAKE_SDL3_LIBRARY` | SDL 3 | `libSDL3.so.0`, `libSDL3.so` |
| `QUAKE_GL_LIBRARY` | OpenGL | `libGL.so.1`, `libGL.so` |
| `QUAKE_VORBISFILE_LIBRARY` | Ogg Vorbis | `libvorbisfile.so.3`, `libvorbisfile.so` |
| `QUAKE_THEORA_LIBRARY` | Ogg Theora | `libtheoradec.so.2`, `libtheoradec.so` |
| `QUAKE_FREETYPE_LIBRARY` | FreeType | `libfreetype.so.6`, `libfreetype.so` |

Search order without an override: the executable's own folder, then the system loader.
A value that is empty or contains a NUL byte is an error.

## Crashes and the crash log

An uncaught error prints its stack to stderr and appends an entry to
`~/.local/share/quake-typescript/crash.log` (mode `0600`). Each entry has the version, the
entry point, the command line and the last 32 KiB of console output. Password-like values are
replaced with `<redacted>`; still, read the log before attaching it anywhere. When the file
passes 1 MiB it is renamed to `crash.log.1`, so at most two generations exist.

Faults are contained where possible ([server-guide.md](server-guide.md#faults)): one peer's
bad input drops that peer; a frame fault restarts the map on a dedicated server or returns a
graphical client to the menu. Only a fault outside those paths ends the process.

## Display and performance

- `--renderer cpu` selects the software renderer if OpenGL does not work. `--renderer gl`
  (default) is the GL backend.
- `QTS_CPU_WORKERS=N` sets how many worker threads the CPU renderer uses (0 to 16). Without it
  the renderer uses up to `min(4, cores - 1)`. This is separate from `r_smp`, which
  moves rendering as a whole to a worker (default off; apply with `vid_restart`).
- `QTS_WORLD_SPACE=0` turns off world-space batches in the GL backend if you suspect a
  rendering problem there.
- `--gamma 0.5..3` adjusts brightness. `--width`, `--height` set the window size.
- `--hidden` starts a hidden native window (for automation).

## Startup is slow

The first start hashes your archives; later starts reuse a cache of archive digests at
`~/.local/share/quake-typescript/cache/archive-digests.json`, keyed on size, times and inode.
Setting `QTS_NO_DIGEST_CACHE` (to any value) forces a full re-hash (slow; for suspected cache problems).
Setting `QTS_STARTUP_TIMING` prints the time spent in each startup phase to stderr.

## Content and mods

- A mod is selectable but will not run: discovery only finds it; its program, assets and
  declarations decide whether it can run ([mod-compatibility.md](mod-compatibility.md)).
- A loadable companion file that fails to decode (a stale `.lit`, a foreign `.aas`, a damaged
  sound) is treated as absent and the game continues without it.
- A save will not load: the same content and declarations must be installed
  ([save-format.md](save-format.md#restoring)).

## Servers

- Nobody can connect: you started `--dedicated` without a listener. Add `--listen`,
  `--listen-q2` or `--listen-unified` ([server-guide.md](server-guide.md)).
- A client reports a mismatch on `qts://`: both sides need the same selected content installed.
- Firewalls must allow the UDP port; the default bind is `0.0.0.0`.

## LLM assistant

Credentials live in `~/.local/share/quake-typescript/settings/`
([console-and-llm.md](console-and-llm.md#credential-and-preference-files)). Sign-in uses a
loopback callback listener on its own thread; cancelling or a timeout closes it. If sign-in
times out, start it again.

## Tests skip or fail

See [CONTRIBUTING.md](../CONTRIBUTING.md#tests): tests that need game data skip unless
`QTS_TEST_CORPUS` is set, and the `corpus` tier fails instead of skipping.
