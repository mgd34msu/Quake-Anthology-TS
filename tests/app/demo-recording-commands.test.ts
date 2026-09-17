import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { ClientDemoRecording, type DemoRecordingIntent } from '../../src/app/bootstrap/demo-recording-commands.ts';
import { CommandBuffer } from '../../src/core/commands/index.ts';
import { CvarRegistry } from '../../src/core/cvars/index.ts';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import type { CommandContext } from '../../src/contracts/common.ts';

test('recording commands synchronously stage original command context and stoprecord is discoverable', () => {
  const identity = createIdentityOwner('record commands'), context: CommandContext = { session: identity.session, origin: { kind: 'local-console' } };
  const staged: DemoRecordingIntent[] = [], printed: string[] = [];
  const recorder = new ClientDemoRecording({ root: () => '/unused', seed: async () => { throw new Error('Must not read seed during command dispatch'); },
    attach: () => { throw new Error('Must not attach during command dispatch'); }, reconnectRecording: async () => { throw new Error('Must not reconnect during dispatch'); }, print: text => { printed.push(text); }, stage: intent => { staged.push(intent); } });
  const cvars = new CvarRegistry({ dialect: 'q3', context }), commands = new CommandBuffer({ dialect: 'q3', context, cvars, print: text => { printed.push(text); } });
  const detach = recorder.attach(commands);
  commands.executeNow('record session'); commands.executeNow('stoprecord');
  expect(staged).toEqual([{ kind: 'record', name: 'session', source: context }, { kind: 'stop', source: context }]);
  expect(commands.commandDocumentation('stoprecord')?.usage).toBe('stoprecord');
  commands.executeNow('record hostile', { ...context, origin: { kind: 'remote-client', client: identity.client(0, 0) } });
  expect(staged).toHaveLength(2); expect(printed.at(-1)).toContain('local recording command');
  detach(); detach(); expect(commands.commandDocumentation('record')).toBeUndefined();
});


test('unnamed Q3 recordings exclusively create the first unused source filename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'demo-auto-'));
  const identity = createIdentityOwner('automatic demos'), context: CommandContext = { session: identity.session, origin: { kind: 'local-console' } };
  const recorder = new ClientDemoRecording({ root: () => root,
    seed: async () => ({ identity: { kind: 'q3', protocol: 68 }, packets: [{ kind: 'q3', sequence: 0, message: new Uint8Array([8]) }] }),
    attach: () => () => {}, reconnectRecording: async () => { throw new Error('Not QW'); }, print() {}, stage() {} });
  try {
    await mkdir(join(root, 'demos')); await writeFile(join(root, 'demos/demo0000.dm_68'), 'preserved');
    await recorder.start(undefined, context);
    expect(recorder.path).toBe(join(root, 'demos/demo0001.dm_68'));
    await recorder.stop();
    expect(await readFile(join(root, 'demos/demo0000.dm_68'), 'utf8')).toBe('preserved');
    expect((await readFile(join(root, 'demos/demo0001.dm_68'))).length).toBeGreaterThan(8);
  } finally { await recorder.stop(); await rm(root, { recursive: true, force: true }); }
});
