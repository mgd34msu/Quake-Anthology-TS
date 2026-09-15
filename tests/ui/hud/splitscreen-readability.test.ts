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

for (const hudScale of [1, 1.25, 1.5]) for (const textScale of [0.75, 1, 1.25, 1.5, 2]) test(`normal HUD values match ammo at HUD scale ${hudScale}, text scale ${textScale}`, () => {
  const owner = createIdentityOwner('normal-status'), seat = owner.seat(0), area = { x: 0, y: 0, width: 640, height: 480 };
  const provider = { provider: 'q2:official', content: 'q2:classic:baseq2:retail' } satisfies import('../../../src/contracts/content.ts').ProviderReference;
  const context: UiDrawContext = { binding: { seat, client: owner.client(0, 0), viewport: area, safeArea: area, hudScale: 1,
    presentation: { doppler: { kind: 'source' }, environment: { kind: 'audio-content' }, assets: provider.content, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 1000 };
  const skin = defaultUiSkin('resource:test:font');
  const commands = drawCommonHud(context, { ...emptyHudData(seat), crosshair: { ...emptyHudData(seat).crosshair, visible: false },
    vitals: [{ label: 'Health', value: 125, icon: null, warning: false }, { label: 'Armor', value: 50, icon: null, warning: false }],
    weapon: { status: { source: provider, item: 'q2:shotgun', label: 'Shotgun', ammo: { kind: 'finite', item: 'q2:shells', count: 99, hasAmmoToStart: true, low: false } },
      warning: 'low', weaponIcon: 'resource:test:weapon', ammoIcon: null, nativeStatus: false } },
    { skin, preferences: { ...new SeatUiPreferences(seat).values, hudScale, textScale }, messages: new SeatHudMessages(seat), camera: null,
      localize: text => text === 'Health' ? 'A very long localized health label' : text });
  const texts = commands.filter(command => command.kind === 'text');
  const health = texts.find(command => command.text === '125'), armor = texts.find(command => command.text === '50'), ammo = texts.find(command => command.text === '99');
  if (health === undefined || armor === undefined || ammo === undefined) throw new Error('Missing full numeric status');
  expect(health.scale).toBe(ammo.scale); expect(armor.scale).toBe(ammo.scale);
  expect(health.scale * 8).toBe(18 * hudScale * textScale);
  const label = texts.find(command => command.text.startsWith('A very'));
  if (label === undefined) throw new Error('Missing readable localized label');
  expect(label.origin.y).toBeGreaterThanOrEqual(health.origin.y + health.scale * 8);
  const panel = commands.flatMap(command => command.kind === 'fill' ? [command.rect] : []).find(rect => health.origin.x >= rect.x && health.origin.x < rect.x + rect.width);
  if (panel === undefined) throw new Error('Missing health panel');
  expect(label.origin.x + label.text.length * 8 * label.scale).toBeLessThanOrEqual(panel.x + panel.width);
  expect(label.origin.y + label.scale * 8).toBeLessThanOrEqual(panel.y + panel.height);
  const panels = commands.flatMap(command => command.kind === 'fill' ? [command.rect] : []);
  for (const command of commands) if (command.kind === 'text' || command.kind === 'image') {
    const rect = command.kind === 'text' ? { ...command.origin, width: command.text.length * 8 * command.scale, height: 8 * command.scale } : command.rect;
    const box = panels.find(panel => rect.x >= panel.x && rect.x < panel.x + panel.width);
    if (box === undefined) throw new Error('Status item lost its panel');
    expect(rect.x + rect.width).toBeLessThanOrEqual(box.x + box.width + 0.001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(box.y + box.height + 0.001);
  }
});

for (const iconAspect of [1, 2, 4]) for (const count of [200, 1234]) for (const warning of ['none', 'low'] satisfies import('../../../src/contracts/ui.ts').ArsenalAmmoWarning[]) test(`maximum HUD ammo ${count} with both icons aspect ${iconAspect} and ${warning} warning stays separate`, async () => {
  const { drawWeaponHud, hudStatusRows } = await import('../../../src/ui/hud/weapon.ts');
  const skin = { ...defaultUiSkin('resource:test:font'), capInk: { top: 0, height: 8 } };
  const textScale = 3, scale = 1.5, height = hudStatusRows(textScale, 8).height;
  const panel = { x: 420 / scale, y: 369 / scale, width: 194 / scale, height };
  const measureText = (text: string, size: number) => text.length * 8 * size;
  const commands = drawWeaponHud({ status: { source: { provider: 'q2:official', content: 'q2:classic:baseq2:retail' }, item: 'q2:weapon_machinegun', label: 'Machinegun',
    ammo: { kind: 'finite', item: 'q2:ammo_bullets', count, hasAmmoToStart: true, low: false } }, warning,
    weaponIcon: 'resource:test:weapon', ammoIcon: 'resource:test:ammo', iconAspect, nativeStatus: false, measureText }, panel, skin, textScale, 2 / 3);
  const boxes = commands.flatMap(command => command.kind === 'image' ? [command.rect] : command.kind === 'text' ? [{ x: command.origin.x, y: command.origin.y,
    width: measureText(command.text, command.scale), height: 8 * command.scale }] : []);
  expect(commands.some(command => command.kind === 'text' && command.text === String(count))).toBe(true);
  for (const [index, rect] of boxes.entries()) {
    expect(rect.x).toBeGreaterThanOrEqual(panel.x); expect(rect.y).toBeGreaterThanOrEqual(panel.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(panel.x + panel.width + 0.001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(panel.y + panel.height + 0.001);
    for (const other of boxes.slice(index + 1)) expect(rect.x < other.x + other.width && rect.x + rect.width > other.x
      && rect.y < other.y + other.height && rect.y + rect.height > other.y).toBe(false);
  }
});
