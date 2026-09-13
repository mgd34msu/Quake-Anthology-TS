// QuakeWorld cl_parse.c transfer lifecycle over shared contained staging.
import { DownloadSink, downloadPath } from '../../../network/services/downloads.ts';
import type { QuakeWorldMessage } from '../../../network/q1/quakeworld.ts';

export interface QwDownloadOptions {
  /** Provisioned writable game directory; mounted-file lookup is supplied by the caller. */
  readonly gameRoot: string;
  /** Shared writable qw directory; skin names retain their skins/ prefix. */
  readonly skinRoot: string;
  readonly exists: (path: string, category: 'sound' | 'model' | 'skin') => Promise<boolean>;
  readonly sendCommand: (text: string) => void;
  readonly print: (text: string) => void;
  readonly noskins: () => number;
  readonly demoRecording: () => boolean;
  readonly demoPlayback: () => boolean;
  readonly maximumBytes?: number;
}
interface Transfer { readonly path: string; readonly root: string; sink: DownloadSink | null; percent: number; }

export class QwDownloadReceiver {
  private transfer: Transfer | null = null;
  private generation = 0;
  constructor(private readonly options: QwDownloadOptions) {}

  async request(path: string, category: 'sound' | 'model' | 'skin'): Promise<'available' | 'waiting' | 'skipped'> {
    if (this.transfer !== null) throw new Error('QuakeWorld download already active');
    if (category === 'model' && path.startsWith('*')) return 'skipped';
    downloadPath(path);
    if (!/^[a-zA-Z0-9_+./-]+$/.test(path) || !path.includes('/') || path.includes('..')
      || (category === 'skin' && !path.startsWith('skins/'))
      || (category === 'sound' && !path.startsWith('sound/'))
      || (category === 'model' && (path.startsWith('skins/') || path.startsWith('sound/'))))
      throw new Error('Invalid QuakeWorld download path or category');
    const generation = this.generation;
    if (await this.options.exists(path, category)) return generation === this.generation ? 'available' : 'skipped';
    if (generation !== this.generation) return 'skipped';
    if (this.options.demoRecording() || this.options.demoPlayback() || (category === 'skin' && this.options.noskins() !== 0)) {
      this.options.print(`Skipping QuakeWorld download ${path}: demo or skin policy\n`);
      return 'skipped';
    }
    this.transfer = { path, root: category === 'skin' ? this.options.skinRoot : this.options.gameRoot, sink: null, percent: 0 };
    this.options.sendCommand(`download ${path}`);
    return 'waiting';
  }

  async receive(result: Extract<QuakeWorldMessage, { kind: 'download' }>['result']): Promise<'waiting' | 'complete' | 'missing'> {
    if (this.options.demoPlayback()) { this.close(); return 'waiting'; }
    const transfer = this.transfer;
    if (transfer === null) throw new Error('Unsolicited QuakeWorld download');
    if (result.kind === 'missing') { this.options.print(`QuakeWorld file not found: ${transfer.path}\n`); this.close(); return 'missing'; }
    if (!Number.isInteger(result.percent) || result.percent < transfer.percent || result.percent > 100 || result.bytes.length > 768) {
      this.close(); throw new Error('Invalid QuakeWorld download block');
    }
    try {
      transfer.sink ??= DownloadSink.create(transfer.root, transfer.path, { kind: 'protocol-completion', maximumBytes: this.options.maximumBytes ?? 64 * 1024 * 1024 });
      transfer.sink.append(result.bytes);
      transfer.percent = result.percent;
      if (result.percent !== 100) { this.options.sendCommand('nextdl'); return 'waiting'; }
      transfer.sink.finish(); this.transfer = null;
      return 'complete';
    } catch (error) {
      this.close();
      this.options.print(`QuakeWorld download failed for ${transfer.path}: ${error instanceof Error ? error.message : String(error)}\n`);
      return 'missing';
    }
  }

  close(): void { this.generation++; this.transfer?.sink?.close(); this.transfer = null; }
}
