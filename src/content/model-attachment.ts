import { isContentDigest } from "../contracts/content.ts";
import type { ModelTransform } from "../contracts/scene.ts";
import type { ModelAttachmentDefinition } from "../contracts/model-attachment.ts";
import { cross3, dot3 } from "../core/math.ts";
import { SaveReader } from "../persistence/value.ts";

export function readModelAttachment(bytes: Uint8Array): ModelAttachmentDefinition {
  const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), reader = new SaveReader(input);
  reader.field("version").literal(1);
  const digest = reader.field("digest").string(); if (!isContentDigest(digest)) throw new Error("Model attachment requires its source digest");
  const common = { digest, grip: readModelGrip(reader.field("grip")) };
  if (reader.field("kind").choice("joint", "mesh") === "joint") return { ...common, kind: "joint", name: reader.field("name").string() };
  const vertices = reader.field("vertices").list(value => value.integer(0)), a = vertices[0], b = vertices[1], c = vertices[2];
  if (vertices.length !== 3 || a === undefined || b === undefined || c === undefined || new Set(vertices).size !== 3) throw new Error("Model attachment requires three distinct source vertices");
  return { ...common, kind: "mesh", referenceFrame: reader.field("referenceFrame").integer(0), vertices: [a, b, c] };
}

export function readModelGrip(grip: SaveReader): ModelTransform {
  const vector = (value: SaveReader) => ({ x: value.field("x").finite(), y: value.field("y").finite(), z: value.field("z").finite() });
  const axis = grip.field("axis").list(vector), first = axis[0], second = axis[1], third = axis[2];
  if (axis.length !== 3 || first === undefined || second === undefined || third === undefined) throw new Error("Model grip requires three source axes");
  if (axis.some(value => Math.abs(dot3(value, value) - 1) > 0.001) || Math.abs(dot3(first, second)) > 0.001 || Math.abs(dot3(first, third)) > 0.001 || Math.abs(dot3(second, third)) > 0.001 || dot3(cross3(first, second), third) < 0.999) throw new Error("Model grip axes must form a rotation");
  const scale = grip.field("scale").value === undefined ? { x: 1, y: 1, z: 1 } : vector(grip.field("scale"));
  if (scale.x === 0 || scale.y === 0 || scale.z === 0) return grip.fail("Model grip scale must be invertible");
  return { origin: vector(grip.field("origin")), axis: [first, second, third], scale };
}
