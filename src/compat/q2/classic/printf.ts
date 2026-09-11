// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestCallValue, GuestValueLayout } from "../../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { q2Double, q2Int, q2Pointer } from "./layout.ts";
import { readClassicString } from "./records.ts";

interface Conversion { readonly start: number; readonly end: number; readonly flags: string; readonly width: string; readonly precision: string | undefined; readonly type: string }
function conversions(format: string): readonly Conversion[] {
  const entries: Conversion[] = [];
  for (let index = 0; index < format.length; index++) {
    if (format[index] !== "%") continue;
    const match = /^%([-+ #0]*)(\*|\d*)(?:\.(\*|\d*))?(?:l)?([%diuoxXcspfeEgG])/.exec(format.slice(index));
    if (match === null) throw new Error(`Unsupported API 3 printf conversion at ${format.slice(index, index + 12)}`);
    const flags = match[1], width = match[2], type = match[4];
    if (flags === undefined || width === undefined || type === undefined) throw new Error("Invalid API 3 printf parser result");
    entries.push({ start: index, end: index + match[0].length, flags, width, precision: match[3], type });
    index += match[0].length - 1;
  }
  return entries;
}
export function classicPrintfLayouts(format: string): readonly GuestValueLayout[] {
  const result: GuestValueLayout[] = [];
  for (const entry of conversions(format)) {
    if (entry.type === "%") continue;
    if (entry.width === "*") result.push(q2Int);
    if (entry.precision === "*") result.push(q2Int);
    result.push("feEgG".includes(entry.type) ? q2Double : "sp".includes(entry.type) ? q2Pointer : q2Int);
  }
  return result;
}
export function classicPrintf(memory: MappedGuestMemory, format: string, arguments_: readonly GuestCallValue[]): string {
  let next = 0, position = 0, result = "";
  function value(): GuestCallValue { const item = arguments_[next++]; if (item === undefined) throw new Error("API 3 printf argument missing"); return item; }
  function integer(): number { const item = value(); if (item.kind !== "int32" && item.kind !== "uint32") throw new TypeError("API 3 printf integer required"); return item.value; }
  for (const entry of conversions(format)) {
    result += format.slice(position, entry.start); position = entry.end;
    if (entry.type === "%") { result += "%"; continue; }
    const width = entry.width === "*" ? integer() : Number(entry.width);
    const precisionInput = entry.precision === "*" ? integer() : entry.precision === undefined ? undefined : Number(entry.precision);
    const precision = precisionInput !== undefined && precisionInput >= 0 ? precisionInput : undefined;
    if (Math.abs(width) > 65536 || precision !== undefined && precision > 100) throw new RangeError("API 3 printf width or precision exceeds supported buffer");
    const item = value(); let text: string;
    if (entry.type === "s" || entry.type === "p") {
      if (item.kind !== "pointer") throw new TypeError("API 3 printf pointer required");
      text = entry.type === "s" ? readClassicString(memory, item.value).slice(0, precision) : (item.value?.byteOffset ?? 0n).toString(16).padStart(8, "0");
    } else if ("feEgG".includes(entry.type)) {
      if (item.kind !== "float64") throw new TypeError("API 3 printf promoted double required");
      text = entry.type === "f" ? item.value.toFixed(precision ?? 6) : "eE".includes(entry.type) ? item.value.toExponential(precision ?? 6) : item.value.toPrecision(Math.max(1, precision ?? 6)).replace(/(\.\d*?)0+(e|$)/, "$1$2").replace(/\.(e|$)/, "$1");
      if (Object.is(item.value, -0)) text = `-${text}`;
      text = text.replace(/e([+-])(\d)$/, "e$10$2");
      if (entry.type === entry.type.toUpperCase()) text = text.toUpperCase();
    } else {
      if (item.kind !== "int32" && item.kind !== "uint32") throw new TypeError("API 3 printf integer required");
      const signed = item.value | 0, unsigned = item.value >>> 0;
      if (entry.type === "c") text = String.fromCharCode(unsigned & 255);
      else if ("di".includes(entry.type)) text = String(signed);
      else text = unsigned.toString(entry.type === "o" ? 8 : entry.type === "u" ? 10 : 16);
      if (entry.type === "X") text = text.toUpperCase();
      if (precision === 0 && unsigned === 0 && entry.type !== "c") text = entry.type === "o" && entry.flags.includes("#") ? "0" : "";
      if (precision !== undefined && entry.type !== "c") text = text.startsWith("-") ? `-${text.slice(1).padStart(precision, "0")}` : text.padStart(precision, "0");
      if (entry.flags.includes("#") && unsigned !== 0) text = entry.type === "o" ? `0${text}` : entry.type === "x" ? `0x${text}` : entry.type === "X" ? `0X${text}` : text;
    }
    if ("difeEgG".includes(entry.type) && !text.startsWith("-")) text = entry.flags.includes("+") ? `+${text}` : entry.flags.includes(" ") ? ` ${text}` : text;
    const left = width < 0 || entry.flags.includes("-"), fill = !left && entry.flags.includes("0") && precision === undefined && !"sc".includes(entry.type) ? "0" : " ";
    if (left) text = text.padEnd(Math.abs(width), " ");
    else if (fill === "0" && /^[+-]/.test(text)) text = text.slice(0, 1) + text.slice(1).padStart(Math.max(0, width - 1), fill);
    else if (fill === "0" && /^0[xX]/.test(text)) text = text.slice(0, 2) + text.slice(2).padStart(Math.max(0, width - 2), fill);
    else text = text.padStart(width, fill);
    result += text;
  }
  return result + format.slice(position);
}
