# Third-party notices

Quake Anthology TypeScript is distributed under the GNU General Public License,
version 2 or later (see `LICENSE`). Source code for any release is available
from the project repository at the tag named in the release's `RELEASE.json`:
<https://github.com/mgd34msu/quake-anthology-ts>.

This file lists material the project knows it incorporates or derives from. It
is a working list, not a legal opinion, and is not exhaustive: file-level notices
in the source tree take precedence, and not every file carries one.

## Code derived from other projects

- **id Software engine source (Quake, QuakeWorld, Quake II, Quake III Arena).**
  Much of the engine is a TypeScript port of behavior from id Software's
  GPL-licensed source releases. Copyright remains with id Software and the
  original authors. Where a source file records its origin, that notice is kept.
- **Independent JPEG Group software, release 6b.** The JPEG decoder and encoder
  in `src/formats/images/` are derived from IJG code. The IJG terms are in
  `src/formats/images/IJG-LICENSE.md` (shipped as `licenses/IJG-LICENSE.md` in
  release archives). This software is based in part on the
  work of the Independent JPEG Group.
- **GNU C Library and GNU libstdc++ behavior.** Files under
  `src/guest/runtime/system-v/` and `src/app/bootstrap/simulation/random.ts`
  reproduce glibc 2.17 and libstdc++ 4.8 data layouts and algorithms. Their
  headers declare `LGPL-2.1-or-later` or
  `GPL-3.0-or-later WITH GCC-exception-3.1`.

## Libraries loaded at run time

The executable loads these from the host system through Bun's FFI and does not
include them: SDL2, OpenGL, FreeType, libvorbisfile and libtheoradec. They are
under their own licenses.

## Build-time tools

TypeScript (Apache-2.0) and the Bun runtime (MIT, with bundled components under
their own licenses) are used to build the executable. The compiled executable
embeds the Bun runtime.

## Trademarks and game data

Quake, Quake II, Quake III Arena and id Software are trademarks of their
respective owners. This project is not affiliated with or endorsed by them.
Original game data is not part of this software and is not relicensed by it.
