interface LoadingState {
  complete: boolean;
  frame: { readonly promise: Promise<void>; resolve(): void; reject(error: unknown): void } | undefined;
  failure: { readonly error: unknown } | undefined;
  wake: (() => void) | undefined;
}

/** Created outside serviceLoading: the operation keeps this closure, and serviceLoading's scope also holds the operation and its result. */
function createNextFrame(state: LoadingState): () => Promise<void> {
  return () => {
    if (state.failure !== undefined) return Promise.reject(state.failure.error);
    state.frame ??= Promise.withResolvers<void>(); state.wake?.(); return state.frame.promise;
  };
}

/** Keep the native window serviced while an asynchronous loading operation owns it. */
export async function serviceLoading<T>(operation: (nextFrame: () => Promise<void>) => Promise<T>, service: () => void): Promise<T> {
  const state: LoadingState = { complete: false, frame: undefined, failure: undefined, wake: undefined };
  const pending = operation(createNextFrame(state)).finally(() => { state.complete = true; state.wake?.(); });
  // Retain rejection until the operation is joined, including a service failure.
  const result = pending.then(value => ({ kind: "value", value } satisfies { kind: "value"; value: T }),
    (error: unknown) => ({ kind: "error", error } satisfies { kind: "error"; error: unknown }));
  try {
    while (!state.complete) {
      service(); const waiting = state.frame; state.frame = undefined; waiting?.resolve();
      await new Promise<void>(resolve => {
        const finish = (): void => { state.wake = undefined; resolve(); };
        let timer = setTimeout(finish, 50), notified = false;
        state.wake = () => {
          if (notified) return;
          notified = true; clearTimeout(timer);
          // Yield to native events without making every guest slice wait for the idle heartbeat.
          timer = setTimeout(finish, 0);
        };
        if (state.frame !== undefined || state.complete) state.wake();
      });
    }
  } catch (error) { state.failure = { error }; state.frame?.reject(error); await result; throw error; }
  const settled = await result;
  if (settled.kind === "error") throw settled.error;
  return settled.value;
}
