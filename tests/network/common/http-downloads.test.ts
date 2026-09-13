import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HttpDownloadQueue, fetchHttpDownloadMetadata } from '../../../src/network/services/http-downloads.ts';
import type { HttpDownloadRequest } from '../../../src/network/services/http-downloads.ts';
import { isUnknownArray } from '../../../src/network/common/value.ts';

function deferred() { let resolve = () => {}; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function request(port: number, path: string, kind: 'asset' | 'package' = 'asset'): HttpDownloadRequest {
  return { path, kind, url: new URL(`http://127.0.0.1:${port}/${path}`), expected: { kind: 'protocol-completion', maximumBytes: 100 } };
}

test('shared HTTP queue overlaps two streamed files and deduplicates one destination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-queue-')), release = deferred(), overlap = deferred();
  let active = 0, peak = 0, requests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
    requests++; active++; peak = Math.max(peak, active); if (active === 2) overlap.resolve();
    await release.promise; active--;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close(); } }));
  } });
  const progress: number[] = [], queue = new HttpDownloadQueue({ root, resolved: () => false, assertCurrent() {}, async refreshPackage() {}, progress: (_path, received) => { progress.push(received); } });
  try {
    const a = request(server.port ?? 0, 'a'), b = request(server.port ?? 0, 'b');
    const first = queue.enqueue(a); expect(queue.enqueue(a)).toBe(first); const second = queue.enqueue(b);
    await overlap.promise; expect(peak).toBe(2); expect(readdirSync(root).some(name => name === 'a' || name === 'b')).toBe(false);
    release.resolve(); expect((await first).kind).toBe('downloaded'); expect((await second).kind).toBe('downloaded');
    expect(requests).toBe(2); expect(readFileSync(join(root, 'a'))).toEqual(Buffer.from([1, 2, 3])); expect(progress).toContain(3);
  } finally { release.resolve(); queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('package barrier refreshes mounts and prunes covered queued assets before HTTP dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-package-')), paths: string[] = [], refreshed = deferred(), release = deferred(); let mounted = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) { paths.push(new URL(req.url).pathname); return new Response('package'); } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: path => mounted && path === 'covered', progress() {},
    async refreshPackage() { refreshed.resolve(); await release.promise; mounted = true; } });
  try {
    const asset = queue.enqueue(request(server.port ?? 0, 'covered')), pack = queue.enqueue(request(server.port ?? 0, 'pak.pk3', 'package'));
    await refreshed.promise; expect(paths).toEqual(['/pak.pk3']); release.resolve();
    expect((await pack).kind).toBe('downloaded'); expect(await asset).toEqual({ kind: 'resolved' }); expect(paths).toEqual(['/pak.pk3']);
  } finally { release.resolve(); queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('per-file HTTP failure returns native fallback while cancellation removes staged work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-cancel-')), started = deferred(), release = deferred();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (new URL(req.url).pathname === '/missing') return new Response('missing', { status: 404 });
    return new Response(new ReadableStream<Uint8Array>({ async start(controller) { controller.enqueue(new Uint8Array([1])); started.resolve(); await release.promise; try { controller.close(); } catch {} } }));
  } });
  const queue = new HttpDownloadQueue({ root, concurrency: 1, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
  try {
    expect((await queue.enqueue(request(server.port ?? 0, 'missing'))).kind).toBe('fallback');
    const active = queue.enqueue(request(server.port ?? 0, 'active')), pending = queue.enqueue(request(server.port ?? 0, 'pending'));
    await started.promise; queue.cancel(); release.resolve();
    expect(await active).toEqual({ kind: 'cancelled' }); expect(await pending).toEqual({ kind: 'cancelled' }); expect(readdirSync(root)).toEqual([]);
  } finally { release.resolve(); queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('shared metadata reads enforce bounded optional filelists and HTTP response status', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    return new URL(req.url).pathname === '/missing' ? new Response('', { status: 404 }) : new Response('maps/test.bsp\n');
  } });
  const controller = new AbortController();
  try {
    expect(await fetchHttpDownloadMetadata(new URL(`http://127.0.0.1:${server.port}/list`), 100, controller.signal)).toEqual(new TextEncoder().encode('maps/test.bsp\n'));
    expect(await fetchHttpDownloadMetadata(new URL(`http://127.0.0.1:${server.port}/list`), 4, controller.signal)).toBeNull();
    expect(await fetchHttpDownloadMetadata(new URL(`http://127.0.0.1:${server.port}/missing`), 100, controller.signal)).toBeNull();
    controller.abort(); expect(await fetchHttpDownloadMetadata(new URL(`http://127.0.0.1:${server.port}/list`), 100, controller.signal)).toBeNull();
  } finally { await server.stop(true); }
});

test('staged cleanup failure settles the transfer and cancels pending package work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-cleanup-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return new Response('bytes'); } });
  const original = new Error('progress owner failed');
  const queue = new HttpDownloadQueue({ root, concurrency: 1, assertCurrent() {}, resolved: () => false, async refreshPackage() {},
    progress() {
      const staged = readdirSync(root).find(name => name.startsWith('.download-'));
      if (staged === undefined) throw new Error('Missing retained staged file');
      unlinkSync(join(root, staged)); throw original;
    } });
  try {
    const first = queue.enqueue(request(server.port ?? 0, 'package.pk3', 'package'));
    const pending = queue.enqueue(request(server.port ?? 0, 'asset'));
    const result = await first;
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed' || !(result.reason instanceof AggregateError)) throw new Error('Expected both transfer and cleanup errors');
    const errors: unknown = result.reason.errors;
    if (!isUnknownArray(errors)) throw new Error('Missing aggregated errors');
    const originalFailure: unknown = errors[0], cleanupFailure: unknown = errors[1];
    expect(originalFailure).toBe(original); expect(cleanupFailure).toBeInstanceOf(Error);
    expect(await pending).toEqual({ kind: 'cancelled' }); expect(readdirSync(root)).toEqual([]);
  } finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
