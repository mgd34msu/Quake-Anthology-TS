import { classicQ1Text } from '../../content/q1/foundation/text.ts';
import type { Q1MessagePart } from '../../content/q1/foundation/types.ts';
import type { ContentId } from '../../contracts/content.ts';
import type { SeatId } from '../../contracts/identity.ts';
import { LocalizationCatalog } from '../../text/localization.ts';
import type { ApplicationAssets } from './assets.ts';

/** Resolve source message arguments before presenting the same text to console and HUD. */
export class Q1MessageLocalization {
  private readonly catalogs = new Map<ContentId, Map<string, Promise<LocalizationCatalog>>>();
  constructor(private readonly seat: SeatId,
    private readonly assets: { readonly content: Pick<ApplicationAssets['content'], 'catalog' | 'forContent'> },
    private readonly language: () => string = () => 'english') {}
  async resolve(content: ContentId, text: string, args: readonly (string | number)[], parts: readonly Q1MessagePart[] = []): Promise<string> {
    const product = this.assets.content.catalog.product(content).expectation;
    if (product.family !== 'q1') return text;
    if (product.edition !== 'rerelease' && !text.startsWith('$') && args.length === 0 && parts.length === 0) return text;
    const language = this.language();
    let languages = this.catalogs.get(content);
    if (languages === undefined) { languages = new Map<string, Promise<LocalizationCatalog>>(); this.catalogs.set(content, languages); }
    let catalog = languages.get(language);
    if (catalog === undefined) {
      catalog = (async () => {
        const mounts = await this.assets.content.forContent(content);
        const tier = async (name: string) => {
          const [base, mod] = await Promise.all([mounts.open(`localization/loc_${name}.txt`), mounts.open(`localization/loc_${name}_mod.txt`)]);
          return { base: base?.bytes ?? null, mods: mod === null ? [] : [mod.bytes] };
        };
        const [primary, fallback] = await Promise.all([tier(language), language === 'english' ? Promise.resolve({ base: null, mods: [] }) : tier('english')]);
        const table = new LocalizationCatalog(this.seat, 'q1-rerelease');
        table.loadOrdered(primary, fallback);
        if (primary.base === null && fallback.base === null) for (const mod of [...fallback.mods, ...primary.mods]) table.merge(mod);
        return table;
      })();
      languages.set(language, catalog);
    }
    const table = await catalog;
    const localize = (value: string, values: readonly (string | number)[]): string => {
      if (product.edition !== 'rerelease' && (value.startsWith('$') ? table.find(value.slice(1)) === undefined : true)) return classicQ1Text(value, values);
      if (value.startsWith('$') && table.find(value.slice(1)) === undefined) return value;
      const entry = value.startsWith('$') ? table.find(value.slice(1)) : undefined;
      if (entry !== undefined && values.some(argument => typeof argument === 'string' && argument.startsWith('$') && table.find(argument.slice(1)) === undefined)) {
        let result = '', start = 0;
        for (const slot of entry.arguments) {
          const argument = values[slot.argIndex]; if (argument === undefined) return value;
          const text = String(argument), known = !text.startsWith('$') || table.find(text.slice(1)) !== undefined;
          result += entry.format.slice(start, slot.start) + (known ? table.localize(text) : text); start = slot.end;
        }
        return result + entry.format.slice(start);
      }
      return table.localize(value, values.map(String));
    };
    return parts.length === 0 ? localize(text, args) : parts.map(part => localize(part.text, part.args ?? [])).join('');
  }
}
