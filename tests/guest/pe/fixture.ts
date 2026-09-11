// SPDX-License-Identifier: GPL-2.0-or-later
/** Authored PE bytes, with RVAs chosen independently of the loader implementation. */
export function peFixture(width: 4 | 8): Uint8Array {
  const bytes = new Uint8Array(0x1200);
  const view = new DataView(bytes.buffer);
  const base = width === 4 ? 0x10000000n : 0x180000000n;
  const optional = 0x98;
  const optionalSize = width === 4 ? 224 : 240;
  const directories = optional + (width === 4 ? 96 : 112);
  const u16 = (offset: number, value: number): void => { view.setUint16(offset, value, true); };
  const u32 = (offset: number, value: number): void => { view.setUint32(offset, value, true); };
  const text = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(`${value}\0`), offset); };
  const raw = (rva: number): number => rva < 0x2000 ? rva - 0x1000 + 0x400
    : rva < 0x3000 ? rva - 0x2000 + 0x600 : rva < 0x4000 ? rva - 0x3000 + 0xe00 : rva - 0x4000 + 0x1000;
  const dword = (rva: number, value: number): void => { u32(raw(rva), value); };
  const pointer = (rva: number, value: bigint): void => {
    if (width === 4) u32(raw(rva), Number(value)); else view.setBigUint64(raw(rva), value, true);
  };
  const directory = (index: number, rva: number, size: number): void => { u32(directories + index * 8, rva); u32(directories + index * 8 + 4, size); };
  u16(0, 0x5a4d); u32(0x3c, 0x80); u32(0x80, 0x4550);
  u16(0x84, width === 4 ? 0x14c : 0x8664); u16(0x86, 4); u16(0x94, optionalSize); u16(0x96, 0x2002);
  u16(optional, width === 4 ? 0x10b : 0x20b); u32(optional + 16, 0x1000);
  if (width === 4) u32(optional + 28, Number(base)); else view.setBigUint64(optional + 24, base, true);
  u32(optional + 32, 0x1000); u32(optional + 36, 0x200); u32(optional + 56, 0x5000); u32(optional + 60, 0x400);
  u32(directories - 4, 16);
  const sections = [
    { name: ".text", rva: 0x1000, size: 0x80, raw: 0x400, rawSize: 0x200, flags: 0x60000020 },
    { name: ".rdata", rva: 0x2000, size: 0x800, raw: 0x600, rawSize: 0x800, flags: 0x40000040 },
    { name: ".data", rva: 0x3000, size: 0x1000, raw: 0xe00, rawSize: 0x200, flags: 0xc0000040 },
    { name: ".reloc", rva: 0x4000, size: 0x200, raw: 0x1000, rawSize: 0x200, flags: 0x42000040 },
  ];
  for (const [index, section] of sections.entries()) {
    const at = optional + optionalSize + index * 40;
    text(at, section.name); u32(at + 8, section.size); u32(at + 12, section.rva);
    u32(at + 16, section.rawSize); u32(at + 20, section.raw); u32(at + 36, section.flags);
  }
  bytes.fill(0xc3, 0x400, 0x480);
  directory(0, 0x2000, 0x100);
  dword(0x200c, 0x2090); dword(0x2010, 8); dword(0x2014, 2); dword(0x2018, 2);
  dword(0x201c, 0x2040); dword(0x2020, 0x2050); dword(0x2024, 0x2058);
  dword(0x2040, 0x1010); dword(0x2044, 0x2080); dword(0x2050, 0x2060); dword(0x2054, 0x2070);
  u16(raw(0x2058), 0); u16(raw(0x205a), 1);
  text(raw(0x2060), "GetGameAPI"); text(raw(0x2070), "Forward"); text(raw(0x2080), "other.#8"); text(raw(0x2090), "authored.dll");
  directory(1, 0x2100, 40);
  dword(0x2100, 0x2140); dword(0x210c, 0x2180); dword(0x2110, 0x2160);
  pointer(0x2140, 0x21a0n); pointer(0x2140 + width, (1n << BigInt(width * 8 - 1)) | 7n);
  pointer(0x2160, 0x21a0n); pointer(0x2160 + width, (1n << BigInt(width * 8 - 1)) | 7n);
  text(raw(0x2180), "guest.dll"); text(raw(0x21a2), "Target");
  directory(9, 0x2200, width * 4 + 8);
  pointer(0x2200, base + 0x3000n); pointer(0x2200 + width, base + 0x3004n);
  pointer(0x2200 + width * 2, base + 0x3020n); pointer(0x2200 + width * 3, base + 0x2240n);
  dword(0x2200 + width * 4, 12); dword(0x2200 + width * 4 + 4, 0x00300000);
  pointer(0x2240, base + 0x1020n); pointer(0x2240 + width, base + 0x1030n);
  bytes.set([9, 8, 7, 6], raw(0x3000)); pointer(0x3010, base + 0x1050n);
  const configSize = width === 4 ? 92 : 148;
  directory(10, 0x2280, configSize); dword(0x2280, configSize);
  const cookie = 0x2280 + (width === 4 ? 60 : 88);
  const check = 0x2280 + (width === 4 ? 72 : 112);
  const dispatch = 0x2280 + (width === 4 ? 76 : 120);
  pointer(cookie, base + 0x3040n); pointer(check, base + 0x3060n); pointer(dispatch, base + 0x3070n);
  dword(0x2280 + (width === 4 ? 88 : 144), 0x100);
  if (width === 8) {
    directory(3, 0x2380, 12); dword(0x2380, 0x1000); dword(0x2384, 0x1040); dword(0x2388, 0x23a0);
    bytes.set([1, 4, 1, 0, 4, 0x32, 0, 0], raw(0x23a0));
  }
  const relocationType = width === 4 ? 3 : 10;
  const rdataRelocations = [0x2200, 0x2200 + width, 0x2200 + width * 2, 0x2200 + width * 3, 0x2240, 0x2240 + width, cookie, check, dispatch]
    .map(rva => (relocationType << 12) | (rva - 0x2000));
  rdataRelocations.push(0);
  const dataRelocations = [(relocationType << 12) | 0x10];
  if (width === 4) {
    u16(raw(0x3018), 0x1122); u16(raw(0x301a), 0x3344); u16(raw(0x301c), 0x2000);
    dataRelocations.push(0x1018, 0x201a, 0x401c, 0x8123);
  }
  dataRelocations.push(0);
  let relocationBytes = 0;
  for (const block of [{ page: 0x2000, entries: rdataRelocations }, { page: 0x3000, entries: dataRelocations }]) {
    const size = 8 + block.entries.length * 2;
    dword(0x4000 + relocationBytes, block.page); dword(0x4004 + relocationBytes, size);
    for (const [index, value] of block.entries.entries()) u16(raw(0x4008 + relocationBytes + index * 2), value);
    relocationBytes += size;
  }
  directory(5, 0x4000, relocationBytes);
  return bytes;
}
