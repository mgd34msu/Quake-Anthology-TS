// Xiph libtheoradec public LP64 API; compressed packet framing remains TypeScript.
import { dlopen, ptr, type Pointer } from "bun:ffi";
import type { OggPacket } from "../media/ogg.ts";
import { openNativeLibrary } from "./native-libraries.ts";

function loadTheora() {
  if ((process.platform !== "linux" && process.platform !== "darwin") || (process.arch !== "x64" && process.arch !== "arm64"))
    throw new Error("Theora decoding requires the qualified 64-bit LP64 ABI");
  return openNativeLibrary("theoradec", path => dlopen(path, {
    th_info_init: { args: ["buffer"], returns: "void" }, th_info_clear: { args: ["buffer"], returns: "void" },
    th_comment_init: { args: ["buffer"], returns: "void" }, th_comment_clear: { args: ["buffer"], returns: "void" },
    th_decode_headerin: { args: ["buffer", "buffer", "buffer", "buffer"], returns: "i32" },
    th_decode_alloc: { args: ["buffer", "u64"], returns: "ptr" }, th_setup_free: { args: ["u64"], returns: "void" },
    th_decode_free: { args: ["ptr"], returns: "void" },
    th_decode_packetin: { args: ["ptr", "buffer", "buffer"], returns: "i32" },
    th_decode_ycbcr_out: { args: ["ptr", "buffer"], returns: "i32" },
  }));
}
function loadMemory() {
  return dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
    { memcpy: { args: ["buffer", "u64", "u64"], returns: "ptr" } });
}
let memory: ReturnType<typeof loadMemory> | undefined;
let library: ReturnType<typeof loadTheora> | undefined;
function theora() { library ??= loadTheora(); return library.symbols; }
function nativePacket(packet: OggPacket): Uint8Array {
  const storage = new Uint8Array(48), view = new DataView(storage.buffer);
  // ogg_packet: pointer, three C longs, granulepos and packetno, all eight-byte LP64 fields.
  view.setBigUint64(0, packet.data.length === 0 ? 0n : BigInt(ptr(packet.data)), true);
  view.setBigInt64(8, BigInt(packet.data.length), true);
  view.setBigInt64(16, packet.first ? 1n : 0n, true); view.setBigInt64(24, packet.last ? 1n : 0n, true);
  view.setBigInt64(32, packet.granule, true); view.setBigInt64(40, BigInt(packet.index), true);
  return storage;
}
export interface TheoraPicture { readonly width: number; readonly height: number; readonly rgba: Uint8Array; }
export class TheoraDecoder {
  private context: Pointer | null = null;
  readonly width: number;
  readonly height: number;
  readonly frameMilliseconds: number;
  private readonly cropX: number;
  private readonly cropY: number;
  private readonly pixelFormat: number;
  constructor(headers: readonly OggPacket[]) {
    const api = theora(), info = new Uint8Array(64), comments = new Uint8Array(32), setupStorage = new BigUint64Array(1);
    api.th_info_init(info); api.th_comment_init(comments);
    try {
      if (headers.length !== 3) throw new Error("Theora requires three header packets");
      for (const packet of headers) {
        const result = api.th_decode_headerin(info, comments, setupStorage, nativePacket(packet));
        if (result <= 0) throw new Error(`Invalid Theora header: ${result}`);
      }
      const metadata = new DataView(info.buffer);
      const frameWidth = metadata.getUint32(4, true), frameHeight = metadata.getUint32(8, true);
      this.width = metadata.getUint32(12, true); this.height = metadata.getUint32(16, true);
      this.cropX = metadata.getUint32(20, true); this.cropY = metadata.getUint32(24, true);
      const numerator = metadata.getUint32(28, true), denominator = metadata.getUint32(32, true);
      this.pixelFormat = metadata.getInt32(48, true);
      if (this.width < 1 || this.height < 1 || frameWidth * frameHeight > 0x1000000 || this.cropX + this.width > frameWidth
        || this.cropY + this.height > frameHeight || numerator === 0 || denominator === 0 || ![0, 2, 3].includes(this.pixelFormat)) throw new Error("Unsupported Theora dimensions, rate or pixel format");
      this.frameMilliseconds = denominator * 1000 / numerator;
      if (this.frameMilliseconds < 1 || this.frameMilliseconds > 10000) throw new Error("Theora frame rate outside supported limits");
      const setup = setupStorage[0] ?? 0n;
      if (setup === 0n) throw new Error("Theora setup allocation failed");
      this.context = api.th_decode_alloc(info, setup);
      if (this.context === null) throw new Error("Theora decoder allocation failed");
    } finally {
      const setup = setupStorage[0] ?? 0n;
      if (setup !== 0n) api.th_setup_free(setup);
      api.th_comment_clear(comments); api.th_info_clear(info);
    }
  }
  decode(packet: OggPacket): TheoraPicture {
    const context = this.context;
    if (context === null) throw new Error("Theora decoder is closed");
    const api = theora(), granule = new BigInt64Array(1), planes = new Uint8Array(72);
    const result = api.th_decode_packetin(context, nativePacket(packet), granule);
    if (result < 0) throw new Error(`Invalid Theora frame: ${result}`);
    if (api.th_decode_ycbcr_out(context, planes) !== 0) throw new Error("Theora frame planes unavailable");
    const view = new DataView(planes.buffer);
    const plane = (index: number): { bytes: Uint8Array; width: number; height: number; stride: number } => {
      const offset = index * 24, width = view.getInt32(offset, true), height = view.getInt32(offset + 4, true), stride = view.getInt32(offset + 8, true);
      const pointer = view.getBigUint64(offset + 16, true);
      if (pointer === 0n || width < 1 || height < 1 || stride < width || stride * height > 128 * 1024 * 1024) throw new Error("Invalid Theora output plane");
      const bytes = new Uint8Array(stride * height);
      memory ??= loadMemory(); memory.symbols.memcpy(bytes, pointer, bytes.length);
      return { bytes, width, height, stride };
    };
    const yPlane = plane(0), cb = plane(1), cr = plane(2), rgba = new Uint8Array(this.width * this.height * 4);
    const shiftX = this.pixelFormat === 3 ? 0 : 1, shiftY = this.pixelFormat === 0 ? 1 : 0;
    if (this.cropX + this.width > yPlane.width || this.cropY + this.height > yPlane.height
      || ((this.cropX + this.width - 1) >> shiftX) >= cb.width || ((this.cropY + this.height - 1) >> shiftY) >= cb.height
      || cb.width !== cr.width || cb.height !== cr.height) throw new Error("Theora crop exceeds decoded planes");
    const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const sourceX = this.cropX + x, sourceY = this.cropY + y;
      const luma = yPlane.bytes[sourceY * yPlane.stride + sourceX];
      const blue = cb.bytes[(sourceY >> shiftY) * cb.stride + (sourceX >> shiftX)], red = cr.bytes[(sourceY >> shiftY) * cr.stride + (sourceX >> shiftX)];
      if (luma === undefined || blue === undefined || red === undefined) throw new Error("Missing Theora color sample");
      const yy = 1.1643835616438356 * (luma - 16), u = blue - 128, v = red - 128, offset = (y * this.width + x) * 4;
      rgba[offset] = byte(yy + 1.5960267857142858 * v); rgba[offset + 1] = byte(yy - 0.39176229009491365 * u - 0.8129676472377708 * v);
      rgba[offset + 2] = byte(yy + 2.017232142857143 * u); rgba[offset + 3] = 255;
    }
    return { width: this.width, height: this.height, rgba };
  }
  close(): void { if (this.context !== null) { theora().th_decode_free(this.context); this.context = null; } }
}
