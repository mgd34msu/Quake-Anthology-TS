import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QvmCgameImport, QvmUiImport } from '../../../src/compat/qvm/abi.ts';
import { qvmClientAudioSyscall } from '../../../src/compat/qvm/client-audio-syscalls.ts';
import { createQvmSystemCall, rejectQvmSyscall } from '../../../src/compat/qvm/syscalls.ts';
import { QvmMemory } from '../../../src/compat/qvm/memory.ts';
import { SoundBank, UnifiedAudio } from '../../../src/audio/index.ts';
import type { PlaySound } from '../../../src/audio/types.ts';
import { Q3PresentationSoundBank, Q3PresentationAudio } from '../../../src/content/q3/presentation/audio.ts';
import type { Q3ClientSound } from '../../../src/content/q3/presentation/client.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { createMountIdentity } from '../../../src/contracts/content.ts';
import type { Axis } from '../../../src/contracts/math.ts';
import { openArchive } from '../../../src/content/archive/index.ts';
import { openMountPlan } from '../../../src/content/mounts/index.ts';
import { ApplicationMusic } from '../../../src/app/bootstrap/audio/music.ts';

test('cgame and UI sound traps use shared bank handles, mixer and music through guest memory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qvm-audio-'));
  const archive = await openArchive(join(import.meta.dir, '../../../../qfiles/q3a/baseq3/pak0.pk3'));
  const path = 'sound/player/sarge/jump1.wav', entry = archive.entries.find(entry => entry.path === path);
  if (entry === undefined) throw new Error('Missing real Q3 jump sound');
  try {
    const bytes = await archive.readEntry(entry);
    await mkdir(join(root, 'sound/player/sarge'), { recursive: true }); await mkdir(join(root, 'music'));
    await Bun.write(join(root, path), bytes); await Bun.write(join(root, 'music/intro.wav'), bytes);
    const content = 'q3:classic:baseq3:installed', mount = { kind: 'loose', identity: createMountIdentity('mount:qvm:audio', content, 0), rootPath: root } satisfies Parameters<typeof openMountPlan>[0]['mounts'][number];
    using mounts = await openMountPlan({ id: 'mount-plan:qvm:audio', mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
    const sourceBank = new SoundBank(mounts), bank = new Q3PresentationSoundBank(sourceBank, null, () => null);
    const identity = createIdentityOwner('QVM audio'), seat = identity.seat(0), actor = identity.actor(1, 0), printed: string[] = [], played: PlaySound[] = [];
    const origin = { x: 0, y: 0, z: 0 }, axis: Axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
    using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 1, onSound: sound => played.push(sound) });
    audio.setListeners([{ seat, actor, origin, axis, gain: 1, underwater: false }]);
    const target = new Q3PresentationAudio({ seat, sounds: bank, actor: number => identity.actor(number, 0), frameNumber: () => 23,
      play: sound => { audio.play(sound); }, loop: sound => { audio.loop(sound); }, updateActor: (actor, position) => audio.updateQ3SeatActor(seat, actor, position),
      stopLoop: (seat, actor) => audio.stopQ3SeatLoop(seat, actor) });
    const music = new ApplicationMusic(audio, text => { printed.push(text); return undefined; });
    let listener = { entity: 1, origin, axis };
    const sound: Q3ClientSound = { bank, startSound: (origin, entity, channel, pcm) => target.startSound(origin, entity, channel, pcm),
      startSourceSound: (pcm, options) => target.startSourceSound(pcm, options), startLocalSound: (pcm, channel) => target.startLocalSound(pcm, channel),
      addLoopSound: (entity, origin, velocity, pcm, real) => target.addLoopSound(entity, origin, velocity, pcm, real),
      updateSoundPosition: (entity, position) => target.updateSoundPosition(entity, position), stopLoopingSound: entity => target.stopLoopingSound(entity),
      clearLoopingSounds: killAll => audio.clearQ3SeatLoops(seat, killAll), setListener: (entity, origin, axis) => {
        listener = { entity, origin, axis }; audio.setListeners([{ seat, actor: identity.actor(entity, 0), origin, axis, gain: 1, underwater: false }]);
      }, startBackgroundTrack: (intro, loop) => music.play(content, 'q3', 'baseq3', sourceBank, `${intro} ${loop}`) };
    const guest = new QvmMemory(new Uint8Array(4096));
    const syscalls = { cgame: createQvmSystemCall('cgame', call => qvmClientAudioSyscall(call, { role: 'cgame', sound, print: text => printed.push(text) }) ?? rejectQvmSyscall(call)),
      ui: createQvmSystemCall('ui', call => qvmClientAudioSyscall(call, { role: 'ui', sound, print: text => printed.push(text) }) ?? rejectQvmSyscall(call)) };
    const call = (role: 'cgame' | 'ui', code: number, args: readonly number[] = []) => {
      const words = new DataView(new ArrayBuffer(4 * (args.length + 1)));
      words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
      return syscalls[role]({ words, memory: guest.bytes, invoke: (): never => { throw new Error('Unexpected guest reentry'); },
        invokeAsync: async (): Promise<number> => { throw new Error('Unexpected guest reentry'); } });
    };
    guest.writeString(256, path, 64);
    const pendingHandle = call('cgame', QvmCgameImport.CG_S_REGISTERSOUND, [256, 1]);
    expect(pendingHandle).toBeInstanceOf(Promise);
    const handle = await pendingHandle;
    expect(handle).toBeGreaterThan(0); expect(bank.indexForSound(bank.soundAtIndex(handle))).toBe(handle);
    expect(await call('ui', QvmUiImport.UI_S_REGISTERSOUND, [256, 0])).toBe(handle);
    expect(bank.registrations()).toHaveLength(1); expect(bank.registrations()[0]?.compressed).toBe(true);
    guest.writeString(256, 'sound/missing.wav', 64);
    expect(await call('cgame', QvmCgameImport.CG_S_REGISTERSOUND, [256, 0])).toBe(0);
    call('ui', QvmUiImport.UI_S_STARTLOCALSOUND, [handle, 6]);
    expect(played[0]?.audience).toEqual({ kind: 'seat', seat });
    expect(audio.mix(4096).some(sample => sample !== 0)).toBe(true);
    audio.stopAll();
    const beforeInvalid = played.length;
    call('ui', QvmUiImport.UI_S_STARTLOCALSOUND, [9876, 6]);
    call('ui', QvmUiImport.UI_S_STARTLOCALSOUND, [0, 6]);
    expect(played).toHaveLength(beforeInvalid); expect(printed).toEqual(['^3']);
    expect(audio.mix(128).every(sample => sample === 0)).toBe(true);
    const point = guest.view(512, 12); point.setFloat32(0, 12.5, true); point.setFloat32(4, -3.25, true); point.setFloat32(8, 8, true);
    const velocity = guest.view(528, 12); velocity.setFloat32(0, 32, true);
    call('cgame', QvmCgameImport.CG_S_UPDATEENTITYPOSITION, [1, 512]);
    call('cgame', QvmCgameImport.CG_S_STARTSOUND, [0, 1, 1, handle]);
    expect(played.at(-1)?.origin.kind).toBe('actor');
    audio.stopAll();
    call('cgame', QvmCgameImport.CG_S_STARTSOUND, [512, 1, 1, handle]);
    expect(played.at(-1)?.origin).toEqual({ kind: 'fixed', position: { x: 12.5, y: -3.25, z: 8 } });
    audio.stopAll();
    call('cgame', QvmCgameImport.CG_S_ADDREALLOOPINGSOUND, [1, 512, 528, handle]); audio.endLoopFrame();
    call('cgame', QvmCgameImport.CG_S_CLEARLOOPINGSOUNDS, [0]); audio.endLoopFrame();
    expect(audio.mix(4096).some(sample => sample !== 0)).toBe(true);
    call('cgame', QvmCgameImport.CG_S_STOPLOOPINGSOUND, [1]); audio.endLoopFrame();
    expect(audio.mix(128).every(sample => sample === 0)).toBe(true);
    call('cgame', QvmCgameImport.CG_S_ADDLOOPINGSOUND, [1, 512, 528, handle]); audio.endLoopFrame();
    expect(audio.mix(4096).some(sample => sample !== 0)).toBe(true);
    call('cgame', QvmCgameImport.CG_S_CLEARLOOPINGSOUNDS, [0]); audio.endLoopFrame();
    expect(audio.mix(128).every(sample => sample === 0)).toBe(true);
    call('cgame', QvmCgameImport.CG_S_ADDREALLOOPINGSOUND, [1, 512, 528, handle]); audio.endLoopFrame();
    call('cgame', QvmCgameImport.CG_S_CLEARLOOPINGSOUNDS, [1]); audio.endLoopFrame();
    expect(audio.mix(128).every(sample => sample === 0)).toBe(true);
    const axes = guest.view(560, 36); axes.setFloat32(0, 1, true); axes.setFloat32(16, 1, true); axes.setFloat32(32, 1, true);
    call('cgame', QvmCgameImport.CG_S_RESPATIALIZE, [1, 512, 560, 1]);
    expect(listener).toEqual({ entity: 1, origin: { x: 12.5, y: -3.25, z: 8 }, axis });
    expect(() => call('cgame', QvmCgameImport.CG_S_STARTSOUND, [0, -1, 1, handle])).toThrow('bad entitynum');
    expect(() => call('cgame', QvmCgameImport.CG_S_RESPATIALIZE, [1, 512, 4090, 0])).toThrow('exceeds allocation');
    guest.writeString(256, 'intro.wav', 64);
    expect(await call('ui', QvmUiImport.UI_S_STARTBACKGROUNDTRACK, [256, 0])).toBe(0);
    expect(audio.mix(4096).some(sample => sample !== 0)).toBe(true);
    expect(await call('cgame', QvmCgameImport.CG_S_STOPBACKGROUNDTRACK)).toBe(0);
    expect(audio.mix(128).every(sample => sample === 0)).toBe(true);
    music.stop();
  } finally { archive.close(); await rm(root, { recursive: true, force: true }); }
});
