// SPDX-License-Identifier: GPL-2.0-or-later
/* A native guest world's map travel is written once as a generator of stages. The synchronous and the loading
 * (frame-yielding) entry points differ only in how each stage executes, so the two cannot drift apart. */

/** Runs the stages with synchronous host calls. A stage failure is thrown into the generator so its cleanup runs. */
export function driveTravel<Step, Result>(stages: Generator<Step, Result, undefined>, execute: (step: Step) => void): Result {
  let next = stages.next();
  while (next.done !== true) {
    try {
      execute(next.value);
    } catch (error) {
      stages.throw(error);
      throw error;
    }
    next = stages.next();
  }
  return next.value;
}

/** Same stages with loading host calls that yield to the frame loop between instruction slices. */
export async function driveTravelLoading<Step, Result>(stages: Generator<Step, Result, undefined>, execute: (step: Step) => Promise<void>): Promise<Result> {
  let next = stages.next();
  while (next.done !== true) {
    try {
      await execute(next.value);
    } catch (error) {
      stages.throw(error);
      throw error;
    }
    next = stages.next();
  }
  return next.value;
}
