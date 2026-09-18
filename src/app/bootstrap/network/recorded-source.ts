import type { CvarRegistry } from '../../../core/cvars/index.ts';
import { NetQuakeDemoReader, QuakeWorldDemoReader } from '../../../network/q1/demos.ts';
import { DemoReader } from '../../../network/q3/demo.ts';
import type { DemoResource } from '../demo-playback.ts';
import type { DemoCompletion } from '../demo-commands.ts';
import { NetQuakeDemoInput, QuakeWorldDemoInput } from './q1-demo.ts';
import { Q2DemoPlayback, readQ2PlaybackHeader } from './q2-demo.ts';
import { Q3DemoPlayback } from './q3-demo.ts';
import { Q1RemotePresentation } from './remote-q1.ts';
import { QwRemotePresentation } from './remote-qw.ts';
import { Q2RemotePresentation } from './remote.ts';
import { Q3RemotePresentation } from './remote-q3.ts';

export interface DemoTiming { readonly frames: number; readonly elapsedMilliseconds: number; }

export function demoTimingText(timing: DemoTiming): string {
  const seconds = timing.elapsedMilliseconds / 1000;
  return `${timing.frames} frames, ${seconds.toFixed(3)} seconds: ${(seconds > 0 ? timing.frames / seconds : 0).toFixed(1)} fps\n`;
}

type Playback = { readonly kind: 'q1'; readonly input: NetQuakeDemoInput }
  | { readonly kind: 'qw'; readonly input: QuakeWorldDemoInput }
  | { readonly kind: 'q2'; readonly input: Q2DemoPlayback; readonly remote: Q2RemotePresentation }
  | { readonly kind: 'q3'; readonly input: Q3DemoPlayback; readonly remote: Q3RemotePresentation };

/** One rendered-frame advance over the existing protocol readers and presentation clocks. */
export class RecordedRemoteSource {
  private readonly playback: Playback;
  private milliseconds: number | null = null;
  private state: 'loading' | 'active' | 'closed' = 'loading';
  private terminal: DemoCompletion | null = null;
  private reported = false;
  private paused = false;
  private previousRealTime: number | null = null;
  private pausedMilliseconds = 0;
  private benchmarkStart: number | null = null;
  private benchmarkFrames = 0;
  private resultTiming: DemoTiming | null = null;
  constructor(readonly resource: DemoResource, remote: Q1RemotePresentation | QwRemotePresentation | Q2RemotePresentation | Q3RemotePresentation,
    private readonly timedemo: boolean, private readonly cvars: CvarRegistry, private readonly complete: (reason: DemoCompletion, timing: DemoTiming | null) => void) {
    if (resource.kind === 'q1' && remote instanceof Q1RemotePresentation) this.playback = { kind: 'q1', input: new NetQuakeDemoInput(new NetQuakeDemoReader(resource.bytes), remote) };
    else if (resource.kind === 'qw' && remote instanceof QwRemotePresentation) this.playback = { kind: 'qw', input: new QuakeWorldDemoInput(new QuakeWorldDemoReader(resource.bytes), remote) };
    else if (resource.kind === 'q2' && remote instanceof Q2RemotePresentation) this.playback = { kind: 'q2', input: new Q2DemoPlayback(resource.bytes, remote, readQ2PlaybackHeader(resource.bytes).kind === 'mvd' ? remote.mvdPresentation : undefined, clientnum => remote.selectRecordedView(clientnum)), remote };
    else if (resource.kind === 'q3' && remote instanceof Q3RemotePresentation) this.playback = { kind: 'q3', input: new Q3DemoPlayback({ host: remote, clock: remote.clock, reader: new DemoReader(resource.bytes, resource.path) }), remote };
    else throw new Error('Recording and remote presentation families differ');
  }
  selectPlayer(clientnum: number): void {
    if (this.playback.kind !== 'q2') throw new Error('View selection requires a multiview Q2 recording');
    this.playback.input.selectPlayer(clientnum);
  }
  get phase(): 'loading' | 'active' | 'closed' { return this.state; }
  get timing(): DemoTiming | null { return this.resultTiming; }
  get isPaused(): boolean { return this.paused; }
  setPaused(paused: boolean): void { this.paused = paused; }
  async advance(milliseconds: number, frame: number, realTime: number): Promise<void> {
    if (this.state === 'closed') return;
    if (this.paused && this.previousRealTime !== null) this.pausedMilliseconds += Math.max(0, realTime - this.previousRealTime);
    this.previousRealTime = realTime;
    if (this.paused) return;
    realTime -= this.pausedMilliseconds;
    const playback = this.playback;
    const timedemo = this.timedemo || this.cvars.variableValue('timedemo') !== 0;
    if (playback.kind === 'q1' || playback.kind === 'qw') {
      const result = await playback.input.advance({ elapsedSeconds: milliseconds / 1000, frame, timedemo });
      if (result.phase === 'ended') this.terminal = result.reason === 'recorded-disconnect' ? 'disconnected' : result.reason;
      else this.state = result.phase;
    } else if (playback.kind === 'q2') {
      const target = this.milliseconds === null ? 0 : this.milliseconds + milliseconds;
      const result = timedemo ? await playback.input.nextFrame() : await playback.input.advance(target);
      if (result.kind === 'frame') {
        this.milliseconds = this.milliseconds === null || timedemo || result.timeMilliseconds < target ? result.timeMilliseconds : target;
        playback.remote.sampleDemo(this.milliseconds);
        this.state = 'active';
      } else this.terminal = result.kind;
    } else {
      const result = await playback.input.advanceFrame(realTime, { paused: false, timeNudge: this.cvars.variableValue('cl_timeNudge'),
        timescale: this.cvars.variableValue('timescale'), freezeDemo: this.cvars.variableValue('cl_freezeDemo') !== 0, timedemo });
      if (result.kind === 'end') {
        this.terminal = result.end.reason === 'truncated-header' || result.end.reason === 'truncated-payload' ? 'truncated' : result.end.reason;
        this.resultTiming = result.timing;
      }
      else if (result.kind === 'frame') { playback.remote.samplePresentation(realTime); this.state = 'active'; }
      else this.state = playback.input.phase === 'active' ? 'active' : 'loading';
    }
    if (timedemo && playback.kind !== 'q3') {
      if (this.terminal === null && this.state === 'active') {
        if (this.benchmarkStart === null) this.benchmarkStart = realTime;
        else this.benchmarkFrames++;
      } else if (this.terminal !== null && this.benchmarkStart !== null) {
        this.resultTiming = { frames: this.benchmarkFrames, elapsedMilliseconds: Math.max(0, realTime - this.benchmarkStart) };
      }
    }
    if (this.terminal !== null && !this.reported) { this.reported = true; this.state = 'closed'; this.complete(this.terminal, this.resultTiming); }
  }
  close(): void { this.state = 'closed'; this.playback.input.close(); }
}
