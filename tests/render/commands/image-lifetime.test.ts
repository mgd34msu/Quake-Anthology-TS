import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CpuImages } from "../../../src/render/cpu/textures.ts";
import { SceneImageRegistry, rgbaImage } from "../../../src/render/scene/resources.ts";

const level = { width: 1, height: 1, pixels: new Uint8Array([255, 128, 64, 255]) };
const content = rgbaImage(level);
const sampling = { wrap: "repeat", filter: "nearest" } satisfies Parameters<SceneImageRegistry["register"]>[2];
function fixture() {
  const identity = createIdentityOwner("shared image lifetime");
  const owner = { identity: Symbol("renderer"), session: identity.session, generation: 0 };
  return { root: new SceneImageRegistry(owner), cpu: new CpuImages(owner) };
}

test("retained menu and successive world scopes share ordinals and retire only their own images", () => {
  const { root, cpu } = fixture();
  const menu = root.register("menu", content, sampling), first = root.fork();
  const world = first.register("world", content, sampling);
  for (const operation of first.drainOperations()) cpu.apply(operation);
  expect(menu.ordinal).not.toBe(world.ordinal);
  cpu.bind(0, { kind: "bind-image", image: menu });
  cpu.bind(1, { kind: "bind-image", image: world });
  expect(() => root.release(world)).toThrow();
  first.close();
  const next = root.fork(), replacement = next.register("world", content, sampling);
  const operations = next.drainOperations();
  expect(operations.map(operation => operation.kind)).toEqual(["release-image", "create-image"]);
  for (const operation of operations) cpu.apply(operation);
  expect(replacement.ordinal).toBeGreaterThan(world.ordinal);
  expect(() => cpu.bind(1, { kind: "bind-image", image: world })).toThrow();
  cpu.bind(0, { kind: "bind-image", image: menu });
  cpu.bind(1, { kind: "bind-image", image: replacement });
  expect(root.isResident(menu)).toBe(true);
  root.close();
  for (const operation of root.drainPendingOperations()) cpu.apply(operation);
  expect(() => cpu.bind(0, { kind: "bind-image", image: menu })).toThrow();
  expect(() => next.register("closed", content, sampling)).toThrow();
  expect(() => root.fork()).toThrow();
  root.close();
  expect(root.drainPendingOperations()).toEqual([]);
});

test("already drained frame uploads precede later queued retirement, including failed preparations", () => {
  const { root, cpu } = fixture(), scene = root.fork();
  const image = scene.register("prepared", content, sampling);
  const frameOperations = scene.drainOperations();
  scene.close();
  for (const operation of frameOperations) cpu.apply(operation);
  cpu.bind(0, { kind: "bind-image", image });
  for (const operation of root.drainPendingOperations()) cpu.apply(operation);
  expect(() => cpu.bind(0, { kind: "bind-image", image })).toThrow();
  const failed = root.fork();
  failed.register("never presented", content, sampling);
  failed.close();
  const pending = root.drainPendingOperations();
  expect(pending.map(operation => operation.kind)).toEqual(["create-image", "release-image"]);
  for (const operation of pending) cpu.apply(operation);
});

test("execution-owned uploads retain scope identity, and independent renderers remain separate", () => {
  const { root, cpu } = fixture(), first = root.fork(), second = root.fork();
  const image = first.allocate(1, 1, { kind: "generated", name: "dynamic" });
  const operation = { kind: "create-image", image, content, sampling } satisfies Parameters<SceneImageRegistry["commit"]>[0];
  expect(() => second.commit(operation)).toThrow();
  cpu.apply(operation); first.commit(operation);
  expect(() => first.commit(operation)).toThrow();
  expect(() => cpu.apply(operation)).toThrow();
  expect(() => second.update(image, 0, level)).toThrow();
  first.close();
  for (const release of root.drainPendingOperations()) cpu.apply(release);
  const other = fixture();
  const foreign = other.root.register("separate", content, sampling);
  expect(foreign.ordinal).toBe(0);
  expect(() => cpu.apply(other.root.drainOperations()[0] ?? operation)).toThrow();
});

test("scope media clocks remain independent and final root shutdown stops remaining animations once", () => {
  const { root } = fixture(), seen: number[] = [], stopped: string[] = [];
  const menu = root.register("menu", content, sampling), world = root.fork({ sample: () => 42 });
  const image = world.register("movie", content, sampling);
  root.trackAnimation(menu, () => { throw Error("Menu clock must not be sampled by world drain"); }, () => stopped.push("menu"));
  world.trackAnimation(image, time => seen.push(time), () => stopped.push("world"));
  world.drainOperations();
  expect(seen).toEqual([42]);
  world.close(); root.drainPendingOperations();
  expect(stopped).toEqual(["world"]);
  root.close(); root.close();
  expect(stopped).toEqual(["world", "menu"]);
});
