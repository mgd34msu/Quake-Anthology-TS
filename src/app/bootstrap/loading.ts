/** Keep the native window serviced while an asynchronous loading operation owns it. */
export async function serviceLoading<T>(operation: () => Promise<T>, service: () => void): Promise<T> {
  let complete = false;
  const pending = operation().finally(() => { complete = true; });
  // Retain rejection until the operation is joined, including a service failure.
  const result = pending.then(value => ({ kind: "value", value } satisfies { kind: "value"; value: T }),
    (error: unknown) => ({ kind: "error", error } satisfies { kind: "error"; error: unknown }));
  try {
    while (!complete) { service(); await Bun.sleep(50); }
  } catch (error) { await result; throw error; }
  const settled = await result;
  if (settled.kind === "error") throw settled.error;
  return settled.value;
}
