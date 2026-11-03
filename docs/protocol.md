# Network protocols

The program speaks the original games' protocols so that unmodified clients and servers can
interoperate, and one transport of its own for mixed-game sessions. The code is the authority:
`src/contracts/protocol.ts` (identities), `src/network/q1`, `q2`, `q3` (codecs and servers),
`src/network/unified` and `src/app/bootstrap/network/unified-*.ts` (mixed-game transport).
How to start a server is in [server-guide.md](server-guide.md).

## Native protocols

All run over UDP. Select them with `--listen` / `--connect-*` and the protocol flags.

| Family | Identities handled | Flags |
| --- | --- | --- |
| Quake (NetQuake) | 15 (id), 666 (FitzQuake), 999 (RMQ, with flags) | `--listen`, `--q1-protocol 15\|666\|999` (default 15; 999 uses 32-bit coordinates and short angles), `--connect-q1` |
| QuakeWorld | 28 (base); 29 is recognized as a wide-entity variant | `--listen` on a QuakeWorld product, `--connect-qw` |
| Quake II | 34 (classic), 35 (R1Q2, revisions 1903 to 1905), 36 (Q2PRO, revisions 1015 and 1017 to 1026), 1038 (rerelease), 2023 (KEX), 4038 (private classic); 2022 (KEX demo) for demos | `--listen`, `--listen-q2`, `--q2-protocol 34\|35[:1904\|1905]\|36[:revision]\|4038\|1038\|2023` (35 defaults to 1904, 36 to 1026), `--connect-q2` |
| Quake III Arena | 68 | `--listen`, `--connect-q3` (client expects `sv_pure 0`) |

A wire version selects a codec. It does not select game APIs or frame cadence. Original
clients join through the matching protocol; the server's world program can still be any
component mix the wire can represent. The Quake II wire rejects mixed recipes and unbound
protocol layouts; Q2PRO revision 1016 is one of them (it is reserved by the native protocol
and has no codec). The `--q2-protocol` flag offers R1Q2 revisions 1904 and 1905 only.

### Retail online services are not part of the wire

The identities above are wire formats only. Nothing here talks to a publisher's online
services: no Nightdive/Bethesda account or relay for the Quake rerelease (Quake KEX), no
matchmaking or cross-play lobby, no Steam or Epic networking. The Quake II KEX identities
(1038, 2023) cover the UDP game traffic and the native KEX LAN protocol; they do not
make a retail lobby list this server. The rerelease client's session setup goes through the platform lobby layer, and an online
lobby session cannot be exercised without the platform services, so no wire identity for it is
claimed.

Quake III key authorization is off unless the archived cvar `cl_authorizeKey` is set. IPX
(`--ipx-dosbox`, `--ipx-native`) carries the native protocols but not QuakeWorld.

Per-protocol limits (connectionless flood gate, per-IP caps, challenge expiry of 30 s, bounded
inflate, download limits) are described in [SECURITY.md](../SECURITY.md).

## Mixed-game transport (`qts://`)

For sessions whose composition has no original wire (for example Quake II rules with Quake
movement and a Quake III character). Both ends are this program. Host with
`--listen-unified PORT`; join with `--connect-unified ADDRESS[:PORT]` or the console command
`connect qts://ADDRESS:PORT`. See [networking-unified.md](networking-unified.md) for the
user view. Requires a built-in TypeScript game on the host.

### Handshake

Three datagrams, each a JSON checkpoint envelope of at most 512 bytes with schema
`qts-connect`, version 1 (`unified-control.ts`):

1. `hello { nonce }` from the client.
2. `challenge { nonce, token }` from the server. The token is a stateless cookie:
   the first 128 bits (32 hex characters) of HMAC-SHA-256 over `address|nonce|window` with a
   per-process secret, where `window` is the current 10 second window. The server keeps no
   state for an unanswered hello.
3. `connect { nonce, token }` from the client echoing the cookie. The server accepts the
   current and the previous window.

The server limits admitted peers to 8 per IP and requires signon to finish within 60 s. After
admission the content is verified: the client must have the selected mounted resources, which
the connection checks against a composition identity before admission. The composition
identity has `schemaVersion: 1`, the normalized recipe, `snapshotSchema: "qts:snapshot-v10"`,
an empty actor configuration list (configurations are negotiated per frame) and sidecars.

### Channel packet

Every datagram after the handshake is one of three kinds, little-endian unless noted, with a
48-byte header (`src/network/unified/packet.ts`):

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | Magic `QTUC` (bytes 51 54 55 43) |
| 4 | 1 | Protocol version, `1` |
| 5 | 1 | Kind: `0` ack, `1` reliable, `2` frame |
| 6 | 2 | Reserved, must be `0` |
| 8 | 16 | 128-bit channel token (the connection's identity) |
| 24 | 4 | Sequence (nonzero) |
| 28 | 4 | Highest reliable sequence acknowledged |
| 32 | 4 | Required reliable sequence (frames only; `0` for reliable and ack) |
| 36 | 4 | Total message bytes |
| 40 | 4 | Bytes in each fragment |
| 44 | 2 | This fragment's index |
| 46 | 2 | Fragment count (`ceil(total / fragment bytes)`, at least 1) |
| 48 | n | Fragment payload |

An ack packet is exactly 48 bytes with the length fields zero. A datagram is at most 65507
bytes; the default fragment datagram is 1200 bytes. Decoders reject anything malformed before
allocating assembly storage. **Reliable** messages are delivered in order with a window of 8
messages, retransmitted every 250 ms up to 40 times. **Frame** messages are the per-tick
snapshots; a frame carries the reliable sequence that must have been delivered before it is
applied. Messages are limited to 4 MiB outbound; a server accepts at most 256 KiB inbound from a
peer. Incomplete assemblies expire after 30 s.

### Payloads

Payloads are encoded by `unified-frame-codec.ts` (snapshots), `unified-event-codec.ts` (ordered
events) and `unified-control.ts` (control messages such as client input batches, up to 64
commands per batch), all under `src/app/bootstrap/network/`.

A frame is a checkpoint value with schema `qts-unified-frame` and **frame version 10**, compressed
with raw deflate at level 1. The decoder accepts versions 2 through 10, limits the uncompressed
frame to 32 MiB and the compressed frame to the 4 MiB channel message limit, and rejects
anything else. The composition identity names the snapshot layout as `qts:snapshot-v10`; peers
whose composition identities differ do not interoperate, so a change to the snapshot layout
changes that name along with the frame version.

The ordered events inside a frame are encoded by reader and writer pairs in
`unified-event-codec.ts`. Most of that file is generated from the `SimulationEvent` and
`SimulationPresentationEvent` types by `tools/generate-event-codec.ts`: the `type Event... = ...`
alias lines in the codec name the nodes of those types, and the generator rebuilds the matching
`read...`/`write...` pairs from the compiler's view of them. Pairs listed in
`tools/event-codec-rules.ts` are hand-written; their type shape is fingerprinted, so changing the
type fails the check until the hand-written code is reviewed.

```sh
bun run codec:generate   # rewrite the codec
bun run codec:check      # exit 1 when the codec differs from the derived output (part of bun run check)
```

The client replays its own unacknowledged movement against the authoritative collision state;
the server owns combat, weapons, events and world changes. A map change keeps the connection and
replaces its content and actor identities.

There is no encryption and no authentication beyond the channel token and the join cookie.
