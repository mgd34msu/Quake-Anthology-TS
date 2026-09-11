import type { BotSourceFiles } from "../../assets.ts";

/** The legacy text family uses byte characters; preserve values above ASCII without UTF-8 replacement. */
export function readBotSourceText(files: Pick<BotSourceFiles, "read">, path: string): string | null {
  const bytes = files.read(path);
  if (bytes === null) return null;
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let text = "";
  for (const byte of bytes.subarray(0, end)) text += String.fromCharCode(byte);
  return text;
}
