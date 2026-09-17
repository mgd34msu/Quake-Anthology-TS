import { serveRenderWorker } from "../../../src/render/worker-transport.ts";
serveRenderWorker((initialization, request) => {
  const values: unknown[] = [];
  let closeCalls = 0;
  return {
    description: initialization,
    dispatch(payload) {
      if (payload === "outer") return request("outer-callback");
      if (payload === "inner") return request("inner-callback");
      if (payload === "leaf") return "leaf-result";
      if (payload === "failure") throw new RangeError("worker failure");
      if (payload === "slow") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
      if (payload === "values") return values.slice();
      values.push(payload); return payload;
    },
    close() { if (initialization === "close-fails-once" && closeCalls++ === 0) throw new Error("release failed"); return undefined; },
  };
});
