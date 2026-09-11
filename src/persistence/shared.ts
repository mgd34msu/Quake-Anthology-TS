import type { ArithmeticProfile, NumericProfile, RandomState } from "../contracts/numeric.ts";
import type { ClockProfile, FrameContext, FrameOrdering, SourceTime } from "../contracts/time.ts";
import type { Bounds, Vec3 } from "../contracts/math.ts";
import type { ContentDigest } from "../contracts/content.ts";
import { isContentDigest } from "../contracts/content.ts";
import { namespaced, SaveReader } from "./value.ts";

export function readDigest(reader: SaveReader): ContentDigest { if (!isContentDigest(reader.value)) return reader.fail("expected a SHA-256 content digest"); return reader.value; }
export function readTime(reader: SaveReader): SourceTime { return { kind: reader.field("kind").choice("seconds", "milliseconds"), value: reader.field("value").finite() }; }
export function readVector(reader: SaveReader): Vec3 { return { x: reader.field("x").number(), y: reader.field("y").number(), z: reader.field("z").number() }; }
export function readBounds(reader: SaveReader): Bounds { return { min: readVector(reader.field("min")), max: readVector(reader.field("max")) }; }
export function readFrame(reader: SaveReader): FrameContext {
  return { frame: reader.field("frame").integer(0), time: readTime(reader.field("time")), elapsed: readTime(reader.field("elapsed")),
    phase: reader.field("phase").choice("frame-entry", "client-command", "entity-prethink", "entity-physics", "entity-think", "client-end-frame", "frame-exit") };
}
export function readClock(reader: SaveReader): ClockProfile {
  switch (reader.field("kind").choice("q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3")) {
    case "q1-netquake": return { kind: "q1-netquake", minimumFrameSeconds: reader.field("minimumFrameSeconds").finite(), maximumFrameSeconds: reader.field("maximumFrameSeconds").finite(), fixedFrameSeconds: reader.field("fixedFrameSeconds").nullable(value => value.finite()) };
    case "q1-quakeworld": return { kind: "q1-quakeworld", maximumCommandMilliseconds: reader.field("maximumCommandMilliseconds").finite() };
    case "q2-classic": return { kind: "q2-classic", frameMilliseconds: reader.field("frameMilliseconds").literal(100) };
    case "q2-rerelease": return { kind: "q2-rerelease", frameMilliseconds: reader.field("frameMilliseconds").finite(), preparation: reader.field("preparation").literal("before-frame") };
    case "q3": return { kind: "q3", serverFrameMilliseconds: reader.field("serverFrameMilliseconds").finite(), fixedMovementMilliseconds: reader.field("fixedMovementMilliseconds").nullable(value => value.finite()), maximumCommandMilliseconds: reader.field("maximumCommandMilliseconds").literal(200) };
  }
}
export function readArithmetic(reader: SaveReader): ArithmeticProfile {
  switch (reader.field("kind").choice("binary32", "donor-binary64", "x87", "sse")) {
    case "binary32": return { kind: "binary32", round: reader.field("round").literal("each-operation") };
    case "donor-binary64": return { kind: "donor-binary64", source: reader.field("source").choice("q1-ts", "q2-ts") };
    case "x87": return { kind: "x87", precisionBits: reader.field("precisionBits").choice(24, 53, 64), rounding: reader.field("rounding").choice("nearest-even", "toward-zero", "toward-positive", "toward-negative") };
    case "sse": return { kind: "sse", flushToZero: reader.field("flushToZero").boolean(), denormalsAreZero: reader.field("denormalsAreZero").boolean(), rounding: reader.field("rounding").choice("nearest-even", "toward-zero", "toward-positive", "toward-negative") };
  }
}
export function readNumeric(reader: SaveReader): NumericProfile {
  return { id: namespaced(reader.field("id")), arithmetic: readArithmetic(reader.field("arithmetic")), scalarStorage: reader.field("scalarStorage").literal("binary32"),
    floatToInt: reader.field("floatToInt").choice("qvm-indefinite", "x86-indefinite", "checked-c-truncation"), integerOverflow: reader.field("integerOverflow").literal("wrap32") };
}
export function readRandom(reader: SaveReader): RandomState {
  const draws = reader.field("draws").integer(0);
  switch (reader.field("kind").choice("q3-lcg", "msvcrt-rand", "glibc-random", "guest")) {
    case "q3-lcg": return { kind: "q3-lcg", seed: reader.field("seed").integer(), draws };
    case "msvcrt-rand": return { kind: "msvcrt-rand", seed: reader.field("seed").integer(), draws };
    case "glibc-random": return { kind: "glibc-random", words: reader.field("words").list(value => value.integer()), front: reader.field("front").integer(0), rear: reader.field("rear").integer(0), draws };
    case "guest": return { kind: "guest", module: reader.field("module").string(), bytes: reader.field("bytes").bytes(), draws };
  }
}
export function readOrdering(reader: SaveReader): FrameOrdering {
  switch (reader.field("kind").choice("native", "mixed")) {
    case "native": return { kind: "native", traversal: reader.field("traversal").literal("source-slot-order"), clock: readClock(reader.field("clock")) };
    case "mixed": return { kind: "mixed", providers: reader.field("providers").list(namespaced), entityOrder: reader.field("entityOrder").literal("source-slot-order"), ties: reader.field("ties").literal("provider-entity-invocation") };
  }
}
