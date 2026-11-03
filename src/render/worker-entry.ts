// SPDX-License-Identifier: GPL-2.0-or-later
import { serveRenderWorker } from "./worker-transport.ts";
import { createRenderWorkerRuntime } from "./worker-runtime.ts";

serveRenderWorker(createRenderWorkerRuntime);
