// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from quake-1-re-ts/src/lib/ttf.ts.
// Unhinted glyf/CFF outlines, CID subroutines, legacy kern and COLR v0/CPAL.
// GPOS, COLR v1 paints, CFF arithmetic and seac composition are unsupported.
import { BinaryError, BinaryReader } from "../core/binary/index.ts";
function at<T>(values: ArrayLike<T>, index: number, context: string): T {
    const value = values[index];
    if (value === undefined)
        throw new RangeError(`Missing ${context} at index ${index}`);
    return value;
}
export type FlattenedContourT = {
    x: number;
    y: number;
}[];
interface RawPoint {
    x: number;
    y: number;
    onCurve: boolean;
}
interface TableRecord {
    offset: number;
    length: number;
}
function readTag(buf: Uint8Array, off: number): string {
    return String.fromCharCode(at(buf, off, "buf"), at(buf, off + 1, "buf"), at(buf, off + 2, "buf"), at(buf, off + 3, "buf"));
}
function readSfntDirectory(buf: Uint8Array, view: DataView): Map<string, TableRecord> | null {
    if (buf.length < 12)
        return null;
    const versionNum = view.getUint32(0, false);
    const tag = readTag(buf, 0);
    if (versionNum !== 0x00010000 && tag !== "OTTO" && tag !== "true" && versionNum !== 0x74727565) {
        return null;
    }
    const numTables = view.getUint16(4, false);
    const reader = new BinaryReader(buf, "<font>");
    const tables = new Map<string, TableRecord>();
    let off = 12;
    for (let i = 0; i < numTables; i++) {
        if (off + 16 > buf.length)
            return null;
        const recTag = readTag(buf, off);
        const tOff = view.getUint32(off + 8, false);
        const tLen = view.getUint32(off + 12, false);
        reader.dataView(tOff, tLen);
        tables.set(recTag, { offset: tOff, length: tLen });
        off += 16;
    }
    return tables;
}
function cmapFormat4Lookup(view: DataView, subtableOffset: number, codepoint: number): number {
    if (codepoint > 0xffff)
        return 0;
    const segCountX2 = view.getUint16(subtableOffset + 6, false);
    const segCount = segCountX2 / 2;
    const endCodesOff = subtableOffset + 14;
    const startCodesOff = endCodesOff + segCountX2 + 2;
    const idDeltaOff = startCodesOff + segCountX2;
    const idRangeOff = idDeltaOff + segCountX2;
    for (let i = 0; i < segCount; i++) {
        const endCode = view.getUint16(endCodesOff + i * 2, false);
        if (codepoint > endCode)
            continue;
        const startCode = view.getUint16(startCodesOff + i * 2, false);
        if (codepoint < startCode)
            return 0;
        const idDelta = view.getInt16(idDeltaOff + i * 2, false);
        const idRangeOffset = view.getUint16(idRangeOff + i * 2, false);
        if (idRangeOffset === 0)
            return (codepoint + idDelta) & 0xffff;
        const glyphIndexAddr = idRangeOff + i * 2 + idRangeOffset + (codepoint - startCode) * 2;
        const g = view.getUint16(glyphIndexAddr, false);
        if (g === 0)
            return 0;
        return (g + idDelta) & 0xffff;
    }
    return 0;
}
function cmapFormat12Lookup(view: DataView, subtableOffset: number, codepoint: number): number {
    const numGroups = view.getUint32(subtableOffset + 12, false);
    const groupsOff = subtableOffset + 16;
    let lo = 0;
    let hi = numGroups - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const base = groupsOff + mid * 12;
        const startChar = view.getUint32(base, false);
        const endChar = view.getUint32(base + 4, false);
        if (codepoint < startChar) {
            hi = mid - 1;
        }
        else if (codepoint > endChar) {
            lo = mid + 1;
        }
        else {
            const startGlyph = view.getUint32(base + 8, false);
            return startGlyph + (codepoint - startChar);
        }
    }
    return 0;
}
type CmapLookupFn = (view: DataView, codepoint: number) => number;
function selectCmapSubtable(view: DataView, cmapOffset: number): CmapLookupFn | null {
    const numTables = view.getUint16(cmapOffset + 2, false);
    let best: {
        offset: number;
        format: number;
        score: number;
    } | null = null;
    for (let i = 0; i < numTables; i++) {
        const rec = cmapOffset + 4 + i * 8;
        const platformID = view.getUint16(rec, false);
        const encodingID = view.getUint16(rec + 2, false);
        const subOffset = cmapOffset + view.getUint32(rec + 4, false);
        const format = view.getUint16(subOffset, false);
        let score = -1;
        if (format === 12 && ((platformID === 3 && encodingID === 10) || (platformID === 0 && (encodingID === 4 || encodingID === 6))))
            score = 100;
        else if (format === 12)
            score = 90;
        else if (format === 4 && ((platformID === 3 && encodingID === 1) || platformID === 0))
            score = 80;
        else if (format === 4)
            score = 70;
        if (score > (best === null ? -1 : best.score))
            best = { offset: subOffset, format, score };
    }
    if (best === null)
        return null;
    const chosen = best;
    if (chosen.format === 12)
        return (v, cp) => cmapFormat12Lookup(v, chosen.offset, cp);
    if (chosen.format === 4)
        return (v, cp) => cmapFormat4Lookup(v, chosen.offset, cp);
    return null;
}
function readLoca(view: DataView, offset: number, numGlyphs: number, indexToLocFormat: number): Uint32Array {
    const out = new Uint32Array(numGlyphs + 1);
    if (indexToLocFormat === 0) {
        for (let i = 0; i <= numGlyphs; i++)
            out[i] = view.getUint16(offset + i * 2, false) * 2;
    }
    else {
        for (let i = 0; i <= numGlyphs; i++)
            out[i] = view.getUint32(offset + i * 4, false);
    }
    return out;
}
function parseSimpleGlyph(view: DataView, buf: Uint8Array, off: number, numContours: number): RawPoint[][] {
    let p = off;
    const endPts: number[] = [];
    for (let i = 0; i < numContours; i++) {
        endPts.push(view.getUint16(p, false));
        p += 2;
    }
    const numPoints = numContours > 0 ? at(endPts, numContours - 1, "endPts") + 1 : 0;
    const instructionLength = view.getUint16(p, false);
    p += 2 + instructionLength;
    const flags: number[] = [];
    while (flags.length < numPoints) {
        const f = at(buf, p, "buf");
        p += 1;
        flags.push(f);
        if (f & 0x08) {
            let repeat = at(buf, p, "buf");
            p += 1;
            while (repeat > 0 && flags.length < numPoints) {
                flags.push(f);
                repeat -= 1;
            }
        }
    }
    const xs: number[] = [];
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
        const f = at(flags, i, "flags");
        if (f & 0x02) {
            const dx = at(buf, p, "buf");
            p += 1;
            x += f & 0x10 ? dx : -dx;
        }
        else if (!(f & 0x10)) {
            x += view.getInt16(p, false);
            p += 2;
        }
        xs.push(x);
    }
    const ys: number[] = [];
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
        const f = at(flags, i, "flags");
        if (f & 0x04) {
            const dy = at(buf, p, "buf");
            p += 1;
            y += f & 0x20 ? dy : -dy;
        }
        else if (!(f & 0x20)) {
            y += view.getInt16(p, false);
            p += 2;
        }
        ys.push(y);
    }
    const contours: RawPoint[][] = [];
    let start = 0;
    for (let c = 0; c < numContours; c++) {
        const end = at(endPts, c, "endPts");
        const pts: RawPoint[] = [];
        for (let i = start; i <= end; i++) {
            pts.push({ x: at(xs, i, "xs"), y: at(ys, i, "ys"), onCurve: (at(flags, i, "flags") & 0x01) !== 0 });
        }
        contours.push(pts);
        start = end + 1;
    }
    return contours;
}
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
function parseCompositeGlyph(view: DataView, off: number, resolve: (gid: number, depth: number) => RawPoint[][], depth: number): RawPoint[][] {
    let p = off;
    const contours: RawPoint[][] = [];
    for (;;) {
        const flags = view.getUint16(p, false);
        p += 2;
        const glyphIndex = view.getUint16(p, false);
        p += 2;
        let dx = 0;
        let dy = 0;
        if (flags & ARG_1_AND_2_ARE_WORDS) {
            const a1 = view.getInt16(p, false);
            const a2 = view.getInt16(p + 2, false);
            p += 4;
            if (flags & ARGS_ARE_XY_VALUES) {
                dx = a1;
                dy = a2;
            }
        }
        else {
            const a1 = view.getInt8(p);
            const a2 = view.getInt8(p + 1);
            p += 2;
            if (flags & ARGS_ARE_XY_VALUES) {
                dx = a1;
                dy = a2;
            }
        }
        let a = 1;
        let b = 0;
        let c = 0;
        let d = 1;
        if (flags & WE_HAVE_A_SCALE) {
            a = view.getInt16(p, false) / 16384;
            d = a;
            p += 2;
        }
        else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
            a = view.getInt16(p, false) / 16384;
            d = view.getInt16(p + 2, false) / 16384;
            p += 4;
        }
        else if (flags & WE_HAVE_A_TWO_BY_TWO) {
            a = view.getInt16(p, false) / 16384;
            b = view.getInt16(p + 2, false) / 16384;
            c = view.getInt16(p + 4, false) / 16384;
            d = view.getInt16(p + 6, false) / 16384;
            p += 8;
        }
        if (depth < 8) {
            const sub = resolve(glyphIndex, depth + 1);
            for (const contour of sub) {
                contours.push(contour.map((pt) => ({
                    x: a * pt.x + c * pt.y + dx,
                    y: b * pt.x + d * pt.y + dy,
                    onCurve: pt.onCurve,
                })));
            }
        }
        if (!(flags & MORE_COMPONENTS))
            break;
    }
    return contours;
}
function flattenQuadraticContour(rawPoints: RawPoint[]): FlattenedContourT {
    const n = rawPoints.length;
    if (n < 2)
        return [];
    const expanded: RawPoint[] = [];
    for (let i = 0; i < n; i++) {
        const cur = at(rawPoints, i, "rawPoints");
        const next = at(rawPoints, (i + 1) % n, "rawPoints");
        expanded.push(cur);
        if (!cur.onCurve && !next.onCurve) {
            expanded.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, onCurve: true });
        }
    }
    const startIdx = expanded.findIndex((p) => p.onCurve);
    if (startIdx === -1)
        return [];
    const ring = expanded.slice(startIdx).concat(expanded.slice(0, startIdx));
    const m = ring.length;
    const out: FlattenedContourT = [{ x: at(ring, 0, "ring").x, y: at(ring, 0, "ring").y }];
    let cur = { x: at(ring, 0, "ring").x, y: at(ring, 0, "ring").y };
    let i = 1;
    while (i < m) {
        const p = at(ring, i, "ring");
        if (p.onCurve) {
            out.push({ x: p.x, y: p.y });
            cur = { x: p.x, y: p.y };
            i += 1;
        }
        else {
            const end = at(ring, (i + 1) % m, "ring");
            flattenQuadSegment(cur, { x: p.x, y: p.y }, { x: end.x, y: end.y }, out);
            cur = { x: end.x, y: end.y };
            i += 2;
        }
    }
    return out;
}
function flattenQuadSegment(p0: {
    x: number;
    y: number;
}, c: {
    x: number;
    y: number;
}, p1: {
    x: number;
    y: number;
}, out: FlattenedContourT): void {
    const segments = 8;
    for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        const mt = 1 - t;
        out.push({
            x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
            y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
        });
    }
}
interface CffIndexResult {
    items: Uint8Array[];
    end: number;
}
function readCffIndex(buf: Uint8Array, view: DataView, pos: number): CffIndexResult {
    const count = view.getUint16(pos, false);
    pos += 2;
    if (count === 0)
        return { items: [], end: pos };
    const offSize = at(buf, pos, "buf");
    if (offSize < 1 || offSize > 4)
        throw new RangeError(`Invalid CFF INDEX offset size ${offSize}`);
    pos += 1;
    const offsets: number[] = [];
    for (let i = 0; i <= count; i++) {
        let v = 0;
        for (let b = 0; b < offSize; b++) {
            v = v * 256 + at(buf, pos, "buf");
            pos += 1;
        }
        offsets.push(v);
    }
    const dataStart = pos - 1;
    if (at(offsets, 0, "CFF INDEX offset") !== 1)
        throw new RangeError("CFF INDEX offsets must start at one");
    const items: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
        const start = dataStart + at(offsets, i, "CFF INDEX offset");
        const end = dataStart + at(offsets, i + 1, "CFF INDEX offset");
        if (end < start || end > buf.length)
            throw new RangeError("CFF INDEX item exceeds table bounds");
        items.push(buf.subarray(start, end));
    }
    return { items, end: dataStart + at(offsets, count, "offsets") };
}
type CffDict = Map<number, number[]>;
function parseCffDict(b: Uint8Array): CffDict {
    const dict: CffDict = new Map<number, number[]>();
    let operands: number[] = [];
    let i = 0;
    while (i < b.length) {
        const b0 = at(b, i, "b");
        if (b0 <= 21) {
            let op: number;
            if (b0 === 12) {
                op = 1200 + at(b, i + 1, "b");
                i += 2;
            }
            else {
                op = b0;
                i += 1;
            }
            dict.set(op, operands);
            operands = [];
        }
        else if (b0 === 28) {
            operands.push(readInt16BE(b, i + 1));
            i += 3;
        }
        else if (b0 === 29) {
            operands.push(readInt32BE(b, i + 1));
            i += 5;
        }
        else if (b0 === 30) {
            i += 1;
            let done = false;
            while (!done && i < b.length) {
                const byte = at(b, i, "b");
                i += 1;
                if (byte >> 4 === 0xf || (byte & 0xf) === 0xf)
                    done = true;
            }
            operands.push(0);
        }
        else if (b0 >= 32 && b0 <= 246) {
            operands.push(b0 - 139);
            i += 1;
        }
        else if (b0 >= 247 && b0 <= 250) {
            operands.push((b0 - 247) * 256 + at(b, i + 1, "b") + 108);
            i += 2;
        }
        else if (b0 >= 251 && b0 <= 254) {
            operands.push(-(b0 - 251) * 256 - at(b, i + 1, "b") - 108);
            i += 2;
        }
        else {
            i += 1;
        }
    }
    return dict;
}
function readInt16BE(b: Uint8Array, pos: number): number {
    const v = (at(b, pos, "b") << 8) | at(b, pos + 1, "b");
    return v >= 0x8000 ? v - 0x10000 : v;
}
function readInt32BE(b: Uint8Array, pos: number): number {
    return (at(b, pos, "b") << 24) | (at(b, pos + 1, "b") << 16) | (at(b, pos + 2, "b") << 8) | at(b, pos + 3, "b");
}
function subrBias(n: number): number {
    return n < 1240 ? 107 : n < 33900 ? 1131 : 32768;
}
function parsePrivateAndLocalSubrs(buf: Uint8Array, view: DataView, privSizeOffset: [
    number,
    number
] | null): {
    subrs: Uint8Array[];
    bias: number;
} {
    if (privSizeOffset === null)
        return { subrs: [], bias: subrBias(0) };
    const [size, offset] = privSizeOffset;
    const privDict = parseCffDict(buf.subarray(offset, offset + size));
    const subrsRel = privDict.get(19);
    if (subrsRel === undefined || subrsRel.length === 0)
        return { subrs: [], bias: subrBias(0) };
    const { items } = readCffIndex(buf, view, offset + at(subrsRel, 0, "subrsRel"));
    return { subrs: items, bias: subrBias(items.length) };
}
function privateEntryOf(dict: CffDict): [
    number,
    number
] | null {
    const entry = dict.get(18);
    if (entry === undefined || entry.length !== 2)
        return null;
    return [at(entry, 0, "entry"), at(entry, 1, "entry")];
}
function parseFdSelect(buf: Uint8Array, view: DataView, offset: number, numGlyphs: number): Uint8Array {
    const result = new Uint8Array(numGlyphs);
    const format = at(buf, offset, "buf");
    if (format === 0) {
        for (let i = 0; i < numGlyphs; i++)
            result[i] = at(buf, offset + 1 + i, "buf");
    }
    else if (format === 3) {
        const nRanges = view.getUint16(offset + 1, false);
        let p = offset + 3;
        let prevFirst = view.getUint16(p, false);
        let prevFd = at(buf, p + 2, "buf");
        p += 3;
        for (let r = 1; r < nRanges; r++) {
            const first = view.getUint16(p, false);
            const fd = at(buf, p + 2, "buf");
            for (let g = prevFirst; g < first; g++)
                result[g] = prevFd;
            prevFirst = first;
            prevFd = fd;
            p += 3;
        }
        const sentinel = view.getUint16(p, false);
        for (let g = prevFirst; g < sentinel; g++)
            result[g] = prevFd;
    }
    return result;
}
interface CffFont {
    charStrings: Uint8Array[];
    globalSubrs: Uint8Array[];
    globalBias: number;
    isCID: boolean;
    defaultLocalSubrs: Uint8Array[];
    defaultLocalBias: number;
    fdLocalSubrs: Uint8Array[][];
    fdLocalBias: number[];
    fdSelect: Uint8Array | null;
}
function parseCFF(buf: Uint8Array, tableOffset: number, tableLength: number): CffFont | null {
    const cff = buf.subarray(tableOffset, tableOffset + tableLength);
    if (cff.length < 4)
        return null;
    const cffView = new DataView(cff.buffer, cff.byteOffset, cff.byteLength);
    const hdrSize = at(cff, 2, "cff");
    let pos = hdrSize;
    const nameIdx = readCffIndex(cff, cffView, pos);
    pos = nameIdx.end;
    const topDictIdx = readCffIndex(cff, cffView, pos);
    pos = topDictIdx.end;
    const stringIdx = readCffIndex(cff, cffView, pos);
    pos = stringIdx.end;
    const globalSubrIdx = readCffIndex(cff, cffView, pos);
    if (topDictIdx.items.length === 0)
        return null;
    const topDict = parseCffDict(at(topDictIdx.items, 0, "topDictIdx.items"));
    const charStringsOff = topDict.get(17);
    if (charStringsOff === undefined || charStringsOff.length === 0)
        return null;
    const csIdx = readCffIndex(cff, cffView, at(charStringsOff, 0, "charStringsOff"));
    const isCID = topDict.has(1230);
    const globalSubrs = globalSubrIdx.items;
    const globalBias = subrBias(globalSubrs.length);
    const { subrs: defaultLocalSubrs, bias: defaultLocalBias } = parsePrivateAndLocalSubrs(cff, cffView, privateEntryOf(topDict));
    const fdLocalSubrs: Uint8Array[][] = [];
    const fdLocalBias: number[] = [];
    let fdSelect: Uint8Array | null = null;
    if (isCID) {
        const fdArrayOff = topDict.get(1236);
        const fdSelectOff = topDict.get(1237);
        if (fdArrayOff !== undefined && fdArrayOff.length > 0) {
            const fdArrayIdx = readCffIndex(cff, cffView, at(fdArrayOff, 0, "fdArrayOff"));
            for (const fdBytes of fdArrayIdx.items) {
                const fdDict = parseCffDict(fdBytes);
                const r = parsePrivateAndLocalSubrs(cff, cffView, privateEntryOf(fdDict));
                fdLocalSubrs.push(r.subrs);
                fdLocalBias.push(r.bias);
            }
        }
        if (fdSelectOff !== undefined && fdSelectOff.length > 0) {
            fdSelect = parseFdSelect(cff, cffView, at(fdSelectOff, 0, "fdSelectOff"), csIdx.items.length);
        }
    }
    return {
        charStrings: csIdx.items,
        globalSubrs,
        globalBias,
        isCID,
        defaultLocalSubrs,
        defaultLocalBias,
        fdLocalSubrs,
        fdLocalBias,
        fdSelect,
    };
}
interface Type2Context {
    x: number;
    y: number;
    contours: FlattenedContourT[];
    current: FlattenedContourT | null;
    stack: number[];
    nStems: number;
    widthParsed: boolean;
}
function moveTo(ctx: Type2Context, dx: number, dy: number): void {
    if (ctx.current !== null && ctx.current.length > 0)
        ctx.contours.push(ctx.current);
    ctx.x += dx;
    ctx.y += dy;
    ctx.current = [{ x: ctx.x, y: ctx.y }];
}
function lineTo(ctx: Type2Context, dx: number, dy: number): void {
    ctx.x += dx;
    ctx.y += dy;
    if (ctx.current === null)
        ctx.current = [{ x: ctx.x, y: ctx.y }];
    else
        ctx.current.push({ x: ctx.x, y: ctx.y });
}
function emitCurveAbs(ctx: Type2Context, c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number): void {
    if (ctx.current === null)
        ctx.current = [{ x: ctx.x, y: ctx.y }];
    const p0x = ctx.x;
    const p0y = ctx.y;
    const segments = 8;
    for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        const mt = 1 - t;
        ctx.current.push({
            x: mt * mt * mt * p0x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex,
            y: mt * mt * mt * p0y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey,
        });
    }
    ctx.x = ex;
    ctx.y = ey;
}
function curveTo(ctx: Type2Context, dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number): void {
    const c1x = ctx.x + dx1;
    const c1y = ctx.y + dy1;
    const c2x = c1x + dx2;
    const c2y = c1y + dy2;
    emitCurveAbs(ctx, c1x, c1y, c2x, c2y, c2x + dx3, c2y + dy3);
}
function maybeTakeWidth(ctx: Type2Context, hasExtra: boolean): void {
    if (ctx.widthParsed)
        return;
    ctx.widthParsed = true;
    if (hasExtra)
        ctx.stack.shift();
}
function execHflex(ctx: Type2Context, s: number[]): void {
    const dx1 = at(s, 0, "s");
    const dx2 = at(s, 1, "s");
    const dy2 = at(s, 2, "s");
    const dx3 = at(s, 3, "s");
    const dx4 = at(s, 4, "s");
    const dx5 = at(s, 5, "s");
    const dx6 = at(s, 6, "s");
    const x0 = ctx.x;
    const y0 = ctx.y;
    const c1x = x0 + dx1;
    const c1y = y0;
    const c2x = c1x + dx2;
    const c2y = c1y + dy2;
    const p1x = c2x + dx3;
    emitCurveAbs(ctx, c1x, c1y, c2x, c2y, p1x, c2y);
    const c3x = p1x + dx4;
    const c3y = c2y;
    const c4x = c3x + dx5;
    emitCurveAbs(ctx, c3x, c3y, c4x, c3y, c4x + dx6, y0);
}
function execFlex(ctx: Type2Context, s: number[]): void {
    const dx1 = at(s, 0, "s");
    const dy1 = at(s, 1, "s");
    const dx2 = at(s, 2, "s");
    const dy2 = at(s, 3, "s");
    const dx3 = at(s, 4, "s");
    const dy3 = at(s, 5, "s");
    const dx4 = at(s, 6, "s");
    const dy4 = at(s, 7, "s");
    const dx5 = at(s, 8, "s");
    const dy5 = at(s, 9, "s");
    const dx6 = at(s, 10, "s");
    const dy6 = at(s, 11, "s");
    curveTo(ctx, dx1, dy1, dx2, dy2, dx3, dy3);
    curveTo(ctx, dx4, dy4, dx5, dy5, dx6, dy6);
}
function execHflex1(ctx: Type2Context, s: number[]): void {
    const dx1 = at(s, 0, "s");
    const dy1 = at(s, 1, "s");
    const dx2 = at(s, 2, "s");
    const dy2 = at(s, 3, "s");
    const dx3 = at(s, 4, "s");
    const dx4 = at(s, 5, "s");
    const dx5 = at(s, 6, "s");
    const dy5 = at(s, 7, "s");
    const dx6 = at(s, 8, "s");
    const x0 = ctx.x;
    const y0 = ctx.y;
    const c1x = x0 + dx1;
    const c1y = y0 + dy1;
    const c2x = c1x + dx2;
    const c2y = c1y + dy2;
    const p1x = c2x + dx3;
    emitCurveAbs(ctx, c1x, c1y, c2x, c2y, p1x, c2y);
    const c3x = p1x + dx4;
    const c3y = c2y;
    const c4x = c3x + dx5;
    const c4y = c3y + dy5;
    emitCurveAbs(ctx, c3x, c3y, c4x, c4y, c4x + dx6, y0);
}
function execFlex1(ctx: Type2Context, s: number[]): void {
    const dx1 = at(s, 0, "s");
    const dy1 = at(s, 1, "s");
    const dx2 = at(s, 2, "s");
    const dy2 = at(s, 3, "s");
    const dx3 = at(s, 4, "s");
    const dy3 = at(s, 5, "s");
    const dx4 = at(s, 6, "s");
    const dy4 = at(s, 7, "s");
    const dx5 = at(s, 8, "s");
    const dy5 = at(s, 9, "s");
    const d6 = at(s, 10, "s");
    const x0 = ctx.x;
    const y0 = ctx.y;
    const c1x = x0 + dx1;
    const c1y = y0 + dy1;
    const c2x = c1x + dx2;
    const c2y = c1y + dy2;
    const p1x = c2x + dx3;
    const p1y = c2y + dy3;
    emitCurveAbs(ctx, c1x, c1y, c2x, c2y, p1x, p1y);
    const c3x = p1x + dx4;
    const c3y = p1y + dy4;
    const c4x = c3x + dx5;
    const c4y = c3y + dy5;
    const sumDx = dx1 + dx2 + dx3 + dx4 + dx5;
    const sumDy = dy1 + dy2 + dy3 + dy4 + dy5;
    if (Math.abs(sumDx) > Math.abs(sumDy))
        emitCurveAbs(ctx, c3x, c3y, c4x, c4y, c4x + d6, y0);
    else
        emitCurveAbs(ctx, c3x, c3y, c4x, c4y, x0, c4y + d6);
}
function execEscapeOp(op: number, ctx: Type2Context, stack: number[]): void {
    switch (op) {
        case 34:
            execHflex(ctx, stack);
            break;
        case 35:
            execFlex(ctx, stack);
            break;
        case 36:
            execHflex1(ctx, stack);
            break;
        case 37:
            execFlex1(ctx, stack);
            break;
        default:
            break;
    }
    stack.length = 0;
}
function execCharstring(code: Uint8Array, ctx: Type2Context, globalSubrs: Uint8Array[], globalBias: number, localSubrs: Uint8Array[], localBias: number, depth: number): void {
    if (depth > 10)
        return;
    const stack = ctx.stack;
    let i = 0;
    while (i < code.length) {
        const b0 = at(code, i, "code");
        if (b0 >= 32 || b0 === 28) {
            let v: number;
            if (b0 === 28) {
                v = readInt16BE(code, i + 1);
                i += 3;
            }
            else if (b0 <= 246) {
                v = b0 - 139;
                i += 1;
            }
            else if (b0 <= 250) {
                v = (b0 - 247) * 256 + at(code, i + 1, "code") + 108;
                i += 2;
            }
            else if (b0 <= 254) {
                v = -(b0 - 251) * 256 - at(code, i + 1, "code") - 108;
                i += 2;
            }
            else {
                v = readInt32BE(code, i + 1) / 65536;
                i += 5;
            }
            stack.push(v);
            continue;
        }
        i += 1;
        switch (b0) {
            case 1:
            case 3:
            case 18:
            case 23: {
                maybeTakeWidth(ctx, stack.length % 2 === 1);
                ctx.nStems += Math.floor(stack.length / 2);
                stack.length = 0;
                break;
            }
            case 19:
            case 20: {
                maybeTakeWidth(ctx, stack.length % 2 === 1);
                ctx.nStems += Math.floor(stack.length / 2);
                stack.length = 0;
                i += (ctx.nStems + 7) >> 3;
                break;
            }
            case 21: {
                maybeTakeWidth(ctx, stack.length > 2);
                moveTo(ctx, at(stack, 0, "stack"), at(stack, 1, "stack"));
                stack.length = 0;
                break;
            }
            case 22: {
                maybeTakeWidth(ctx, stack.length > 1);
                moveTo(ctx, at(stack, 0, "stack"), 0);
                stack.length = 0;
                break;
            }
            case 4: {
                maybeTakeWidth(ctx, stack.length > 1);
                moveTo(ctx, 0, at(stack, 0, "stack"));
                stack.length = 0;
                break;
            }
            case 5: {
                for (let k = 0; k + 1 < stack.length; k += 2)
                    lineTo(ctx, at(stack, k, "stack"), at(stack, k + 1, "stack"));
                stack.length = 0;
                break;
            }
            case 6: {
                let horiz = true;
                for (let k = 0; k < stack.length; k++) {
                    if (horiz)
                        lineTo(ctx, at(stack, k, "stack"), 0);
                    else
                        lineTo(ctx, 0, at(stack, k, "stack"));
                    horiz = !horiz;
                }
                stack.length = 0;
                break;
            }
            case 7: {
                let horiz = false;
                for (let k = 0; k < stack.length; k++) {
                    if (horiz)
                        lineTo(ctx, at(stack, k, "stack"), 0);
                    else
                        lineTo(ctx, 0, at(stack, k, "stack"));
                    horiz = !horiz;
                }
                stack.length = 0;
                break;
            }
            case 8: {
                for (let k = 0; k + 5 < stack.length; k += 6)
                    curveTo(ctx, at(stack, k, "stack"), at(stack, k + 1, "stack"), at(stack, k + 2, "stack"), at(stack, k + 3, "stack"), at(stack, k + 4, "stack"), at(stack, k + 5, "stack"));
                stack.length = 0;
                break;
            }
            case 24: {
                let k = 0;
                for (; k + 5 < stack.length - 2; k += 6)
                    curveTo(ctx, at(stack, k, "stack"), at(stack, k + 1, "stack"), at(stack, k + 2, "stack"), at(stack, k + 3, "stack"), at(stack, k + 4, "stack"), at(stack, k + 5, "stack"));
                lineTo(ctx, at(stack, k, "stack"), at(stack, k + 1, "stack"));
                stack.length = 0;
                break;
            }
            case 25: {
                let k = 0;
                for (; k + 1 < stack.length - 6; k += 2)
                    lineTo(ctx, at(stack, k, "stack"), at(stack, k + 1, "stack"));
                curveTo(ctx, at(stack, k, "stack"), at(stack, k + 1, "stack"), at(stack, k + 2, "stack"), at(stack, k + 3, "stack"), at(stack, k + 4, "stack"), at(stack, k + 5, "stack"));
                stack.length = 0;
                break;
            }
            case 26: {
                let k = 0;
                let dx1 = 0;
                if (stack.length % 4 === 1) {
                    dx1 = at(stack, 0, "stack");
                    k = 1;
                }
                for (; k + 3 < stack.length; k += 4) {
                    const c1x = ctx.x + dx1;
                    const c1y = ctx.y + at(stack, k, "stack");
                    const c2x = c1x + at(stack, k + 1, "stack");
                    const c2y = c1y + at(stack, k + 2, "stack");
                    emitCurveAbs(ctx, c1x, c1y, c2x, c2y, c2x, c2y + at(stack, k + 3, "stack"));
                    dx1 = 0;
                }
                stack.length = 0;
                break;
            }
            case 27: {
                let k = 0;
                let dy1 = 0;
                if (stack.length % 4 === 1) {
                    dy1 = at(stack, 0, "stack");
                    k = 1;
                }
                for (; k + 3 < stack.length; k += 4) {
                    const c1x = ctx.x + at(stack, k, "stack");
                    const c1y = ctx.y + dy1;
                    const c2x = c1x + at(stack, k + 1, "stack");
                    const c2y = c1y + at(stack, k + 2, "stack");
                    emitCurveAbs(ctx, c1x, c1y, c2x, c2y, c2x + at(stack, k + 3, "stack"), c2y);
                    dy1 = 0;
                }
                stack.length = 0;
                break;
            }
            case 30:
            case 31: {
                let horiz = b0 === 31;
                let k = 0;
                while (k + 3 < stack.length) {
                    const hasExtra = k + 5 === stack.length;
                    if (horiz) {
                        const c1x = ctx.x + at(stack, k, "stack");
                        const c1y = ctx.y;
                        const c2x = c1x + at(stack, k + 1, "stack");
                        const c2y = c1y + at(stack, k + 2, "stack");
                        const ey = c2y + at(stack, k + 3, "stack");
                        const ex = hasExtra ? c2x + at(stack, k + 4, "stack") : c2x;
                        emitCurveAbs(ctx, c1x, c1y, c2x, c2y, ex, ey);
                    }
                    else {
                        const c1x = ctx.x;
                        const c1y = ctx.y + at(stack, k, "stack");
                        const c2x = c1x + at(stack, k + 1, "stack");
                        const c2y = c1y + at(stack, k + 2, "stack");
                        const ex = c2x + at(stack, k + 3, "stack");
                        const ey = hasExtra ? c2y + at(stack, k + 4, "stack") : c2y;
                        emitCurveAbs(ctx, c1x, c1y, c2x, c2y, ex, ey);
                    }
                    horiz = !horiz;
                    k += 4;
                }
                stack.length = 0;
                break;
            }
            case 10: {
                const operand = stack.pop();
                if (operand === undefined)
                    throw new RangeError("CFF callsubr has no operand");
                const sub = at(localSubrs, operand + localBias, "CFF local subroutine");
                execCharstring(sub, ctx, globalSubrs, globalBias, localSubrs, localBias, depth + 1);
                break;
            }
            case 29: {
                const operand = stack.pop();
                if (operand === undefined)
                    throw new RangeError("CFF callgsubr has no operand");
                const sub = at(globalSubrs, operand + globalBias, "CFF global subroutine");
                execCharstring(sub, ctx, globalSubrs, globalBias, localSubrs, localBias, depth + 1);
                break;
            }
            case 11: {
                return;
            }
            case 14: {
                maybeTakeWidth(ctx, stack.length === 1 || stack.length === 5);
                return;
            }
            case 12: {
                const b1 = at(code, i, "code");
                i += 1;
                execEscapeOp(b1, ctx, stack);
                break;
            }
            default: {
                stack.length = 0;
                break;
            }
        }
    }
}
function getCffContours(cff: CffFont, gid: number): FlattenedContourT[] {
    const code = cff.charStrings[gid];
    if (code === undefined)
        return [];
    let localSubrs = cff.defaultLocalSubrs;
    let localBias = cff.defaultLocalBias;
    if (cff.isCID && cff.fdSelect !== null) {
        const fd = at(cff.fdSelect, gid, "CFF glyph FD selection");
        localSubrs = at(cff.fdLocalSubrs, fd, "CFF font dictionary");
        localBias = at(cff.fdLocalBias, fd, "CFF local subroutine bias");
    }
    const ctx: Type2Context = { x: 0, y: 0, contours: [], current: null, stack: [], nStems: 0, widthParsed: false };
    execCharstring(code, ctx, cff.globalSubrs, cff.globalBias, localSubrs, localBias, 0);
    if (ctx.current !== null && ctx.current.length > 0)
        ctx.contours.push(ctx.current);
    return ctx.contours;
}
function parseKernFormat0(view: DataView, offset: number, length: number): Map<number, number> | null {
    if (length < 4)
        return null;
    const version = view.getUint16(offset, false);
    if (version !== 0)
        return null;
    const nTables = view.getUint16(offset + 2, false);
    let pos = offset + 4;
    const pairs = new Map<number, number>();
    for (let t = 0; t < nTables && pos + 6 <= offset + length; t++) {
        const subVersion = view.getUint16(pos, false);
        const subLength = view.getUint16(pos + 2, false);
        const coverage = view.getUint16(pos + 4, false);
        const format = coverage >> 8;
        if (subVersion === 0 && format === 0) {
            const nPairs = view.getUint16(pos + 6, false);
            let p = pos + 14;
            for (let i = 0; i < nPairs; i++) {
                const left = view.getUint16(p, false);
                const right = view.getUint16(p + 2, false);
                const value = view.getInt16(p + 4, false);
                pairs.set(left * 65536 + right, value);
                p += 6;
            }
        }
        pos += subLength;
    }
    return pairs.size > 0 ? pairs : null;
}
interface ColrTable {
    base: Map<number, {
        firstLayerIndex: number;
        numLayers: number;
    }>;
    layers: {
        gid: number;
        paletteIndex: number;
    }[];
}
function parseCOLR(view: DataView, offset: number, length: number): ColrTable | null {
    if (length < 14)
        return null;
    const version = view.getUint16(offset, false);
    if (version !== 0)
        return null;
    const numBaseGlyphRecords = view.getUint16(offset + 2, false);
    const baseGlyphRecordsOffset = view.getUint32(offset + 4, false);
    const layerRecordsOffset = view.getUint32(offset + 8, false);
    const numLayerRecords = view.getUint16(offset + 12, false);
    const base = new Map<number, {
        firstLayerIndex: number;
        numLayers: number;
    }>();
    let bp = offset + baseGlyphRecordsOffset;
    for (let i = 0; i < numBaseGlyphRecords; i++) {
        const gID = view.getUint16(bp, false);
        const firstLayerIndex = view.getUint16(bp + 2, false);
        const numLayers = view.getUint16(bp + 4, false);
        base.set(gID, { firstLayerIndex, numLayers });
        bp += 6;
    }
    const layers: {
        gid: number;
        paletteIndex: number;
    }[] = [];
    let lp = offset + layerRecordsOffset;
    for (let i = 0; i < numLayerRecords; i++) {
        const gID = view.getUint16(lp, false);
        const paletteIndex = view.getUint16(lp + 2, false);
        layers.push({ gid: gID, paletteIndex });
        lp += 4;
    }
    return { base, layers };
}
interface CpalTable {
    numPaletteEntries: number;
    numPalettes: number;
    colorRecordIndices: Uint16Array;
    colorRecords: {
        r: number;
        g: number;
        b: number;
        a: number;
    }[];
}
function parseCPAL(view: DataView, offset: number, length: number): CpalTable | null {
    if (length < 12)
        return null;
    const numPaletteEntries = view.getUint16(offset + 2, false);
    const numPalettes = view.getUint16(offset + 4, false);
    const numColorRecords = view.getUint16(offset + 6, false);
    const colorRecordsArrayOffset = view.getUint32(offset + 8, false);
    const colorRecordIndices = new Uint16Array(numPalettes);
    const idxBase = offset + 12;
    for (let i = 0; i < numPalettes; i++)
        colorRecordIndices[i] = view.getUint16(idxBase + i * 2, false);
    const recBase = offset + colorRecordsArrayOffset;
    const colorRecords: {
        r: number;
        g: number;
        b: number;
        a: number;
    }[] = [];
    for (let i = 0; i < numColorRecords; i++) {
        const p = recBase + i * 4;
        const blue = view.getUint8(p);
        const green = view.getUint8(p + 1);
        const red = view.getUint8(p + 2);
        const alpha = view.getUint8(p + 3);
        colorRecords.push({ r: red, g: green, b: blue, a: alpha });
    }
    return { numPaletteEntries, numPalettes, colorRecordIndices, colorRecords };
}
export interface ColorLayerT {
    gid: number;
    paletteIndex: number;
}
export interface ParsedFontT {
    unitsPerEm: number;
    numGlyphs: number;
    ascent: number;
    descent: number;
    lineGap: number;
    outlineFormat: "glyf" | "cff";
    cmapLookup(codepoint: number): number;
    advanceWidth(gid: number): number;
    contours(gid: number): FlattenedContourT[];
    kerning(leftGid: number, rightGid: number): number;
    colorLayers(gid: number): ColorLayerT[] | null;
    paletteColor(paletteIndex: number, paletteId?: number): {
        r: number;
        g: number;
        b: number;
        a: number;
    } | null;
}
export type ParseFontResultT = {
    ok: true;
    font: ParsedFontT;
} | {
    ok: false;
    reason: string;
};
export function parseFont(buf: Uint8Array): ParseFontResultT {
    try {
        return parseFontData(buf);
    } catch (error) {
        if (error instanceof BinaryError || error instanceof RangeError)
            return { ok: false, reason: error.message };
        throw error;
    }
}
function parseFontData(buf: Uint8Array): ParseFontResultT {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tables = readSfntDirectory(buf, view);
    if (tables === null)
        return { ok: false, reason: "not a recognized sfnt file (bad signature)" };
    const headT = tables.get("head");
    const hheaT = tables.get("hhea");
    const maxpT = tables.get("maxp");
    const hmtxT = tables.get("hmtx");
    const cmapT = tables.get("cmap");
    if (headT === undefined || hheaT === undefined || maxpT === undefined || hmtxT === undefined || cmapT === undefined) {
        return { ok: false, reason: "missing a required table (head/hhea/maxp/hmtx/cmap)" };
    }
    if (headT.length < 54)
        return { ok: false, reason: "head table too short" };
    if (hheaT.length < 36)
        return { ok: false, reason: "hhea table too short" };
    if (maxpT.length < 6)
        return { ok: false, reason: "maxp table too short" };
    const unitsPerEm = view.getUint16(headT.offset + 18, false);
    if (unitsPerEm === 0)
        return { ok: false, reason: "invalid unitsPerEm" };
    const indexToLocFormat = view.getInt16(headT.offset + 50, false);
    const ascent = view.getInt16(hheaT.offset + 4, false);
    const descent = view.getInt16(hheaT.offset + 6, false);
    const lineGap = view.getInt16(hheaT.offset + 8, false);
    const numberOfHMetrics = view.getUint16(hheaT.offset + 34, false);
    const numGlyphs = view.getUint16(maxpT.offset + 4, false);
    if (numberOfHMetrics < 1 || numberOfHMetrics > numGlyphs || hmtxT.length < numberOfHMetrics * 4 + (numGlyphs - numberOfHMetrics) * 2)
        return { ok: false, reason: "invalid horizontal metrics" };
    const advanceWidths = new Uint16Array(numGlyphs);
    {
        let hOff = hmtxT.offset;
        let lastAdvance = 0;
        for (let g = 0; g < numGlyphs; g++) {
            if (g < numberOfHMetrics) {
                lastAdvance = view.getUint16(hOff, false);
                hOff += 4;
            }
            advanceWidths[g] = lastAdvance;
        }
    }
    const cmapLookupFn = selectCmapSubtable(view, cmapT.offset);
    if (cmapLookupFn === null)
        return { ok: false, reason: "no supported cmap subtable (need format 4 or 12)" };
    const glyfT = tables.get("glyf");
    const locaT = tables.get("loca");
    const cffT = tables.get("CFF ");
    let contoursFn: (gid: number) => FlattenedContourT[];
    let outlineFormat: "glyf" | "cff";
    if (glyfT !== undefined && locaT !== undefined) {
        outlineFormat = "glyf";
        if ((indexToLocFormat !== 0 && indexToLocFormat !== 1) || locaT.length < (numGlyphs + 1) * (indexToLocFormat === 0 ? 2 : 4))
            return { ok: false, reason: "invalid loca table" };
        const locaOffsets = readLoca(view, locaT.offset, numGlyphs, indexToLocFormat);
        const rawCache = new Map<number, RawPoint[][]>();
        const getRaw = (gid: number, depth: number): RawPoint[][] => {
            if (depth === 0) {
                const cached = rawCache.get(gid);
                if (cached !== undefined)
                    return cached;
            }
            if (!Number.isInteger(gid) || gid < 0 || gid >= numGlyphs)
                return [];
            if (depth > 8)
                throw new RangeError("Composite glyph recursion exceeds eight levels");
            const start = at(locaOffsets, gid, "locaOffsets");
            const end = at(locaOffsets, gid + 1, "locaOffsets");
            if (end < start || end > glyfT.length)
                throw new RangeError("Glyph location exceeds glyf table bounds");
            if (end === start)
                return [];
            const glyphBytes = buf.subarray(glyfT.offset + start, glyfT.offset + end);
            const glyphView = new DataView(glyphBytes.buffer, glyphBytes.byteOffset, glyphBytes.byteLength);
            const numContours = glyphView.getInt16(0, false);
            const result = numContours >= 0 ? parseSimpleGlyph(glyphView, glyphBytes, 10, numContours) : parseCompositeGlyph(glyphView, 10, getRaw, depth);
            if (depth === 0)
                rawCache.set(gid, result);
            return result;
        };
        const flatCache = new Map<number, FlattenedContourT[]>();
        contoursFn = (gid: number) => {
            const cached = flatCache.get(gid);
            if (cached !== undefined)
                return cached;
            const flat = getRaw(gid, 0).map(flattenQuadraticContour);
            flatCache.set(gid, flat);
            return flat;
        };
    }
    else if (cffT !== undefined) {
        outlineFormat = "cff";
        const cffFont = parseCFF(buf, cffT.offset, cffT.length);
        if (cffFont === null)
            return { ok: false, reason: "malformed CFF table" };
        const flatCache = new Map<number, FlattenedContourT[]>();
        contoursFn = (gid: number) => {
            const cached = flatCache.get(gid);
            if (cached !== undefined)
                return cached;
            const result = gid >= 0 && gid < cffFont.charStrings.length ? getCffContours(cffFont, gid) : [];
            flatCache.set(gid, result);
            return result;
        };
    }
    else {
        return { ok: false, reason: "no outline table found (need glyf+loca or CFF )" };
    }
    const kernT = tables.get("kern");
    const kernPairs = kernT !== undefined ? parseKernFormat0(view, kernT.offset, kernT.length) : null;
    const colrT = tables.get("COLR");
    const colrTable = colrT !== undefined ? parseCOLR(view, colrT.offset, colrT.length) : null;
    const cpalT = tables.get("CPAL");
    const cpalTable = cpalT !== undefined ? parseCPAL(view, cpalT.offset, cpalT.length) : null;
    const font: ParsedFontT = {
        unitsPerEm,
        numGlyphs,
        ascent,
        descent,
        lineGap,
        outlineFormat,
        cmapLookup: (cp: number) => cmapLookupFn(view, cp),
        advanceWidth: (gid: number) => (Number.isInteger(gid) && gid >= 0 && gid < numGlyphs ? at(advanceWidths, gid, "advanceWidths") : 0),
        contours: contoursFn,
        kerning: (l: number, r: number) => (kernPairs === null ? 0 : (kernPairs.get(l * 65536 + r) ?? 0)),
        colorLayers: (gid: number) => {
            if (colrTable === null)
                return null;
            const rec = colrTable.base.get(gid);
            if (rec === undefined)
                return null;
            const out: ColorLayerT[] = [];
            for (let i = 0; i < rec.numLayers; i++) {
                const layer = colrTable.layers[rec.firstLayerIndex + i];
                if (layer === undefined)
                    continue;
                out.push({ gid: layer.gid, paletteIndex: layer.paletteIndex });
            }
            return out;
        },
        paletteColor: (paletteIndex: number, paletteId = 0) => {
            if (cpalTable === null)
                return null;
            if (paletteId < 0 || paletteId >= cpalTable.numPalettes)
                return null;
            if (paletteIndex < 0 || paletteIndex >= cpalTable.numPaletteEntries)
                return null;
            const first = at(cpalTable.colorRecordIndices, paletteId, "cpalTable.colorRecordIndices");
            const rec = cpalTable.colorRecords[first + paletteIndex];
            return rec === undefined ? null : rec;
        },
    };
    return { ok: true, font };
}
export interface RasterizedGlyphT {
    width: number;
    height: number;
    coverage: Uint8Array;
}
interface FillEdge {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    dir: 1 | -1;
}
function accumulateSpan(coverage: Float32Array, row: number, width: number, xa: number, xb: number, weight: number): void {
    let a = xa;
    let b = xb;
    if (b <= a)
        return;
    if (a < 0)
        a = 0;
    if (b > width)
        b = width;
    if (b <= a)
        return;
    const rowBase = row * width;
    const firstPx = Math.floor(a);
    const lastPx = Math.floor(b - 1e-9);
    if (firstPx === lastPx) {
        coverage[rowBase + firstPx] = at(coverage, rowBase + firstPx, "coverage") + (b - a) * weight;
        return;
    }
    coverage[rowBase + firstPx] = at(coverage, rowBase + firstPx, "coverage") + (firstPx + 1 - a) * weight;
    for (let px = firstPx + 1; px < lastPx; px++)
        coverage[rowBase + px] = at(coverage, rowBase + px, "coverage") + weight;
    coverage[rowBase + lastPx] = at(coverage, rowBase + lastPx, "coverage") + (b - lastPx) * weight;
}
export function rasterizeContours(contoursPx: FlattenedContourT[], width: number, height: number, supersampleY = 4): RasterizedGlyphT {
    const coverage = new Float32Array(width * height);
    const edges: FillEdge[] = [];
    for (const contour of contoursPx) {
        const n = contour.length;
        if (n < 2)
            continue;
        for (let i = 0; i < n; i++) {
            const p0 = at(contour, i, "contour");
            const p1 = at(contour, (i + 1) % n, "contour");
            if (p0.y === p1.y)
                continue;
            if (p0.y < p1.y)
                edges.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, dir: 1 });
            else
                edges.push({ x0: p1.x, y0: p1.y, x1: p0.x, y1: p0.y, dir: -1 });
        }
    }
    const invSS = 1 / supersampleY;
    for (let row = 0; row < height; row++) {
        for (let s = 0; s < supersampleY; s++) {
            const sy = row + (s + 0.5) * invSS;
            const xs: {
                x: number;
                dir: number;
            }[] = [];
            for (const e of edges) {
                if (sy >= e.y0 && sy < e.y1) {
                    const t = (sy - e.y0) / (e.y1 - e.y0);
                    xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.dir });
                }
            }
            if (xs.length < 2)
                continue;
            xs.sort((a, b) => a.x - b.x);
            let winding = 0;
            for (let k = 0; k < xs.length - 1; k++) {
                winding += at(xs, k, "xs").dir;
                if (winding !== 0)
                    accumulateSpan(coverage, row, width, at(xs, k, "xs").x, at(xs, k + 1, "xs").x, invSS);
            }
        }
    }
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) {
        const v = at(coverage, i, "coverage");
        out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
    return { width, height, coverage: out };
}
export function rasterizeGlyph(font: ParsedFontT, gid: number, px: number): RasterizedGlyphT {
    const scale = px / font.unitsPerEm;
    const width = Math.max(1, Math.round(font.advanceWidth(gid) * scale));
    const contours = font.contours(gid);
    let yMin = 0;
    for (const c of contours)
        for (const p of c)
            if (p.y < yMin)
                yMin = p.y;
    const bottom = Math.min(0, yMin);
    const height = Math.max(1, Math.round((font.ascent - bottom) * scale));
    if (contours.length === 0) {
        return { width, height, coverage: new Uint8Array(width * height) };
    }
    const pxContours: FlattenedContourT[] = contours.map((c) => c.map((p) => ({ x: p.x * scale, y: (font.ascent - p.y) * scale })));
    return rasterizeContours(pxContours, width, height);
}
export interface RasterizedColorGlyphT {
    width: number;
    height: number;
    pixels: Uint8Array;
}
const COLR_FOREGROUND_SENTINEL = 0xffff;
function compositeOver(pixels: Uint8Array, i: number, srcCoverage: number, color: {
    r: number;
    g: number;
    b: number;
    a: number;
}): void {
    const srcA = (srcCoverage / 255) * (color.a / 255);
    if (srcA <= 0)
        return;
    const o = i * 4;
    const dstA = at(pixels, o + 3, "pixels") / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0)
        return;
    const dstFactor = dstA * (1 - srcA);
    pixels[o] = Math.round((color.r * srcA + at(pixels, o, "pixels") * dstFactor) / outA);
    pixels[o + 1] = Math.round((color.g * srcA + at(pixels, o + 1, "pixels") * dstFactor) / outA);
    pixels[o + 2] = Math.round((color.b * srcA + at(pixels, o + 2, "pixels") * dstFactor) / outA);
    pixels[o + 3] = Math.round(outA * 255);
}
export function rasterizeColorGlyph(font: ParsedFontT, baseGid: number, px: number, paletteId = 0, foregroundColor: {
    r: number;
    g: number;
    b: number;
    a: number;
} = { r: 255, g: 255, b: 255, a: 255 }): RasterizedColorGlyphT | null {
    const layers = font.colorLayers(baseGid);
    if (layers === null)
        return null;
    const scale = px / font.unitsPerEm;
    const width = Math.max(1, Math.round(font.advanceWidth(baseGid) * scale));
    const resolved: {
        contours: FlattenedContourT[];
        color: {
            r: number;
            g: number;
            b: number;
            a: number;
        };
    }[] = [];
    let yMin = 0;
    for (const layer of layers) {
        const color = layer.paletteIndex === COLR_FOREGROUND_SENTINEL ? foregroundColor : font.paletteColor(layer.paletteIndex, paletteId);
        if (color === null)
            continue;
        const contours = font.contours(layer.gid);
        for (const c of contours)
            for (const p of c)
                if (p.y < yMin)
                    yMin = p.y;
        resolved.push({ contours, color });
    }
    const bottom = Math.min(0, yMin);
    const height = Math.max(1, Math.round((font.ascent - bottom) * scale));
    const pixels = new Uint8Array(width * height * 4);
    for (const { contours, color } of resolved) {
        if (contours.length === 0)
            continue;
        const pxContours: FlattenedContourT[] = contours.map((c) => c.map((p) => ({ x: p.x * scale, y: (font.ascent - p.y) * scale })));
        const raster = rasterizeContours(pxContours, width, height);
        for (let i = 0; i < raster.coverage.length; i++) {
            if (at(raster.coverage, i, "raster.coverage") === 0)
                continue;
            compositeOver(pixels, i, at(raster.coverage, i, "raster.coverage"), color);
        }
    }
    return { width, height, pixels };
}
export interface AtlasRectT {
    x: number;
    y: number;
    w: number;
    h: number;
    color: boolean;
}
export interface FontAtlasT {
    width: number;
    height: number;
    pixels: Uint8Array;
    glyphs: Map<number, AtlasRectT>;
    lineHeight: number;
}
interface AtlasCellFields {
    codepoint: number;
    width: number;
    height: number;
}
type AtlasCellT = AtlasCellFields & ({
    color: true;
    rgba: Uint8Array;
} | {
    color: false;
    coverage: Uint8Array;
});
export function buildFontAtlas(font: ParsedFontT, codepoints: Iterable<number, unknown, unknown>, px: number, maxWidth = 512): FontAtlasT {
    if (!Number.isFinite(px) || px <= 0 || !Number.isSafeInteger(maxWidth) || maxWidth < 1)
        throw new RangeError("Font atlas pixel size and width must be positive");
    const cells: AtlasCellT[] = [];
    let lineHeight = 0;
    for (const cp of codepoints) {
        const gid = font.cmapLookup(cp);
        if (gid === 0)
            continue;
        if (font.colorLayers(gid) !== null) {
            const raster = rasterizeColorGlyph(font, gid, px);
            if (raster === null)
                continue;
            if (raster.height > lineHeight)
                lineHeight = raster.height;
            cells.push({ codepoint: cp, width: raster.width, height: raster.height, color: true, rgba: raster.pixels });
            continue;
        }
        const raster = rasterizeGlyph(font, gid, px);
        if (raster.height > lineHeight)
            lineHeight = raster.height;
        cells.push({ codepoint: cp, width: raster.width, height: raster.height, color: false, coverage: raster.coverage });
    }
    const sorted = [...cells].sort((a, b) => b.height - a.height);
    const gap = 1;
    let atlasWidth = maxWidth;
    for (const cell of cells)
        atlasWidth = Math.max(atlasWidth, cell.width + gap * 2);
    let cursorX = gap;
    let cursorY = gap;
    let shelfHeight = 0;
    const placements = new Map<number, {
        x: number;
        y: number;
    }>();
    for (const { codepoint, width, height } of sorted) {
        if (cursorX + width + gap > atlasWidth) {
            cursorX = gap;
            cursorY += shelfHeight + gap;
            shelfHeight = 0;
        }
        placements.set(codepoint, { x: cursorX, y: cursorY });
        cursorX += width + gap;
        if (height > shelfHeight)
            shelfHeight = height;
    }
    const atlasHeight = cursorY + shelfHeight + gap;
    const pixels = new Uint8Array(atlasWidth * atlasHeight * 4);
    const glyphs = new Map<number, AtlasRectT>();
    for (const cell of cells) {
        const pos = placements.get(cell.codepoint);
        if (pos === undefined)
            continue;
        if (cell.color) {
            const src = cell.rgba;
            for (let y = 0; y < cell.height; y++) {
                for (let x = 0; x < cell.width; x++) {
                    const so = (y * cell.width + x) * 4;
                    const dst = ((pos.y + y) * atlasWidth + (pos.x + x)) * 4;
                    pixels[dst] = at(src, so, "src");
                    pixels[dst + 1] = at(src, so + 1, "src");
                    pixels[dst + 2] = at(src, so + 2, "src");
                    pixels[dst + 3] = at(src, so + 3, "src");
                }
            }
        }
        else {
            const src = cell.coverage;
            for (let y = 0; y < cell.height; y++) {
                for (let x = 0; x < cell.width; x++) {
                    const a = at(src, y * cell.width + x, "src");
                    const dst = ((pos.y + y) * atlasWidth + (pos.x + x)) * 4;
                    pixels[dst] = 255;
                    pixels[dst + 1] = 255;
                    pixels[dst + 2] = 255;
                    pixels[dst + 3] = a;
                }
            }
        }
        glyphs.set(cell.codepoint, { x: pos.x, y: pos.y, w: cell.width, h: cell.height, color: cell.color });
    }
    return { width: atlasWidth, height: atlasHeight, pixels, glyphs, lineHeight };
}
export function latin1Codepoints(): number[] {
    const out: number[] = [];
    for (let cp = 0x20; cp <= 0x7e; cp++)
        out.push(cp);
    for (let cp = 0xa0; cp <= 0xff; cp++)
        out.push(cp);
    return out;
}
