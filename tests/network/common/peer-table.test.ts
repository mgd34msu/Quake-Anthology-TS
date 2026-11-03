import { expect, test } from 'bun:test';
import { PeerTable } from '../../../src/network/common/peer-table.ts';
import { FloodLimiter } from '../../../src/network/services/admin.ts';
import { sameAddress } from '../../../src/network/common/endpoint.ts';
import type { NetworkAddress } from '../../../src/network/common/endpoint.ts';

const v4 = (d: number, port = 1): NetworkAddress => ({ kind: 'ipv4', host: [10, 0, 0, d], port });

test('peer slots ignore ports, stay distinct per family, and report exhaustion', () => {
  const table = new PeerTable(2);
  const a = table.claim(v4(1, 100));
  expect(table.claim(v4(1, 200))).toBe(a);
  const ipx: NetworkAddress = { kind: 'ipx', network: 1, node: [1, 2, 3, 4, 5, 6], port: 1 };
  const b = table.claim(ipx);
  expect(b).not.toBe(a);
  expect(table.claim({ ...ipx, node: [1, 2, 3, 4, 5, 7] })).toBe(-1);
  table.release(a);
  expect(table.find(v4(1))).toBe(-1);
  expect(table.claim({ kind: 'loopback', id: 'x' })).toBe(a);
  expect(table.find({ kind: 'loopback', id: 'y' })).toBe(-1);
});

test('flood limiter table is bounded and refuses new sources once full and unexpired', () => {
  const limiter = new FloodLimiter(2, 1000, 2);
  expect(limiter.allow(v4(1), 0)).toBe(true);
  expect(limiter.allow(v4(2), 0)).toBe(true);
  expect(limiter.allow(v4(3), 0)).toBe(false);
  expect(limiter.allow(v4(3), 10_000)).toBe(true);
});

test('sameAddress compares fields like the formatted key', () => {
  expect(sameAddress(v4(1, 5), v4(1, 6))).toBe(false);
  expect(sameAddress(v4(1, 5), v4(1, 6), false)).toBe(true);
  expect(sameAddress({ kind: 'ipv6', host: '::1', port: 1 }, v4(1))).toBe(false);
});
