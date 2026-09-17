import { serveRenderWorker } from "./worker-transport.ts";
import { createRenderWorkerRuntime } from "./worker-runtime.ts";

serveRenderWorker(createRenderWorkerRuntime);
