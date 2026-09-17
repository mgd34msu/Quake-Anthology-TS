# Mixed-game networking

Host a mixed-game session with this client:

```sh
./quake-typescript --game q2-classic-baseq2 --movement q1 --character q3 --model sarge --mode coop --dedicated --listen-unified 27910
```

Join it from another instance:

```sh
./quake-typescript --connect-unified 127.0.0.1:27910 --renderer gl
```

From the console, use `connect qts://127.0.0.1:27910`. Replace the address with the host's address for another machine. Add `--seats 2` to join with two local players.

The host's composition selects the world, movement, character, weapons and monsters. Each client must have matching content installed; the connection verifies the selected mounted resources before admission. The client's input settings, name and local seats remain its own.

This transport uses UDP and connects instances of this client. Original Quake clients use the existing native protocol options. Native IPX selection applies to native protocols. The current mixed-game host requires a built-in TypeScript game implementation; native guest hosting remains separate work.

Clients receive public state and replay their own unacknowledged movement against the authoritative collision state. The server owns combat, weapons, events and world changes. Snapshots are losslessly compressed; events use ordered reliable delivery. Map changes retain the connection and replace its content and actor identities.
