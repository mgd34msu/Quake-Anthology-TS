/* Cgame collision traps from id Software's code/client/cl_cgame.c,
 * code/cgame/cg_public.h and cg_syscalls.asm.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later */
import type { SourceClipModels } from "../../world/collision/q3/clip-models.ts";
import { SOURCE_BOX_MODEL_HANDLE } from "../../world/collision/q3/clip-models.ts";
import type { SourceTraceResult, TraceShape } from "../../world/collision/q3/world.ts";
import { vec3 } from "../../core/math.ts";
import type { Vec3 } from "../../core/math.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import type { QvmMemory } from "./memory.ts";
import { QVM_TRACE_BYTES, writeQvmTrace } from "./trace-record.ts";

function vector(memory: QvmMemory, word: number): Vec3 {
  const view = memory.view(word, 12);
  return vec3(view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true));
}

function boundsVector(memory: QvmMemory, word: number): Vec3 {
  return word === 0 ? vec3(0, 0, 0) : vector(memory, word);
}

export type QvmClientClipModels = Pick<SourceClipModels, 'modelCount' | 'inlineModel' | 'tempBoxModel' | 'pointContents' | 'transformedPointContents' | 'traceWithoutNodes' | 'trace' | 'transformedTrace'> & {
  readonly world: { readonly hasNodes: boolean };
};

export interface QvmClientCollisionServices {
  models(): QvmClientClipModels;
  loadMap(name: string): void | Promise<void>;
}

/** Uses the collision owner already loaded for this client map lifetime. */
export function qvmClientCollisionSyscall(call: QvmHostCall, services: QvmClientCollisionServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== "cgame") return null;
  const { words, guest: memory } = call, trap = call.code;
  if (trap === 18) {
    const loaded = services.loadMap(memory.readString(words.getInt32(4, true)));
    return loaded === undefined ? 0 : loaded.then(() => 0);
  }
  if (![19, 20, 22, 23, 24, 25, 26, 82, 83, 84].includes(trap)) return null;
  const models = services.models();
  switch (trap) {
    case 19: return models.modelCount;
    case 20: return models.inlineModel(words.getInt32(4, true));
    case 22:
    case 82: return models.tempBoxModel(vector(memory, words.getInt32(4, true)),
      vector(memory, words.getInt32(8, true)), trap === 82);
    case 23: {
      const point = words.getInt32(4, true), handle = words.getInt32(8, true);
      return models.world.hasNodes ? models.pointContents(vector(memory, point), handle) : 0;
    }
    case 24: {
      const point = words.getInt32(4, true), handle = words.getInt32(8, true);
      const origin = words.getInt32(12, true), angles = words.getInt32(16, true);
      return models.transformedPointContents(vector(memory, point), handle, vector(memory, origin),
        handle === SOURCE_BOX_MODEL_HANDLE ? vec3(0, 0, 0) : vector(memory, angles));
    }
    case 25:
    case 26:
    case 83:
    case 84: {
      const output = memory.view(words.getInt32(4, true), QVM_TRACE_BYTES);
      const handle = words.getInt32(24, true), mask = words.getInt32(28, true);
      if (trap === 25 || trap === 83) {
        const unloaded = models.traceWithoutNodes(handle);
        if (unloaded !== null) { writeQvmTrace(output, { ...unloaded, entityNum: 0 }); return 0; }
      }
      const start = vector(memory, words.getInt32(8, true));
      const end = vector(memory, words.getInt32(12, true));
      const mins = boundsVector(memory, words.getInt32(16, true));
      const maxs = boundsVector(memory, words.getInt32(20, true));
      const shape: TraceShape = { kind: trap === 83 || trap === 84 ? "capsule" : "box", mins, maxs };
      const query = { start, end, shape, mask };
      let result: SourceTraceResult;
      if (trap === 26 || trap === 84) {
        const origin = words.getInt32(32, true), angles = words.getInt32(36, true);
        result = models.transformedTrace(query, handle, vector(memory, origin),
          handle === SOURCE_BOX_MODEL_HANDLE ? vec3(0, 0, 0) : vector(memory, angles));
      } else result = models.trace(query, handle);
      // CM_Trace clears the entire trace work; cgame assigns entity identity later.
      writeQvmTrace(output, { ...result, entityNum: 0 });
      return 0;
    }
    // LoadModel is source-unused; mark fragments belong to renderer clipping.
    default: return null;
  }
}
