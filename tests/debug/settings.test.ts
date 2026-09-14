import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApplicationImageSettings } from '../../src/app/bootstrap/image-settings.ts';
import { createIdentityOwner } from '../../src/contracts/identity.ts';

test('debug line width is live, defaults to two, rejects invalid values, and is not archived', async () => {
  const root = await mkdtemp(join(tmpdir(), 'debug-line-settings-')), errors: string[] = [];
  try {
    const settings = await ApplicationImageSettings.open({ context: { session: createIdentityOwner('debug-settings').session, origin: { kind: 'local-console' } }, dialect: 'q2-rerelease', userContentRoot: root, print: message => errors.push(message) });
    expect(settings.debugLineWidth).toBe(2);
    settings.cvars.set('gl_debug_linewidth', '6'); expect(settings.debugLineWidth).toBe(6);
    settings.cvars.set('gl_debug_linewidth', '-1'); expect(settings.debugLineWidth).toBe(6);
    expect(settings.cvars.variableValue('gl_debug_linewidth')).toBe(6); expect(errors).toHaveLength(1);
    await settings.close(); expect(await Bun.file(join(root, 'settings/images.cfg')).exists()).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
