import { LlmSettingsError } from "./errors.ts";
import { cancelResponseBody, checkRequestAbort, responseBody, withRequestAbort } from "./request.ts";

export interface SseEvent { readonly event: string; readonly data: string }
const MAX_STREAM_BYTES = 1_048_576;

export async function consumeSse(response: Response, signal: AbortSignal, onEvent: (event: SseEvent) => boolean | void): Promise<void> {
  const body = responseBody(response);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") || body === null) {
    cancelResponseBody(response);
    throw new LlmSettingsError("LLM service did not return an event stream.");
  }
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", event = "message", data: string[] = [], bytes = 0, stopped = false;
  const stop = (): void => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  function line(value: string): void {
    if (stopped) return;
    if (value === "") {
      if (data.length > 0) {
        checkRequestAbort(signal);
        stopped = onEvent({ event, data: data.join("\n") }) === true;
      }
      event = "message"; data = [];
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":"), field = colon === -1 ? value : value.slice(0, colon);
    let content = colon === -1 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (field === "data") data.push(content);
    else if (field === "event") event = content;
  }
  function drain(final: boolean): void {
    while (!stopped) {
      const end = buffer.search(/[\r\n]/);
      if (end === -1 || !final && end === buffer.length - 1 && buffer[end] === "\r") break;
      const width = buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1;
      const value = buffer.slice(0, end); buffer = buffer.slice(end + width); line(value);
    }
    if (final && !stopped && buffer !== "") { line(buffer); buffer = ""; }
    if (final && !stopped) line("");
  }
  try {
    checkRequestAbort(signal);
    while (!stopped) {
      const chunk = await withRequestAbort(reader.read(), signal);
      checkRequestAbort(signal);
      if (chunk.done) { buffer += decoder.decode(); drain(true); break; }
      if (!(chunk.value instanceof Uint8Array)) throw new LlmSettingsError("LLM service returned invalid stream bytes.");
      bytes += chunk.value.byteLength;
      if (bytes > MAX_STREAM_BYTES) throw new LlmSettingsError("LLM response exceeded the size limit.");
      buffer += decoder.decode(chunk.value, { stream: true }); drain(false);
    }
  } catch (error) {
    checkRequestAbort(signal);
    if (error instanceof LlmSettingsError) throw error;
    throw new LlmSettingsError("Could not read the LLM response stream.");
  } finally { signal.removeEventListener("abort", stop); stop(); reader.releaseLock(); }
}
