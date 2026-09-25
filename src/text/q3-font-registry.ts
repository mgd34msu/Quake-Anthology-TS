// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from quake-3-ts/src/render/font-registry.ts.
import { SaveReader } from "../persistence/value.ts";
import type { FontFileReader, RetainedFontFile } from "./draw2d.ts";
import type { MaterialPicture } from "./draw2d.ts";
import { readFontData } from "./q3-font.ts";
import type { RegisteredFont, RegisteredGlyph } from "./q3-font.ts";
import { FreeTypeFontLibrary } from "../platform/freetype.ts";
import type { FontGlyphBitmap, FreeTypeInitialization } from "../platform/freetype.ts";
export interface FontGenerationServices {
    registerImage(name: string, rgba: Uint8Array): Promise<MaterialPicture>;
    saveFontData(): boolean;
    writeFile(name: string, bytes: Uint8Array): void | Promise<void>;
}
export class RendererFontRegistry {
    private readonly fonts: {
        readonly font: RegisteredFont;
        readonly record: Uint8Array;
    }[] = [];
    private pending = 0;
    private readonly generated = new Map<string, Uint8Array>();
    private registration: Promise<void> = Promise.resolve();
    private freeType: FreeTypeInitialization | undefined;
    private readonly retained = new Set<RetainedFontFile>();
    private closed = false;
    constructor(private readonly reader: FontFileReader, private readonly registerPicture: (path: string) => Promise<MaterialPicture>, private readonly syncRenderThread: () => void, private readonly generation: FontGenerationServices | null = null) { }
    captureCheckpoint() {
        this.requireOpen();
        if (this.pending !== 0) throw new Error("Cannot checkpoint pending font registration");
        return { freeType: this.freeType?.kind ?? null,
            generated: [...this.generated].map(([name, rgba]) => ({ name, rgba: rgba.slice() })),
            fonts: this.fonts.map(entry => ({ record: entry.record.slice(), pictures: entry.font.glyphs.map(glyph => glyph.picture?.name ?? null) })) };
    }
    async restoreCheckpoint(value: unknown): Promise<void> {
        this.requireOpen();
        if (this.pending !== 0 || this.fonts.length !== 0 || this.freeType !== undefined) throw new Error("Font restore requires an empty owner");
        const r = new SaveReader(value, "client-fonts");
        const freeType = r.field("freeType").nullable(v => v.choice("unavailable", "failed", "ready"));
        this.pending++;
        try {
            if (freeType !== null) {
                this.freeType = FreeTypeFontLibrary.open();
                if (this.freeType.kind !== freeType) r.fail("font generator availability changed");
            }
            const generated = new Map<string, MaterialPicture>();
            for (const row of r.field("generated").list(item => ({ name: item.field("name").string(), rgba: item.field("rgba").bytes().slice() }))) {
                if (this.generation === null || row.rgba.length !== 256 * 256 * 4 || generated.has(row.name)) r.fail("invalid generated font atlas");
                const generation = this.generation;
                if (generation === null) throw new Error("Generated font restore requires its atlas owner");
                const picture = await generation.registerImage(row.name, row.rgba);
                this.requireOpen(); generated.set(row.name, picture); this.generated.set(row.name, row.rgba);
            }
            const rows = r.field("fonts").list(item => ({ record: item.field("record").bytes().slice(), pictures: item.field("pictures").list(v => v.nullable(name => name.string())) }));
            if (rows.length > 6) r.fail("too many cached fonts");
            for (const row of rows) {
                if (row.record.length !== 20548 || row.pictures.length !== 256) r.fail("invalid font record");
                const data = readFontData(row.record), glyphs: RegisteredGlyph[] = [], view = new DataView(row.record.buffer);
                for (const [index, glyph] of data.glyphs.entries()) {
                    const name = row.pictures[index];
                    if (name === undefined) throw new Error("Missing cached glyph");
                    const picture = name === null ? null : generated.get(name) ?? await this.registerPicture(name);
                    this.requireOpen();
                    if (picture !== null) view.setInt32(index * 80 + 44, picture.material.order, true);
                    glyphs.push({ ...glyph, picture });
                }
                this.fonts.push({ font: { name: data.name, glyphScale: data.glyphScale, glyphs }, record: row.record });
            }
        } finally { this.pending--; }
    }
    async registerFont(path: string | null, pointSize: number, print: (text: string) => void, destination?: () => Uint8Array): Promise<RegisteredFont | null> {
        if (!Number.isFinite(pointSize))
            throw new RangeError("Invalid font point size");
        const integerSize = Math.trunc(pointSize), size = integerSize <= 0 ? 12 : integerSize;
        this.pending++;
        const result = this.registration.then(() => this.loadFont(`fonts/fontImage_${size}.dat`, path, size, print, destination));
        this.registration = result.then(() => { this.pending--; }, () => { this.pending--; });
        return result;
    }
    close(): void {
        if (this.closed)
            return;
        this.closed = true;
        if (this.freeType?.kind === "ready")
            this.freeType.library.close();
        this.freeType = undefined;
        this.fonts.length = 0;
        this.generated.clear();
        for (const file of this.retained) this.reader.freeFile(file);
        this.retained.clear();
    }
    private async loadFont(name: string, path: string | null, size: number, print: (text: string) => void, destination: (() => Uint8Array) | undefined): Promise<RegisteredFont | null> {
        this.requireOpen();
        this.syncRenderThread();
        if (this.fonts.length >= 6) {
            print("RE_RegisterFont: Too many fonts registered already.\n");
            return null;
        }
        const cached = this.fonts.find(entry => entry.font.name.toLowerCase() === name.toLowerCase());
        if (cached !== undefined) {
            if (destination !== undefined)
                this.destinationRecord(destination).set(cached.record);
            return cached.font;
        }
        const file = await this.reader.readFileLength(name) === 20548 ? await this.reader.readFileRetained(name) : undefined;
        if (this.closed && file !== undefined) this.reader.freeFile(file);
        this.requireOpen();
        if (file === undefined || file.length !== 20548) {
            if (file !== undefined) this.reader.freeFile(file);
            return this.generateFont(path, size, print, destination);
        }
        // Q3 retains DAT allocations through registration; release them with this renderer.
        this.retained.add(file);
        const bytes = file.bytes;
        const record = destination === undefined ? bytes.slice() : this.destinationRecord(destination);
        record.set(bytes);
        record.fill(0, 20484);
        for (let index = 0; index < name.length; index++)
            record[20484 + index] = name.charCodeAt(index);
        const view = new DataView(record.buffer, record.byteOffset, record.byteLength), pictures: MaterialPicture[] = [];
        for (let index = 0; index < 255; index++) {
            const shaderBytes = record.subarray(index * 80 + 48), end = shaderBytes.indexOf(0);
            if (end < 0)
                throw new RangeError("Font shader name has no terminator inside fontInfo_t");
            let shaderName = "";
            for (const byte of shaderBytes.subarray(0, end))
                shaderName += String.fromCharCode(byte);
            const picture = await this.registerPicture(shaderName);
            this.requireOpen();
            view.setInt32(index * 80 + 44, picture.material.order, true);
            pictures.push(picture);
        }
        const data = readFontData(record, name), glyphs: RegisteredGlyph[] = [];
        for (const [index, glyph] of data.glyphs.entries()) {
            const picture = index === 255 ? null : pictures[index];
            if (picture === undefined)
                throw new RangeError("Missing registered font glyph");
            glyphs.push({ ...glyph, picture });
        }
        const result: RegisteredFont = { name: data.name, glyphScale: data.glyphScale, glyphs };
        this.fonts.push({ font: result, record: record.slice() });
        return result;
    }
    private async generateFont(path: string | null, size: number, print: (text: string) => void, destination: (() => Uint8Array) | undefined): Promise<RegisteredFont | null> {
        const generation = this.generation;
        if (generation === null) {
            print("RE_RegisterFont: FreeType code not available\n");
            return null;
        }
        if (this.freeType === undefined)
            this.freeType = FreeTypeFontLibrary.open(print);
        if (this.freeType.kind !== "ready") {
            print(this.freeType.kind === "unavailable" ? "RE_RegisterFont: FreeType code not available\n" : "RE_RegisterFont: FreeType not initialized.\n");
            return null;
        }
        const freeType = this.freeType.library;
        const file = await this.reader.readFileRetained(path ?? "");
        if (this.closed && file !== undefined) this.reader.freeFile(file);
        this.requireOpen();
        if (file === undefined || file.length <= 0) {
            if (file !== undefined) this.reader.freeFile(file);
            print("RE_RegisterFont: Unable to read font file\n");
            return null;
        }
        const face = freeType.createFace(file.bytes, size, print);
        if (face === null) {
            this.reader.freeFile(file);
            return null;
        }
        try {
        const record = destination === undefined ? new Uint8Array(20548) : this.destinationRecord(destination);
        const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
        const pictures: (MaterialPicture | null)[] = Array.from({ length: 256 }, () => null);
        const atlas = new Uint8Array(1024 * 1024);
        let maxHeight = 0;
        for (let code = 0; code < 255; code++) {
            const glyph = freeType.renderGlyph(face, code, print);
            if (glyph !== null)
                maxHeight = Math.max(maxHeight, glyph.height);
        }
        let x = 0, y = 0, lastStart = 0, imageNumber = 0;
        for (let code = 0; code <= 255; code++) {
            const glyph = freeType.renderGlyph(face, code, print);
            let overflow = false;
            if (glyph !== null) {
                maxHeight = Math.max(maxHeight, glyph.height);
                if (x + glyph.pitch + 1 >= 255) {
                    if (y + maxHeight + 1 >= 255)
                        overflow = true;
                    else {
                        x = 0;
                        y += maxHeight + 1;
                    }
                }
                else if (y + maxHeight + 1 >= 255)
                    overflow = true;
                if (!overflow)
                    for (let row = 0; row < glyph.height; row++) {
                        const start = row * glyph.pitch;
                        atlas.set(glyph.pixels.subarray(start, start + glyph.pitch), (y + row) * 256 + x);
                    }
            }
            if (overflow || code === 255) {
                const rgba = new Uint8Array(256 * 256 * 4);
                let maximum = 0;
                for (const value of atlas.subarray(0, 256 * 256))
                    maximum = Math.max(maximum, value);
                const scale = maximum > 0 ? Math.fround(255 / maximum) : 0;
                for (let pixel = 0; pixel < 256 * 256; pixel++) {
                    const value = atlas[pixel];
                    if (value === undefined)
                        throw new RangeError("Font atlas pixel exceeds allocation");
                    rgba.fill(255, pixel * 4, pixel * 4 + 3);
                    rgba[pixel * 4 + 3] = Math.fround(value * scale);
                }
                const name = `fonts/fontImage_${imageNumber++}_${size}.tga`;
                if (generation.saveFontData())
                    await generation.writeFile(name, this.tga(rgba));
                this.requireOpen();
                const picture = await generation.registerImage(name, rgba);
                this.generated.set(name, rgba.slice());
                this.requireOpen();
                for (let index = lastStart; index < code; index++) {
                    view.setInt32(index * 80 + 44, picture.material.order, true);
                    this.writeName(record, index * 80 + 48, 32, name);
                    pictures[index] = picture;
                }
                lastStart = code;
                atlas.fill(0);
                x = 0;
                y = 0;
            }
            else {
                this.writeGlyph(view, record, code, glyph, x, y);
                if (glyph !== null)
                    x += glyph.pitch + 1;
            }
        }
        view.setFloat32(20480, Math.fround(48 / Math.fround(size)), true);
        this.writeName(record, 20484, 64, `fonts/fontImage_${size}.dat`);
        const data = readFontData(record), glyphs: RegisteredGlyph[] = [];
        for (const [index, glyph] of data.glyphs.entries()) {
            const picture = pictures[index];
            if (picture === undefined)
                throw new RangeError("Missing generated font glyph slot");
            glyphs.push({ ...glyph, picture });
        }
        const result: RegisteredFont = { name: data.name, glyphScale: data.glyphScale, glyphs };
        this.fonts.push({ font: result, record: record.slice() });
        if (generation.saveFontData())
            await generation.writeFile(`fonts/fontImage_${size}.dat`, record);
        this.requireOpen();
        return result;
        } finally {
            if (!this.closed) freeType.releaseFace(face);
            this.reader.freeFile(file);
        }
    }
    private writeGlyph(view: DataView, bytes: Uint8Array, code: number, glyph: FontGlyphBitmap | null, x: number, y: number): void {
        const offset = code * 80;
        bytes.fill(0, offset, offset + 80);
        if (glyph === null)
            return;
        for (const [index, value] of [glyph.height, glyph.top, glyph.bottom, glyph.pitch, glyph.xSkip, glyph.pitch, glyph.height].entries())
            view.setInt32(offset + index * 4, value, true);
        for (const [index, value] of [x / 256, y / 256, (x + glyph.pitch) / 256, (y + glyph.height) / 256].entries())
            view.setFloat32(offset + 28 + index * 4, value, true);
    }
    private writeName(bytes: Uint8Array, offset: number, length: number, name: string): void {
        const text = Buffer.from(name, "latin1").subarray(0, length - 1);
        bytes.fill(0, offset, offset + length);
        bytes.set(text, offset);
    }
    private tga(rgba: Uint8Array): Uint8Array {
        const bytes = new Uint8Array(rgba.length + 18);
        bytes[2] = 2;
        bytes[13] = 1;
        bytes[15] = 1;
        bytes[16] = 32;
        bytes[17] = 0x28;
        bytes.set(rgba, 18);
        return bytes;
    }
    private requireOpen(): void { if (this.closed)
        throw new Error("Renderer font registry is closed"); }
    private destinationRecord(destination: () => Uint8Array): Uint8Array {
        const record = destination();
        if (record.byteLength !== 20548)
            throw new RangeError("fontInfo_t destination must contain exactly 20548 bytes");
        return record;
    }
}
