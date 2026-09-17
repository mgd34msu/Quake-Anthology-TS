// AF_IPX layouts: glibc netipx/ipx.h and Winsock wsipx.h/wsnwlink.h.
import { dlopen, read } from 'bun:ffi';
import { getSystemErrorName } from 'node:util';
import { ipxAddress, portNumber } from '../network/common/endpoint.ts';
import type { IpxAddress } from '../network/common/endpoint.ts';
import type { NativeIpxCapability } from '../network/common/ipx-host.ts';
import type { ReceiveEvent } from '../network/common/transport.ts';
import { UnsupportedTransportError } from '../network/common/transport.ts';

type BindOptions = Parameters<Extract<NativeIpxCapability, { readonly kind: 'available' }>['bind']>[0];
export interface NativeSocket {
  readonly address: IpxAddress;
  readonly maxDatagramBytes: number;
  send(to: IpxAddress, payload: Uint8Array): boolean;
  receive(): ReceiveEvent<IpxAddress> | null;
  readable(): boolean;
  close(): void;
}
function checkedOptions(options: BindOptions): void {
  portNumber(options.port, true);
  if (!Number.isInteger(options.packetType) || options.packetType < 0 || options.packetType > 255 || options.broadcast !== true) throw new RangeError('Invalid native IPX socket options');
}
function sockaddr(windows: boolean, port: number, type: number, address?: IpxAddress): Uint8Array {
  const bytes = new Uint8Array(windows ? 14 : 16), view = new DataView(bytes.buffer);
  view.setUint16(0, windows ? 6 : 4, true);
  view.setUint16(windows ? 12 : 2, port, false); view.setUint32(windows ? 2 : 4, address?.network ?? 0, false);
  if (address !== undefined) bytes.set(address.node, windows ? 6 : 8);
  if (!windows) view.setUint8(14, type);
  return bytes;
}
function addressFrom(bytes: Uint8Array, length: number, windows: boolean): IpxAddress {
  if (length < (windows ? 14 : 16)) throw new Error('Native IPX returned a truncated address');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), start = windows ? 6 : 8;
  if (view.getUint16(0, true) !== (windows ? 6 : 4)) throw new Error('Native IPX returned another address family');
  return ipxAddress(view.getUint32(windows ? 2 : 4, false), [view.getUint8(start), view.getUint8(start + 1), view.getUint8(start + 2),
    view.getUint8(start + 3), view.getUint8(start + 4), view.getUint8(start + 5)], view.getUint16(windows ? 12 : 2, false));
}
function failure(operation: string, code: number, windows: boolean): Error {
  const name = windows ? `WSA error ${code}` : `${getSystemErrorName(-code)} (${code})`;
  const familyMissing = windows ? code === 10047 || code === 10043 || code === 10044 : code === 97 || code === 93 || code === 94;
  const detail = `${windows ? 'Winsock' : 'Linux'} AF_IPX ${operation}: ${name}`;
  if (familyMissing) return new UnsupportedTransportError('ipx-native', `${detail}; the OS has no installed IPX datagram provider`);
  if (windows ? code === 10049 || code === 10050 || code === 10051 : code === 99 || code === 100 || code === 101)
    return new Error(`${detail}; no usable configured IPX interface or route`);
  return new Error(detail);
}

function linuxSocket(options: BindOptions): NativeSocket {
  const library = dlopen('libc.so.6', {
    socket: { args: ['i32', 'i32', 'i32'], returns: 'i32' }, close: { args: ['i32'], returns: 'i32' },
    bind: { args: ['i32', 'buffer', 'u32'], returns: 'i32' }, getsockname: { args: ['i32', 'buffer', 'buffer'], returns: 'i32' },
    setsockopt: { args: ['i32', 'i32', 'i32', 'buffer', 'u32'], returns: 'i32' },
    sendto: { args: ['i32', 'buffer', 'u64', 'i32', 'buffer', 'u32'], returns: 'i64' },
    recvfrom: { args: ['i32', 'buffer', 'u64', 'i32', 'buffer', 'buffer'], returns: 'i64' },
    poll: { args: ['buffer', 'u64', 'i32'], returns: 'i32' }, __errno_location: { args: [], returns: 'ptr' },
  });
  const api = library.symbols;
  const errno = (): number => { const pointer = api.__errno_location(); if (pointer === null) throw new Error('libc returned no errno storage'); return read.i32(pointer); };
  let fd = -1;
  try {
    fd = api.socket(4, 2 | 0x800 | 0x80000, 0); // SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC.
    if (fd < 0) throw failure('socket', errno(), false);
    const check = (result: number, operation: string): void => { if (result < 0) throw failure(operation, errno(), false); };
    check(api.setsockopt(fd, 1, 6, new Int32Array([1]), 4), 'SO_BROADCAST');
    check(api.setsockopt(fd, 256, 1, new Int32Array([options.packetType]), 4), 'IPX_TYPE');
    const local = sockaddr(false, options.port, options.packetType);
    check(api.bind(fd, local, local.length), 'bind');
    const addressLength = new Uint32Array([local.length]); check(api.getsockname(fd, local, addressLength), 'getsockname');
    const address = addressFrom(local, addressLength[0] ?? 0, false), receive = new Uint8Array(65535), from = new Uint8Array(16), fromLength = new Uint32Array(1);
    const pollfd = new Uint8Array(8), pollView = new DataView(pollfd.buffer);
    pollView.setInt32(0, fd, true); pollView.setInt16(4, 1, true);
    // The portable IPX MTU is 576 bytes, including its 30-byte network header.
    const maxDatagramBytes = 546;
    return { address, maxDatagramBytes,
      send(to, payload) {
        const target = sockaddr(false, to.port, options.packetType, to);
        const sent = Number(api.sendto(fd, payload.length === 0 ? new Uint8Array(1) : payload, payload.length, 0x4000, target, target.length));
        if (sent < 0) { const code = errno(); if (code === 11 || code === 4 || code === 105) return false; throw failure('sendto', code, false); }
        if (sent !== payload.length) throw new Error('Linux IPX sent a partial datagram'); return true;
      },
      receive() {
        fromLength[0] = from.length;
        const size = Number(api.recvfrom(fd, receive, receive.length, 0, from, fromLength));
        if (size < 0) { const code = errno(); if (code === 11 || code === 4) return null; throw failure('recvfrom', code, false); }
        const sender = addressFrom(from, fromLength[0] ?? 0, false);
        if (size > maxDatagramBytes) return { kind: 'dropped', reason: 'oversize', from: sender };
        return { kind: 'packet', from: sender, payload: receive.slice(0, size), receivedAt: performance.now() };
      },
      readable() {
        pollView.setInt16(6, 0, true); const result = api.poll(pollfd, 1, 0);
        if (result < 0) { const code = errno(); if (code === 4) return false; throw failure('poll', code, false); }
        const events = pollView.getInt16(6, true);
        if ((events & 32) !== 0) throw new Error('Linux IPX descriptor is invalid');
        if ((events & 24) !== 0) throw new Error('Linux IPX socket reported a device error or hangup');
        return result > 0 && (events & 1) !== 0;
      },
      close() { try { if (api.close(fd) < 0) { const code = errno(); if (code !== 4) throw failure('close', code, false); } } finally { library.close(); } },
    };
  } catch (error) { if (fd >= 0) api.close(fd); library.close(); throw error; }
}

function windowsSocket(options: BindOptions): NativeSocket {
  const library = dlopen('ws2_32.dll', {
    WSAStartup: { args: ['u16', 'buffer'], returns: 'i32' }, WSACleanup: { args: [], returns: 'i32' }, WSAGetLastError: { args: [], returns: 'i32' },
    socket: { args: ['i32', 'i32', 'i32'], returns: 'u64' }, closesocket: { args: ['u64'], returns: 'i32' },
    ioctlsocket: { args: ['u64', 'u32', 'buffer'], returns: 'i32' },
    bind: { args: ['u64', 'buffer', 'i32'], returns: 'i32' }, getsockname: { args: ['u64', 'buffer', 'buffer'], returns: 'i32' },
    setsockopt: { args: ['u64', 'i32', 'i32', 'buffer', 'i32'], returns: 'i32' }, getsockopt: { args: ['u64', 'i32', 'i32', 'buffer', 'buffer'], returns: 'i32' },
    sendto: { args: ['u64', 'buffer', 'i32', 'i32', 'buffer', 'i32'], returns: 'i32' },
    recvfrom: { args: ['u64', 'buffer', 'i32', 'i32', 'buffer', 'buffer'], returns: 'i32' },
    select: { args: ['i32', 'buffer', 'ptr', 'ptr', 'buffer'], returns: 'i32' },
  });
  const api = library.symbols, invalid = 0xffffffffffffffffn;
  let socket = invalid, initialized = false;
  try {
    const data = new Uint8Array(512), startup = api.WSAStartup(0x0202, data);
    if (startup !== 0) throw failure('WSAStartup', startup, true);
    initialized = true;
    if (new DataView(data.buffer).getUint16(0, true) !== 0x0202) throw new UnsupportedTransportError('ipx-native', 'Winsock 2.2 is unavailable');
    socket = api.socket(6, 2, 1000);
    if (socket === invalid) throw failure('socket', api.WSAGetLastError(), true);
    const check = (result: number, operation: string): void => { if (result === -1) throw failure(operation, api.WSAGetLastError(), true); };
    check(api.ioctlsocket(socket, 0x8004667e, new Uint32Array([1])), 'FIONBIO');
    check(api.setsockopt(socket, 0xffff, 0x20, new Int32Array([1]), 4), 'SO_BROADCAST');
    check(api.setsockopt(socket, 1000, 0x4000, new Int32Array([options.packetType]), 4), 'IPX_PTYPE');
    const local = sockaddr(true, options.port, options.packetType); check(api.bind(socket, local, local.length), 'bind');
    const addressLength = new Int32Array([local.length]); check(api.getsockname(socket, local, addressLength), 'getsockname');
    const maximum = new Uint32Array(1), maximumLength = new Int32Array([4]);
    check(api.getsockopt(socket, 1000, 0x4006, maximum, maximumLength), 'IPX_MAXSIZE');
    const maxDatagramBytes = maximum[0] ?? 0;
    if (maximumLength[0] !== 4 || maxDatagramBytes < 1 || maxDatagramBytes > 65505) throw new Error('Winsock IPX returned an invalid maximum datagram size');
    const address = addressFrom(local, addressLength[0] ?? 0, true), receive = new Uint8Array(65535), from = new Uint8Array(14), fromLength = new Int32Array(1);
    const readSet = new Uint8Array(520), readView = new DataView(readSet.buffer), timeout = new Int32Array(2);
    return { address, maxDatagramBytes,
      send(to, payload) {
        const target = sockaddr(true, to.port, options.packetType, to);
        const sent = api.sendto(socket, payload.length === 0 ? new Uint8Array(1) : payload, payload.length, 0, target, target.length);
        if (sent === -1) { const code = api.WSAGetLastError(); if (code === 10035 || code === 10004 || code === 10055) return false; throw failure('sendto', code, true); }
        if (sent !== payload.length) throw new Error('Winsock IPX sent a partial datagram'); return true;
      },
      receive() {
        fromLength[0] = from.length;
        const size = api.recvfrom(socket, receive, receive.length, 0, from, fromLength);
        if (size === -1) { const code = api.WSAGetLastError(); if (code === 10035 || code === 10004) return null; throw failure('recvfrom', code, true); }
        const sender = addressFrom(from, fromLength[0] ?? 0, true);
        if (size > maxDatagramBytes) return { kind: 'dropped', reason: 'oversize', from: sender };
        return { kind: 'packet', from: sender, payload: receive.slice(0, size), receivedAt: performance.now() };
      },
      readable() {
        readView.setUint32(0, 1, true); readView.setBigUint64(8, socket, true); timeout.fill(0);
        const result = api.select(0, readSet, null, null, timeout);
        if (result === -1) { const code = api.WSAGetLastError(); if (code === 10004) return false; throw failure('select', code, true); }
        return result > 0;
      },
      close() {
        const failures: Error[] = [];
        try {
          if (api.closesocket(socket) === -1) failures.push(failure('closesocket', api.WSAGetLastError(), true));
          if (api.WSACleanup() === -1) failures.push(failure('WSACleanup', api.WSAGetLastError(), true));
        } finally { library.close(); }
        if (failures.length !== 0) throw new AggregateError(failures, 'Native IPX socket cleanup failed');
      },
    };
  } catch (error) { if (socket !== invalid) api.closesocket(socket); if (initialized) api.WSACleanup(); library.close(); throw error; }
}

export function bindNativeIpxSocket(options: BindOptions): NativeSocket {
  checkedOptions(options);
  return process.platform === 'win32' ? windowsSocket(options) : linuxSocket(options);
}
