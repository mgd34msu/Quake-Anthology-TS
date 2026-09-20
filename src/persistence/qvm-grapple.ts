import type { QvmGrappleDefinition } from "../contracts/qvm-grapple.ts";
import { readModule } from "./execution.ts";
import type { SaveReader } from "./value.ts";
import { readVector } from "./shared.ts";

/** The loader subsequently validates these declarations against the mounted executable. */
export function readQvmGrappleDefinition(reader: SaveReader): QvmGrappleDefinition {
  const fields = reader.field("fields"), globals = reader.field("globals"), callbacks = reader.field("callbacks"), movement = reader.field("movement");
  const cvars = reader.field("initialCvars"), cvarValue = cvars.value;
  if (cvarValue === null || typeof cvarValue !== "object" || Array.isArray(cvarValue)) throw cvars.fail("Expected source settings");
  const presentation = reader.field("presentation"), cable = presentation.field("cable"), cableKind = cable.field("kind").choice("shader", "model"), anchor = presentation.field("viewAnchor");
  return { id: reader.field("id").string(), title: reader.field("title").string(), module: readModule(reader.field("module")), abiProfile: reader.field("abiProfile").choice("q3-modern", "q3-1.16n-base"),
    entityStride: reader.field("entityStride").integer(1), clientStride: reader.field("clientStride").integer(1), pullingFlag: reader.field("pullingFlag").integer(1),
    fields: { inuse: fields.field("inuse").integer(0), client: fields.field("client").integer(0), parent: fields.field("parent").integer(0), target: fields.field("target").integer(0),
      mover: fields.field("mover").nullable(value => value.integer(0)), hook: fields.field("hook").integer(0), health: fields.field("health").integer(0), takedamage: fields.field("takedamage").integer(0),
      eventTime: fields.field("eventTime").integer(0), freeAfterEvent: fields.field("freeAfterEvent").integer(0) },
    globals: { time: globals.field("time").integer(0), frame: globals.field("frame").integer(0), movement: globals.field("movement").integer(0), forward: globals.field("forward").integer(0), groundPlane: globals.field("groundPlane").integer(0) },
    callbacks: { allocate: callbacks.field("allocate").integer(1), free: callbacks.field("free").integer(1), fire: callbacks.field("fire").integer(1), release: callbacks.field("release").integer(1),
      forceRelease: callbacks.field("forceRelease").integer(1), missile: callbacks.field("missile").integer(1), follow: callbacks.field("follow").nullable(value => value.integer(1)),
      think: callbacks.field("think").integer(1), pull: callbacks.field("pull").integer(1), moveMoverHooks: callbacks.field("moveMoverHooks").nullable(value => value.integer(1)), damage: callbacks.field("damage").integer(1), sameTeam: callbacks.field("sameTeam").integer(1), playerMove: callbacks.field("playerMove").integer(1) },
    fireArguments: reader.field("fireArguments").list(value => value.integer()), movement: { byteLength: movement.field("byteLength").integer(4), words: movement.field("words").list(value => ({ offset: value.field("offset").integer(4), value: value.field("value").integer() })) },
    initialCvars: Object.fromEntries(Object.keys(cvarValue).map(name => [name, cvars.field(name).string()])), eventLifetimeMilliseconds: reader.field("eventLifetimeMilliseconds").integer(1), grappleDamageMethod: reader.field("grappleDamageMethod").integer(0),
    presentation: { projectileModel: presentation.field("projectileModel").string(), viewModel: presentation.field("viewModel").string(),
      weaponIndex: presentation.field("weaponIndex").integer(1), viewAnchor: { path: anchor.field("path").string(), tag: anchor.field("tag").string(), offset: readVector(anchor.field("offset")),
        fovOffset: { above: anchor.field("fovOffset").field("above").integer(1), scale: anchor.field("fovOffset").field("scale").finite() } },
      viewAttachments: presentation.field("viewAttachments").list(entry => ({ path: entry.field("path").string(), tag: entry.field("tag").string() })),
      cable: cableKind === "shader" ? { kind: cableKind, path: cable.field("path").string(), width: cable.field("width").integer(1) }
        : { kind: cableKind, flight: cable.field("flight").string(), pull: cable.field("pull").string(), hold: cable.field("hold").string(), segmentLength: cable.field("segmentLength").integer(1) },
      fireSound: presentation.field("fireSound").nullable(value => value.string()), attachSound: presentation.field("attachSound").nullable(value => value.string()),
      releaseSound: presentation.field("releaseSound").nullable(value => value.string()), pullSound: presentation.field("pullSound").nullable(value => value.string()), hangSound: presentation.field("hangSound").nullable(value => value.string()) } };
}
