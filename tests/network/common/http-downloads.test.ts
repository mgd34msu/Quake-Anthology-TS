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

const rangeBytes = Uint8Array.from({ length: 1024 * 1024 + 123 }, (_value, index) => index * 17 % 251);
function rangeRequest(port: number): HttpDownloadRequest {
  return { ...request(port, 'large'), expected: { kind: 'protocol-completion', maximumBytes: rangeBytes.length } };
}
function rangeHeaders(): Headers {
  return new Headers({ 'Accept-Ranges': 'bytes', 'Content-Length': String(rangeBytes.length), ETag: '"version-one"' });
}
function requestedSpan(req: Request): { start: number; end: number } {
  const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') ?? '');
  if (match === null) throw new Error('Expected exact byte range request');
  return { start: Number(match[1]), end: Number(match[2]) };
}
function spanHeaders(start: number, end: number): Headers {
  const headers = rangeHeaders();
  headers.set('Content-Range', `bytes ${start}-${end}/${rangeBytes.length}`);
  headers.set('Content-Length', String(end - start + 1));
  return headers;
}

test('large HTTP files stream four overlapping ranges to one atomic byte-identical destination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-ranges-')), overlap = deferred(), release = deferred();
  let active = 0, peak = 0, head = 0;
  const spans: { start: number; end: number }[] = [], progress: number[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') { head++; return new Response(null, { headers: rangeHeaders() }); }
    expect(req.headers.get('if-range')).toBe('"version-one"'); expect(req.headers.get('accept-encoding')).toBe('identity');
    const span = requestedSpan(req); spans.push(span);
    return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
      active++; peak = Math.max(peak, active); if (active === 4) overlap.resolve();
      controller.enqueue(rangeBytes.slice(span.start, span.start + 32768));
      await release.promise;
      controller.enqueue(rangeBytes.slice(span.start + 32768, span.end + 1)); controller.close(); active--;
    } }), { status: 206, headers: spanHeaders(span.start, span.end) });
  } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: () => false, async refreshPackage() {},
    progress(_path, bytes, total) { expect(total).toBe(rangeBytes.length); progress.push(bytes); } });
  try {
    const result = queue.enqueue(rangeRequest(server.port ?? 0)); await overlap.promise;
    expect(peak).toBe(4); expect(readdirSync(root).every(name => name.startsWith('.download-'))).toBe(true);
    release.resolve(); expect((await result).kind).toBe('downloaded');
    expect(head).toBe(1); expect(spans.length).toBe(4);
    expect(readFileSync(join(root, 'large'))).toEqual(Buffer.from(rangeBytes));
    expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(rangeBytes.length);
    expect(progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0))).toBe(true);
    expect(readdirSync(root)).toEqual(['large']);
  } finally { release.resolve(); queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

for (const status of [200, 416]) test(`range status ${status} drains the attempt and retries one identity-pinned whole GET`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-range-retry-')); let whole = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') return new Response(null, { headers: rangeHeaders() });
    if (req.headers.has('range')) return new Response(status === 200 ? rangeBytes : null, { status,
      headers: status === 200 ? rangeHeaders() : { ETag: '"version-one"' } });
    whole++; expect(req.headers.get('if-match')).toBe('"version-one"');
    return new Response(rangeBytes, { headers: rangeHeaders() });
  } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
  try {
    expect((await queue.enqueue(rangeRequest(server.port ?? 0))).kind).toBe('downloaded'); expect(whole).toBe(1);
    expect(readFileSync(join(root, 'large'))).toEqual(Buffer.from(rangeBytes)); expect(readdirSync(root)).toEqual(['large']);
  } finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ['missing', 'start', 'end', 'total', 'wildcard', 'trailing', 'etag', 'missing-etag', 'short', 'overflow', 'changed-200'])
  test(`invalid ranged ${mode} response returns native fallback without publishing`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'http-range-invalid-')); let whole = 0;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
      if (req.method === 'HEAD') return new Response(null, { headers: rangeHeaders() });
      if (!req.headers.has('range')) { whole++; return new Response(rangeBytes, { headers: rangeHeaders() }); }
      const { start, end } = requestedSpan(req), headers = spanHeaders(start, end);
      if (mode === 'missing') headers.delete('content-range');
      if (mode === 'start') headers.set('content-range', `bytes ${start + 1}-${end}/${rangeBytes.length}`);
      if (mode === 'end') headers.set('content-range', `bytes ${start}-${end - 1}/${rangeBytes.length}`);
      if (mode === 'total') headers.set('content-range', `bytes ${start}-${end}/${rangeBytes.length + 1}`);
      if (mode === 'wildcard') headers.set('content-range', `bytes ${start}-${end}/*`);
      if (mode === 'trailing') headers.append('content-range', 'garbage');
      if (mode === 'etag' || mode === 'changed-200') headers.set('etag', '"version-two"');
      if (mode === 'missing-etag') headers.delete('etag');
      headers.delete('content-length');
      let bytes = rangeBytes.slice(start, end + 1);
      if (mode === 'short') bytes = bytes.slice(1);
      if (mode === 'overflow') bytes = new Uint8Array(bytes.length + 1);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
        { status: mode === 'changed-200' ? 200 : 206, headers });
    } });
    const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
    try {
      expect((await queue.enqueue(rangeRequest(server.port ?? 0))).kind).toBe('fallback');
      expect(whole).toBe(0); expect(readdirSync(root)).toEqual([]);
    } finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });

for (const mode of ['unsupported-head', 'weak-etag', 'no-etag', 'no-ranges']) test(`${mode} uses the original whole-file HTTP path`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-head-fallback-')); let whole = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') {
      const headers = rangeHeaders();
      if (mode === 'weak-etag') headers.set('etag', 'W/"version-one"');
      if (mode === 'no-etag') headers.delete('etag');
      if (mode === 'no-ranges') headers.delete('accept-ranges');
      return new Response(null, { status: mode === 'unsupported-head' ? 405 : 200, headers });
    }
    whole++; expect(req.headers.has('range')).toBe(false); return new Response(rangeBytes);
  } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
  try {
    expect((await queue.enqueue(rangeRequest(server.port ?? 0))).kind).toBe('downloaded'); expect(whole).toBe(1);
    expect(readFileSync(join(root, 'large'))).toEqual(Buffer.from(rangeBytes));
  } finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('cancelling paused range bodies drains siblings and removes all staging', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-range-cancel-')), streamed = deferred(), release = deferred(); let retired = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') return new Response(null, { headers: rangeHeaders() });
    const { start, end } = requestedSpan(req);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(rangeBytes.slice(start, start + 32768));
      void release.promise.then(() => { try { controller.enqueue(rangeBytes.slice(start + 32768, end + 1)); controller.close(); } catch {} });
    } }), { status: 206, headers: spanHeaders(start, end) });
  } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() { if (retired) throw new Error('Retired epoch'); }, resolved: () => false,
    async refreshPackage() {}, progress(_path, received) { if (received > 0) streamed.resolve(); } });
  try {
    const result = queue.enqueue(rangeRequest(server.port ?? 0)); await streamed.promise; retired = true; queue.cancel();
    expect(await result).toEqual({ kind: 'cancelled' }); expect(readdirSync(root)).toEqual([]);
  } finally { release.resolve(); await Bun.sleep(0); queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('whole-file degradation rejects a representation changed after range rejection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-range-representation-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') return new Response(null, { headers: rangeHeaders() });
    if (req.headers.has('range')) return new Response(null, { status: 416 });
    const headers = rangeHeaders(); headers.set('etag', '"version-two"'); return new Response(rangeBytes, { headers });
  } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
  try { expect((await queue.enqueue(rangeRequest(server.port ?? 0))).kind).toBe('fallback'); expect(readdirSync(root)).toEqual([]); }
  finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

for (const streams of [0, 99]) test(`range stream setting ${streams} clamps to the supported bounds`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-range-clamp-')); let ranges = 0, heads = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') { heads++; return new Response(null, { headers: rangeHeaders() }); }
    if (!req.headers.has('range')) return new Response(rangeBytes);
    ranges++; const { start, end } = requestedSpan(req);
    return new Response(rangeBytes.slice(start, end + 1), { status: 206, headers: spanHeaders(start, end) });
  } });
  const queue = new HttpDownloadQueue({ root, rangeStreams: streams, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
  try {
    expect((await queue.enqueue(rangeRequest(server.port ?? 0))).kind).toBe('downloaded');
    expect(ranges).toBe(streams === 0 ? 0 : 8); expect(heads).toBe(streams === 0 ? 0 : 1);
    expect(readFileSync(join(root, 'large'))).toEqual(Buffer.from(rangeBytes));
  } finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('whole-file range retry cannot publish a truncated protocol-completion file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'http-range-short-retry-'));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    if (req.method === 'HEAD') return new Response(null, { headers: rangeHeaders() });
    if (req.headers.has('range')) return new Response(null, { status: 416 });
    return new Response(rangeBytes.slice(1), { headers: { ETag: '"version-one"' } });
  } });
  const queue = new HttpDownloadQueue({ root, assertCurrent() {}, resolved: () => false, async refreshPackage() {}, progress() {} });
  try { expect((await queue.enqueue(rangeRequest(server.port ?? 0))).kind).toBe('fallback'); expect(readdirSync(root)).toEqual([]); }
  finally { queue.cancel(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test('HTTP redirect stays within advertised origin and settled fallback can be retried', async () => {
  const root = mkdtempSync(join(tmpdir(),'http-redirect-')); let ready = false;
  const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/redirect') return new Response(null,{status:302,headers:{location:'/asset'}});
    if (path === '/escape') return new Response(null,{status:302,headers:{location:'http://localhost:1/asset'}});
    return ready ? new Response('complete') : new Response('',{status:503});
  }});
  const queue=new HttpDownloadQueue({root,assertCurrent(){},resolved:()=>false,async refreshPackage(){},progress(){}});
  try {
    expect((await queue.enqueue(request(server.port ?? 0,'redirect'))).kind).toBe('fallback');
    ready=true; expect((await queue.retry('redirect')).kind).toBe('downloaded');
    expect(readFileSync(join(root,'redirect'),'utf8')).toBe('complete');
    expect((await queue.enqueue(request(server.port ?? 0,'escape'))).kind).toBe('fallback');
    expect(queue.progress.find(item=>item.path==='redirect')).toMatchObject({phase:'done',received:8,result:'downloaded'});
  } finally {queue.cancel();await server.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('per-file cancellation preserves unrelated queue work and permits explicit retry', async () => {
  const root=mkdtempSync(join(tmpdir(),'http-file-cancel-')), started=deferred(),release=deferred();let block=true;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    if(new URL(req.url).pathname==='/first'&&block)return new Response(new ReadableStream<Uint8Array>({async start(controller){controller.enqueue(new Uint8Array([1]));started.resolve();await release.promise;try{controller.close();}catch{}}}));
    return new Response('ok');
  }});
  const queue=new HttpDownloadQueue({root,concurrency:1,assertCurrent(){},resolved:()=>false,async refreshPackage(){},progress(){}});
  try {
    const first=queue.enqueue(request(server.port ?? 0,'first')),second=queue.enqueue(request(server.port ?? 0,'second'));
    await started.promise;queue.cancelFile('first');release.resolve();
    expect((await first).kind).toBe('cancelled');expect((await second).kind).toBe('downloaded');
    block=false;expect((await queue.retry('first')).kind).toBe('downloaded');expect(readdirSync(root).sort()).toEqual(['first','second']);
  }finally{release.resolve();queue.cancel();await server.stop(true);rmSync(root,{recursive:true,force:true});}
});

test('interrupted byte range resumes at retained offset under the same strong ETag', async () => {
  const root=mkdtempSync(join(tmpdir(),'http-resume-')),bytes=new Uint8Array(2*1024*1024).fill(37),ranges:string[]=[];
  let interrupted=false;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    if(req.method==='HEAD')return new Response(null,{headers:{'content-length':String(bytes.length),'accept-ranges':'bytes',etag:'"same"'}});
    const raw=req.headers.get('range')??'',match=/^bytes=(\d+)-(\d+)$/.exec(raw);ranges.push(raw);
    if(match===null)throw new Error('Expected range');const start=Number(match[1]),end=Number(match[2]);
    const headers={'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"same"'};
    if(start===0&&!interrupted){interrupted=true;return new Response(new ReadableStream<Uint8Array>({async start(controller){controller.enqueue(bytes.slice(0,4096));await Bun.sleep(10);controller.error(new Error('interrupted'));}}),{status:206,headers});}
    return new Response(bytes.slice(start,end+1),{status:206,headers});
  }});
  const queue=new HttpDownloadQueue({root,rangeStreams:2,assertCurrent(){},resolved:()=>false,async refreshPackage(){},progress(){}});
  try {
    const result=await queue.enqueue({...request(server.port ?? 0,'asset'),expected:{kind:'protocol-completion',maximumBytes:bytes.length}});
    expect(result.kind).toBe('downloaded');expect(ranges).toContain('bytes=4096-1048575');
    expect(readFileSync(join(root,'asset'))).toEqual(Buffer.from(bytes));expect(queue.progress[0]?.received).toBe(bytes.length);
  }finally{queue.cancel();await server.stop(true);rmSync(root,{recursive:true,force:true});}
});
