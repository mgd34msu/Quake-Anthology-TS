// SPDX-License-Identifier: GPL-2.0-or-later
// Quake rerelease localization grammar and substitutions.
import type { SeatId } from "../contracts/identity.ts";
export interface LibLog { warn(text: string): void; info?(text: string): void; }
const MAX_LOC_KEY = 64;
const MAX_LOC_FORMAT = 1024;
const MAX_LOC_ARGS = 8;
const MAX_STRING_CHARS = 1024;
const utf8 = new TextEncoder();
interface LocArg {
    argIndex: number;
    start: number;
    end: number;
}
interface LocString {
    format: string;
    arguments: LocArg[];
}
function strlcpy(src: string, size: number): string {
    if (size <= 0)
        return "";
    const bytes = utf8.encode(src);
    if (bytes.length < size) return src;
    let end = Math.max(0, Math.trunc(size) - 1);
    while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
    return new TextDecoder().decode(bytes.subarray(0, end));
}
function strnlcpy(src: string, count: number, size: number): string {
    if (size <= 0)
        return "";
    const ret = Math.min(count, src.length);
    return strlcpy(src.slice(0, ret), size);
}
function strlcat(dst: string, src: string, size: number): string {
    return dst + strlcpy(src, size - utf8.encode(dst).length);
}
function strnlcat(dst: string, src: string, count: number, size: number): string {
    return dst + strnlcpy(src, count, size - utf8.encode(dst).length);
}
type LocParseResult = {
    ok: true;
    arguments: LocArg[];
} | {
    ok: false;
    error: string;
};
function Loc_Parse(format: string): LocParseResult {
    let argIndexState = 0;
    let argRover = 0;
    const formatLen = format.length;
    const args: LocArg[] = [];
    const at = (i: number): string => format.charAt(i);
    while (true) {
        if (argRover >= formatLen || !at(argRover)) {
            break;
        }
        if (at(argRover) === "{") {
            const argStart = argRover;
            argRover++;
            if (at(argRover) && at(argRover) === "{") {
                continue;
            }
            if (args.length === MAX_LOC_ARGS) {
                return { ok: false, error: "too many arguments" };
            }
            const arg: LocArg = { argIndex: 0, start: argStart, end: 0 };
            args.push(arg);
            const rest = format.slice(argRover);
            const digits = /^[0-9]+/.exec(rest);
            const endPtrOffset = digits ? argRover + digits[0].length : argRover;
            if (endPtrOffset === argRover) {
                if (argIndexState === -1) {
                    return { ok: false, error: "encountered sequential argument, but has positional args" };
                }
                arg.argIndex = argIndexState & 0xff;
                argIndexState++;
            }
            else {
                if (argIndexState > 0) {
                    return { ok: false, error: "encountered positional argument, but has sequential args" };
                }
                arg.argIndex = Number.parseInt(digits?.[0] ?? "0", 10) & 0xff;
                argIndexState = -1;
            }
            argRover = endPtrOffset - 1;
            while (true) {
                if (argRover >= formatLen || !at(argRover)) {
                    return { ok: false, error: "EOF before end of argument found" };
                }
                argRover++;
                if (at(argRover) !== "}") {
                    continue;
                }
                const argEnd = argRover;
                argRover++;
                if (at(argRover) && at(argRover) === "}") {
                    continue;
                }
                arg.end = argEnd + 1;
                break;
            }
        }
        else {
            argRover++;
        }
    }
    if (args.length) {
        args.sort((a, b) => a.start - b.start);
    }
    return { ok: true, arguments: args };
}
function Loc_HasArguments(base: string): boolean {
    const len = base.length;
    for (let i = 0; i < len; i++) {
        if (base[i] === "{") {
            i++;
            if (i >= len)
                return false;
            if (base[i] !== "{")
                return true;
        }
    }
    return false;
}
const PARSE_FLAG_NONE = 0;
const PARSE_FLAG_ESCAPE = 1;
interface TokenState {
    data: string;
    index: number;
}
function cc(s: string, i: number): number {
    return i < s.length ? s.charCodeAt(i) : 0;
}
function parseEscapeSequence(state: TokenState): number | null {
    const code = cc(state.data, state.index);
    state.index++;
    if (code === 0)
        return null;
    if (code === 0x6e)
        return 0x0a;
    if (code === 0x74)
        return 0x09;
    if (code === 0x72)
        return 0x0d;
    return code;
}
function comParseToken(state: TokenState, size: number, flags: number): string {
    let result = "";
    let len = 0;
    for (;;) {
        let c = cc(state.data, state.index);
        while (c <= 32) {
            if (c === 0)
                return "";
            state.index++;
            c = cc(state.data, state.index);
        }
        if (c === 0x2f && cc(state.data, state.index + 1) === 0x2f) {
            state.index += 2;
            while (cc(state.data, state.index) !== 0 && cc(state.data, state.index) !== 0x0a)
                state.index++;
            continue;
        }
        if (c === 0x2f && cc(state.data, state.index + 1) === 0x2a) {
            state.index += 2;
            while (cc(state.data, state.index) !== 0) {
                if (cc(state.data, state.index) === 0x2a && cc(state.data, state.index + 1) === 0x2f) {
                    state.index += 2;
                    break;
                }
                state.index++;
            }
            continue;
        }
        break;
    }
    let c = cc(state.data, state.index);
    if (c === 0x3d) {
        state.index++;
        return "=";
    }
    if (c === 0x22) {
        state.index++;
        for (;;) {
            c = cc(state.data, state.index);
            state.index++;
            if (c === 0x22 || c === 0) {
                return strlcpy(result, size);
            }
            if (c === 0x5c && (flags & PARSE_FLAG_ESCAPE) !== 0) {
                const esc = parseEscapeSequence(state);
                if (esc === null)
                    return strlcpy(result, size);
                c = esc;
            }
            if (len + 1 < size) {
                result += String.fromCharCode(c);
            }
            len++;
        }
    }
    do {
        if (c === 0x5c && (flags & PARSE_FLAG_ESCAPE) !== 0) {
            const esc = parseEscapeSequence(state);
            if (esc === null)
                break;
            c = esc;
        }
        if (len + 1 < size) {
            result += String.fromCharCode(c);
        }
        len++;
        state.index++;
        c = cc(state.data, state.index);
    } while (c > 32 && c !== 0x3d);
    return strlcpy(result, size);
}
export interface LocReloadOptions {
    platform?: string;
    log?: LibLog;
    duplicateKeys?: "first" | "last";
}
function stripPlatformTag(token: string): string {
    let s = token;
    if (s.charAt(0) === "<")
        s = s.slice(1);
    if (s.charAt(s.length - 1) === ">")
        s = s.slice(0, -1);
    return s.toLowerCase();
}
interface LocEntrySink {
    has(key: string): boolean;
    set(key: string, value: LocString): void;
}
function Loc_ParseInto(bytes: Uint8Array, opts: LocReloadOptions, sink: LocEntrySink): number {
    const platform = opts.platform?.toLowerCase();
    const text = new TextDecoder("utf-8").decode(bytes);
    const state: TokenState = { data: text, index: 0 };
    let numLocs = 0;
    while (true) {
        const key = comParseToken(state, MAX_LOC_KEY, PARSE_FLAG_NONE);
        if (!key)
            break;
        let equals = comParseToken(state, MAX_STRING_CHARS, PARSE_FLAG_NONE);
        let hasPlatformSpec = false;
        const platformTags: string[] = [];
        if (!equals) {
            break;
        }
        else if (equals.charAt(0) === "<") {
            hasPlatformSpec = true;
            while (equals && equals.charAt(equals.length - 1) !== ">") {
                platformTags.push(stripPlatformTag(equals));
                equals = comParseToken(state, MAX_STRING_CHARS, PARSE_FLAG_NONE);
            }
            if (equals)
                platformTags.push(stripPlatformTag(equals));
            equals = comParseToken(state, MAX_STRING_CHARS, PARSE_FLAG_NONE);
        }
        if (equals !== "=")
            break;
        const format = comParseToken(state, MAX_LOC_FORMAT, PARSE_FLAG_ESCAPE);
        const parsed = Loc_Parse(format);
        if (!parsed.ok) {
            opts.log?.warn(`loc parse error (${key}): ${parsed.error}`);
            continue;
        }
        if (hasPlatformSpec) {
            if (platform !== undefined && platformTags.includes(platform)) {
                sink.set(key, { format, arguments: parsed.arguments });
                numLocs++;
            }
            continue;
        }
        if (opts.duplicateKeys === "last" || !sink.has(key)) {
            sink.set(key, { format, arguments: parsed.arguments });
            numLocs++;
        }
    }
    return numLocs;
}
export interface LocLoadTier {
    base: Uint8Array | null;
    mods: readonly Uint8Array[];
}
const LOCALE_LANGUAGE_TABLE: ReadonlyMap<string, string> = new Map([
    ["en", "english"],
    ["fr", "french"],
    ["de", "german"],
    ["it", "italian"],
    ["ru", "russian"],
    ["es", "spanish"],
]);
export const LOC_KNOWN_LANGUAGES: readonly string[] = ["english", "french", "german", "italian", "russian", "spanish"];
export function Loc_LanguageFromLocale(tag: string | null | undefined): string {
    if (!tag)
        return "english";
    const stripped = (tag.split(".")[0] ?? "").split("@")[0] ?? "";
    const primary = (stripped.split(/[-_]/)[0] ?? "").toLowerCase();
    return LOCALE_LANGUAGE_TABLE.get(primary) ?? "english";
}
export class LocalizationTable {
private readonly locTable = new Map<string, LocString>();
constructor(readonly profile: "q1-rerelease" | "q2-rerelease" = "q1-rerelease") {}
lookup(key: string, args: readonly string[] = []): string | null {
    const name = key.startsWith("$") ? key.slice(1) : key;
    return this.find(name) === undefined ? null : this.localize("$" + name, args);
}
find(base: string): LocString | undefined {
    return this.locTable.get(base);
}
localizeSource(base: string, allow_in_place: boolean, args: readonly string[] | null, num_args: number, output_length: number = MAX_STRING_CHARS, log?: LibLog): string {
    let workingBase = base;
    let str: LocString | undefined;
    if (!allow_in_place) {
        if (workingBase.charAt(0) !== "$") {
            return strlcpy(workingBase, output_length);
        }
        workingBase = workingBase.slice(1);
        str = this.find(workingBase);
    }
    else {
        if (workingBase.charAt(0) === "$") {
            workingBase = workingBase.slice(1);
            str = this.find(workingBase);
        }
        else if (Loc_HasArguments(workingBase)) {
            const inPlaceFormat = strlcpy(workingBase, MAX_LOC_FORMAT);
            const parsed = Loc_Parse(inPlaceFormat);
            if (!parsed.ok) {
                log?.warn(`in-place localization of "${workingBase}" failed: ${parsed.error}`);
                return strlcpy(workingBase, output_length);
            }
            str = { format: inPlaceFormat, arguments: parsed.arguments };
        }
        else {
            return strlcpy(workingBase, output_length);
        }
    }
    if (!str) {
        return strlcpy(workingBase, output_length);
    }
    if (str.arguments.length === 0) {
        return strlcpy(str.format, output_length);
    }
    for (const arg of str.arguments) {
        if (arg.argIndex >= num_args) {
            log?.warn(`Loc_Localize: base "${workingBase}" localized with too few arguments`);
            return strlcpy(workingBase, output_length);
        }
    }
    for (let i = 0; i < num_args; i++) {
        if (!args || args[i] == null) {
            log?.warn(`Loc_Localize: invalid argument at position ${i}`);
            return strlcpy(workingBase, output_length);
        }
    }
    const argList: readonly string[] = args ?? [];
    let arg = str.arguments[0];
    if (arg === undefined) return strlcpy(str.format, output_length);
    let output = strnlcpy(str.format, arg.start, output_length);
    for (let i = 0; i < str.arguments.length - 1; i++) {
        const localizedArg = this.localizeSource(argList[arg.argIndex] ?? "", false, null, 0, MAX_STRING_CHARS, log);
        output = strlcat(output, localizedArg, output_length);
        const nextArg = str.arguments[i + 1];
        if (nextArg === undefined) throw new RangeError("Missing localization argument record");
        output = strnlcat(output, str.format.slice(arg.end), nextArg.start - arg.end, output_length);
        arg = nextArg;
    }
    const lastLocalizedArg = this.localizeSource(argList[arg.argIndex] ?? "", false, null, 0, MAX_STRING_CHARS, log);
    output = strlcat(output, lastLocalizedArg, output_length);
    return strlcat(output, str.format.slice(arg.end), output_length);
}
clear(): void {
    this.locTable.clear();
}
reload(bytes: Uint8Array | null, opts: LocReloadOptions = {}): number {
    this.clear();
    if (!bytes) {
        return 0;
    }
    const numLocs = Loc_ParseInto(bytes, { duplicateKeys: this.profile === "q2-rerelease" ? "last" : "first", ...opts }, this.locTable);
    opts.log?.info?.(`Loaded ${numLocs} localization strings`);
    return numLocs;
}
merge(bytes: Uint8Array | null, opts: LocReloadOptions = {}): number {
    if (!bytes) {
        return 0;
    }
    const seenThisFile = new Set<string>();
    const sink: LocEntrySink = {
        has: (key) => seenThisFile.has(key),
        set: (key, value) => {
            seenThisFile.add(key);
            this.locTable.set(key, value);
        },
    };
    const numLocs = Loc_ParseInto(bytes, { duplicateKeys: this.profile === "q2-rerelease" ? "last" : "first", ...opts }, sink);
    opts.log?.info?.(`Merged ${numLocs} localization strings`);
    return numLocs;
}
size(): number {
    return this.locTable.size;
}
loadOrdered(primary: LocLoadTier, fallback: LocLoadTier, opts: LocReloadOptions = {}): number {
    const tier = primary.base !== null ? primary : fallback;
    this.reload(tier.base, opts);
    for (const modBytes of tier.mods) {
        this.merge(modBytes, opts);
    }
    return this.locTable.size;
}
init(bytes: Uint8Array | null, opts?: LocReloadOptions): number {
    return this.reload(bytes, opts);
}
localize(base: string, args: readonly string[] = [], allowInPlace = true, outputBytes = 1024, log?: LibLog): string {
    if (!Number.isSafeInteger(outputBytes) || outputBytes < 0) throw new RangeError("Invalid localization output size");
    return this.localizeSource(base, allowInPlace, args, args.length, outputBytes, log);
}
/** Byte-oriented guest outputs keep the C buffer's exact truncation, including a partial UTF-8 sequence. */
localizeBytes(base: string, args: readonly string[] = [], allowInPlace = true, outputBytes = 1024): Uint8Array {
    if (!Number.isSafeInteger(outputBytes) || outputBytes < 0) throw new RangeError("Invalid localization output size");
    const text = this.localizeSource(base, allowInPlace, args, args.length, Number.MAX_SAFE_INTEGER);
    return utf8.encode(text).slice(0, Math.max(0, outputBytes - 1));
}
}

/** Presentation binds a shared localization table to its viewing seat. */
export class LocalizationCatalog extends LocalizationTable {
  constructor(readonly seat: SeatId, profile: "q1-rerelease" | "q2-rerelease" = "q1-rerelease") { super(profile); }
}
