// Port of id Software's server/sv_rankings.c ASCII and 64-bit game ID encoder. The decoder halves
// (SV_RankAsciiDecode, SV_RankDecodePlayerID) read client-supplied IDs, which the provider interface never carries as text.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.

const asciiEncoding = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ[]";

/** SV_RankAsciiEncode. Returns text length; also writes the terminating NUL. */
export function rankAsciiEncode(destination: Uint8Array, source: Uint8Array): number {
  const input = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const output = new DataView(destination.buffer, destination.byteOffset, destination.byteLength);
  let length = 0;
  for (let index = 0; index < source.length; index += 3) {
    const first = input.getUint8(index);
    const second = index + 1 < source.length ? input.getUint8(index + 1) : 0;
    const third = index + 2 < source.length ? input.getUint8(index + 2) : 0;
    const text = [first >> 2, ((first << 4) | (second >> 4)) & 63,
      ((second << 2) | (third >> 6)) & 63, third & 63];
    const count = index + 2 < source.length ? 4 : Math.floor((source.length - index) * 4 / 3) + 1;
    for (const value of text.slice(0, count)) output.setUint8(length++, asciiEncoding.charCodeAt(value));
  }
  output.setUint8(length, 0);
  return length;
}

/** SV_RankEncodeGameID. A short destination receives only a leading NUL. */
export function rankEncodeGameId(gameId: bigint, destination: Uint8Array, debugPrint: (text: string) => void): void {
  if (destination.length < 12) {
    debugPrint("SV_RankEncodeGameID: result buffer too small\n");
    new DataView(destination.buffer, destination.byteOffset, destination.byteLength).setUint8(0, 0);
    return;
  }
  if (gameId < 0n || gameId > 0xffffffffffffffffn) throw new RangeError("Ranking game ID exceeds uint64 range");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, gameId, true);
  rankAsciiEncode(destination, bytes);
}
