export const UNIFIED_PACKET_HEADER_BYTES = 48;
export const UNIFIED_SEQUENCE_MAX = 0xffffffff;

export type UnifiedPacket =
  | { readonly kind: 'ack'; readonly token: string; readonly sequence: number; readonly acknowledgedReliable: number; readonly fragment: number }
  | { readonly kind: 'reliable' | 'frame'; readonly token: string; readonly sequence: number; readonly acknowledgedReliable: number;
      readonly requiredReliableSequence: number; readonly totalBytes: number; readonly fragmentBytes: number; readonly fragment: number; readonly fragments: number; readonly payload: Uint8Array };

export function unifiedToken(token: string): string {
  if (!/^[0-9a-fA-F]{32}$/.test(token)) throw new RangeError('Unified channel token must contain 128 bits of hexadecimal');
  return token.toLowerCase();
}

function uint(value: number, maximum: number): boolean { return Number.isInteger(value) && value >= 0 && value <= maximum; }

export function encodeUnifiedPacket(packet: UnifiedPacket): Uint8Array {
  const token = unifiedToken(packet.token);
  if (!uint(packet.sequence, UNIFIED_SEQUENCE_MAX) || packet.sequence === 0 || !uint(packet.acknowledgedReliable, UNIFIED_SEQUENCE_MAX) || !uint(packet.fragment, 65535))
    throw new RangeError('Invalid unified packet sequence');
  if (packet.kind !== 'ack' && (!uint(packet.requiredReliableSequence, UNIFIED_SEQUENCE_MAX) || !uint(packet.totalBytes, UNIFIED_SEQUENCE_MAX)
    || !uint(packet.fragmentBytes, 65507 - UNIFIED_PACKET_HEADER_BYTES) || packet.fragmentBytes === 0
    || packet.fragments !== Math.max(1, Math.ceil(packet.totalBytes / packet.fragmentBytes)) || packet.fragments > 65535 || packet.fragment >= packet.fragments
    || packet.payload.length !== Math.min(packet.fragmentBytes, Math.max(0, packet.totalBytes - packet.fragment * packet.fragmentBytes))
    || packet.kind === 'reliable' && packet.requiredReliableSequence !== 0)) throw new RangeError('Invalid unified packet fragment');
  const bytes = new Uint8Array(UNIFIED_PACKET_HEADER_BYTES + (packet.kind === 'ack' ? 0 : packet.payload.length)), view = new DataView(bytes.buffer);
  bytes.set([81, 84, 85, 67, 1, packet.kind === 'ack' ? 0 : packet.kind === 'reliable' ? 1 : 2]);
  for (let index = 0; index < 16; index++) view.setUint8(8 + index, Number.parseInt(token.slice(index * 2, index * 2 + 2), 16));
  view.setUint32(24, packet.sequence, true); view.setUint32(28, packet.acknowledgedReliable, true); view.setUint16(44, packet.fragment, true);
  if (packet.kind !== 'ack') {
    view.setUint32(32, packet.requiredReliableSequence, true); view.setUint32(36, packet.totalBytes, true); view.setUint32(40, packet.fragmentBytes, true);
    view.setUint16(46, packet.fragments, true); bytes.set(packet.payload, UNIFIED_PACKET_HEADER_BYTES);
  }
  return bytes;
}

/** Malformed and foreign protocol datagrams never acquire assembly storage. */
export function decodeUnifiedPacket(bytes: Uint8Array): UnifiedPacket | null {
  if (bytes.length < UNIFIED_PACKET_HEADER_BYTES || bytes.length > 65507) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x51545543 || view.getUint8(4) !== 1 || view.getUint16(6, true) !== 0) return null;
  const kind = view.getUint8(5), sequence = view.getUint32(24, true), acknowledgedReliable = view.getUint32(28, true), fragment = view.getUint16(44, true);
  if (kind > 2 || sequence === 0) return null;
  let token = '';
  for (let index = 0; index < 16; index++) token += view.getUint8(8 + index).toString(16).padStart(2, '0');
  const requiredReliableSequence = view.getUint32(32, true), totalBytes = view.getUint32(36, true), fragmentBytes = view.getUint32(40, true), fragments = view.getUint16(46, true);
  if (kind === 0) return bytes.length === UNIFIED_PACKET_HEADER_BYTES && requiredReliableSequence === 0 && totalBytes === 0 && fragmentBytes === 0 && fragments === 0
    ? { kind: 'ack', token, sequence, acknowledgedReliable, fragment } : null;
  if (fragmentBytes === 0 || fragmentBytes > 65507 - UNIFIED_PACKET_HEADER_BYTES || fragments !== Math.max(1, Math.ceil(totalBytes / fragmentBytes)) || fragment >= fragments
    || bytes.length - UNIFIED_PACKET_HEADER_BYTES !== Math.min(fragmentBytes, Math.max(0, totalBytes - fragment * fragmentBytes)) || kind === 1 && requiredReliableSequence !== 0) return null;
  return { kind: kind === 1 ? 'reliable' : 'frame', token, sequence, acknowledgedReliable, requiredReliableSequence, totalBytes, fragmentBytes, fragment, fragments,
    payload: bytes.subarray(UNIFIED_PACKET_HEADER_BYTES) };
}
