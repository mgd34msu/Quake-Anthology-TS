import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { UiDrawContext } from '../../../src/contracts/ui.ts';
import { defaultUiSkin } from '../../../src/ui/common/skin.ts';
import { drawCommonHud, emptyHudData, hudVitalOccupiedRects, SeatHudMessages } from '../../../src/ui/hud/index.ts';
import { SeatUiPreferences } from '../../../src/ui/settings/index.ts';

for (const [width, height] of [[320, 120], [1280, 360]]) test(`status text and panels fit both ${width}x${height} seats`, () => {
  if (width === undefined || height === undefined) throw new Error('Missing viewport size');
  const owner = createIdentityOwner('readable-status'), skin = { ...defaultUiSkin('resource:test:font'), capInk: { top: 16 / 7, height: 24 / 7 } };
  const measureText = (text: string, scale: number): number => text.length * 32 / 7 * scale;
  for (const index of [0, 1]) {
    const seat = owner.seat(index), area = { x: 0, y: height * index, width, height };
    const provider = { provider: 'q2:official', content: 'q2:rerelease:baseq2:retail' } satisfies import('../../../src/contracts/content.ts').ProviderReference;
    const context: UiDrawContext = { binding: { seat, client: owner.client(index, 0), viewport: area, safeArea: area, hudScale: 1,
      presentation: { doppler: { kind: 'source' }, environment: { kind: 'audio-content' }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 1000 };
    const preferences = new SeatUiPreferences(seat).values, messages = new SeatHudMessages(seat);
    const commands = drawCommonHud(context, { ...emptyHudData(seat), crosshair: { ...emptyHudData(seat).crosshair, visible: false },
      vitals: [{ label: 'Health', value: 100, icon: null, warning: false }, { label: 'Armor', value: 50, icon: null, warning: false }],
      weapon: { status: { source: provider, item: 'q2:shotgun', label: 'Shotgun', ammo: { kind: 'finite', item: 'q2:shells', count: 2, hasAmmoToStart: true, low: true } },
        measureText, warning: 'low', weaponIcon: null, ammoIcon: null, nativeStatus: false } },
      { skin, measureText, preferences, messages, camera: null, localize: text => text });
    const fills = commands.flatMap(command => command.kind === 'fill' ? [command.rect] : []);
    expect(fills).toEqual([...hudVitalOccupiedRects(context, 3, preferences.hudScale, skin.fontScale * preferences.textScale, skin.capInk.height)]);
    expect(fills).toHaveLength(3);
    for (const [ordinal, rect] of fills.entries()) {
      expect(rect.x).toBeGreaterThanOrEqual(area.x); expect(rect.y).toBeGreaterThanOrEqual(area.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width); expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + height);
      const next = fills[ordinal + 1]; if (next !== undefined) expect(rect.x + rect.width).toBeLessThan(next.x);
    }
    for (const command of commands) if (command.kind === 'text') {
      expect(command.scale * skin.capInk.height).toBeGreaterThanOrEqual(8);
      const panel = fills.find(rect => command.origin.x >= rect.x && command.origin.x < rect.x + rect.width);
      if (panel === undefined) throw new Error('Status text lost its panel');
      expect(command.origin.x + measureText(command.text, command.scale)).toBeLessThanOrEqual(panel.x + panel.width + 0.001);
      expect(command.origin.y + (skin.capInk.top + skin.capInk.height) * command.scale).toBeLessThanOrEqual(panel.y + panel.height + 0.001);
    }
  }
});

for (const backend of ['cpu', 'gl']) for (const [width, height] of [[320, 240], [1280, 720]]) {
  test.skipIf(process.env['QUAKE_HUD_READABILITY_APP'] !== '1')(`actual ${backend} status capture ${width}x${height}`, async () => {
    if (width === undefined || height === undefined) throw new Error('Missing capture size');
    const { mkdtemp, rm } = await import('node:fs/promises'), { join } = await import('node:path'), { tmpdir } = await import('node:os');
    const { Application } = await import('../../../src/app/bootstrap/application.ts');
    const { parseApplicationCommand } = await import('../../../src/app/bootstrap/options.ts');
    const { encodePng } = await import('../../../src/formats/images/png.ts');
    const userRoot = await mkdtemp(join(tmpdir(), 'hud-readable-'));
    try {
      const parsed = parseApplicationCommand(['--game', 'q2-rerelease-baseq2', '--map', 'base1', '--renderer', backend,
        '--hidden', '--width', String(width), '--height', String(height), '--seats', '2', '--gamma', '1', '--user-content-root', userRoot]);
      if (parsed.kind !== 'run') throw new Error('No application launch');
      const app = await Application.open(parsed.options, { print: () => undefined });
      try {
        for (let frame = 0; frame < 1; frame++) await app.step(25);
        const capture = app.captureNextFrame(); await app.step(25); const rgba = await capture;
        expect(rgba.byteLength).toBe(width * height * 4);
        await Bun.write(`/tmp/hud-readability-${backend}-${width}.png`, encodePng(width, height, rgba));
      } finally { await app.close(); }
    } finally { await rm(userRoot, { recursive: true, force: true }); }
  }, 30000);
}
