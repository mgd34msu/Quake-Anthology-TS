/*
 * Foundation adoption microbenchmarks: the former allocating data paths
 * (reconstructed here from their surviving allocating forms) against the
 * shared-foundation paths now used by the engine. Each measurement is the
 * median of three rounds over retained structures, as in engine use.
 * Component timings only; they do not establish whole-frame FPS changes.
 * Run: bun run tools/bench-foundation.ts
 */
import {
  EventRing, IdIndex, StampSet, StringTable, createVec3Store,
  vec3AngleVectors, vec3Cross, vec3Normalize, vec3Scratch, vec3Set, vec3Sub,
} from "../src/foundation/index.ts";
import {
  angleVectors, angleVectorsInto, cross3, cross3Into, dot3,
  lookAtMat4, mutableVec3, normalize3, normalize3Into, projectPointOnPlane,
  scale3, sub3, sub3Into, vec3, type Mat4, type Vec3,
} from "../src/core/math.ts";
import { float32ToBits } from "../src/core/numeric.ts";

interface Result { readonly nsPerOp: number; readonly checksum: number }

function bench(iterations: number, run: () => number): Result {
  let checksum = 0;
  for (let i = 0; i < iterations / 5; i++) checksum += run();
  const rounds: number[] = [];
  for (let round = 0; round < 3; round++) {
    const start = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) checksum += run();
    rounds.push((Bun.nanoseconds() - start) / iterations);
  }
  rounds.sort((left, right) => left - right);
  return { nsPerOp: rounds[1] ?? 0, checksum };
}

function report(group: string, former: Result, found: Result): void {
  const ratio = former.nsPerOp / found.nsPerOp;
  console.log(`${group}`);
  console.log(`  former  ${former.nsPerOp.toFixed(1).padStart(10)} ns/op  (checksum ${former.checksum})`);
  console.log(`  found.  ${found.nsPerOp.toFixed(1).padStart(10)} ns/op  (checksum ${found.checksum})  ${ratio.toFixed(2)}x`);
}

const a = vec3(120.5, -45.25, 890.75);
const b = vec3(-300.25, 64.5, 12.125);
const angles = vec3(15, 40, -70);

// 1. Float32 bit reinterpretation: per-call ArrayBuffer vs retained scratch.
function allocatingBits(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}
{
  let tick = 0;
  const former = bench(200_000, () => allocatingBits(tick++ * 0.5));
  tick = 0;
  const found = bench(200_000, () => float32ToBits(tick++ * 0.5));
  report("float32ToBits", former, found);
}

// 2. normalize(cross(sub)) chain: allocating objects vs Into on plain scratch vs flat store.
function allocatingChain(): number {
  const value = normalize3(cross3(sub3(a, b), a));
  return value.x + value.y + value.z;
}
{
  const s1 = vec3Scratch();
  const s2 = vec3Scratch();
  const s3 = vec3Scratch();
  report("normalize(cross(sub)) allocating vs Into (plain scratch)",
    bench(200_000, allocatingChain),
    bench(200_000, () => {
      sub3Into(s1, a, b);
      cross3Into(s2, s1, a);
      normalize3Into(s3, s2);
      return s3.x + s3.y + s3.z;
    }));
  const retained = mutableVec3();
  const retained2 = mutableVec3();
  const retained3 = mutableVec3();
  report("normalize(cross(sub)) allocating vs Into (retained binary32 scratch)",
    bench(200_000, allocatingChain),
    bench(200_000, () => {
      sub3Into(retained, a, b);
      cross3Into(retained2, retained, a);
      normalize3Into(retained3, retained2);
      return retained3.x + retained3.y + retained3.z;
    }));
  const store = createVec3Store(4);
  vec3Set(store, 0, a.x, a.y, a.z);
  vec3Set(store, 1, b.x, b.y, b.z);
  report("normalize(cross(sub)) allocating vs Float32Array store",
    bench(200_000, allocatingChain),
    bench(200_000, () => {
      vec3Sub(store, 2, 0, 1);
      vec3Cross(store, 3, 2, 0);
      vec3Normalize(store, 3, 3);
      return (store[9] ?? 0) + (store[10] ?? 0) + (store[11] ?? 0);
    }));
}

// 3. Angle vectors.
{
  const s1 = vec3Scratch();
  const s2 = vec3Scratch();
  const s3 = vec3Scratch();
  report("angleVectors allocating vs Into (plain scratch)",
    bench(200_000, () => {
      const value = angleVectors(angles);
      return value.forward.x + value.right.y + value.up.z;
    }),
    bench(200_000, () => {
      angleVectorsInto(s1, s2, s3, angles);
      return s1.x + s2.y + s3.z;
    }));
  const store = createVec3Store(4);
  vec3Set(store, 0, angles.x, angles.y, angles.z);
  report("angleVectors allocating vs store",
    bench(200_000, () => {
      const value = angleVectors(angles);
      return value.forward.x + value.right.y + value.up.z;
    }),
    bench(200_000, () => {
      vec3AngleVectors(store, 1, 2, 3, 0);
      return (store[3] ?? 0) + (store[7] ?? 0) + (store[11] ?? 0);
    }));
}

// 4. Project-point-on-plane: former object composition vs scalar implementation.
function formerProject(point: Vec3, normal: Vec3): Vec3 {
  const inverse = Math.fround(1 / dot3(normal, normal));
  const distance = Math.fround(dot3(normal, point) * inverse);
  const scaled = scale3(normal, inverse);
  return sub3(point, scale3(scaled, distance));
}
report("projectPointOnPlane",
  bench(200_000, () => {
    const value = formerProject(a, b);
    return value.x + value.y + value.z;
  }),
  bench(200_000, () => {
    const value = projectPointOnPlane(a, b);
    return value.x + value.y + value.z;
  }));

// 5. Look-at: former normalize/cross composition vs scalar implementation, both building Mat4.
function formerLookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const backward = normalize3(sub3(eye, target));
  const right = normalize3(cross3(up, backward));
  const cameraUp = cross3(backward, right);
  return [
    right.x, cameraUp.x, backward.x, 0,
    right.y, cameraUp.y, backward.y, 0,
    right.z, cameraUp.z, backward.z, 0,
    -dot3(right, eye), -dot3(cameraUp, eye), -dot3(backward, eye), 1,
  ];
}
report("lookAtMat4",
  bench(100_000, () => {
    const matrix = formerLookAt(a, b, vec3(0, 0, 1));
    return (matrix[0] ?? 0) + (matrix[5] ?? 0) + (matrix[10] ?? 0) + (matrix[12] ?? 0) + (matrix[13] ?? 0) + (matrix[14] ?? 0);
  }),
  bench(100_000, () => {
    const matrix = lookAtMat4(a, b, vec3(0, 0, 1));
    return (matrix[0] ?? 0) + (matrix[5] ?? 0) + (matrix[10] ?? 0) + (matrix[12] ?? 0) + (matrix[13] ?? 0) + (matrix[14] ?? 0);
  }));

// 6. Event queue: retained array push/splice drain vs retained ring visitor drain (64 per batch).
{
  const batch = 64;
  const queue: number[] = [];
  const ring = new EventRing<number>(1024);
  const cursor = ring.openCursor();
  report("event batch of 64 (retained array splice vs retained ring visitor)",
    bench(20_000, () => {
      for (let i = 0; i < batch; i++) queue.push(i);
      let sum = 0;
      for (const value of queue.splice(0)) sum += value;
      return sum;
    }),
    bench(20_000, () => {
      for (let i = 0; i < batch; i++) ring.append(i);
      let sum = 0;
      ring.drain(cursor, (value) => { sum += value; });
      ring.retire();
      return sum;
    }));
}

// 7. Visit marks: cleared Set vs epoch stamp set (256 marks per query).
{
  const stamps = new StampSet(4096);
  report("visit marks x256 (Set clear vs stamp epoch)",
    bench(20_000, () => {
      const seen = new Set<number>();
      let fresh = 0;
      for (let i = 0; i < 256; i++) if (!seen.has(i * 7 % 4096)) { seen.add(i * 7 % 4096); fresh++; }
      return fresh;
    }),
    bench(20_000, () => {
      stamps.begin();
      let fresh = 0;
      for (let i = 0; i < 256; i++) if (stamps.mark(i * 7 % 4096)) fresh++;
      return fresh;
    }));
}

// 8. Resource lookup: template-string map key vs interned id index.
{
  const contents = ["q1:classic:id1:base", "q2:classic:baseq2:base", "q3:arena:baseq3:base"];
  const paths: string[] = [];
  for (let i = 0; i < 299; i++) paths.push(`sound/weapons/weapon${i}.wav`);
  const stringMap = new Map<string, number>();
  const names = new StringTable(() => 0);
  const idIndex = new IdIndex();
  idIndex.reserve(contents.length * paths.length);
  let row = 0;
  for (const content of contents) {
    for (const path of paths) {
      stringMap.set(`${content}/${path}`, row);
      idIndex.insert(names.intern(path), names.intern(content), row);
      row++;
    }
  }
  let pick = 0;
  const former = bench(200_000, () => {
    const content = contents[pick % contents.length] ?? "";
    const path = paths[pick % paths.length] ?? "";
    pick++;
    return stringMap.get(`${content}/${path}`) ?? -1;
  });
  pick = 0;
  const found = bench(200_000, () => {
    const content = contents[pick % contents.length] ?? "";
    const path = paths[pick % paths.length] ?? "";
    pick++;
    return idIndex.find(names.find(path), names.find(content));
  });
  report("resource lookup (897 entries)", former, found);
}

// 9. Scheduler ordering: indexOf per comparison vs bound integer ranks (sorting 256 thinks).
{
  interface ThinkRow { provider: string; rank: number; slot: number; sequence: number }
  const providers = ["q1:game", "q2:game", "q3:game", "q1:mod", "q2:mod", "q3:mod"];
  const thinks: ThinkRow[] = [];
  for (let i = 0; i < 256; i++) {
    thinks.push({ provider: providers[i % providers.length] ?? "", rank: i % providers.length, slot: (i * 37) % 256, sequence: i });
  }
  report("think ordering sort x256 (indexOf vs rank)",
    bench(5_000, () => {
      const rows = [...thinks];
      rows.sort((left, right) => providers.indexOf(left.provider) - providers.indexOf(right.provider)
        || left.slot - right.slot || left.sequence - right.sequence);
      return rows[0]?.sequence ?? 0;
    }),
    bench(5_000, () => {
      const rows = [...thinks];
      rows.sort((left, right) => left.rank - right.rank || left.slot - right.slot || left.sequence - right.sequence);
      return rows[0]?.sequence ?? 0;
    }));
}

// 10. Bulk entity-style processing: retained results prevent allocation
// sinking, which is the shape the flat store is built for (512 vectors).
{
  const count = 512;
  const inputs: Vec3[] = [];
  for (let i = 0; i < count; i++) inputs.push(vec3(i * 0.5 - 128, 64 - i * 0.25, (i % 97) - 48));
  const retained: Vec3[] = new Array<Vec3>(count);
  const bulkStore = createVec3Store(count * 2);
  for (let i = 0; i < count; i++) {
    const value = inputs[i] ?? vec3(0, 0, 0);
    vec3Set(bulkStore, i, value.x, value.y, value.z);
  }
  report("bulk normalize x512 (retained objects vs store slots)",
    bench(2_000, () => {
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const value = normalize3(inputs[i] ?? vec3(0, 0, 0));
        retained[i] = value;
        sum += value.x;
      }
      return sum;
    }),
    bench(2_000, () => {
      let sum = 0;
      for (let i = 0; i < count; i++) {
        vec3Normalize(bulkStore, count + i, i);
        sum += bulkStore[(count + i) * 3] ?? 0;
      }
      return sum;
    }));
}

console.log("Component timings only; no whole-frame claim. Checksums guard against dead-code elimination.");
