import type { ContentId } from '../../contracts/content.ts';
import type { SeatId } from '../../contracts/identity.ts';
import { LocalizationCatalog } from '../../text/localization.ts';
import type { ApplicationAssets } from './assets.ts';

/** Resolve source message arguments before presenting the same text to console and HUD. */
export class Q1MessageLocalization {
  private readonly catalogs = new Map<ContentId, Promise<LocalizationCatalog>>();
  constructor(private readonly seat: SeatId, private readonly assets: ApplicationAssets) {}
  async resolve(content: ContentId, text: string, args: readonly (string | number)[]): Promise<string> {
    const product = this.assets.content.catalog.product(content).expectation;
    if (product.family !== 'q1' || product.edition !== 'rerelease') return text;
    let catalog = this.catalogs.get(content);
    if (catalog === undefined) {
      catalog = (async () => {
        const provider = await this.assets.provider(content);
        const [base, mod] = await Promise.all([provider.mounts.open('localization/loc_english.txt'), provider.mounts.open('localization/loc_english_mod.txt')]);
        const table = new LocalizationCatalog(this.seat, 'q1-rerelease');
        table.loadOrdered({ base: base?.bytes ?? null, mods: mod === null ? [] : [mod.bytes] }, { base: null, mods: [] });
        return table;
      })();
      this.catalogs.set(content, catalog);
    }
    return (await catalog).localize(text, args.map(String));
  }
}
