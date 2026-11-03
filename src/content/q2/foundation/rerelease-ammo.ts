// SPDX-License-Identifier: GPL-2.0-or-later
/** Ammunition capacities of the Quake II rerelease game DLL. `tag` is the ammo index stored in each ammo gitem and indexes
 * client.pers.max_ammo[12]; `capacity` is what InitClientPersistant stores there; `bandolier` and `pack` are the ceilings
 * Pickup_Bandolier and Pickup_Pack raise it to (null where that pickup leaves the ammo alone). */
export interface Q2AmmoLimits {
  readonly tag: number;
  readonly capacity: number;
  readonly bandolier: number | null;
  readonly pack: number | null;
}

export const q2RereleaseAmmoLimits: Readonly<Record<string, Q2AmmoLimits>> = {
  ammo_bullets: { tag: 0, capacity: 200, bandolier: 250, pack: 300 },
  ammo_shells: { tag: 1, capacity: 100, bandolier: 150, pack: 200 },
  ammo_rockets: { tag: 2, capacity: 50, bandolier: null, pack: 100 },
  ammo_grenades: { tag: 3, capacity: 50, bandolier: null, pack: 100 },
  ammo_cells: { tag: 4, capacity: 200, bandolier: 250, pack: 300 },
  ammo_slugs: { tag: 5, capacity: 50, bandolier: 75, pack: 100 },
  ammo_magslug: { tag: 6, capacity: 50, bandolier: 75, pack: 100 },
  ammo_trap: { tag: 7, capacity: 5, bandolier: null, pack: null },
  ammo_flechettes: { tag: 8, capacity: 200, bandolier: 250, pack: 300 },
  ammo_tesla: { tag: 9, capacity: 5, bandolier: null, pack: null },
  ammo_disruptor: { tag: 10, capacity: 12, bandolier: 21, pack: 30 },
  ammo_prox: { tag: 11, capacity: 50, bandolier: null, pack: null },
};
