import { expect, test } from "bun:test";
import { serviceLoading } from "../../src/app/bootstrap/loading.ts";

test("loading frame waits are released by the existing service pump", async () => {
  let frames = 0;
  const observed: number[] = [];
  await serviceLoading(async nextFrame => {
    await nextFrame(); observed.push(frames);
    await nextFrame(); observed.push(frames);
  }, () => { frames++; });
  expect(observed).toEqual([1, 2]);
});

test("loading service failure rejects a pending script frame wait", async () => {
  const failure = new Error("window closed");
  await expect(serviceLoading(async nextFrame => { await nextFrame(); }, () => { throw failure; })).rejects.toBe(failure);
});
