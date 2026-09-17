import { directServerText } from "./server-browser-addresses.ts";
import { isReadableStream } from "../../network/common/value.ts";

/** q2 client/cl_servers.ts ParseMasterPlain, with bounded response ownership. */
export async function fetchServerMasterList(url: string, signal: AbortSignal): Promise<readonly string[]> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Master lists require HTTP or HTTPS");
  const response = await fetch(target, { signal });
  if (!response.ok) throw new Error(`Master list returned HTTP ${response.status}`);
  const body: unknown = response.body;
  if (!isReadableStream(body)) throw new Error("Master list has no response body");
  const reader = body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error("Master list response is not a byte stream");
      length += part.value.length;
      if (length > 1024 * 1024) throw new Error("Master list exceeds 1 MiB");
      chunks.push(part.value);
    }
  } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const servers = [...new Set(new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/).map(line => line.trim()).filter(line => line !== "" && !line.startsWith("#")))];
  if (servers.length > 4096) throw new Error("Master list exceeds 4096 servers");
  return servers.map(directServerText);
}
