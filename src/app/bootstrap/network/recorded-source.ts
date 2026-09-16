import type { CvarRegistry } from '../../../core/cvars/index.ts';
import { NetQuakeDemoReader, QuakeWorldDemoReader } from '../../../network/q1/demos.ts';
import { DemoReader } from '../../../network/q3/demo.ts';
import type { DemoResource } from '../demo-playback.ts';
import type { DemoCompletion } from '../demo-commands.ts';
import { NetQuakeDemoInput, QuakeWorldDemoInput } from './q1-demo.ts';
import { Q2DemoPlayback } from './q2-demo.ts';
import { Q3DemoPlayback } from './q3-demo.ts';
import { Q1RemotePresentation } from './remote-q1.ts';
import { QwRemotePresentation } from './remote-qw.ts';
import { Q2RemotePresentation } from './remote.ts';
import { Q3RemotePresentation } from './remote-q3.ts';

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
  constructor(readonly resource: DemoResource, remote: Q1RemotePresentation | QwRemotePresentation | Q2RemotePresentation | Q3RemotePresentation,
    private readonly timedemo: boolean, private readonly cvars: CvarRegistry, private readonly complete: (reason: DemoCompletion) => void) {
    if (resource.kind === 'q1' && remote instanceof Q1RemotePresentation) this.playback = { kind: 'q1', input: new NetQuakeDemoInput(new NetQuakeDemoReader(resource.bytes), remote) };
    else if (resource.kind === 'qw' && remote instanceof QwRemotePresentation) this.playback = { kind: 'qw', input: new QuakeWorldDemoInput(new QuakeWorldDemoReader(resource.bytes), remote) };
    else if (resource.kind === 'q2' && remote instanceof Q2RemotePresentation) this.playback = { kind: 'q2', input: new Q2DemoPlayback(resource.bytes, remote), remote };
    else if (resource.kind === 'q3' && remote instanceof Q3RemotePresentation) this.playback = { kind: 'q3', input: new Q3DemoPlayback({ host: remote, clock: remote.clock, reader: new DemoReader(resource.bytes, resource.path) }), remote };
    else throw new Error('Recording and remote presentation families differ');
  }
  get phase(): 'loading' | 'active' | 'closed' { return this.state; }
  async advance(milliseconds: number, frame: number, realTime: number): Promise<void> {
    if (this.state === 'closed') return;
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
      if (result.kind === 'end') this.terminal = result.end.reason === 'truncated-header' || result.end.reason === 'truncated-payload' ? 'truncated' : result.end.reason;
      else if (result.kind === 'frame') { playback.remote.samplePresentation(realTime); this.state = 'active'; }
      else this.state = playback.input.phase === 'active' ? 'active' : 'loading';
    }
    if (this.terminal !== null && !this.reported) { this.reported = true; this.state = 'closed'; this.complete(this.terminal); }
  }
  close(): void { this.state = 'closed'; this.playback.input.close(); }
}
