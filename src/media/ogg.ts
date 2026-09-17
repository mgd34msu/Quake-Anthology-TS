// Ogg framing (RFC 3533): packet lacing and logical stream sequence ownership.
export interface OggPacket {
  readonly data: Uint8Array;
  readonly first: boolean;
  readonly last: boolean;
  readonly granule: bigint;
  readonly index: number;
}
export interface OggMovie {
  readonly video: readonly OggPacket[];
  readonly audio: Uint8Array | null;
}
interface LogicalStream {
  sequence: number;
  readonly packets: OggPacket[];
  readonly pages: Uint8Array[];
  pieces: Uint8Array[];
  pendingBytes: number;
  ended: boolean;
}
const checksumTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
  return value >>> 0;
});
function join(parts: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export function decodeOggMovie(bytes: Uint8Array): OggMovie {
  if (bytes.length > 512 * 1024 * 1024) throw new RangeError("Ogg movie exceeds 512 MiB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), streams = new Map<number, LogicalStream>();
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || view.getUint32(offset, false) !== 0x4f676753 || bytes[offset + 4] !== 0) throw new Error("Invalid or truncated Ogg page");
    const flags = bytes[offset + 5], segments = bytes[offset + 26];
    if (flags === undefined || segments === undefined || (flags & ~7) !== 0 || offset + 27 + segments > bytes.length) throw new Error("Invalid Ogg page flags/lacing");
    const lacing = bytes.subarray(offset + 27, offset + 27 + segments), payloadStart = offset + 27 + segments;
    let payloadBytes = 0; for (const length of lacing) payloadBytes += length;
    const end = payloadStart + payloadBytes;
    if (end > bytes.length) throw new Error("Truncated Ogg page payload");
    let crc = 0;
    for (let position = offset; position < end; position++) {
      const byte = position >= offset + 22 && position < offset + 26 ? 0 : bytes[position];
      if (byte === undefined) throw new Error("Missing Ogg checksum byte");
      const table = checksumTable[((crc >>> 24) ^ byte) & 255];
      if (table === undefined) throw new Error("Missing Ogg checksum entry");
      crc = ((crc << 8) ^ table) >>> 0;
    }
    if (crc !== view.getUint32(offset + 22, true)) throw new Error("Ogg page checksum mismatch");
    const serial = view.getUint32(offset + 14, true), sequence = view.getUint32(offset + 18, true);
    let stream = streams.get(serial);
    if (stream === undefined) {
      if ((flags & 2) === 0 || sequence !== 0 || streams.size >= 8) throw new Error("Invalid Ogg logical stream start");
      stream = { sequence: 0, packets: [], pages: [], pieces: [], pendingBytes: 0, ended: false }; streams.set(serial, stream);
    } else if ((flags & 2) !== 0 || stream.ended) throw new Error("Ogg logical stream restarted after admission");
    if (sequence !== stream.sequence++ || Boolean(flags & 1) !== (stream.pieces.length !== 0)) throw new Error("Ogg packet sequence discontinuity");
    stream.pages.push(bytes.subarray(offset, end));
    let cursor = payloadStart;
    const completed: OggPacket[] = [];
    for (const length of lacing) {
      stream.pieces.push(bytes.subarray(cursor, cursor + length)); stream.pendingBytes += length; cursor += length;
      if (stream.pendingBytes > 16 * 1024 * 1024) throw new Error("Ogg packet exceeds 16 MiB");
      if (length < 255) {
        const packet: OggPacket = { data: join(stream.pieces, stream.pendingBytes), first: stream.packets.length === 0,
          last: false, granule: -1n, index: stream.packets.length };
        stream.packets.push(packet); completed.push(packet); stream.pieces = []; stream.pendingBytes = 0;
      }
    }
    const last = completed.at(-1);
    if (last !== undefined) stream.packets[last.index] = { ...last, granule: view.getBigInt64(offset + 6, true), last: (flags & 4) !== 0 };
    if ((flags & 4) !== 0) {
      if (stream.pieces.length !== 0) throw new Error("Ogg stream ends inside a packet");
      stream.ended = true;
    }
    offset = end;
  }
  let video: readonly OggPacket[] | null = null, audio: Uint8Array | null = null;
  for (const stream of streams.values()) {
    if (!stream.ended) throw new Error("Truncated Ogg logical stream");
    const first = stream.packets[0]?.data;
    if (first === undefined) throw new Error("Empty Ogg logical stream");
    const signature = new TextDecoder().decode(first.subarray(1, 7));
    if (first[0] === 0x80 && signature === "theora") {
      if (video !== null) throw new Error("Multiple Theora video streams are unsupported");
      video = stream.packets;
    } else if (first[0] === 1 && signature === "vorbis") {
      if (audio !== null) throw new Error("Multiple Vorbis soundtracks are unsupported");
      audio = join(stream.pages, stream.pages.reduce((sum, page) => sum + page.length, 0));
    }
  }
  if (video === null || video.length < 4) throw new Error("Ogg movie has no complete Theora video");
  return { video, audio };
}
