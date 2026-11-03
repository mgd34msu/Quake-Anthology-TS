# Security policy

## Reporting a vulnerability

Do not post exploit details in a public issue. Contact the maintainer through the
GitHub profile of the repository owner (`mgd34msu`) and ask for a private channel, then
send the report there. Include the version (`--version`), the command line, and whether the
problem needs hostile game content, a hostile network peer, or local access. There is no
published response-time commitment and no bug bounty.

Only the latest tagged release and the tree at `main` are maintained.

## What this program does that matters for security

Quake Anthology runs content and talks to peers that you may not control:

- It **executes code from game content** (Quake II game DLLs, Quake III QVM bytecode,
  QuakeC `progs.dat`).
- It **accepts packets from the network** when you host a server, and it parses server
  replies, downloads and master lists when you join one.
- It **stores OAuth tokens and API keys** for the optional LLM console assistant.
- It **loads native libraries** (SDL, OpenGL, FreeType, libvorbisfile, libtheoradec) and
  parses mounted images, audio and video with them in process.

## Mod trust model

**Treat any mod, map pack or game module as code you are choosing to run.** The engine
limits what that code can reach, but it is not a security sandbox for hostile content.

What is isolated:

- **Quake II DLLs are emulated, not loaded.** `gamex86.dll` and `game_x64.dll` are mapped
  into a software x86/x64 CPU (`src/guest`). Guest code has no direct system-call access.
  It sees only the import table the host provides (`gi.*`). Each call is bounded by an
  instruction budget, guest memory is capped (1 GiB mapped, 256 MiB for classic `TagMalloc`),
  and the file services refuse writes to names such as `.cfg .rc .dll .so .exe .pak .pk3 .qvm
  .bsp`, cap one file at 64 MiB, a session at 512 MiB and 256 written files.
  Private cvars are hidden from the guest and protected from guest writes.
- **QVM bytecode and QuakeC** run in interpreters (`src/compat/qvm`, `src/compat/qc`) that
  expose only the engine's system-call surface.
- **Content roots are read-only.** Installed game folders are never written; saves, settings,
  downloads and the crash log go under `~/.local/share/quake-typescript/`.

What is **not** isolated:

- A guest can issue console commands (`AddCommandString` in Quake II). There is no
  allowlist and no distinct "game module" origin for those commands; they run as the
  engine's own console would (audit item GUEST-002, recorded for an owner decision).
  A hostile module can therefore run commands such as `exec`, `alias`, `connect` or
  `writeconfig` within the user's own directories and network reach.
- A hostile module can consume CPU and memory up to the limits above, and can make the
  game unusable for as long as the instruction budget allows.
- Emulator or host-service bugs are not ruled out. Emulation is a hardening layer, not a
  proof of containment.
- Image, audio, video and font files are decoded by native libraries in process. No
  minimum library versions are enforced. Keep those libraries patched when you load
  untrusted content.
- Mounted `.pak`, `.pk3` and add-on folders are trusted to be well-formed; they are read
  with bounds checks but are not scanned.

Practical guidance: install mods only from sources you trust, run unfamiliar mods as a
separate OS user or in a container, and do not give the process access to files you
cannot lose.

## Network trust model

Peers are untrusted. Servers apply per-address connection limits, a connectionless-packet
flood gate, bounded challenge lifetimes (30 s), a movement time budget per client,
bounded decompression for downloads and Quake II stream data, and a failure backoff on
rcon password attempts (comparison with a timing-safe digest). The mixed-game (`qts://`)
transport authenticates a join with a stateless HMAC cookie. See the audit tracker
[NET](docs/reviews/2026-11-01-full-audit/remediation/NET.md) for each control and the
items deliberately left open.

Things to know before you host:

- Traffic is UDP and **not encrypted**. rcon and server passwords cross the network in the
  clear, as they do in the original games.
- NetQuake and the native KEX LAN protocol have no handshake secret an original client
  could echo, so a spoofed packet can disconnect an admitted peer by address or take a lobby
  slot (NET-007, NET-022). Both listeners stay open by default so original clients can join.
  Mitigations always on: a connectionless-packet gate, at most 4 NetQuake / 8 KEX peers per
  address, and a 10 s drop of silent admitted NetQuake peers. Start the server with
  `--lan-only` to make NetQuake and KEX LAN hosts ignore every datagram from a non-private
  address (loopback, RFC 1918, link-local, unique-local, IPX). Use it, or a firewall, on any
  host that is not meant to be reachable from the internet.
- Server-supplied downloads are restricted to asset extensions and size limits (128 MiB per
  asset, 1 GiB per package, 2 GiB per Quake II session). HTTP download servers on private,
  loopback or link-local hosts are refused unless the game server is itself private.
  Automatic downloads stay on by default (`allow_download 1`, `cl_http_downloads 1`, as in
  Q2PRO), and downloaded packages (`pak`, `pkz`, `pk3`) stay mounted in later sessions, where
  they can shadow assets. HTTP packages have their own switch: set
  `cl_http_package_downloads 0` to refuse them while keeping other downloads (NET-013). The
  Quake II native client keeps an interrupted download as `<name>.part` with a
  `<name>.part.sha256` record and resumes it only if the length and SHA-256 still match.
- Quake III key authorization is off unless `cl_authorizeKey` is set.
- `--bind` selects the listen address; the default is `0.0.0.0`.

## Local state and credentials

- LLM credentials (`chatgpt.key`, `other.key`, `other.service`, `llm.json`) live in
  `~/.local/share/quake-typescript/settings/` and are written with mode `0600`. Older
  releases kept them beside the executable; on first start of a compiled build they are moved
  to the settings folder (copied with exclusive create, then the source file is removed) and a
  `.legacy-migrated` marker is written.
- `crash.log` (same parent folder, rotated to `crash.log.1` at 1 MiB) is mode `0600`. Command
  line values after `password`, `secret`, `token` and `apikey` flags and password-like values in
  the recent-output tail are replaced with `<redacted>`. Review a crash log before sharing it.
- LLM requests start only from direct local console input. `llm_exec` validates the whole
  returned batch first and rejects commands that run scripts, rebind keys, quit, connect, change
  maps, send chat, write files or set command-valued cvars. See
  [console-and-llm.md](docs/console-and-llm.md).
- `save` writes only inside the save directory. id's engines accept no `load` path outside
  their save directory; this program accepts one from the local console (typed commands,
  bound keys, the server console) to import original saves. A `load` of a path outside the
  save directory (and outside the installed add-on save folders) that comes from a script
  (`exec`, `autoexec.cfg`), a game or client module, or a remote client is refused with an
  error. Start with `--allow-load-paths` to allow those sources too (audit DOCS2-003). A save
  file is parsed, not executed. Test: `tests/app/load-path-policy.test.ts`.

## Supply chain

`package.json` declares no runtime npm dependencies, only development dependencies
(`@types/bun`, `typescript`); the program runs on Bun and the native libraries above. Third-party code and its licenses are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Release archives list a SHA-256 in
`RELEASE.json` and in a `.sha256` file next to the archive; see
[the release process](docs/release-process.md).
