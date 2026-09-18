/** Keep the native window serviced while an asynchronous loading operation owns it. */
export async function serviceLoading<T>(operation: (nextFrame: () => Promise<void>) => Promise<T>, service: () => void): Promise<T> {
  let complete = false;
  let frame: { readonly promise: Promise<void>; resolve(): void; reject(error: unknown): void } | undefined;
  let failure: { readonly error: unknown } | undefined;
  let wake: (() => void) | undefined;
  const nextFrame = (): Promise<void> => {
    if (failure !== undefined) return Promise.reject(failure.error);
    frame ??= Promise.withResolvers<void>(); wake?.(); return frame.promise;
  };
  const pending = operation(nextFrame).finally(() => { complete = true; wake?.(); });
  // Retain rejection until the operation is joined, including a service failure.
  const result = pending.then(value => ({ kind: "value", value } satisfies { kind: "value"; value: T }),
    (error: unknown) => ({ kind: "error", error } satisfies { kind: "error"; error: unknown }));
  try {
    while (!complete) {
      service(); const waiting = frame; frame = undefined; waiting?.resolve();
      await new Promise<void>(resolve => {
        const finish = (): void => { wake = undefined; resolve(); };
        let timer = setTimeout(finish, 50), notified = false;
        wake = () => {
          if (notified) return;
          notified = true; clearTimeout(timer);
          // Yield to native events without making every guest slice wait for the idle heartbeat.
          timer = setTimeout(finish, 0);
        };
        if (frame !== undefined || complete) wake();
      });
    }
  } catch (error) { failure = { error }; frame?.reject(error); await result; throw error; }
  const settled = await result;
  if (settled.kind === "error") throw settled.error;
  return settled.value;
}
