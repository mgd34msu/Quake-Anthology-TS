import { createHash } from 'node:crypto';
import type { IndexedModelSkin } from '../../../contracts/scene.ts';
import { decodePcx } from '../../../formats/images/indexed.ts';

export interface QwSkinOptions {
  readonly read: (path: string) => Promise<Uint8Array | null>;
  readonly noskins: () => number;
  readonly baseskin: () => string;
  readonly allskins: () => string;
}

function skinName(value: string): string {
  if (value.includes('..') || value.startsWith('.') || !/^[a-zA-Z0-9_+.-]+$/.test(value)) return 'base';
  const dot = value.lastIndexOf('.');
  return (dot < 0 ? value : value.slice(0, dot)).slice(0, 15) || 'base';
}

/** Skin_Find/Skin_Cache selection; the remote owner clears after downloads or content changes. */
export class QwPlayerSkins {
  private readonly cache = new Map<string, Promise<IndexedModelSkin | null>>();
  constructor(private readonly options: QwSkinOptions) {}
  name(userinfoSkin: string): string { return skinName(this.options.allskins() || userinfoSkin || this.options.baseskin()); }
  select(userinfoSkin: string): Promise<IndexedModelSkin | null> {
    if (this.options.noskins() === 1) return Promise.resolve(null);
    const base = skinName(this.options.baseskin());
    const selected = this.name(userinfoSkin), key = `${selected}\0${base}`;
    const cached = this.cache.get(key); if (cached !== undefined) return cached;
    if (this.cache.size === 128) this.clear();
    const pending = this.load(selected, base);
    this.cache.set(key, pending);
    return pending;
  }
  clear(): void { this.cache.clear(); }
  private async load(selected: string, base: string): Promise<IndexedModelSkin | null> {
    let path = `skins/${selected}.pcx`, bytes = await this.options.read(path);
    if (bytes === null && selected !== base) { path = `skins/${base}.pcx`; bytes = await this.options.read(path); }
    if (bytes === null) return null;
    try {
      if (bytes.length < 128) return null;
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (header.getUint16(8, true) >= 320 || header.getUint16(10, true) >= 200) return null;
      const decoded = decodePcx(bytes, path);
      const padded = new Uint8Array(320 * 200);
      for (let row = 0; row < decoded.height; row++) padded.set(decoded.indices.subarray(row * decoded.width, (row + 1) * decoded.width), row * 320);
      const pixels = new Uint8Array(296 * 194);
      for (let row = 0; row < 194; row++) pixels.set(padded.subarray(row * 320, row * 320 + 296), row * 296);
      return { name: `qw-skin:${createHash('sha256').update(bytes).digest('hex')}:crop:0,0,296,194:stride320`, width: 296, height: 194, pixels };
    } catch { return null; }
  }
}
