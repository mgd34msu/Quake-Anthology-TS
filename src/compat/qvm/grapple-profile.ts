import type { QvmGrappleDefinition } from "../../contracts/qvm-grapple.ts";
import { SaveReader } from "../../persistence/value.ts";
import { QvmOpcode } from "./image.ts";
import type { QvmModuleOptions } from "./module.ts";
import { qvmPlayerStateBytes } from "./player-record.ts";
import { qvmSharedEntityBytes } from "./shared-entity-record.ts";
import { readVector } from "../../persistence/shared.ts";

export type QvmGrappleProfile = QvmGrappleDefinition;

/** Private offsets and function entries are admitted against exact executable bytes. */
export function readQvmGrappleProfile(value: unknown, artifact: QvmModuleOptions["artifact"]): QvmGrappleProfile {
  const reader = new SaveReader(value, "qvm-grapple-profile");
  reader.field("version").literal(1);
  reader.field("artifactDigest").literal(artifact.module.digest);
  reader.field("artifactPath").literal(artifact.module.artifactPath);
  const abiProfile = reader.field("abiProfile").literal(artifact.abiProfile ?? "q3-modern");
  if (artifact.role !== "qagame") throw reader.fail("grapple callbacks require a qagame module");
  const entityStride = reader.field("entityStride").integer(qvmSharedEntityBytes(abiProfile));
  const clientStride = reader.field("clientStride").integer(qvmPlayerStateBytes(abiProfile));
  if (entityStride % 4 !== 0 || clientStride % 4 !== 0 || Math.max(entityStride, clientStride) > artifact.image.allocatedDataLength)
    throw reader.fail("unaligned or oversized source records");
  const offset = (name: string, minimum: number, maximum: number): number => {
    const field = reader.field("fields").field(name), result = field.integer(minimum);
    if (result % 4 !== 0 || result > maximum - 4) throw field.fail("field is outside its source record");
    return result;
  };
  const global = (name: string, bytes = 4): number => {
    const field = reader.field("globals").field(name), result = field.integer(4);
    if (result % 4 !== 0 || result + bytes > artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength)
      throw field.fail("global is outside declared source memory");
    return result;
  };
  const callback = (name: string): number => {
    const field = reader.field("callbacks").field(name), entry = field.integer(1);
    if (artifact.image.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER) throw field.fail("callback is not a source function entry");
    return entry;
  };
  const entityField = (name: string): number => offset(name, qvmSharedEntityBytes(abiProfile), entityStride);
  const nullableCallback = (name: string): number | null => reader.field("callbacks").field(name).value === null ? null : callback(name);
  const pullingFlag = reader.field("pullingFlag").integer(1);
  if (pullingFlag > 0x40000000 || (pullingFlag & (pullingFlag - 1)) !== 0) throw reader.field("pullingFlag").fail("expected one player movement flag");
  const cvars = reader.field("initialCvars"), cvarValue = cvars.value;
  if (cvarValue === null || typeof cvarValue !== "object" || Array.isArray(cvarValue)) throw cvars.fail("Expected initial source settings");
  const initialCvars = Object.fromEntries(Object.keys(cvarValue).map(name => [name, cvars.field(name).string()]));
  const presentation = reader.field("presentation"), cable = presentation.field("cable"), cableKind = cable.field("kind").choice("shader", "model"), anchor = presentation.field("viewAnchor");
  return { id: reader.field("id").string(), title: reader.field("title").string(), module: artifact.module, abiProfile, entityStride, clientStride,
    fields: { inuse: entityField("inuse"), client: entityField("client"), parent: entityField("parent"), target: entityField("target"),
      mover: reader.field("fields").field("mover").value === null ? null : entityField("mover"), health: entityField("health"), takedamage: entityField("takedamage"),
      eventTime: entityField("eventTime"), freeAfterEvent: entityField("freeAfterEvent"), hook: offset("hook", qvmPlayerStateBytes(abiProfile), clientStride) },
    globals: { time: global("time"), frame: global("frame"), movement: global("movement"), forward: global("forward", 12), groundPlane: global("groundPlane") },
    callbacks: { allocate: callback("allocate"), free: callback("free"), fire: callback("fire"), release: callback("release"), forceRelease: callback("forceRelease"), missile: callback("missile"), follow: nullableCallback("follow"),
      think: callback("think"), pull: callback("pull"), moveMoverHooks: nullableCallback("moveMoverHooks"), damage: callback("damage"), sameTeam: callback("sameTeam"), playerMove: callback("playerMove") }, pullingFlag,
    fireArguments: reader.field("fireArguments").list(entry => entry.integer()),
    movement: { byteLength: reader.field("movement").field("byteLength").integer(4), words: reader.field("movement").field("words").list(entry => {
      const result = { offset: entry.field("offset").integer(4), value: entry.field("value").integer() };
      if (result.offset % 4 !== 0 || result.offset + 4 > reader.field("movement").field("byteLength").integer(4)) throw entry.fail("Movement field is outside the declared source record");
      return result;
    }) }, initialCvars, eventLifetimeMilliseconds: reader.field("eventLifetimeMilliseconds").integer(1), grappleDamageMethod: reader.field("grappleDamageMethod").integer(0), presentation: { projectileModel: presentation.field("projectileModel").string(), viewModel: presentation.field("viewModel").string(),
      weaponIndex: presentation.field("weaponIndex").integer(1), viewAnchor: { path: anchor.field("path").string(), tag: anchor.field("tag").string(), offset: readVector(anchor.field("offset")),
        fovOffset: { above: anchor.field("fovOffset").field("above").integer(1), scale: anchor.field("fovOffset").field("scale").finite() } },
      viewAttachments: presentation.field("viewAttachments").list(entry => ({ path: entry.field("path").string(), tag: entry.field("tag").string() })),
      cable: cableKind === "shader" ? { kind: cableKind, path: cable.field("path").string(), width: cable.field("width").integer(1) }
        : { kind: cableKind, flight: cable.field("flight").string(), pull: cable.field("pull").string(), hold: cable.field("hold").string(), segmentLength: cable.field("segmentLength").integer(1) },
      fireSound: presentation.field("fireSound").nullable(entry => entry.string()), attachSound: presentation.field("attachSound").nullable(entry => entry.string()),
      releaseSound: presentation.field("releaseSound").nullable(entry => entry.string()), pullSound: presentation.field("pullSound").nullable(entry => entry.string()), hangSound: presentation.field("hangSound").nullable(entry => entry.string()) } };
}

export function qvmGrappleProfileDeclaration(profile: QvmGrappleProfile): unknown {
  return { ...profile, version: 1, artifactDigest: profile.module.digest, artifactPath: profile.module.artifactPath };
}
