// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from "bun:test";

/**
 * One capability gate for tests that need a GL window. `bun run test:gl` sets
 * QUAKE_GL_SMOKE=1 (with a GL-capable SDL driver); without it these tests skip
 * instead of failing under the dummy driver or opening windows on a desktop.
 */
export const glEnabled = process.env["QUAKE_GL_SMOKE"] === "1";
export const glTest: typeof test = glEnabled ? test : test.skip;
export const rendererBackends: readonly ("cpu" | "gl")[] = glEnabled ? ["cpu", "gl"] : ["cpu"];
