import type { ItemId } from '../../../contracts/gameplay.ts';
import type { PlayerUi } from './types.ts';

export interface QuakeCWeaponUiBinding { readonly item: ItemId; readonly label: string; readonly bit: number; readonly impulse: number; }

/** The source selects its displayed ammo category in items and reports currentammo directly. */
export function quakeCWeaponUi(items: number, weapon: number, currentAmmo: number, bindings: readonly QuakeCWeaponUiBinding[]): Pick<PlayerUi, 'activeWeapon' | 'ammo' | 'items' | 'weaponStatus' | 'arsenalWarning'> {
  const active = bindings.find(binding => binding.bit === weapon);
  const ammunition: readonly { readonly bit: number; readonly item: ItemId }[] = [
    { bit: 256, item: 'q1:ammo/shells' }, { bit: 512, item: 'q1:ammo/nails' },
    { bit: 1024, item: 'q1:ammo/rockets' }, { bit: 2048, item: 'q1:ammo/cells' },
  ];
  const category = ammunition.find(value => (items & value.bit) !== 0);
  const ammo = category === undefined ? null : { item: category.item, count: currentAmmo };
  return { activeWeapon: active?.item ?? null, ammo, weaponStatus: null, arsenalWarning: 'none',
    items: bindings.map(binding => ({ id: binding.item, label: binding.label,
      kind: 'weapon', sourceOrdinal: binding.impulse, owned: (items & binding.bit) !== 0,
      hasAmmo: binding !== active || ammo === null || ammo.count > 0,
      count: binding === active ? ammo?.count ?? null : null, warningCount: 0 })) };
}
