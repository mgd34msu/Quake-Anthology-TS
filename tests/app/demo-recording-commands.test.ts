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


test('MVD commands retain context and select the hosted all-player feed instead of client recording', async () => {
  const root = await mkdtemp(join(tmpdir(), 'demo-mvd-controls-'));
  const owner = createIdentityOwner('mvd controls'), context: CommandContext = { session: owner.session, origin: { kind: 'local-console' } };
  const staged: DemoRecordingIntent[] = []; let attached = 0, detached = 0;
  const recorder = new ClientDemoRecording({ root: () => root, seed: async () => { throw new Error('Single-view seed is wrong'); },
    attach: () => { throw new Error('Single-view feed is wrong'); }, reconnectRecording: async () => { throw new Error('Not QW'); },
    print() {}, stage: intent => { staged.push(intent); }, mvdRecording: {
      seed: async source => { expect(source).toBe(context); return { identity: { kind: 'mvd', revision: 2010 }, packets: [{ kind: 'mvd', message: Uint8Array.of(1) }] }; },
      attach: () => { attached++; return () => { detached++; }; },
    } });
  const commands = new CommandBuffer({ dialect: 'q2-classic', context });
  const detach = recorder.attach(commands);
  try {
    commands.executeNow('mvdrecord match'); commands.executeNow('mvdstop');
    expect(staged).toEqual([{ kind: 'mvdrecord', name: 'match', source: context }, { kind: 'mvdstop', source: context }]);
    expect(attached).toBe(0); expect(commands.commandDocumentation('mvdrecord')?.usage).toBe('mvdrecord <name>');
    await recorder.startMvd('match', context); expect(attached).toBe(1); expect(recorder.path).toBe(join(root, 'demos/match.mvd'));
    await recorder.stopMvd(); expect(detached).toBe(1); expect(recorder.path).toBeNull();
    expect([...await readFile(join(root, 'demos/match.mvd'))]).toEqual([77, 86, 68, 50, 1, 0, 1, 0, 0]);
  } finally { detach(); await recorder.stop(); await rm(root, { recursive: true, force: true }); }
});

test('serverrecord controls preserve concurrent client recording and serverstop closes only footage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'server-record-controls-'));
  const owner = createIdentityOwner('server controls'), context: CommandContext = { session: owner.session, origin: { kind: 'local-console' } };
  const staged: DemoRecordingIntent[] = []; let clientDetached = 0, serverDetached = 0;
  const recorder = new ClientDemoRecording({ root: () => root,
    seed: async () => ({ identity: { kind: 'q2', protocol: { kind: 'q2-classic', version: 34 } }, packets: [{ kind: 'q2', message: Uint8Array.of(6) }] }),
    attach: () => () => { clientDetached++; }, reconnectRecording: async () => { throw new Error('Not QW'); }, print() {}, stage: intent => { staged.push(intent); },
    serverRecording: { seed: async source => { expect(source).toBe(context); return { identity: { kind: 'q2-server', protocol: 34 }, packets: [{ kind: 'q2-server', message: Uint8Array.of(6) }] }; },
      attach: () => () => { serverDetached++; } } });
  const commands = new CommandBuffer({ dialect: 'q2-classic', context }); const detach = recorder.attach(commands);
  try {
    commands.executeNow('serverrecord footage'); commands.executeNow('serverstop');
    expect(staged).toEqual([{ kind: 'serverrecord', name: 'footage', source: context }, { kind: 'serverstop', source: context }]);
    expect(commands.commandDocumentation('serverrecord')?.usage).toBe('serverrecord <name>');
    await recorder.start('client', context); const clientPath = recorder.path;
    await recorder.startServer('footage', context); expect(recorder.path).toBe(clientPath); expect(clientDetached).toBe(0);
    await expect(recorder.startServer('other', context)).rejects.toThrow('Already');
    await recorder.stopServer(); expect(serverDetached).toBe(1); expect(clientDetached).toBe(0);
    expect([...await readFile(join(root, 'demos/footage.dm2'))]).toEqual([1, 0, 0, 0, 6]);
    await recorder.startServer('another', context); await recorder.stopAll();
    expect(clientDetached).toBe(1); expect(serverDetached).toBe(2);
  } finally { detach(); await recorder.stopAll(); await rm(root, { recursive: true, force: true }); }
});
