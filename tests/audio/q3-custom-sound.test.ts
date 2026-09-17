import { test, expect } from 'bun:test';
import { q3CustomSoundFallback } from '../../src/content/q3/presentation/character-resources.ts';
import { q3VoiceFallback } from '../../src/app/bootstrap/audio/q3.ts';
import { InstalledCatalog, expectedProducts } from '../../src/content/catalog/index.ts';
import type { CatalogProduct } from '../../src/content/catalog/index.ts';
import { createContentId } from '../../src/contracts/content.ts';

test('Q3 custom voice default preserves native base and Team Arena team/FFA policy', () => {
  expect(q3CustomSoundFallback('baseq3', false)).toBe('sarge');
  expect(q3CustomSoundFallback('baseq3', true)).toBe('sarge');
  expect(q3CustomSoundFallback('missionpack', false)).toBe('sarge');
  expect(q3CustomSoundFallback('missionpack', true)).toBe('james');
});
test('shared custom voice policy follows selected character ancestry across foreign-world content', () => {
  const products: CatalogProduct[] = expectedProducts.map(expectation => ({ id: createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: 'fixture' }), expectation,
    availability: { kind: 'installed' }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [] }));
  const team = products.find(product => product.expectation.id === 'q3-missionpack');
  if (team === undefined) throw new Error('Missing authored Team Arena declaration');
  const mod: CatalogProduct = { ...team, id: createContentId({ family: 'q3', edition: 'classic', package: 'ta-voice-mod', revision: 'fixture' }), expectation: { ...team.expectation, id: 'ta-voice-mod', campaign: 'custom-team-game', baseProduct: 'q3-missionpack' } };
  const catalog = new InstalledCatalog('/unused', [...products, mod], [], 0);
  const worlds = ['q1-classic-id1', 'q2-classic-baseq2', 'q3-baseq3'];
  for (const world of worlds) {
    expect(catalog.product(world).expectation.id).toBe(world);
    // Geometry is deliberately not a selector: these three worlds host the same character policy.
    expect(q3VoiceFallback(catalog, team.id, true)).toBe('james');
    expect(q3VoiceFallback(catalog, team.id, false)).toBe('sarge');
    expect(q3VoiceFallback(catalog, mod.id, true)).toBe('james');
    expect(q3VoiceFallback(catalog, catalog.product('q3-baseq3').id, true)).toBe('sarge');
  }
});
