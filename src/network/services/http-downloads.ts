// Q2PRO/Q2 rerelease HTTP queue behavior over the shared staged filesystem. GPL-2.0-or-later.
import type { ContentDigest } from '../../contracts/content.ts';
import { isReadableStream } from '../common/value.ts';
import { DownloadSink, downloadPath } from './downloads.ts';
import type { DownloadExpectation, DownloadSpan, ProtocolDownloadExpectation } from './downloads.ts';

export interface HttpDownloadRequest {
  readonly path: string;
  readonly url: URL;
  readonly kind: 'asset' | 'package';
  readonly expected: DownloadExpectation | ProtocolDownloadExpectation;
  readonly validate?: (stagedPath: string) => Promise<void>;
}
export type HttpDownloadResult = { readonly kind: 'downloaded'; readonly digest: ContentDigest }
  | { readonly kind: 'resolved' | 'cancelled' }
  | { readonly kind: 'fallback' | 'failed'; readonly reason: Error };
export interface HttpDownloadQueueOptions {
  readonly root: string;
  readonly concurrency?: number;
  readonly rangeStreams?: number;
  assertCurrent(): void;
  resolved(path: string): boolean | Promise<boolean>;
  refreshPackage(path: string): Promise<void>;
  progress(path: string, received: number, total: number | null): void;
}
interface Entry {
  readonly request: HttpDownloadRequest;
  readonly promise: Promise<HttpDownloadResult>;
  readonly resolve: (result: HttpDownloadResult) => void;
  readonly abort: AbortController;
  state: 'pending' | 'running' | 'done';
}
function sameExpectation(left: HttpDownloadRequest['expected'], right: HttpDownloadRequest['expected']): boolean {
  if ('kind' in left) return 'kind' in right && left.maximumBytes === right.maximumBytes;
  return !('kind' in right) && left.byteLength === right.byteLength && left.digest === right.digest;
}
function failure(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }

async function openResponse(url: URL, signal: AbortSignal, identity?: string): Promise<{ readonly headers: Headers; readonly body: ReadableStream<unknown> }> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RangeError('Download URL requires HTTP or HTTPS');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    headers: identity === undefined ? {} : { 'Accept-Encoding': 'identity', 'If-Match': identity } });
  const body: unknown = response.body;
  if (response.status !== 200 || !isReadableStream(body) || identity !== undefined
    && (response.headers.get('etag') !== identity || !identityEncoding(response.headers))) {
    if (isReadableStream(body)) await body.cancel();
    throw new Error(`HTTP download status ${response.status}`);
  }
  return { headers: response.headers, body };
}

interface RangeProbe { readonly total: number; readonly etag: string; }
class UnsupportedRange extends Error {}
class StagedCleanupFailure extends Error {}
const rangeThreshold = 1024 * 1024;
function contentLength(headers: Headers): number | null {
  const value = headers.get('content-length');
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
function identityEncoding(headers: Headers): boolean {
  const encoding = headers.get('content-encoding');
  return encoding === null || encoding.toLowerCase() === 'identity';
}
async function probeRanges(request: HttpDownloadRequest, signal: AbortSignal): Promise<RangeProbe | null> {
  const limit = 'kind' in request.expected ? request.expected.maximumBytes : request.expected.byteLength;
  if (limit <= rangeThreshold) return null;
  let response: Response;
  try {
    response = await fetch(request.url, { method: 'HEAD', redirect: 'error',
      headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  } catch { signal.throwIfAborted(); return null; }
  const body: unknown = response.body;
  if (isReadableStream(body)) await body.cancel();
  signal.throwIfAborted();
  const total = contentLength(response.headers), etag = response.headers.get('etag');
  if (response.status !== 200 || !identityEncoding(response.headers) || total === null || total <= rangeThreshold
    || response.headers.get('accept-ranges')?.toLowerCase() !== 'bytes' || etag === null
    || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) return null;
  if (total > limit || !('kind' in request.expected) && total !== request.expected.byteLength)
    throw new RangeError('HTTP range size differs from expected bounds');
  return { total, etag };
}
function byteSpans(total: number, streams: number): DownloadSpan[] {
  const width = Math.ceil(total / streams), spans: DownloadSpan[] = [];
  for (let start = 0; start < total; start += width) spans.push({ start, end: Math.min(start + width, total) - 1 });
  return spans;
}
async function receiveRange(request: HttpDownloadRequest, probe: RangeProbe, span: DownloadSpan, sink: DownloadSink,
  signal: AbortSignal, current: () => void, progress: () => void): Promise<void> {
  const response = await fetch(request.url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    headers: { Range: `bytes=${span.start}-${span.end}`, 'If-Range': probe.etag, 'Accept-Encoding': 'identity' } });
  const body: unknown = response.body;
  try {
    current(); signal.throwIfAborted();
    const etag = response.headers.get('etag');
    if (etag !== null && etag !== probe.etag) throw new Error('HTTP ranged representation changed');
    if (response.status === 200 || response.status === 416) throw new UnsupportedRange('HTTP server rejected byte ranges');
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    const length = contentLength(response.headers);
    if (response.status !== 206 || etag !== probe.etag || !identityEncoding(response.headers) || match === null
      || Number(match[1]) !== span.start || Number(match[2]) !== span.end || Number(match[3]) !== probe.total
      || response.headers.has('content-length') && length !== span.end - span.start + 1 || !isReadableStream(body))
      throw new Error('Invalid HTTP byte range response');
  } catch (error) { if (isReadableStream(body)) await body.cancel(); throw error; }
  if (!isReadableStream(body)) throw new Error('HTTP range has no body');
  const reader = body.getReader(); let received = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); current(); signal.throwIfAborted();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new TypeError('HTTP range supplied a non-byte chunk');
      if (chunk.value.byteLength > span.end - span.start + 1 - received) throw new RangeError('HTTP byte range overflow');
      sink.appendRange(span.start, chunk.value); received += chunk.value.byteLength; progress();
    }
    if (received !== span.end - span.start + 1) throw new Error('Incomplete HTTP byte range');
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
}
async function receiveRanges(request: HttpDownloadRequest, probe: RangeProbe, spans: readonly DownloadSpan[], sink: DownloadSink,
  signal: AbortSignal, current: () => void, progress: () => void): Promise<void> {
  const siblings = new AbortController(), ownedSignal = AbortSignal.any([signal, siblings.signal]);
  let primary: Error | null = null;
  await Promise.allSettled(spans.map(async span => {
    try { await receiveRange(request, probe, span, sink, ownedSignal, current, progress); }
    catch (error) {
      if (primary === null) primary = failure(error);
      siblings.abort();
      throw error;
    }
  }));
  if (primary !== null) throw primary;
  current(); signal.throwIfAborted();
}

/** Optional dependency metadata stays in memory; the native adapter owns its format and meaning. */
export async function fetchHttpDownloadMetadata(url: URL, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new RangeError('Invalid HTTP metadata size limit');
  try {
    const response = await openResponse(url, signal), reader = response.body?.getReader();
    if (reader === undefined) throw new Error('HTTP metadata has no response body');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); signal.throwIfAborted();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw new TypeError('HTTP metadata supplied a non-byte chunk');
        if (chunk.value.byteLength > maximumBytes - size) throw new RangeError('HTTP metadata exceeds its size limit');
        chunks.push(chunk.value); size += chunk.value.byteLength;
      }
    } catch (error) {
      try { await reader.cancel(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'HTTP metadata and response cleanup failed'); }
      throw error;
    }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch { return null; }
}

/** One owner per connection epoch; fallback results go to its existing sequential native queue. */
export class HttpDownloadQueue {
  private readonly concurrency: number;
  private readonly rangeStreams: number;
  private readonly entries = new Map<string, Entry>();
  private active = 0;
  private packageActive = false;
  private scheduled = false;
  private reschedule = false;
  private generation = 0;
  private closed = false;
  constructor(private readonly options: HttpDownloadQueueOptions) {
    const concurrency = options.concurrency ?? 2;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new RangeError('HTTP download concurrency must be between 1 and 4');
    this.concurrency = concurrency;
    const streams = options.rangeStreams ?? 4;
    if (!Number.isFinite(streams)) throw new RangeError('Invalid HTTP range stream count');
    this.rangeStreams = Math.max(1, Math.min(8, Math.trunc(streams)));
  }
  enqueue(request: HttpDownloadRequest): Promise<HttpDownloadResult> {
    if (this.closed) return Promise.resolve({ kind: 'cancelled' });
    this.options.assertCurrent(); downloadPath(request.path);
    if (request.url.protocol !== 'http:' && request.url.protocol !== 'https:') throw new RangeError('Download URL requires HTTP or HTTPS');
    const existing = this.entries.get(request.path);
    if (existing !== undefined) {
      if (existing.request.url.href !== request.url.href || existing.request.kind !== request.kind
        || !sameExpectation(existing.request.expected, request.expected) || existing.request.validate !== request.validate)
        throw new Error('Conflicting HTTP download identity for one destination');
      return existing.promise;
    }
    let resolve: (result: HttpDownloadResult) => void = () => {};
    const promise = new Promise<HttpDownloadResult>(complete => { resolve = complete; });
    const owned = { ...request, url: new URL(request.url.href), expected: { ...request.expected } };
    this.entries.set(request.path, { request: owned, promise, resolve, abort: new AbortController(), state: 'pending' });
    this.schedule(); return promise;
  }
  private schedule(): void {
    if (this.closed) return;
    if (this.scheduled) { this.reschedule = true; return; }
    this.scheduled = true;
    queueMicrotask(() => {
      void this.pump().finally(() => {
        this.scheduled = false;
        if (this.reschedule) { this.reschedule = false; this.schedule(); }
      });
    });
  }
  private settle(entry: Entry, result: HttpDownloadResult): void { entry.state = 'done'; entry.resolve(result); }
  private async pump(): Promise<void> {
    if (this.closed || this.packageActive) return;
    try {
      this.options.assertCurrent();
      for (const entry of this.entries.values()) if (entry.state === 'pending') {
        const resolved = await this.options.resolved(entry.request.path);
        if (this.closed) return;
        this.options.assertCurrent();
        if (resolved) this.settle(entry, { kind: 'resolved' });
      }
      const pending = [...this.entries.values()].filter(entry => entry.state === 'pending');
      const pack = pending.find(entry => entry.request.kind === 'package');
      if (pack !== undefined) { if (this.active === 0) this.start(pack); return; }
      for (const entry of pending) { if (this.active >= this.concurrency) break; this.start(entry); }
    } catch (error) {
      for (const entry of this.entries.values()) if (entry.state === 'pending') this.settle(entry, { kind: 'failed', reason: failure(error) });
    }
  }
  private start(entry: Entry): void {
    entry.state = 'running'; this.active++;
    if (entry.request.kind === 'package') this.packageActive = true;
    const complete = (result: HttpDownloadResult): void => {
      try { this.settle(entry, result); }
      finally {
        this.active--;
        if (entry.request.kind === 'package') this.packageActive = false;
        if (result.kind === 'failed') this.cancel(); else this.schedule();
      }
    };
    void this.transfer(entry).then(complete, (error: unknown) => complete({ kind: 'failed', reason: failure(error) }));
  }
  private async transfer(entry: Entry): Promise<HttpDownloadResult> {
    const request = entry.request, generation = this.generation;
    let sink: DownloadSink | null = null, published = false;
    const current = (): void => {
      if (this.closed || generation !== this.generation) throw new Error('HTTP download epoch retired');
      this.options.assertCurrent();
    };
    try {
      current();
      const probe = this.rangeStreams > 1 ? await probeRanges(request, entry.abort.signal) : null;
      current();
      let retryIdentity: string | undefined;
      if (probe !== null) {
        const spans = byteSpans(probe.total, this.rangeStreams);
        sink = DownloadSink.createRanged(this.options.root, request.path, request.expected, probe.total, spans);
        this.options.progress(request.path, 0, probe.total);
        const rangedSink = sink;
        try {
          await receiveRanges(request, probe, spans, sink, entry.abort.signal, current,
            () => { this.options.progress(request.path, rangedSink.byteLength, probe.total); });
        } catch (error) {
          if (!(error instanceof UnsupportedRange)) throw error;
          try { sink.close(); }
          catch (cleanup) { throw new StagedCleanupFailure('HTTP ranged staging cleanup failed', { cause: cleanup }); }
          sink = null; current(); retryIdentity = probe.etag;
        }
      }
      if (sink === null) {
        const response = await openResponse(request.url, entry.abort.signal, retryIdentity);
        try { current(); } catch (error) {
          try { await response.body?.cancel(); }
          catch (cleanup) { throw new AggregateError([error, cleanup], 'HTTP download epoch and response cleanup failed'); }
          throw error;
        }
        const total = contentLength(response.headers);
        const reader = response.body?.getReader();
        if (reader === undefined) throw new Error('HTTP download has no response body');
        try {
          sink = DownloadSink.create(this.options.root, request.path, request.expected);
          this.options.progress(request.path, 0, total);
          for (;;) {
            const chunk = await reader.read(); current();
            if (chunk.done) break;
            if (!(chunk.value instanceof Uint8Array)) throw new TypeError('HTTP download supplied a non-byte chunk');
            sink.append(chunk.value); this.options.progress(request.path, sink.byteLength, total);
          }
          if (retryIdentity !== undefined && sink.byteLength !== probe?.total)
            throw new Error('HTTP whole-file retry differs from probed size');
        } catch (error) {
          try { await reader.cancel(); }
          catch (cleanup) { throw new AggregateError([error, cleanup], 'HTTP download and response cleanup failed'); }
          throw error;
        }
        finally { reader.releaseLock(); }
      }
      current();
      if (request.validate !== undefined) { await sink.inspectStaged(request.validate); current(); }
      const digest = sink.finish(); published = true;
      if (request.kind === 'package') { await this.options.refreshPackage(request.path); current(); }
      return { kind: 'downloaded', digest };
    } catch (error) {
      try { sink?.close(); }
      catch (cleanup) { return { kind: 'failed', reason: new AggregateError([error, cleanup], 'HTTP download and staged cleanup failed') }; }
      if (this.closed || generation !== this.generation) return { kind: 'cancelled' };
      return { kind: published || error instanceof StagedCleanupFailure ? 'failed' : 'fallback', reason: failure(error) };
    }
  }
  cancel(): void {
    if (this.closed) return;
    this.closed = true; this.generation++;
    for (const entry of this.entries.values()) {
      if (entry.state === 'pending') this.settle(entry, { kind: 'cancelled' });
      else if (entry.state === 'running') entry.abort.abort();
    }
  }
}
