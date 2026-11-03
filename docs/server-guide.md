# Server guide

How to host a game. Every example uses the compiled `./quake-typescript`; from source use
`bun run start` instead. Run `--help` for the complete flag list, which is the authority for
spelling and ranges.

## Listening is explicit

`--dedicated` removes the window and the local seats. **It does not open a socket.** A
`--dedicated` launch with no listener runs a headless world that nothing can join (this is
kept on purpose for bot, navigation and timing runs). To serve clients add one listener:

| Flag | Serves | Typical port |
| --- | --- | --- |
| `--listen PORT` | The selected game's native protocol: NetQuake for Quake, QuakeWorld protocol 28 for a QuakeWorld product, Quake II (selected by `--q2-protocol`) or Quake III protocol 68 | Quake 26000, QuakeWorld 27500, Quake II 27910, Quake III 27960 |
| `--listen-q2 PORT` | The native Quake II protocol (same as `--listen` for a Quake II product) | 27910 |
| `--listen-unified PORT` | The mixed-game `qts://` transport for clients of this program; see [networking-unified.md](networking-unified.md) and [protocol.md](protocol.md) | any UDP port |

Choose one listener per process. `PORT` may be `0` to take an available port. The server
prints `Listening for ... peers on <address>.` when the socket is open. `--bind ADDRESS`
selects the local IP (default `0.0.0.0`) and requires a listener.

`--dedicated` cannot be combined with a `--connect-*` option, and `--menu` is not allowed
with it. A graphical (non-dedicated) launch can host too: add a listener without `--dedicated`
and the local player joins the same world.

## Examples

```sh
# Quake deathmatch for original NetQuake clients
./quake-typescript --content-root /path/to/games --game q1-classic-id1 \
  --map dm4 --mode deathmatch --dedicated --listen 26000

# Quake II cooperative for stock protocol 34 clients
./quake-typescript --game q2-classic-baseq2 --map base1 --mode coop \
  --dedicated --listen-q2 27910 --q2-protocol 34

# Quake III Arena capture the flag
./quake-typescript --game q3-baseq3 --map q3ctf1 --rules ctf --dedicated --listen 27960

# Mixed game: Quake II rules, Quake movement, a Quake III character
./quake-typescript --game q2-classic-baseq2 --movement q1 --character q3 --model sarge \
  --mode coop --dedicated --listen-unified 27910
```

Product ids come from `--list-content`. Clients join with `--connect-q1`, `--connect-qw`,
`--connect-q2`, `--connect-q3` or `--connect-unified ADDRESS[:PORT]`, or with the console
`connect` command (`connect qts://host:port` for the unified transport).

## Protocol options

- `--q1-protocol 15|666|999` selects NetQuake (15 default, 666 FitzQuake, 999 RMQ; RMQ flags 130).
  It requires `--listen` on a Quake product and is rejected for QuakeWorld.
- `--q2-protocol 34|35[:1904|1905]|36[:revision]|4038|1038|2023` selects the Quake II wire. It
  requires `--listen`, `--listen-q2` or `--connect-q2`.
- `--ipx-dosbox HOST[:PORT]` and `--ipx-native` carry the native protocols over IPX (a DOSBox
  IPXNET relay or a host `AF_IPX` socket). They do not apply to QuakeWorld or the unified
  transport.

## Match rules, skill and settings

- `--mode singleplayer|coop|deathmatch`, `--skill 0..3`, `--bot-skill 1..5` (Quake III bots),
  `--seed N`. `--rules standard|ctf|lmctf|tag|deathball|horde` selects match rules; see
  [playing.md](playing.md) for which map entities each needs.
- `--server-profile PATH` loads shared server settings from JSON:

  ```json
  { "version": 1, "overrides": [ { "id": "server:q3.game-type", "value": "0" } ] }
  ```

  Every `id` must name a setting owned by the selected components, appear once, and carry a
  string `value` valid for that setting (toggle `0`/`1`, a number within its range, one of its
  choices, or text without control characters). An unknown or duplicate id rejects the whole
  file. The in-game **Server settings** menu lists the ids' labels; the same settings can be
  changed from the console.
- Map rotation is edited in the in-game settings (add, reorder, remove).

## The dedicated console

A dedicated server reads console commands from standard input, one per line (up to 64 KiB for
an unterminated line; further input is dropped and reported, not fatal). Commands run as they
would from the local console.

## Administration

- **rcon.** QuakeWorld, Quake II and Quake III servers accept rcon. Failed password attempts
  back off per source address, and the password comparison is timing safe. The password
  travels unencrypted, as in the original games.
- **Limits** applied automatically: a flood gate before connectionless packets (loopback
  exempt), per-address connection caps (4 for NetQuake, 8 for the others), a 30 second life
  for challenges, and a movement time budget per client.
- **Downloads.** Servers offer files with asset extensions only. Client-side limits are
  128 MiB per asset, 1 GiB per package and 2 GiB per Quake II session.

## Faults

A fault caused by one peer's input drops that peer. A fault in the frame restarts the map. A
dedicated server exits with an error after more than three such faults in 60 seconds. Look in
`~/.local/share/quake-typescript/crash.log` ([troubleshooting.md](troubleshooting.md)).

## Exposure

Traffic is UDP and unencrypted. NetQuake and the native KEX LAN protocol cannot carry a
join secret, so a spoofed packet can remove an admitted peer by address. Read the network
section of [SECURITY.md](../SECURITY.md) before exposing a listener to the internet.
