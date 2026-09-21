import type { ModClientCommand } from "../../../world/session/mod-clients.ts";
import type { ActorId, ClientId, IdentityOwner } from "../../../contracts/identity.ts";
import type { CommandSource } from "../../../contracts/session.ts";
import type { UserCommand } from "../../../contracts/protocol.ts";
import { readSavedActor, savedActorId } from "../../../persistence/save-image.ts";
import { readTime, readVector } from "../../../persistence/shared.ts";
import { namespaced, SaveReader } from "../../../persistence/value.ts";

export function captureModClientCommand(value: ModClientCommand, client: ClientId) {
  const { input, time } = value, source = input.source;
  return { actor: savedActorId(input.actor), client: { slot: client.slot, generation: client.generation }, time,
    source: source.kind === "local-seat" ? { kind: source.kind, seat: source.seat.index }
      : source.kind === "bot" ? { kind: source.kind, provider: source.provider } : { kind: source.kind },
    sequence: input.sequence, command: input.command, arsenal: input.arsenal ?? null };
}

function words(reader: SaveReader): readonly [number, number, number] {
  const values = reader.list(value => value.integer()), [x, y, z] = values;
  if (values.length !== 3 || x === undefined || y === undefined || z === undefined) return reader.fail("Expected three command angle words");
  return [x, y, z];
}
function readCommand(reader: SaveReader): UserCommand {
  const kind = reader.field("kind").choice("q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3");
  const buttons = reader.field("buttons").integer(0), forwardMove = reader.field("forwardMove").finite();
  if (kind === "q3") return { kind, buttons, forwardMove, serverTimeMilliseconds: reader.field("serverTimeMilliseconds").integer(),
    angleWords: words(reader.field("angleWords")), weapon: reader.field("weapon").integer(), rightMove: reader.field("rightMove").finite(), upMove: reader.field("upMove").finite() };
  const sideMove = reader.field("sideMove").finite();
  if (kind === "q2-rerelease") return { kind, buttons, forwardMove, sideMove, milliseconds: reader.field("milliseconds").finite(),
    angles: readVector(reader.field("angles")), serverFrame: reader.field("serverFrame").integer() };
  const upMove = reader.field("upMove").finite(), impulse = reader.field("impulse").integer(0);
  if (kind === "q1-netquake") return { kind, buttons, forwardMove, sideMove, upMove, impulse,
    acknowledgedServerTimeSeconds: reader.field("acknowledgedServerTimeSeconds").finite(), viewAngles: readVector(reader.field("viewAngles")) };
  const milliseconds = reader.field("milliseconds").finite();
  if (kind === "q1-quakeworld") return { kind, buttons, forwardMove, sideMove, upMove, impulse, milliseconds, angles: readVector(reader.field("angles")) };
  return { kind, buttons, forwardMove, sideMove, upMove, impulse, milliseconds, angleShorts: words(reader.field("angleShorts")), lightLevel: reader.field("lightLevel").integer(0) };
}

export function readModClientCommands(reader: SaveReader, host: {
  readonly identity: IdentityOwner;
  actor(saved: ReturnType<typeof readSavedActor>): ActorId;
  client(actor: ActorId): ClientId | null;
}): readonly ModClientCommand[] {
  if (reader.value === undefined) return [];
  const seen = new Set<ActorId>();
  return reader.list(entry => {
    const actor = host.actor(readSavedActor(entry.field("actor"))), client = host.client(actor), savedClient = entry.field("client");
    savedClient.field("generation").integer(0);
    if (client === null || client.slot !== savedClient.field("slot").integer(0) || seen.has(actor)) return entry.fail("Saved command requires one live restored client");
    seen.add(actor);
    const owner = entry.field("source"), kind = owner.field("kind").choice("local-seat", "remote-client", "bot");
    const source: CommandSource = kind === "local-seat" ? { kind, client, seat: host.identity.seat(owner.field("seat").integer(0)) }
      : kind === "remote-client" ? { kind, client } : { kind, provider: namespaced(owner.field("provider")) };
    const arsenal = entry.field("arsenal").nullable(value => ({ provider: namespaced(value.field("provider")),
      weapon: value.field("weapon").nullable(namespaced), useHoldable: value.field("useHoldable").boolean(),
      ...(value.field("impulse").value === undefined ? {} : { impulse: value.field("impulse").integer(0) }) }));
    return { time: readTime(entry.field("time")), input: { actor, source, sequence: entry.field("sequence").integer(0),
      angleSpace: "absolute", command: readCommand(entry.field("command")), ...(arsenal === null ? {} : { arsenal }) } };
  });
}
