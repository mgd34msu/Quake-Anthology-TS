import { LlmSettingsError } from "./errors.ts";

export interface LlmRequestInput {
  readonly prompt: string;
  readonly instructions: string;
  readonly signal?: AbortSignal;
  readonly onText?: (text: string) => void;
}
export interface TransportRequest extends Omit<LlmRequestInput, "signal"> {
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly signal: AbortSignal;
}
export type LlmFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface LlmRequestOptions { readonly fetch?: LlmFetch; readonly timeoutMs?: number }

export function checkRequestAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new LlmSettingsError("LLM request cancelled.");
}
export async function withRequestAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop = (): void => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new LlmSettingsError("LLM request cancelled."));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener("abort", stop); }
}
export async function fetchLlmResponse(url: string, init: RequestInit, fetcher: LlmFetch, signal: AbortSignal): Promise<Response> {
  checkRequestAbort(signal);
  try {
    const pending = fetcher(url, { ...init, signal, redirect: "error" });
    void pending.then(response => {
      if (signal.aborted) cancelResponseBody(response);
    }, () => {});
    return await withRequestAbort(pending, signal);
  } catch {
    checkRequestAbort(signal);
    throw new LlmSettingsError("Could not reach the LLM service. Check its URL and connection.");
  }
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> { return value instanceof ReadableStream; }
export function responseBody(response: Response): ReadableStream<unknown> | null {
  const body: unknown = response.body;
  if (body === null) return null;
  if (!isReadableStream(body)) throw new LlmSettingsError("LLM service returned an invalid response body.");
  return body;
}
export function cancelResponseBody(response: Response): void {
  void responseBody(response)?.cancel().catch(() => {});
}
